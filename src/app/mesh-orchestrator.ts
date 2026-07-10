import { Notice } from "obsidian";
import type { AppServices } from "./services";
import { loadAgentFromVault } from "../agents/agent-loader";
import { executeTurn } from "../orchestrator/agent-turn";
import { parseCriticJSON } from "../orchestrator/mesh";
import type { LoopState, MeshResultFull, HistoryEntry, CriticEvaluation, AttemptRecord } from "../orchestrator/mesh";

const ACCEPT_THRESHOLD = 80;
const ESCALATE_THRESHOLD = 40;
const MAX_ATTEMPTS = 3;

function pickBestAttempt(attempts: AttemptRecord[]): AttemptRecord | null {
  if (attempts.length === 0) return null;
  return attempts.reduce((best, a) => a.total_score > best.total_score ? a : best);
}

/**
 * Orchestrates the Forager → Researcher ↔ Critic pipeline.
 */
export class MeshOrchestrator {
  constructor(private svc: AppServices) {}

  async execute(userPrompt: string, pathFilter?: string[]): Promise<MeshResultFull> {
    const vaultAdapter = this.svc.adapter;
    const tracer = this.svc.tracer;

    const forager = await loadAgentFromVault(vaultAdapter, "forager.md");
    const researcher = await loadAgentFromVault(vaultAdapter, "researcher.md");
    const critic = await loadAgentFromVault(vaultAdapter, "critic.md");

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
      // Step 1: Forager
      const foragerResult = await executeTurn(
        this.buildDeps(forager),
        userPrompt, false, pathFilter,
      );
      state.current_step = "research";
      state.history.push({ agent: "forager", output: foragerResult.content, usage: foragerResult.usage });

      let bestResearcherOutput = "";

      // Step 2: Researcher ↔ Critic loop
      while (state.attempt <= MAX_ATTEMPTS) {
        const researcherInput = this.buildResearcherInput(foragerResult.content, state.history, state.attempt);
        const researcherResult = await executeTurn(
          this.buildDeps(researcher),
          researcherInput, false, pathFilter,
        );
        state.history.push({ agent: "researcher", output: researcherResult.content, usage: researcherResult.usage });
        bestResearcherOutput = researcherResult.content;
        state.current_step = "critic_review";

        const criticInput = `Prompt original del usuario:\n${state.original_prompt}\n\nOutput del Researcher a evaluar:\n${researcherResult.content}`;
        const criticResult = await executeTurn(
          this.buildDeps(critic),
          criticInput, true,
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
          agent: "critic", output: criticResult.content,
          score: evaluation.total_score, verdict: evaluation.verdict,
          feedback: evaluation.feedback_for_regeneration, usage: criticResult.usage,
        });

        // Decision logic
        if (evaluation.total_score >= ACCEPT_THRESHOLD || evaluation.verdict === "accept") {
          state.current_step = "done";
          state.best_attempt = state.attempts.length - 1;
          await tracer.finish(bestResearcherOutput, { loopState: state, critic_score: evaluation.total_score, critic_verdict: "accept", attempts: state.attempt });
          return this.result(foragerResult.content, bestResearcherOutput, evaluation.total_score, "accept", state.attempt, state);
        }

        if (evaluation.total_score <= ESCALATE_THRESHOLD) {
          state.current_step = "escalated";
          state.best_attempt = state.attempts.length - 1;
          await tracer.finish(bestResearcherOutput, { loopState: state, critic_score: evaluation.total_score, critic_verdict: "escalated", attempts: state.attempt, feedback: evaluation.feedback_for_regeneration, reason: "score_below_escalate_threshold" });
          return this.result(foragerResult.content, bestResearcherOutput, evaluation.total_score, "escalated", state.attempt, state);
        }

        if (state.attempt >= MAX_ATTEMPTS) {
          const best = pickBestAttempt(state.attempts);
          if (best) bestResearcherOutput = best.researcherOutput;
          state.current_step = "done";
          state.best_attempt = best?.attempt ? best.attempt - 1 : 0;
          await tracer.finish(bestResearcherOutput, { loopState: state, critic_score: best?.total_score ?? evaluation.total_score, critic_verdict: "accept", attempts: state.attempt, reason: "max_attempts_reached" });
          return this.result(foragerResult.content, bestResearcherOutput, best?.total_score ?? evaluation.total_score, "accept", state.attempt, state);
        }

        const best = pickBestAttempt(state.attempts);
        if (best && state.attempt > 1 && evaluation.total_score <= best.total_score) {
          bestResearcherOutput = best.researcherOutput;
          state.current_step = "done";
          state.best_attempt = best.attempt - 1;
          await tracer.finish(bestResearcherOutput, { loopState: state, critic_score: best.total_score, critic_verdict: "accept", attempts: state.attempt, reason: "score_stalled" });
          return this.result(foragerResult.content, bestResearcherOutput, best.total_score, "accept", state.attempt, state);
        }

        state.attempt += 1;
        state.current_step = "research";
      }

      // Safety net
      state.current_step = "done";
      const best = pickBestAttempt(state.attempts);
      if (best) bestResearcherOutput = best.researcherOutput;
      return this.result(foragerResult.content, bestResearcherOutput, best?.total_score, "accept", state.attempt, state);
    } catch (err: any) {
      tracer.abort(err.message);
      throw err;
    }
  }

  private buildDeps(agent: any) {
    return {
      agent,
      opencodeClient: this.svc.opencodeClient,
      geminiBalancer: this.svc.geminiBalancer,
      vectorStore: this.svc.vectorStore,
      tracer: this.svc.tracer,
      tavilyApiKey: this.svc.settings?.tavilyApiKey,
      kgOptions: this.svc.kgOptions,
      edgeStore: this.svc.kgEdgeStore,
      projectContext: this.svc.activeProjectContext || undefined,
      skillContext: this.svc.skillContext || undefined,
    };
  }

  private buildResearcherInput(foragerOutput: string, history: any[], attempt: number): string {
    let input = foragerOutput;
    if (attempt > 1) {
      const criticEntries = history.filter(h => h.agent === "critic");
      if (criticEntries.length > 0) {
        input += `\n\n---\nFeedback del Critic para regeneración:\n`;
        for (const ce of criticEntries) {
          if (ce.feedback?.length > 0) {
            for (const fb of ce.feedback) input += `- ${fb}\n`;
          }
        }
        input += `\nPor favor, regenera tu respuesta teniendo en cuenta todo el feedback acumulado.`;
      }
    }
    return input;
  }

  private result(forager: string, researcher: string, score: number | undefined, verdict: "accept" | "escalated", attempts: number, state: LoopState): MeshResultFull {
    return {
      foragerOutput: forager,
      researcherOutput: researcher,
      criticScore: score,
      criticVerdict: verdict,
      attempts,
      loopState: state,
    };
  }
}
