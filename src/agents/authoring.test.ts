import { describe, expect, it } from "vitest";
import { AgentAuthoringError, AgentAuthoringService, serializeAgentMarkdown } from "./authoring/service";
import { validateAgentDraft } from "./authoring/validator";
import type { AgentDraft } from "./authoring/types";
import type { VaultAdapter } from "../core/vault-adapter";

class MemoryVault implements VaultAdapter {
  files = new Map<string, string>();
  folders = new Set<string>();
  async read(path: string): Promise<string> { const value = this.files.get(path); if (value === undefined) throw new Error("not found"); return value; }
  async write(path: string, data: string): Promise<void> { this.files.set(path, data); }
  async mkdir(path: string): Promise<void> { this.folders.add(path); }
  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = `${path}/`;
    return { files: [...this.files.keys()].filter(file => file.startsWith(prefix) && !file.slice(prefix.length).includes("/")), folders: [] };
  }
  async exists(path: string): Promise<boolean> { return this.files.has(path) || this.folders.has(path); }
  async remove(path: string): Promise<void> { this.files.delete(path); }
}

const baseDraft: AgentDraft = {
  id: "legal-reviewer",
  name: "Legal Reviewer",
  description: "Revisa contenido legal con precisión.",
  systemPrompt: "Eres un revisor legal. Usá las fuentes disponibles.\n{{rag_context}}\n{{user_prompt}}",
  tools: ["rag_query"],
  permissions: { read_paths: ["/Legal/**"], write_paths: [] },
  triggers: [{ type: "mention" }],
};

describe("AgentAuthoringService", () => {
  it("serializa y vuelve a auditar frontmatter anidado", () => {
    const service = new AgentAuthoringService();
    const markdown = serializeAgentMarkdown(baseDraft);
    const audited = service.audit(markdown, "legal-reviewer.md");
    expect(audited.valid).toBe(true);
    expect(audited.value.permissions.read_paths).toEqual(["/Legal/**"]);
    expect(audited.value.triggers).toEqual([{ type: "mention" }]);
  });

  it("bloquea tools de RAG y escritura sin permisos explícitos", () => {
    const result = validateAgentDraft({
      ...baseDraft,
      tools: ["rag_query", "create_note"],
      permissions: { read_paths: [], write_paths: [] },
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(["RAG_READ_PATH_REQUIRED", "WRITE_PATH_REQUIRED"]));
  });

  it("la generación determinista deja claro qué falta para RAG", async () => {
    const service = new AgentAuthoringService();
    const result = await service.generate({ description: "Revisa documentación técnica", tools: ["rag_query"] });
    expect(result.agent.permissions.read_paths).toEqual([]);
    expect(result.issues.some(issue => issue.code === "RAG_READ_PATH_REQUIRED")).toBe(true);
    expect(result.assumptions.join(" ")).toContain("ruta de lectura");
  });

  it("ignora permisos propuestos por IA y conserva los definidos por el usuario", async () => {
    const service = new AgentAuthoringService({
      llm: {
        async chat() {
          return { content: JSON.stringify({ agent: { name: "Research", tools: ["rag_query"], permissions: { read_paths: ["/**"] }, systemPrompt: "Rol. {{rag_context}} {{user_prompt}}" } }) };
        },
      },
    });
    const result = await service.generate({ description: "Investiga /Research", readPaths: ["/Research/**"], tools: ["rag_query"] });
    expect(result.agent.permissions.read_paths).toEqual(["/Research/**"]);
    expect(result.agent.permissions.read_paths).not.toContain("/**");
  });

  it("repara el contrato del prompt, descarta imágenes y desactiva escritura sin permisos", async () => {
    const service = new AgentAuthoringService({
      llm: {
        async chat() {
          return { content: JSON.stringify({ agent: {
            name: "Revisor Legal",
            avatar: "https://example.com/legal-agent.png",
            tools: ["rag_query", "web_search", "create_note", "append_to_note"],
            systemPrompt: "Eres un revisor legal preciso y debes citar cada riesgo contractual.",
          } }) };
        },
      },
    });
    const result = await service.generate({
      description: "Revisa contratos legales",
      avatar: "shield-check",
      readPaths: ["/Research/**"],
      writePaths: [],
      tools: ["rag_query", "web_search", "create_note", "append_to_note"],
    });

    expect(result.agent.avatar).toBe("shield-check");
    expect(result.agent.tools).toEqual(["rag_query", "web_search"]);
    expect(result.agent.systemPrompt).toContain("{{rag_context}}");
    expect(result.agent.systemPrompt).toContain("{{web_context}}");
    expect(result.agent.systemPrompt).toContain("{{user_prompt}}");
    expect(result.issues.some(issue => issue.severity === "error")).toBe(false);
    expect(result.assumptions.join(" ")).toContain("Se desactivaron create_note y append_to_note");
  });

  it("envía la descripción del usuario al LLM como brief estructurado", async () => {
    let userMessage = "";
    const service = new AgentAuthoringService({
      llm: {
        async chat(messages) {
          userMessage = messages.find(message => message.role === "user")?.content || "";
          return { content: JSON.stringify({ agent: { name: "Analista", systemPrompt: "Analiza con rigor. {{rag_context}} {{user_prompt}}" } }) };
        },
      },
    });
    await service.generate({
      description: "Compara informes financieros, explica discrepancias y cita cada fuente.",
      name: "Analista financiero",
      tools: ["rag_query"],
      readPaths: ["/Finanzas/**"],
    });

    expect(userMessage).toContain("Compara informes financieros, explica discrepancias y cita cada fuente.");
    expect(userMessage).toContain('"preferredName": "Analista financiero"');
    expect(userMessage).toContain('"rag_query"');
    expect(userMessage).toContain("{{rag_context}}");
    expect(userMessage).toContain("La descripción es la fuente principal de intención");
  });

  it("rechaza URLs o archivos como avatar", () => {
    const result = validateAgentDraft({ ...baseDraft, avatar: "https://example.com/avatar.png" });
    expect(result.issues.some(issue => issue.code === "AGENT_AVATAR_IMAGE_UNSUPPORTED")).toBe(true);
  });

  it("preserva y valida un auto-chequeo QUBO opcional", () => {
    const draft = validateAgentDraft({
      ...baseDraft,
      autoCheckTool: "sanctum_validate_qubo",
    });
    expect(draft.valid).toBe(true);
    const markdown = serializeAgentMarkdown(draft.value);
    expect(markdown).toContain("auto_check: sanctum_validate_qubo");
    expect(new AgentAuthoringService().audit(markdown).value.autoCheckTool).toBe("sanctum_validate_qubo");
  });

  it("no escribe si existe el agente y permite guardar una definición válida", async () => {
    const vault = new MemoryVault();
    const service = new AgentAuthoringService({ adapter: vault });
    const result = await service.generate({ name: "Legal responder", description: "Responde sobre Legal", readPaths: ["/Legal/**"], tools: ["rag_query"] });
    await service.save(result);
    await expect(service.save(result)).rejects.toBeInstanceOf(AgentAuthoringError);
    expect(vault.files.has("sanctum-agents/legal-responder.md")).toBe(true);
  });
});
