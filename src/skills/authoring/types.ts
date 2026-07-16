import type { AgentAuthoringLLM, AgentTool, SkillDraft, ValidationIssue } from "../../agents/authoring/types";
import type { VaultAdapter } from "../../core/vault-adapter";
import type { GeminiBalancer } from "../../embeddings/gemini-balancer";
import type { OpenCodeClient } from "../../llm/opencode-client";
import type { Tracer } from "../../observability/tracer";
import type { ProjectContext } from "../../projects/context";
import type { VectorStore } from "../../rag/vector-store";
import type { TavilyResponse } from "../../tools/tavily";

export interface SkillGenerationRequest {
  description: string;
  id?: string;
  name?: string;
  tools?: AgentTool[];
  mode?: "create" | "update";
  targetId?: string;
}

export interface SkillGenerationResult {
  skill: SkillDraft;
  issues: ValidationIssue[];
  assumptions: string[];
  skillMarkdown: string;
}

export interface SkillAuthoringOptions {
  llm?: AgentAuthoringLLM;
  adapter?: VaultAdapter;
}

export interface SaveSkillOptions {
  overwrite?: boolean;
  archiveExisting?: boolean;
}

export interface SavedSkillArtifact {
  skillPath: string;
  historyPath?: string;
}

export type SkillAuthoringStage = "rag" | "web" | "author" | "critic" | "done" | "failed";

export interface SkillRagSource {
  notePath: string;
  score: number;
}

export interface SkillWebSource {
  title: string;
  url: string;
  score: number;
}

export interface SkillAuthoringProgress {
  stage: SkillAuthoringStage;
  attempt?: number;
  score?: number;
  message?: string;
  ragSources?: SkillRagSource[];
  webSources?: SkillWebSource[];
}

export interface SkillCriticScore {
  name: "contextual_grounding" | "domain_accuracy" | "web_currentness" | "sanctum_contract" | "edge_cases_output" | "clarity_density";
  score: number;
  note: string;
}

export interface SkillCriticEvaluation {
  criteria: SkillCriticScore[];
  totalScore: number;
  accepted: boolean;
  feedback: string[];
}

export interface SkillAuthoringMeshResult {
  status: "accepted" | "escalated";
  generation: SkillGenerationResult;
  score: number;
  attempts: number;
  feedback: string[];
  ragSources: SkillRagSource[];
  webSources: SkillWebSource[];
  traceId: string;
  saved?: SavedSkillArtifact;
}

export interface SkillAuthoringMeshOptions {
  adapter: VaultAdapter;
  opencodeClient: OpenCodeClient;
  geminiBalancer: GeminiBalancer;
  vectorStore: VectorStore;
  tracer: Tracer;
  tavilyApiKey?: string;
  projectContext?: ProjectContext | null;
  pathFilter?: string[];
  onProgress?: (progress: SkillAuthoringProgress) => void;
  searchWeb?: (query: string, maxResults?: number) => Promise<TavilyResponse>;
}
