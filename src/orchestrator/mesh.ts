import { loadAgentFromVault } from "../agents/agent-loader";
import { executeTurn } from "./agent-turn";
import type { GeminiBalancer } from "../embeddings/gemini-balancer";
import type { OpenCodeClient } from "../llm/opencode-client";
import type { VectorStore } from "../rag/vector-store";
import type { Tracer } from "../observability/tracer";

export interface MeshOptions {
  userPrompt: string;
  vaultAdapter: { read: (p: string) => Promise<string> };
  geminiBalancer: GeminiBalancer;
  vectorStore: VectorStore;
  opencodeClient: OpenCodeClient;
  tracer: Tracer;
  pathFilter?: string[];
  tavilyApiKey?: string;
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
}

export interface CriticEvaluation {
  total_score: number;
  threshold: number;
  verdict: "accept" | "reject";
  feedback_for_regeneration: string[];
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

function buildResearcherInput(foragerOutput: string, history: HistoryEntry[], attempt: number): string {
  let input = foragerOutput;
  if (attempt > 1) {
    const lastCritic = [...history].reverse().find(h => h.agent === "critic");
    if (lastCritic?.feedback && lastCritic.feedback.length > 0) {
      input += `\n\n---\nFeedback del Critic para regeneración:\n`;
      for (const fb of lastCritic.feedback) {
        input += `- ${fb}\n`;
      }
      input += `\nPor favor, regenera tu respuesta teniendo en cuenta este feedback.`;
    }
  }
  return input;
}

function buildCriticInput(originalPrompt: string, researcherOutput: string): string {
  return `Prompt original del usuario:\n${originalPrompt}\n\nOutput del Researcher a evaluar:\n${researcherOutput}`;
}

function parseCriticJSON(raw: string): CriticEvaluation {
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error("No JSON found");
    const jsonStr = raw.substring(start, end + 1);
    const parsed = JSON.parse(jsonStr);
    const ev = parsed.evaluation || parsed;
    const totalScore = ev.total_score ?? 80;
    const threshold = ev.threshold ?? 80;
    const verdict = ev.verdict === "reject" ? "reject" : "accept";
    const feedback = Array.isArray(ev.feedback_for_regeneration) ? ev.feedback_for_regeneration : [];
    return { total_score: totalScore, threshold, verdict, feedback_for_regeneration: feedback };
  } catch (err: any) {
    console.warn("Sanctum: fallo parseo de Critic JSON", err.message);
    return { total_score: 80, threshold: 80, verdict: "accept", feedback_for_regeneration: [] };
  }
}

function pickTurnDeps(opts: MeshOptions) {
  return {
    opencodeClient: opts.opencodeClient,
    geminiBalancer: opts.geminiBalancer,
    vectorStore: opts.vectorStore,
    tracer: opts.tracer,
    tavilyApiKey: opts.tavilyApiKey,
  };
}

export async function runMeshWithCritic(opts: MeshOptions): Promise<MeshResultFull> {
  const { userPrompt, vaultAdapter, tracer } = opts;

  const forager = await loadAgentFromVault(vaultAdapter, "forager.md");
  const researcher = await loadAgentFromVault(vaultAdapter, "researcher.md");
  const critic = await loadAgentFromVault(vaultAdapter, "critic.md");

  const traceId = tracer.start("mesh-orchestrator", "", userPrompt);

  const state: LoopState = {
    original_prompt: userPrompt,
    current_step: "forager",
    attempt: 1,
    max_attempts: 3,
    history: [],
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

    // Loop: Researcher ↔ Critic (up to 3 attempts)
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
      state.history.push({
        agent: "critic",
        output: criticResult.content,
        score: evaluation.total_score,
        verdict: evaluation.verdict,
        feedback: evaluation.feedback_for_regeneration,
        usage: criticResult.usage,
      });

      if (evaluation.verdict === "accept" || evaluation.total_score >= 80) {
        state.current_step = "done";
        await tracer.finish(bestResearcherOutput, {
          loopState: state,
          critic_score: evaluation.total_score,
          critic_verdict: "accept",
          attempts: state.attempt,
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

      if (state.attempt >= state.max_attempts) {
        state.current_step = "escalated";
        await tracer.finish(bestResearcherOutput, {
          loopState: state,
          critic_score: evaluation.total_score,
          critic_verdict: "escalated",
          attempts: state.attempt,
          feedback: evaluation.feedback_for_regeneration,
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

      state.attempt += 1;
      state.current_step = "research";
    }

    // Should not reach here, but TypeScript safety
    state.current_step = "escalated";
    return {
      foragerOutput: foragerResult.content,
      researcherOutput: bestResearcherOutput,
      criticVerdict: "escalated",
      attempts: state.attempt,
      loopState: state,
    };
  } catch (err: any) {
    tracer.abort(err.message);
    throw err;
  }
}
