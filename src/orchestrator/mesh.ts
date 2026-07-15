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

// ── Shared module types and functions (imported for local use, re-exported for consumers) ──
import { MESH_DEFAULTS } from "../shared/mesh/types";
import type { CriteriaScore, CriticEvaluation, AttemptRecord, HistoryEntry, LoopState, OrchestratorAction, OrchestratorDecision } from "../shared/mesh/types";
export type { CriteriaScore, CriticEvaluation, AttemptRecord, HistoryEntry, LoopState, OrchestratorAction, OrchestratorDecision } from "../shared/mesh/types";

import { parseCriticJSON, parseOrchestratorDecision } from "../shared/mesh/parse";
export { parseCriticJSON, parseOrchestratorDecision } from "../shared/mesh/parse";

import { buildResearcherInput, buildCriticInput, buildOrchestratorInput, pickBestAttempt, buildAttemptHistory } from "../shared/mesh/core";
export { buildResearcherInput, buildCriticInput, buildOrchestratorInput, pickBestAttempt, buildAttemptHistory } from "../shared/mesh/core";

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
}

const ACCEPT_THRESHOLD = MESH_DEFAULTS.ACCEPT_THRESHOLD;
const ESCALATE_THRESHOLD = MESH_DEFAULTS.ESCALATE_THRESHOLD;
const MAX_ATTEMPTS = MESH_DEFAULTS.MAX_ATTEMPTS;

async function resolveOrchestratorDecision(
  opts: MeshOptions,
  state: LoopState,
  evaluation: CriticEvaluation,
  orchestratorAgent: { system_prompt: string },
): Promise<"accept" | "escalate" | "regenerate"> {
  const orchestratorInput = buildOrchestratorInput(state, evaluation);
  const renderedPrompt = renderSystemPrompt(
    { id: "orchestrator", name: "orchestrator", avatar: "", model: "", description: "", triggers: [], tools: [], permissions: { read_paths: [], write_paths: [] }, system_prompt: orchestratorAgent.system_prompt },
    "",
    orchestratorInput,
  );

  try {
    const result = await opts.opencodeClient.chat(renderedPrompt, orchestratorInput);
    const decision = parseOrchestratorDecision(result.content);
    if (decision) {
      console.log(`[Mesh] Orchestrator decision: ${decision.action} — ${decision.reason}`);
      return decision.action;
    }
    console.warn("[Mesh] Orchestrator response unparseable, falling back to hardcoded thresholds. Raw:", result.content.slice(0, 200));
  } catch (err: any) {
    console.warn("[Mesh] Orchestrator invocation failed, falling back to hardcoded thresholds:", err.message);
  }

  if (evaluation.total_score >= ACCEPT_THRESHOLD) return "accept";
  if (evaluation.total_score <= ESCALATE_THRESHOLD) return "escalate";
  if (state.attempt >= state.max_attempts) return "accept";

  const bestScore = state.attempts.length > 1
    ? Math.max(...state.attempts.slice(0, -1).map(a => a.total_score))
    : 0;
  if (state.attempt > 1 && evaluation.total_score <= bestScore) return "accept";

  return "regenerate";
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

export async function runMeshWithCritic(opts: MeshOptions): Promise<MeshResultFull> {
  const { userPrompt, vaultAdapter, tracer } = opts;

  const forager = await loadAgentFromVault(vaultAdapter, `${BUILTIN_AGENTS.FORAGER}.md`);
  const researcher = await loadAgentFromVault(vaultAdapter, `${BUILTIN_AGENTS.RESEARCHER}.md`);
  const critic = await loadAgentFromVault(vaultAdapter, `${BUILTIN_AGENTS.CRITIC}.md`);
  const orchestrator = await loadAgentFromVault(vaultAdapter, `${BUILTIN_AGENTS.ORCHESTRATOR}.md`);

  const traceId = tracer.start("mesh-orchestrator", "", userPrompt);

  const state: LoopState = {
    original_prompt: userPrompt,
    current_step: "forager",
    attempt: 1,
    max_attempts: MAX_ATTEMPTS,
    history: [],
    attempts: [],
    best_attempt: 0,
  };

  try {
    const foragerResult = await executeTurn(
      { agent: forager, traceId, ...pickTurnDeps(opts) },
      userPrompt,
      false,
      opts.pathFilter,
    );
    state.current_step = "research";
    state.history.push({ agent: "forager", output: foragerResult.content, usage: foragerResult.usage });

    let bestResearcherOutput = "";

    while (state.attempt <= state.max_attempts) {
      const researcherInput = buildResearcherInput(foragerResult.content, state.history, state.attempt);

      const researcherResult = await executeTurn(
        { agent: researcher, traceId, ...pickTurnDeps(opts) },
        researcherInput,
        false,
        opts.pathFilter,
      );
      state.history.push({ agent: "researcher", output: researcherResult.content, usage: researcherResult.usage });
      bestResearcherOutput = researcherResult.content;
      state.current_step = "critic_review";

      const criticInput = buildCriticInput(state.original_prompt, researcherResult.content);
      const criticResult = await executeTurn(
        { agent: critic, traceId, ...pickTurnDeps(opts) },
        criticInput,
        true
      );
      const evaluation = parseCriticJSON(criticResult.content);

      const record: AttemptRecord = {
        attempt: state.attempt,
        researcherOutput: researcherResult.content,
        criteria: evaluation.criteria,
        total_score: evaluation.total_score,
        verdict: evaluation.verdict,
        feedback: evaluation.feedback_for_regeneration,
        usage: researcherResult.usage,
      };
      state.attempts.push(record);
      state.history.push({
        agent: "critic",
        output: criticResult.content,
        score: evaluation.total_score,
        verdict: evaluation.verdict,
        feedback: evaluation.feedback_for_regeneration,
        usage: criticResult.usage,
      });

      const action = await resolveOrchestratorDecision(opts, state, evaluation, orchestrator);

      if (action === "accept") {
        state.current_step = "done";
        state.best_attempt = state.attempts.length - 1;
        await tracer.finish(traceId, bestResearcherOutput, {
          loopState: state,
          critic_score: evaluation.total_score,
          critic_verdict: "accept",
          attempts: state.attempt,
          attempt_history: buildAttemptHistory(state),
        });
        return {
          foragerOutput: foragerResult.content,
          researcherOutput: bestResearcherOutput,
          criticScore: evaluation.total_score,
          criticVerdict: "accept",
          attempts: state.attempt,
          loopState: state,
        };
      }

      if (action === "escalate") {
        state.current_step = "escalated";
        state.best_attempt = state.attempts.length - 1;
        await tracer.finish(traceId, bestResearcherOutput, {
          loopState: state,
          critic_score: evaluation.total_score,
          critic_verdict: "escalated",
          attempts: state.attempt,
          feedback: evaluation.feedback_for_regeneration,
          reason: "escalated_by_orchestrator",
          attempt_history: buildAttemptHistory(state),
        });
        return {
          foragerOutput: foragerResult.content,
          researcherOutput: bestResearcherOutput,
          criticScore: evaluation.total_score,
          criticVerdict: "escalated",
          attempts: state.attempt,
          loopState: state,
        };
      }

      if (state.attempt >= state.max_attempts) {
        const best = pickBestAttempt(state);
        if (best) bestResearcherOutput = best.researcherOutput;
        state.current_step = "done";
        state.best_attempt = best?.attempt ? best.attempt - 1 : 0;
        await tracer.finish(traceId, bestResearcherOutput, {
          loopState: state,
          critic_score: best?.total_score ?? evaluation.total_score,
          critic_verdict: "accept",
          attempts: state.attempt,
          reason: "max_attempts_reached",
          attempt_history: buildAttemptHistory(state),
        });
        return {
          foragerOutput: foragerResult.content,
          researcherOutput: bestResearcherOutput,
          criticScore: best?.total_score ?? evaluation.total_score,
          criticVerdict: "accept",
          attempts: state.attempt,
          loopState: state,
        };
      }

      state.attempt += 1;
      state.current_step = "research";
    }

    state.current_step = "done";
    const best = pickBestAttempt(state);
    if (best) {
      bestResearcherOutput = best.researcherOutput;
      state.best_attempt = best.attempt - 1;
    }
    return {
      foragerOutput: foragerResult.content,
      researcherOutput: bestResearcherOutput,
      criticScore: best?.total_score,
      criticVerdict: "accept",
      attempts: state.attempt,
      loopState: state,
    };
  } catch (err: any) {
    tracer.abort(traceId, err.message);
    throw err;
  }
}
