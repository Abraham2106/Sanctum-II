/**
 * DEC-0022: portable critic mesh loop (score gate + orchestrator without skipping gate).
 */

import { parseCriticJSON } from "../shared/mesh/parse";
import {
  MESH_DEFAULTS,
  type CriticEvaluation,
  type MeshAttemptRecord,
  type MeshRunResult,
  type MeshStatus,
  type OrchestratorAction,
} from "../shared/mesh/types";

export function normalizeMeshScore(raw: number): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return null;
  }
  if (raw < 0 || raw > 100) {
    return null;
  }
  return raw;
}

/** DEC-0022: accepted requires finite 0..100 score, threshold, and explicit accept verdict. */
export function passesAcceptGate(evaluation: CriticEvaluation, threshold: number): boolean {
  const score = normalizeMeshScore(evaluation.total_score);
  if (score === null) {
    return false;
  }
  return evaluation.verdict === "accept" && score >= threshold;
}

export function pickBestMeshAttempt(attempts: MeshAttemptRecord[]): MeshAttemptRecord | null {
  if (attempts.length === 0) {
    return null;
  }
  let best = attempts[0];
  for (const attempt of attempts) {
    const bestScore = normalizeMeshScore(best.evaluation.total_score) ?? -1;
    const score = normalizeMeshScore(attempt.evaluation.total_score) ?? -1;
    if (score > bestScore) {
      best = attempt;
    }
  }
  return best;
}

export interface MeshStepResult {
  content: string;
  usage: { prompt: number; completion: number };
}

export interface MeshRuntimePorts {
  runForager: (prompt: string, signal?: AbortSignal) => Promise<MeshStepResult>;
  runResearcher: (input: string, signal?: AbortSignal) => Promise<MeshStepResult>;
  runCritic: (input: string, signal?: AbortSignal) => Promise<MeshStepResult>;
  resolveOrchestratorAction?: (
    attempt: number,
    evaluation: CriticEvaluation,
    attempts: MeshAttemptRecord[],
  ) => Promise<OrchestratorAction | null>;
}

export interface MeshRuntimeOptions {
  userPrompt: string;
  projectId?: string;
  provenance?: string;
  maxAttempts?: number;
  acceptThreshold?: number;
  escalateThreshold?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function mergeAbortSignals(signals: AbortSignal[]): AbortSignal | undefined {
  const active = signals.filter(Boolean) as AbortSignal[];
  if (active.length === 0) {
    return undefined;
  }
  if (active.length === 1) {
    return active[0];
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const sig of active) {
    if (sig.aborted) {
      controller.abort(sig.reason);
      return controller.signal;
    }
    sig.addEventListener("abort", onAbort, { once: true });
  }
  return controller.signal;
}

function selectedFromAttempt(record: MeshAttemptRecord | null): MeshRunResult["selectedAttempt"] {
  if (!record) {
    return null;
  }
  const score = normalizeMeshScore(record.evaluation.total_score);
  return {
    output: record.output,
    score: score ?? 0,
    evaluation: record.evaluation,
    attempt: record.attempt,
  };
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

export async function runMeshCore(
  ports: MeshRuntimePorts,
  options: MeshRuntimeOptions,
): Promise<MeshRunResult> {
  const maxAttempts = options.maxAttempts ?? MESH_DEFAULTS.MAX_ATTEMPTS;
  const acceptThreshold = options.acceptThreshold ?? MESH_DEFAULTS.ACCEPT_THRESHOLD;
  const escalateThreshold = options.escalateThreshold ?? MESH_DEFAULTS.ESCALATE_THRESHOLD;
  const projectId = options.projectId ?? "";
  const provenance = options.provenance ?? "sanctum.mesh";

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutController = new AbortController();
  if (options.timeoutMs != null && options.timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timeoutController.abort(new Error("MESH_TIMEOUT"));
    }, options.timeoutMs);
  }

  const runSignal = mergeAbortSignals(
    [options.signal, timeoutController.signal].filter(Boolean) as AbortSignal[],
  );

  const clearTimers = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  };

  const attempts: MeshAttemptRecord[] = [];
  let foragerOutput = "";

  const throwIfAborted = () => {
    if (runSignal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
  };

  try {
    throwIfAborted();

    const forager = await ports.runForager(options.userPrompt, runSignal);
    foragerOutput = forager.content;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      throwIfAborted();

      const researcherInput =
        attempt === 1
          ? foragerOutput
          : buildRegenerationInput(foragerOutput, attempts);

      const researcher = await ports.runResearcher(researcherInput, runSignal);
      const criticInput = `Prompt original del usuario:\n${options.userPrompt}\n\nOutput del Researcher a evaluar:\n${researcher.content}`;
      const critic = await ports.runCritic(criticInput, runSignal);
      const evaluation = parseCriticJSON(critic.content);

      const record: MeshAttemptRecord = {
        attempt,
        output: researcher.content,
        evaluation,
        usage: researcher.usage,
      };
      attempts.push(record);

      if (passesAcceptGate(evaluation, acceptThreshold)) {
        clearTimers();
        return {
          status: "accepted",
          foragerOutput,
          attempts,
          selectedAttempt: selectedFromAttempt(record),
          projectId,
          provenance,
        };
      }

      let orchAction: OrchestratorAction | null = null;
      if (ports.resolveOrchestratorAction) {
        orchAction = await ports.resolveOrchestratorAction(attempt, evaluation, attempts);
      }

      if (orchAction === "accept" && !passesAcceptGate(evaluation, acceptThreshold)) {
        orchAction = "regenerate";
      }

      const score = normalizeMeshScore(evaluation.total_score) ?? 0;
      if (score <= escalateThreshold || orchAction === "escalate") {
        clearTimers();
        const best = pickBestMeshAttempt(attempts);
        return {
          status: "escalated",
          foragerOutput,
          attempts,
          selectedAttempt: selectedFromAttempt(best),
          projectId,
          provenance,
          escalationReason: evaluation.feedback_for_regeneration,
        };
      }

      const previousBest =
        attempts.length > 1
          ? Math.max(
              ...attempts.slice(0, -1).map((a) => normalizeMeshScore(a.evaluation.total_score) ?? -1),
            )
          : -1;

      if (attempt >= maxAttempts || (attempt > 1 && score < previousBest)) {
        clearTimers();
        const best = pickBestMeshAttempt(attempts);
        return {
          status: "needs_review",
          foragerOutput,
          attempts,
          selectedAttempt: selectedFromAttempt(best),
          projectId,
          provenance,
        };
      }

      if (orchAction === "regenerate" || orchAction === null) {
        continue;
      }
    }

    clearTimers();
    const best = pickBestMeshAttempt(attempts);
    return {
      status: "needs_review",
      foragerOutput,
      attempts,
      selectedAttempt: selectedFromAttempt(best),
      projectId,
      provenance,
    };
  } catch (err: unknown) {
    clearTimers();
    const best = pickBestMeshAttempt(attempts);
    const base = {
      foragerOutput,
      attempts,
      selectedAttempt: selectedFromAttempt(best),
      projectId,
      provenance,
      error: err instanceof Error ? err.message : String(err),
    };

    const timedOut =
      timeoutController.signal.aborted && !(options.signal?.aborted ?? false);
    if (isAbortError(err) || timedOut) {
      const status: MeshStatus = timedOut ? "timed_out" : "cancelled";
      return { status, ...base };
    }

    return { status: "failed", ...base };
  }
}

function buildRegenerationInput(foragerOutput: string, attempts: MeshAttemptRecord[]): string {
  const feedback = attempts.flatMap((a) => a.evaluation.feedback_for_regeneration);
  if (feedback.length === 0) {
    return foragerOutput;
  }
  return `${foragerOutput}\n\n---\nFeedback del Critic para regeneración:\n${feedback.map((f) => `- ${f}`).join("\n")}\n\nPor favor, regenera tu respuesta teniendo en cuenta todo el feedback acumulado. Especialmente mejora los criterios con puntuación más baja.`;
}
