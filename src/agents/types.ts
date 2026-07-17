export interface AgentPermissions {
  read_paths: string[];
  write_paths: string[];
}

export interface AgentDefinition {
  id: string;
  name: string;
  avatar: string;
  model: string;
  description: string;
  triggers: { type: string }[];
  tools: string[];
  permissions: AgentPermissions;
  system_prompt: string;
  /** Optional MCP tool executed against the final answer before delivery. */
  auto_check_tool?: string;
  internal?: boolean;
}
