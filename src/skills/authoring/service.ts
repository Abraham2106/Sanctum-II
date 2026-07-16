import { serializeFrontmatter } from "../../shared/agents/frontmatter";
import { ensureVaultDirectory } from "../../core/vault-fs";
import { slugify } from "../../utils";
import { AgentAuthoringError } from "../../agents/authoring/service";
import { validateSkillDraft } from "../../agents/authoring/validator";
import { SUPPORTED_AGENT_TOOLS, type AgentTool, type SkillDraft, type ValidationIssue } from "../../agents/authoring/types";
import type { SaveSkillOptions, SavedSkillArtifact, SkillAuthoringOptions, SkillGenerationRequest, SkillGenerationResult } from "./types";

const SKILLS_DIR = "sanctum-skills";
const TOOL_SET = new Set<string>(SUPPORTED_AGENT_TOOLS);

const GENERATOR_SYSTEM_PROMPT = `Sos un diseñador de skills para Sanctum-II. Convertí el brief en un objeto JSON, no en Markdown.
Una skill es un flujo reusable, no un agente: no incluyas identidad persistente, avatar, modelo, permisos ni triggers.
El objeto debe incluir id, name, description e instructions. Usá solamente las tools indicadas en el brief.
La description debe explicar qué hace y cuándo conviene invocarla. Las instructions deben ser operativas, concretas, en imperativo y sin relleno.
Incluí {{user_prompt}}. Incluí {{rag_context}} si usa rag_query y {{web_context}} si usa web_search.
Definí proceso interno sin narrarlo, reglas de contenido, formato de salida, límites y comportamiento cuando falten datos. Respondé solamente con JSON.`;

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asTools(value: unknown): AgentTool[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((tool): tool is AgentTool => typeof tool === "string" && TOOL_SET.has(tool)))];
}

export function extractSkillJson(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("La respuesta del generador no contiene JSON válido.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function normalizeForMatching(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Infer only capabilities explicitly named in the user's brief. */
export function inferSkillTools(description: string): AgentTool[] {
  const text = normalizeForMatching(description).replace(/_/g, "-");
  const tools: AgentTool[] = [];
  if (/\b(?:web-search|busqueda web|buscar en (?:la )?web|internet)\b/.test(text)) tools.push("web_search");
  if (/\b(?:rag-query|rag|vault|notas? (?:internas?|del vault))\b/.test(text)) tools.push("rag_query");
  if (/\b(?:create-note|crear (?:una )?nota|guardar (?:como )?nota)\b/.test(text)) tools.push("create_note");
  if (/\b(?:append-to-note|anexar (?:a )?(?:una )?nota|agregar (?:a|en) (?:una )?nota existente)\b/.test(text)) tools.push("append_to_note");
  return tools;
}

export function finalizeSkillDraft(
  request: SkillGenerationRequest,
  proposed: Record<string, unknown>,
  assumptions: string[] = [],
): SkillGenerationResult {
  const inferredTools = inferSkillTools(request.description);
  const tools = request.tools !== undefined ? asTools(request.tools) : inferredTools;
  const name = request.name || asString(proposed.name) || fallbackName(request.description);
  const id = slugify(request.targetId || request.id || asString(proposed.id) || name);
  const description = asString(proposed.description) || request.description.trim();
  const proposedTools = asTools(proposed.tools);
  if (proposedTools.some(tool => !tools.includes(tool))) assumptions.push("Se ignoraron tools no solicitadas propuestas por la IA.");
  const instructions = ensurePromptContract(asString(proposed.instructions), name, request.description, tools, assumptions);
  const checked = validateSkillDraft({ id, name, description, tools, instructions });
  const issues = [...checked.issues, ...contractIssues(checked.value)];
  return {
    skill: checked.value,
    issues,
    assumptions,
    skillMarkdown: serializeSkillMarkdown(checked.value),
  };
}

function conciseSubject(description: string): string {
  const withoutHints = description.replace(/\([^)]*(?:uses?|usa|tools?)[^)]*\)/gi, " ").trim();
  const subject = withoutHints
    .replace(/^(?:create|build|make|design|write)\s+(?:me\s+)?a\s+skill\s+(?:for|to)\s+/i, "")
    .replace(/^(?:crea|crear|haz|diseña|genera)(?:me)?\s+(?:una\s+)?skill\s+(?:para|que)\s+/i, "")
    .replace(/^(?:a|una)\s+skill\s+(?:for|para)\s+/i, "")
    .trim();
  return subject || "Nueva skill";
}

function fallbackName(description: string): string {
  const subject = conciseSubject(description).replace(/[.!?].*$/s, "").trim().slice(0, 60);
  return subject
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ") || "Nueva Skill";
}

function fallbackInstructions(name: string, description: string, tools: AgentTool[]): string {
  const lines = [
    `Aplicá el flujo ${name} para cumplir esta intención: ${description.trim()}`,
    "",
    "PROCESO INTERNO (NO LO NARRES)",
    "1. Identificá el objetivo, las restricciones y el entregable solicitado.",
    "2. Reuní solo la información necesaria y comprobá que respalde la respuesta.",
    "3. Entregá el resultado directamente, sin describir pasos internos.",
    "",
    "REGLAS",
    "- Priorizá instrucciones concretas, resultados verificables y una estructura acorde al contenido.",
    "- No inventes datos ni fuentes. Si falta información indispensable, indicá exactamente qué falta.",
  ];
  if (tools.includes("rag_query")) lines.push("- Usá el contexto del vault y citá las notas relevantes con [[wikilinks]].");
  if (tools.includes("web_search")) lines.push("- Contrastá el contexto web y citá las afirmaciones verificables con enlaces directos.");
  if (tools.includes("create_note")) lines.push("- Creá una nota solo cuando el pedido requiera persistir el entregable.");
  if (tools.includes("append_to_note")) lines.push("- Anexá contenido solo a la nota que el usuario identifique.");
  if (tools.includes("rag_query")) lines.push("", "Contexto del vault:", "{{rag_context}}");
  if (tools.includes("web_search")) lines.push("", "Contexto web:", "{{web_context}}");
  lines.push("", "Pedido del usuario:", "{{user_prompt}}");
  return lines.join("\n");
}

function ensurePromptContract(instructions: string | undefined, name: string, description: string, tools: AgentTool[], assumptions: string[]): string {
  let value = instructions || fallbackInstructions(name, description, tools);
  const added: string[] = [];
  const append = (label: string, placeholder: string) => {
    if (value.includes(placeholder)) return;
    value += `\n\n${label}:\n${placeholder}`;
    added.push(placeholder);
  };
  if (tools.includes("rag_query")) append("Contexto del vault", "{{rag_context}}");
  if (tools.includes("web_search")) append("Contexto web", "{{web_context}}");
  append("Pedido del usuario", "{{user_prompt}}");
  if (added.length) assumptions.push(`Se completó el contrato de la skill con ${added.join(", ")}.`);
  return value;
}

function contractIssues(skill: SkillDraft): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (code: string, field: string, message: string) => issues.push({ code, severity: "error", field, message });
  if (!skill.instructions.includes("{{user_prompt}}")) add("SKILL_USER_CONTEXT_MISSING", "instructions", "La skill debe incluir {{user_prompt}}.");
  if (skill.tools.includes("rag_query") && !skill.instructions.includes("{{rag_context}}")) add("SKILL_RAG_CONTEXT_MISSING", "instructions", "rag_query requiere {{rag_context}} en la skill.");
  if (skill.tools.includes("web_search") && !skill.instructions.includes("{{web_context}}")) add("SKILL_WEB_CONTEXT_MISSING", "instructions", "web_search requiere {{web_context}} en la skill.");
  return issues;
}

function buildGeneratorUserPrompt(request: SkillGenerationRequest, tools: AgentTool[]): string {
  return `Diseñá una skill reusable para Sanctum-II a partir de este brief:\n\n<skill_brief>\n${JSON.stringify({
    description: request.description.trim(),
    preferredName: request.name || null,
    preferredId: request.id || null,
    tools,
    requiredPlaceholders: [
      "{{user_prompt}}",
      ...(tools.includes("rag_query") ? ["{{rag_context}}"] : []),
      ...(tools.includes("web_search") ? ["{{web_context}}"] : []),
    ],
  }, null, 2)}\n</skill_brief>\n\nLa descripción de la persona es la fuente principal de intención. Respondé solamente con JSON.`;
}

export function serializeSkillMarkdown(skill: SkillDraft): string {
  return `---\n${serializeFrontmatter({ id: skill.id, name: skill.name, description: skill.description, tools: skill.tools })}\n---\n${skill.instructions.trim()}\n`;
}

export class SkillAuthoringService {
  private readonly llm?: SkillAuthoringOptions["llm"];
  private readonly adapter?: SkillAuthoringOptions["adapter"];

  constructor(options: SkillAuthoringOptions = {}) {
    this.llm = options.llm;
    this.adapter = options.adapter;
  }

  async generate(request: SkillGenerationRequest): Promise<SkillGenerationResult> {
    if (!request.description.trim()) {
      throw new AgentAuthoringError([{ code: "SKILL_DESCRIPTION_REQUIRED", severity: "error", field: "description", message: "Describí qué debe hacer la skill." }]);
    }

    const assumptions: string[] = [];
    const tools = request.tools !== undefined ? asTools(request.tools) : inferSkillTools(request.description);
    let proposed: Record<string, unknown> = {};
    if (this.llm) {
      try {
        const response = await this.llm.chat([
          { role: "system", content: GENERATOR_SYSTEM_PROMPT },
          { role: "user", content: buildGeneratorUserPrompt(request, tools) },
        ]);
        proposed = extractSkillJson(response.content);
      } catch {
        assumptions.push("No se pudo usar el generador IA; se creó un borrador determinista.");
      }
    } else {
      assumptions.push("No hay cliente IA configurado; se creó un borrador determinista.");
    }

    return finalizeSkillDraft({ ...request, tools }, proposed, assumptions);
  }

  async save(result: SkillGenerationResult, options: SaveSkillOptions = {}): Promise<SavedSkillArtifact> {
    if (!this.adapter) throw new Error("SkillAuthoringService necesita un VaultAdapter para guardar.");
    const checked = validateSkillDraft(result.skill);
    const issues = [...checked.issues, ...contractIssues(checked.value)];
    if (issues.some(issue => issue.severity === "error")) throw new AgentAuthoringError(issues);

    await ensureVaultDirectory(this.adapter, SKILLS_DIR);
    const skillPath = `${SKILLS_DIR}/${checked.value.id}.md`;
    const exists = await this.adapter.exists(skillPath);
    if (!options.overwrite && exists) {
      throw new AgentAuthoringError([{ code: "SKILL_ID_EXISTS", severity: "error", field: "id", message: `Ya existe ${skillPath}.` }]);
    }
    let historyPath: string | undefined;
    if (exists && options.overwrite && options.archiveExisting) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      historyPath = `${SKILLS_DIR}/.history/${checked.value.id}-${stamp}.md`;
      await ensureVaultDirectory(this.adapter, `${SKILLS_DIR}/.history`);
      await this.adapter.write(historyPath, await this.adapter.read(skillPath));
    }
    await this.adapter.write(skillPath, serializeSkillMarkdown(checked.value));
    return { skillPath, ...(historyPath ? { historyPath } : {}) };
  }
}
