import { loadAgentFromVault, renderSystemPrompt } from "../agents/agent-loader";
import { executeTurn } from "./agent-turn";
import type { GeminiBalancer } from "../embeddings/gemini-balancer";
import type { OpenCodeClient } from "../llm/opencode-client";
import type { VectorStore } from "../rag/vector-store";
import type { Tracer } from "../observability/tracer";
import type { KgOptions } from "../kg/types";
import type { KgEdgeStore } from "../kg/kg-store";
import type { ProjectContext } from "../projects/context";
import type { Skill } from "../skills/types";
import { BUILTIN_AGENTS } from "../constants";

import { MESH_DEFAULTS } from "../shared/mesh/types";
import type { AttemptRecord, HistoryEntry, LoopState, MeshRunResult } from "../shared/mesh/types";

import { parseCriticJSON, parseOrchestratorDecision } from "../shared/mesh/parse";
export { parseCriticJSON } from "../shared/mesh/parse";

import { buildOrchestratorInput, buildAttemptHistory } from "../shared/mesh/core";
import { runMeshCore } from "../runtime/mesh";

import type { MeshResultFull } from "./mesh-types";
export type { MeshResultFull } from "./mesh-types";

export interface MeshOptions {
  userPrompt: string;
  vaultAdapter: { read: (p: string) => Promise<string> };
  geminiBalancer: GeminiBalancer;
  vectorStore: VectorStore;
  opencodeClient: OpenCodeClient;
  tracer: Tracer;
  pathFilter?: string[];
  tavilyApiKey?: string;
  kgOptions?: KgOptions;
  edgeStore?: KgEdgeStore;
  projectContext?: ProjectContext;
  skillContext?: Skill;
  projectId?: string;
  signal?: AbortSignal;
}

function pickTurnDeps(opts: MeshOptions) {
  return {
    opencodeClient: opts.opencodeClient,
    geminiBalancer: opts.geminiBalancer,
    vectorStore: opts.vectorStore,
    tracer: opts.tracer,
    tavilyApiKey: opts.tavilyApiKey,
    kgOptions: opts.kgOptions,
    edgeStore: opts.edgeStore,
    projectContext: opts.projectContext,
    skillContext: opts.skillContext,
  };
}

function loopStateFromCore(userPrompt: string, coreAttempts: MeshRunResult): LoopState {
  const attempts: AttemptRecord[] = coreAttempts.attempts.map((a) => ({
    attempt: a.attempt,
    researcherOutput: a.output,
    criteria: a.evaluation.criteria,
    total_score: a.evaluation.total_score,
    verdict: a.evaluation.verdict,
    feedback: a.evaluation.feedback_for_regeneration,
    usage: a.usage,
  }));

  const history: HistoryEntry[] = [];
  if (coreAttempts.foragerOutput) {
    history.push({ agent: "forager", output: coreAttempts.foragerOutput });
  }
  for (const a of coreAttempts.attempts) {
    history.push({ agent: "researcher", output: a.output, usage: a.usage });
    history.push({
      agent: "critic",
      output: JSON.stringify(a.evaluation),
      score: a.evaluation.total_score,
      verdict: a.evaluation.verdict,
      feedback: a.evaluation.feedback_for_regeneration,
    });
  }

  const bestIdx = coreAttempts.selectedAttempt
    ? coreAttempts.selectedAttempt.attempt - 1
    : attempts.length > 0
      ? 0
      : 0;

  let current_step: LoopState["current_step"] = "done";
  if (coreAttempts.status === "escalated") {
    current_step = "escalated";
  }

  return {
    original_prompt: userPrompt,
    current_step,
    attempt: attempts.length,
    max_attempts: MESH_DEFAULTS.MAX_ATTEMPTS,
    history,
    attempts,
    best_attempt: bestIdx,
  };
}

function mapCriticVerdict(status: MeshResultFull["meshStatus"]): MeshResultFull["criticVerdict"] {
  if (status === "accepted") {
    return "accept";
  }
  if (status === "escalated") {
    return "escalated";
  }
  if (status === "needs_review") {
    return "needs_review";
  }
  return "reject";
}

export async function runMeshWithCritic(opts: MeshOptions): Promise<MeshResultFull> {
  const { userPrompt, vaultAdapter, tracer } = opts;

  const forager = await loadAgentFromVault(vaultAdapter, `${BUILTIN_AGENTS.FORAGER}.md`);
  const researcher = await loadAgentFromVault(vaultAdapter, `${BUILTIN_AGENTS.RESEARCHER}.md`);
  const critic = await loadAgentFromVault(vaultAdapter, `${BUILTIN_AGENTS.CRITIC}.md`);
  const orchestrator = await loadAgentFromVault(vaultAdapter, `${BUILTIN_AGENTS.ORCHESTRATOR}.md`);

  const traceId = tracer.start("mesh-orchestrator", "", userPrompt);
  const turnDeps = pickTurnDeps(opts);

  try {
    const core = await runMeshCore(
      {
        runForager: async (prompt, signal) => {
          const result = await executeTurn(
            { agent: forager, traceId, ...turnDeps },
            prompt,
            false,
            opts.pathFilter,
          );
          void signal;
          return result;
        },
        runResearcher: async (input, signal) => {
          const result = await executeTurn(
            { agent: researcher, traceId, ...turnDeps },
            input,
            false,
            opts.pathFilter,
          );
          void signal;
          return result;
        },
        runCritic: async (input, signal) => {
          const result = await executeTurn({ agent: critic, traceId, ...turnDeps }, input, true);
          void signal;
          return result;
        },
        resolveOrchestratorAction: async (attempt, evaluation, attempts) => {
          const state: LoopState = {
            original_prompt: userPrompt,
            current_step: "critic_review",
            attempt,
            max_attempts: MESH_DEFAULTS.MAX_ATTEMPTS,
            history: [],
            attempts: attempts.map((a) => ({
              attempt: a.attempt,
              researcherOutput: a.output,
              criteria: a.evaluation.criteria,
              total_score: a.evaluation.total_score,
              verdict: a.evaluation.verdict,
              feedback: a.evaluation.feedback_for_regeneration,
              usage: a.usage,
            })),
            best_attempt: 0,
          };

          const orchestratorInput = buildOrchestratorInput(state, evaluation);
          const renderedPrompt = renderSystemPrompt(
            {
              id: "orchestrator",
              name: "orchestrator",
              avatar: "",
              model: "",
              description: "",
              triggers: [],
              tools: [],
              permissions: { read_paths: [], write_paths: [] },
              system_prompt: orchestrator.system_prompt,
            },
            "",
            orchestratorInput,
          );

          try {
            const result = await opts.opencodeClient.chat(renderedPrompt, orchestratorInput, undefined, {
              signal: opts.signal,
            });
            const decision = parseOrchestratorDecision(result.content);
            if (decision) {
              console.error(`[Mesh] Orchestrator decision: ${decision.action} — ${decision.reason}`);
              return decision.action;
            }
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn("[Mesh] Orchestrator invocation failed:", message);
          }
          return null;
        },
      },
      {
        userPrompt,
        projectId: opts.projectId ?? opts.projectContext?.project?.id ?? "",
        provenance: "sanctum.plugin.mesh",
        signal: opts.signal,
      },
    );

    const loopState = loopStateFromCore(userPrompt, core);
    const researcherOutput = core.selectedAttempt?.output ?? "";
    const criticScore = core.selectedAttempt?.score;
    const meshStatus = core.status;
    const criticVerdict = mapCriticVerdict(meshStatus);

    await tracer.finish(traceId, researcherOutput, {
      loopState,
      critic_score: criticScore,
      critic_verdict: criticVerdict,
      mesh_status: meshStatus,
      attempts: core.attempts.length,
      attempt_history: buildAttemptHistory(loopState),
    });

    if (core.status === "failed") {
      throw new Error(core.error ?? "Mesh failed");
    }

    return {
      foragerOutput: core.foragerOutput,
      researcherOutput,
      criticScore,
      criticVerdict,
      meshStatus,
      attempts: core.attempts.length,
      loopState,
      meshCore: core,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    tracer.abort(traceId, message);
    throw err;
  }
}
