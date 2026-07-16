import { AGENTS_DIR } from "../../constants";
import { ensureVaultDirectory } from "../../core/vault-fs";
import { slugify } from "../../utils";
import { serializeFrontmatter, splitFrontmatter } from "../../shared/agents/frontmatter";
import { normalizeAgentDraft, validateAgentDraft, validateSkillDraft } from "./validator";
import type {
  AgentAuthoringLLM,
  AgentDraft,
  AgentGenerationRequest,
  AgentGenerationResult,
  AgentTool,
  SaveAgentOptions,
  SavedAgentArtifacts,
  SkillDraft,
  ValidationIssue,
  ValidationResult,
} from "./types";
import type { VaultAdapter } from "../../core/vault-adapter";

const SKILLS_DIR = "sanctum-skills";
const WRITE_TOOLS = new Set<AgentTool>(["create_note", "append_to_note"]);

const GENERATOR_SYSTEM_PROMPT = `Sos un diseñador de agentes para Sanctum-II. Convertí una descripción en un borrador JSON, no en Markdown.
Separá identidad del agente de formato reusable de una skill. No inventes permisos: si una ruta no está explícita, devolvé []. No incluy model salvo que se solicite.
Usá únicamente estas tools: rag_query, web_search, create_note, append_to_note.
El systemPrompt debe incluir {{user_prompt}}; también {{rag_context}} si usa rag_query y {{web_context}} si usa web_search.
Redactá el systemPrompt como una instrucción operativa completa: identidad, objetivo, alcance, uso de fuentes, límites, comportamiento ante datos insuficientes y criterios de respuesta. Evitá relleno y formatos rígidos que el usuario no haya pedido.
No propongas avatar ni URLs de imagen: el icono Lucide lo elige la persona en la interfaz.
El JSON puede contener agent y, si se pidió, skill. El agent debe incluir id, name, description, tools, systemPrompt, permissions y triggers.`;

export class AgentAuthoringError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(issues.map(issue => issue.message).join(" "));
    this.name = "AgentAuthoringError";
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStrings(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter(item => typeof item === "string").map(item => String(item)) : undefined;
}

function asTools(value: unknown): AgentTool[] | undefined {
  return asStrings(value) as AgentTool[] | undefined;
}

function extractJson(raw: string): Record<string, any> {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("La respuesta del generador no contiene JSON válido.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function fallbackPrompt(name: string, description: string, tools: AgentTool[]): string {
  const lines = [
    `Eres ${name}, ${description}.`,
    "Respondé de forma directa, específica y verificable.",
    "No narres procesos internos ni inventes información cuando falten fuentes.",
  ];
  if (tools.includes("rag_query")) lines.push("Usá el contexto indexado cuando esté disponible y citá las notas con [[wikilinks]].");
  if (tools.includes("web_search")) lines.push("Contrastá la información web disponible y citá cada afirmación relevante con su URL.");
  if (tools.includes("create_note") || tools.includes("append_to_note")) lines.push("Escribí notas solo dentro de las rutas permitidas y confirmá la ruta antes de modificar contenido.");
  lines.push("Si no hay información suficiente, indicá qué dato falta en lugar de completar con suposiciones.");
  if (tools.includes("rag_query")) lines.push("\nContexto del vault:\n{{rag_context}}");
  if (tools.includes("web_search")) lines.push("\nContexto web:\n{{web_context}}");
  lines.push("\nPregunta del usuario:\n{{user_prompt}}");
  return lines.join("\n");
}

function ensurePromptContract(prompt: string | undefined, name: string, description: string, tools: AgentTool[], assumptions: string[]): string {
  let value = prompt || fallbackPrompt(name, description, tools);
  const added: string[] = [];
  const append = (label: string, placeholder: string) => {
    if (value.includes(placeholder)) return;
    value += `\n\n${label}:\n${placeholder}`;
    added.push(placeholder);
  };
  if (tools.includes("rag_query")) append("Contexto del vault", "{{rag_context}}");
  if (tools.includes("web_search")) append("Contexto web", "{{web_context}}");
  append("Pregunta del usuario", "{{user_prompt}}");
  if (added.length) assumptions.push(`Se completó el contrato del prompt con ${added.join(", ")}.`);
  return value;
}

function reconcileTools(tools: AgentTool[], writePaths: string[], assumptions: string[]): AgentTool[] {
  if (writePaths.length) return tools;
  const removed = tools.filter(tool => WRITE_TOOLS.has(tool));
  if (!removed.length) return tools;
  assumptions.push(`Se desactivaron ${removed.join(" y ")} porque no se definió una ruta de escritura.`);
  return tools.filter(tool => !WRITE_TOOLS.has(tool));
}

function buildGeneratorUserPrompt(request: AgentGenerationRequest): string {
  const tools = request.tools || [];
  const requiredPlaceholders = [
    "{{user_prompt}}",
    ...(tools.includes("rag_query") ? ["{{rag_context}}"] : []),
    ...(tools.includes("web_search") ? ["{{web_context}}"] : []),
  ];
  const brief = {
    description: request.description.trim(),
    preferredName: request.name || null,
    preferredId: request.id || null,
    tools,
    access: {
      read: request.readPaths?.length ? "configured" : "none",
      write: request.writePaths?.length ? "configured" : "none",
    },
    mentionable: request.mention !== false && !request.internal,
    includeCompanionSkill: !!request.includeSkill,
    requiredPlaceholders,
  };
  return `Diseñá un agente a partir del brief escrito por la persona usuaria.

<agent_brief>
${JSON.stringify(brief, null, 2)}
</agent_brief>

La descripción es la fuente principal de intención. Convertíla en un systemPrompt claro y específico, conservando el alcance solicitado. Respondé solamente con el objeto JSON.`;
}

function fallbackSkill(request: AgentGenerationRequest, agent: AgentDraft): SkillDraft {
  const id = slugify(request.skillName || `${agent.id}-workflow`);
  return {
    id,
    name: request.skillName || `${agent.name} workflow`,
    description: `Flujo reusable para usar ${agent.name} con instrucciones específicas.`,
    tools: agent.tools,
    instructions: `Aplicá el flujo solicitado por el usuario con precisión.\n\nFORMATO\n- Organizá la respuesta según el contenido, no según el origen de las fuentes.\n- Citá afirmaciones verificables cuando haya contexto disponible.\n- No narres el proceso interno de búsqueda.`,
  };
}

export function serializeAgentMarkdown(agent: AgentDraft): string {
  const frontmatter: Record<string, unknown> = {
    id: agent.id,
    name: agent.name,
    ...(agent.avatar ? { avatar: agent.avatar } : {}),
    ...(agent.model ? { model: agent.model } : {}),
    ...(agent.internal ? { internal: true } : {}),
    description: agent.description,
    ...(agent.triggers?.length ? { triggers: agent.triggers } : {}),
    tools: agent.tools,
    permissions: agent.permissions,
  };
  return `---\n${serializeFrontmatter(frontmatter)}\n---\n${agent.systemPrompt.trim()}\n`;
}

export function serializeSkillMarkdown(skill: SkillDraft): string {
  const frontmatter = { id: skill.id, name: skill.name, description: skill.description, tools: skill.tools };
  return `---\n${serializeFrontmatter(frontmatter)}\n---\n${skill.instructions.trim()}\n`;
}

function parseAgentMarkdown(markdown: string): AgentDraft {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const permissions = frontmatter.permissions && typeof frontmatter.permissions === "object" ? frontmatter.permissions as Record<string, unknown> : {};
  const triggers = Array.isArray(frontmatter.triggers)
    ? frontmatter.triggers.filter((trigger: any) => trigger && trigger.type === "mention").map(() => ({ type: "mention" as const }))
    : [];
  return normalizeAgentDraft({
    id: asString(frontmatter.id),
    name: asString(frontmatter.name),
    description: asString(frontmatter.description),
    avatar: asString(frontmatter.avatar),
    model: asString(frontmatter.model),
    internal: frontmatter.internal === true,
    triggers,
    tools: asTools(frontmatter.tools),
    permissions: {
      read_paths: asStrings(permissions.read_paths) || asStrings(frontmatter.read_paths) || [],
      write_paths: asStrings(permissions.write_paths) || asStrings(frontmatter.write_paths) || [],
    },
    systemPrompt: body,
  });
}

export class AgentAuthoringService {
  private readonly llm?: AgentAuthoringLLM;
  private readonly adapter?: VaultAdapter;

  constructor(options: { llm?: AgentAuthoringLLM; adapter?: VaultAdapter } = {}) {
    this.llm = options.llm;
    this.adapter = options.adapter;
  }

  async generate(request: AgentGenerationRequest): Promise<AgentGenerationResult> {
    if (!request.description.trim()) throw new AgentAuthoringError([{ code: "DESCRIPTION_REQUIRED", severity: "error", field: "description", message: "Describí qué debe hacer el agente." }]);

    let proposed: any = {};
    const assumptions: string[] = [];
    if (this.llm) {
      try {
        const response = await this.llm.chat([
          { role: "system", content: GENERATOR_SYSTEM_PROMPT },
          { role: "user", content: buildGeneratorUserPrompt(request) },
        ]);
        proposed = extractJson(response.content);
      } catch (error) {
        assumptions.push("No se pudo usar el generador IA; se creó un borrador determinista para revisión.");
      }
    } else {
      assumptions.push("No hay cliente IA configurado; se creó un borrador determinista para revisión.");
    }

    const proposedAgent = proposed.agent || proposed;
    const writePaths = request.writePaths || [];
    const tools = reconcileTools(request.tools || asTools(proposedAgent.tools) || [], writePaths, assumptions);
    const name = request.name || asString(proposedAgent.name) || "Nuevo agente";
    const internal = request.internal ?? proposedAgent.internal === true;
    const systemPrompt = ensurePromptContract(
      asString(proposedAgent.systemPrompt || proposedAgent.system_prompt),
      name,
      request.description.trim(),
      tools,
      assumptions,
    );
    const agent = normalizeAgentDraft({
      id: request.id || asString(proposedAgent.id) || name,
      name,
      description: request.description.trim(),
      avatar: request.avatar,
      model: request.model,
      internal,
      triggers: request.mention === false || internal ? [] : [{ type: "mention" as const }],
      tools,
      permissions: {
        // Permissions are always user-provided; the model cannot widen access.
        read_paths: request.readPaths || [],
        write_paths: writePaths,
      },
      systemPrompt,
    });

    if (agent.tools.includes("rag_query") && !agent.permissions.read_paths.length) assumptions.push("rag_query quedó bloqueada hasta que se defina al menos una ruta de lectura.");
    const agentCheck = validateAgentDraft(agent);
    const result: AgentGenerationResult = {
      agent: agentCheck.value,
      issues: agentCheck.issues,
      assumptions,
      agentMarkdown: serializeAgentMarkdown(agentCheck.value),
    };

    if (request.includeSkill) {
      const skillRaw = proposed.skill;
      const skill = validateSkillDraft(skillRaw ? {
        id: asString(skillRaw.id) || `${agent.id}-workflow`,
        name: asString(skillRaw.name) || `${agent.name} workflow`,
        description: asString(skillRaw.description) || `Flujo reusable para ${agent.name}.`,
        instructions: asString(skillRaw.instructions) || "Aplicá el flujo del usuario de forma específica y verificable.",
        tools: asTools(skillRaw.tools) || agent.tools,
      } : fallbackSkill(request, agent));
      result.skill = skill.value;
      result.skillMarkdown = serializeSkillMarkdown(skill.value);
      result.issues.push(...skill.issues);
    }
    return result;
  }

  audit(markdown: string, filename?: string, existingIds?: string[]): ValidationResult<AgentDraft> {
    try {
      const draft = parseAgentMarkdown(markdown);
      return validateAgentDraft(draft, { filename, existingIds, allowExisting: true });
    } catch (error: any) {
      return {
        value: normalizeAgentDraft({}),
        issues: [{ code: "FRONTMATTER_INVALID", severity: "error", field: "frontmatter", message: error?.message || "Frontmatter inválido." }],
        valid: false,
      };
    }
  }

  async save(result: AgentGenerationResult, options: SaveAgentOptions = {}): Promise<SavedAgentArtifacts> {
    if (!this.adapter) throw new Error("AgentAuthoringService necesita un VaultAdapter para guardar.");
    const existingIds = await this.listAgentIds();
    const agentCheck = validateAgentDraft(result.agent, { existingIds, allowExisting: !!options.overwrite });
    const issues = [...agentCheck.issues];
    if (result.skill) issues.push(...validateSkillDraft(result.skill).issues);
    if (issues.some(issue => issue.severity === "error")) throw new AgentAuthoringError(issues);

    await ensureVaultDirectory(this.adapter, AGENTS_DIR);
    const agentPath = `${AGENTS_DIR}/${agentCheck.value.id}.md`;
    const skillPath = result.skill ? `${SKILLS_DIR}/${result.skill.id}.md` : undefined;
    if (!options.overwrite && skillPath && await this.adapter.exists(skillPath)) {
      throw new AgentAuthoringError([{ code: "SKILL_ID_EXISTS", severity: "error", field: "skill.id", message: `Ya existe ${skillPath}.` }]);
    }

    let skillCreated = false;
    try {
      if (result.skill && skillPath) {
        await ensureVaultDirectory(this.adapter, SKILLS_DIR);
        await this.adapter.write(skillPath, serializeSkillMarkdown(result.skill));
        skillCreated = true;
      }
      await this.adapter.write(agentPath, serializeAgentMarkdown(agentCheck.value));
    } catch (error) {
      if (skillCreated && this.adapter.remove && !options.overwrite) await this.adapter.remove(skillPath!);
      throw error;
    }
    return { agentPath, ...(skillPath ? { skillPath } : {}) };
  }

  private async listAgentIds(): Promise<string[]> {
    if (!this.adapter) return [];
    const listing = await this.adapter.list(AGENTS_DIR).catch(() => ({ files: [], folders: [] }));
    return listing.files.filter(file => file.endsWith(".md")).map(file => file.replace(/^.*[\\/]/, "").replace(/\.md$/i, ""));
  }
}
