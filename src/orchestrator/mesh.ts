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

export interface CriteriaScore {
  name: string;
  score: number;
  note: string;
}

export interface CriticEvaluation {
  criteria: CriteriaScore[];
  total_score: number;
  threshold: number;
  verdict: "accept" | "reject";
  feedback_for_regeneration: string[];
}

export interface AttemptRecord {
  attempt: number;
  researcherOutput: string;
  criteria: CriteriaScore[];
  total_score: number;
  verdict: "accept" | "reject";
  feedback: string[];
  usage?: { prompt: number; completion: number };
}

export interface HistoryEntry {
  agent: string;
  output: string;
  score?: number;
  verdict?: "accept" | "reject";
  feedback?: string[];
  usage?: { prompt: number; completion: number };
}

export interface LoopState {
  original_prompt: string;
  current_step: "forager" | "research" | "critic_review" | "done" | "escalated";
  attempt: number;
  max_attempts: number;
  history: HistoryEntry[];
  attempts: AttemptRecord[];
  best_attempt: number;
}

export interface MeshResultFull {
  foragerOutput: string;
  researcherOutput: string;
  criticScore?: number;
  criticVerdict: "accept" | "escalated";
  attempts: number;
  loopState: LoopState;
  createdNotePath?: string;
}

const ACCEPT_THRESHOLD = 80;
const ESCALATE_THRESHOLD = 40;
const MAX_ATTEMPTS = 3;

type OrchestratorAction = "accept" | "escalate" | "regenerate";

interface OrchestratorDecision {
  action: OrchestratorAction;
  reason: string;
}

function buildResearcherInput(foragerOutput: string, history: HistoryEntry[], attempt: number): string {
  let input = foragerOutput;
  if (attempt > 1) {
    const criticEntries = history.filter(h => h.agent === "critic");
    if (criticEntries.length > 0) {
      input += `\n\n---\nFeedback del Critic para regeneración:\n`;
      for (const ce of criticEntries) {
        if (ce.feedback && ce.feedback.length > 0) {
          for (const fb of ce.feedback) {
            input += `- ${fb}\n`;
          }
        }
      }
      input += `\nPor favor, regenera tu respuesta teniendo en cuenta todo el feedback acumulado. Especialmente mejora los criterios con puntuación más baja.`;
    }
  }
  return input;
}

function buildCriticInput(originalPrompt: string, researcherOutput: string): string {
  return `Prompt original del usuario:\n${originalPrompt}\n\nOutput del Researcher a evaluar:\n${researcherOutput}`;
}

export function parseCriticJSON(raw: string): CriticEvaluation {
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error("No JSON found");
    const jsonStr = raw.substring(start, end + 1);
    const parsed = JSON.parse(jsonStr);
    const ev = parsed.evaluation || parsed;

    const criteria: CriteriaScore[] = [];
    if (Array.isArray(ev.criteria)) {
      for (const c of ev.criteria) {
        criteria.push({
          name: String(c.name ?? ""),
          score: typeof c.score === "number" ? c.score : 0,
          note: String(c.note ?? ""),
        });
      }
    }

    const totalScore = ev.total_score ?? 80;
    const threshold = ev.threshold ?? 80;
    const verdict = ev.verdict === "reject" ? ("reject" as const) : ("accept" as const);
    const feedback = Array.isArray(ev.feedback_for_regeneration) ? ev.feedback_for_regeneration : [];

    if (criteria.length === 0) {
      for (const name of ["coherencia_interna", "uso_de_fuentes", "completitud_vs_prompt", "actualidad_de_datos", "claridad_de_escritura"]) {
        const score = ev[name];
        if (typeof score === "number") {
          criteria.push({ name, score, note: "" });
        }
      }
    }

    return { criteria, total_score: totalScore, threshold, verdict, feedback_for_regeneration: feedback };
  } catch (err: any) {
    console.warn("Sanctum: fallo parseo de Critic JSON", err.message);
    return {
      criteria: [],
      total_score: 80,
      threshold: 80,
      verdict: "accept",
      feedback_for_regeneration: [],
    };
  }
}

function parseOrchestratorDecision(raw: string): OrchestratorDecision | null {
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    const jsonStr = raw.substring(start, end + 1);
    const parsed = JSON.parse(jsonStr);
    const action = parsed.action;
    if (action === "accept" || action === "escalate" || action === "regenerate") {
      return { action, reason: parsed.reason || "" };
    }
    return null;
  } catch {
    return null;
  }
}

function buildOrchestratorInput(state: LoopState, evaluation: CriticEvaluation): string {
  const historySummary = state.history.map(h => {
    if (h.agent === "critic") {
      return `[${h.agent}] score=${h.score}, verdict=${h.verdict}, feedback=${JSON.stringify(h.feedback)}`;
    }
    return `[${h.agent}] output (first 200 chars): ${h.output.slice(0, 200)}`;
  }).join("\n");

  return `Loop state actual:
- original_prompt: "${state.original_prompt}"
- current_step: ${state.current_step}
- attempt: ${state.attempt} / max_attempts: ${state.max_attempts}

Historial del loop:
${historySummary}

Última evaluación del Critic:
- total_score: ${evaluation.total_score}
- threshold: ${evaluation.threshold}
- verdict: ${evaluation.verdict}
- criteria: ${JSON.stringify(evaluation.criteria.map(c => ({ name: c.name, score: c.score, note: c.note })))}
- feedback_for_regeneration: ${JSON.stringify(evaluation.feedback_for_regeneration)}
- best_total_score so far: ${state.attempts.length > 0 ? Math.max(...state.attempts.map(a => a.total_score)) : "N/A"}

Decidí el siguiente paso.`;
}

async function resolveOrchestratorDecision(
  opts: MeshOptions,
  state: LoopState,
  evaluation: CriticEvaluation,
  orchestratorAgent: { system_prompt: string },
): Promise<OrchestratorAction> {
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

  // Fallback to hardcoded thresholds
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

function pickBestAttempt(state: LoopState): AttemptRecord | null {
  if (state.attempts.length === 0) return null;
  let best = state.attempts[0];
  for (const a of state.attempts) {
    if (a.total_score > best.total_score) best = a;
  }
  return best;
}

function buildAttemptHistory(state: LoopState) {
  return state.attempts.map(a => ({
    attempt: a.attempt,
    total_score: a.total_score,
    criteria: a.criteria,
  }));
}

export async function runMeshWithCritic(opts: MeshOptions): Promise<MeshResultFull> {
  const { userPrompt, vaultAdapter, tracer } = opts;

  const forager = await loadAgentFromVault(vaultAdapter, "forager.md");
  const researcher = await loadAgentFromVault(vaultAdapter, "researcher.md");
  const critic = await loadAgentFromVault(vaultAdapter, "critic.md");
  const orchestrator = await loadAgentFromVault(vaultAdapter, "orchestrator.md");

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
    // Step 1: Forager (once)
    const foragerResult = await executeTurn(
      { agent: forager, ...pickTurnDeps(opts) },
      userPrompt,
      false,
      opts.pathFilter,
    );
    state.current_step = "research";
    state.history.push({ agent: "forager", output: foragerResult.content, usage: foragerResult.usage });

    let bestResearcherOutput = "";

    // Loop: Researcher ↔ Critic ↔ Orchestrator
    while (state.attempt <= state.max_attempts) {
      const researcherInput = buildResearcherInput(foragerResult.content, state.history, state.attempt);

      const researcherResult = await executeTurn(
        { agent: researcher, ...pickTurnDeps(opts) },
        researcherInput,
        false,
        opts.pathFilter,
      );
      state.history.push({ agent: "researcher", output: researcherResult.content, usage: researcherResult.usage });
      bestResearcherOutput = researcherResult.content;
      state.current_step = "critic_review";

      const criticInput = buildCriticInput(state.original_prompt, researcherResult.content);
      const criticResult = await executeTurn(
        { agent: critic, ...pickTurnDeps(opts) },
        criticInput,
        true
      );
      const evaluation = parseCriticJSON(criticResult.content);

      // Record this attempt
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

      // Orchestrator decides the next step
      const action = await resolveOrchestratorDecision(opts, state, evaluation, orchestrator);

      if (action === "accept") {
        state.current_step = "done";
        state.best_attempt = state.attempts.length - 1;
        await tracer.finish(bestResearcherOutput, {
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
        await tracer.finish(bestResearcherOutput, {
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

      // action === "regenerate"
      // If we're already at max_attempts, accept the best (safety net)
      if (state.attempt >= state.max_attempts) {
        const best = pickBestAttempt(state);
        if (best) bestResearcherOutput = best.researcherOutput;
        state.current_step = "done";
        state.best_attempt = best?.attempt ? best.attempt - 1 : 0;
        await tracer.finish(bestResearcherOutput, {
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

    // Safety net (should not normally reach here)
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
    tracer.abort(err.message);
    throw err;
  }
}
