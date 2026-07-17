import type { VaultAdapter } from "../../core/vault-adapter";

export const SUPPORTED_AGENT_TOOLS = [
  "rag_query",
  "web_search",
  "create_note",
  "append_to_note",
] as const;

export type AgentTool = typeof SUPPORTED_AGENT_TOOLS[number];

export interface AgentPermissionDraft {
  read_paths: string[];
  write_paths: string[];
}

export interface AgentTriggerDraft {
  type: "mention";
}

/** Authoring representation: optional fields are deliberately not defaulted until load time. */
export interface AgentDraft {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: AgentTool[];
  permissions: AgentPermissionDraft;
  autoCheckTool?: string;
  avatar?: string;
  model?: string;
  internal?: boolean;
  triggers?: AgentTriggerDraft[];
}

export interface SkillDraft {
  id: string;
  name: string;
  description: string;
  instructions: string;
  tools: AgentTool[];
}

export interface AgentGenerationRequest {
  description: string;
  id?: string;
  name?: string;
  avatar?: string;
  model?: string;
  internal?: boolean;
  mention?: boolean;
  tools?: AgentTool[];
  readPaths?: string[];
  writePaths?: string[];
  includeSkill?: boolean;
  skillName?: string;
  autoCheckTool?: string;
}

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning";
  field: string;
  message: string;
}

export interface ValidationResult<T> {
  value: T;
  issues: ValidationIssue[];
  valid: boolean;
}

export interface AgentGenerationResult {
  agent: AgentDraft;
  skill?: SkillDraft;
  issues: ValidationIssue[];
  assumptions: string[];
  agentMarkdown: string;
  skillMarkdown?: string;
}

export interface AgentAuthoringLLM {
  chat(messages: { role: "system" | "user"; content: string }[]): Promise<{ content: string }>;
}

export interface AgentAuthoringOptions {
  llm?: AgentAuthoringLLM;
  adapter?: VaultAdapter;
}

export interface SaveAgentOptions {
  overwrite?: boolean;
}

export interface SavedAgentArtifacts {
  agentPath: string;
  skillPath?: string;
}
