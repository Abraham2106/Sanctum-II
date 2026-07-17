import { slugify } from "../../utils";
import { SUPPORTED_AGENT_TOOLS, type AgentDraft, type AgentTool, type SkillDraft, type ValidationIssue, type ValidationResult } from "./types";

const TOOL_SET = new Set<string>(SUPPORTED_AGENT_TOOLS);
const SAFE_PATH = /^\/?(?:[^/\0.][^/\0]*\/)*[^/\0]*\*{0,2}$/;

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

export function normalizeVaultPaths(values: string[] | undefined): string[] {
  return unique((values || []).map(value => {
    const normalized = value.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
    if (!normalized) return "";
    return normalized.startsWith("/") ? normalized : `/${normalized}`;
  }));
}

export function normalizeAgentDraft(input: Partial<AgentDraft>): AgentDraft {
  const name = String(input.name || "Nuevo agente").trim();
  const tools = unique((input.tools || []) as string[]) as AgentTool[];
  const triggers = (input.triggers || []).filter(trigger => trigger?.type === "mention").map(() => ({ type: "mention" as const }));
  return {
    id: slugify(String(input.id || name)),
    name,
    description: String(input.description || "").trim(),
    systemPrompt: String(input.systemPrompt || "").trim(),
    tools,
    permissions: {
      read_paths: normalizeVaultPaths(input.permissions?.read_paths),
      write_paths: normalizeVaultPaths(input.permissions?.write_paths),
    },
    ...(input.autoCheckTool?.trim() ? { autoCheckTool: input.autoCheckTool.trim() } : {}),
    ...(input.avatar?.trim() ? { avatar: input.avatar.trim() } : {}),
    ...(input.model?.trim() ? { model: input.model.trim() } : {}),
    ...(input.internal ? { internal: true } : {}),
    ...(triggers.length ? { triggers } : {}),
  };
}

function add(issues: ValidationIssue[], code: string, severity: ValidationIssue["severity"], field: string, message: string): void {
  issues.push({ code, severity, field, message });
}

export function validateAgentDraft(input: AgentDraft, options: { filename?: string; existingIds?: string[]; allowExisting?: boolean } = {}): ValidationResult<AgentDraft> {
  const value = normalizeAgentDraft(input);
  const issues: ValidationIssue[] = [];

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)) add(issues, "AGENT_ID_INVALID", "error", "id", "Usá un ID kebab-case con letras minúsculas, números y guiones.");
  if (!value.name || value.name.length > 80) add(issues, "AGENT_NAME_INVALID", "error", "name", "El nombre es obligatorio y debe tener como máximo 80 caracteres.");
  if (!value.description || value.description.length > 240) add(issues, "AGENT_DESCRIPTION_INVALID", "error", "description", "La descripción es obligatoria y debe tener como máximo 240 caracteres.");
  if (value.avatar && (/^(?:https?:|data:|file:)/i.test(value.avatar) || /\.(?:png|jpe?g|gif|webp|svg)(?:\?.*)?$/i.test(value.avatar))) {
    add(issues, "AGENT_AVATAR_IMAGE_UNSUPPORTED", "error", "avatar", "Elegí un icono Lucide; las URLs y archivos de imagen no son compatibles.");
  }
  if (!value.systemPrompt) add(issues, "AGENT_PROMPT_EMPTY", "error", "systemPrompt", "El agente necesita un system prompt.");
  else if (value.systemPrompt.length < 40) add(issues, "AGENT_PROMPT_SHORT", "warning", "systemPrompt", "El prompt es muy corto para expresar identidad y límites del agente.");
  if (!value.systemPrompt.includes("{{user_prompt}}")) add(issues, "PROMPT_USER_CONTEXT_MISSING", "error", "systemPrompt", "El prompt debe incluir {{user_prompt}}.");

  if (options.filename && options.filename.replace(/\\/g, "/").split("/").pop() !== `${value.id}.md`) {
    add(issues, "AGENT_FILENAME_MISMATCH", "error", "id", `El archivo debe llamarse ${value.id}.md.`);
  }
  if (!options.allowExisting && options.existingIds?.includes(value.id)) add(issues, "AGENT_ID_EXISTS", "error", "id", "Ya existe un agente con este ID.");

  for (const tool of value.tools) {
    if (!TOOL_SET.has(tool)) add(issues, "AGENT_TOOL_UNKNOWN", "error", "tools", `Tool no soportada: ${tool}.`);
  }
  if (value.tools.includes("rag_query")) {
    if (!value.permissions.read_paths.length) add(issues, "RAG_READ_PATH_REQUIRED", "error", "permissions.read_paths", "rag_query requiere al menos una ruta de lectura explícita.");
    if (!value.systemPrompt.includes("{{rag_context}}")) add(issues, "RAG_CONTEXT_MISSING", "error", "systemPrompt", "rag_query requiere {{rag_context}} en el prompt.");
  }
  if (value.autoCheckTool && value.autoCheckTool !== "sanctum_validate_qubo") {
    add(issues, "AUTO_CHECK_TOOL_UNKNOWN", "error", "auto_check", `Tool de auto-chequeo no soportada: ${value.autoCheckTool}.`);
  }
  if (value.autoCheckTool === "sanctum_validate_qubo" && !value.permissions.read_paths.length) {
    add(issues, "AUTO_CHECK_READ_PATH_REQUIRED", "error", "permissions.read_paths", "sanctum_validate_qubo requiere rutas de lectura explícitas para el contexto RAG.");
  }
  if (value.tools.includes("web_search") && !value.systemPrompt.includes("{{web_context}}")) add(issues, "WEB_CONTEXT_MISSING", "error", "systemPrompt", "web_search requiere {{web_context}} en el prompt.");
  if ((value.tools.includes("create_note") || value.tools.includes("append_to_note")) && !value.permissions.write_paths.length) {
    add(issues, "WRITE_PATH_REQUIRED", "error", "permissions.write_paths", "Las tools de escritura requieren rutas de escritura explícitas.");
  }
  for (const path of [...value.permissions.read_paths, ...value.permissions.write_paths]) {
    if (!SAFE_PATH.test(path) || path.includes("..") || path.includes("\0")) add(issues, "VAULT_PATH_INVALID", "error", "permissions", `Ruta inválida o insegura: ${path}.`);
  }
  if (value.internal && value.triggers?.some(trigger => trigger.type === "mention")) add(issues, "INTERNAL_MENTION", "error", "triggers", "Un agente interno no debe exponerse por @mención.");
  if (/^(ayuda|asistente|agente)\b/i.test(value.description)) add(issues, "DESCRIPTION_GENERIC", "warning", "description", "La descripción debería explicar una capacidad concreta.");

  return { value, issues, valid: !issues.some(issue => issue.severity === "error") };
}

export function validateSkillDraft(input: SkillDraft): ValidationResult<SkillDraft> {
  const value: SkillDraft = {
    id: slugify(input.id || input.name),
    name: String(input.name || "").trim(),
    description: String(input.description || "").trim(),
    instructions: String(input.instructions || "").trim(),
    tools: unique(input.tools || []) as AgentTool[],
  };
  const issues: ValidationIssue[] = [];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)) add(issues, "SKILL_ID_INVALID", "error", "id", "El ID de la skill debe estar en kebab-case.");
  if (!value.name) add(issues, "SKILL_NAME_EMPTY", "error", "name", "La skill necesita un nombre.");
  if (!value.description) add(issues, "SKILL_DESCRIPTION_EMPTY", "error", "description", "La skill necesita una descripción recuperable.");
  if (!value.instructions) add(issues, "SKILL_BODY_EMPTY", "error", "instructions", "La skill necesita instrucciones operativas.");
  for (const tool of value.tools) {
    if (!TOOL_SET.has(tool)) add(issues, "SKILL_TOOL_UNKNOWN", "error", "tools", `Tool no soportada: ${tool}.`);
  }
  return { value, issues, valid: !issues.some(issue => issue.severity === "error") };
}
