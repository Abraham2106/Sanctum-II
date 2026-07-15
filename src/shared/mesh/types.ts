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

export type OrchestratorAction = "accept" | "escalate" | "regenerate";

export interface OrchestratorDecision {
  action: OrchestratorAction;
  reason: string;
}

export const MESH_DEFAULTS = {
  MAX_ATTEMPTS: 3,
  ACCEPT_THRESHOLD: 80,
  ESCALATE_THRESHOLD: 40,
} as const;
