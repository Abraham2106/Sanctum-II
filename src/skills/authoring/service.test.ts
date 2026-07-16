import { describe, expect, it } from "vitest";
import { AgentAuthoringError } from "../../agents/authoring/service";
import type { VaultAdapter } from "../../core/vault-adapter";
import { parseSkillMarkdown } from "../loader";
import { inferSkillTools, SkillAuthoringService } from "./service";

class MemoryVault implements VaultAdapter {
  files = new Map<string, string>();
  folders = new Set<string>();
  async read(path: string): Promise<string> { const value = this.files.get(path); if (value === undefined) throw new Error("not found"); return value; }
  async write(path: string, data: string): Promise<void> { this.files.set(path, data); }
  async mkdir(path: string): Promise<void> { this.folders.add(path); }
  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = `${path}/`;
    return { files: [...this.files.keys()].filter(file => file.startsWith(prefix)), folders: [] };
  }
  async exists(path: string): Promise<boolean> { return this.files.has(path) || this.folders.has(path); }
}

describe("SkillAuthoringService", () => {
  it("reconoce aliases de tools escritos en el brief", () => {
    expect(inferSkillTools("designing apps (uses web-search and vault RAG)"))
      .toEqual(["web_search", "rag_query"]);
  });

  it("genera una skill invocable con el contrato de contexto completo", async () => {
    const service = new SkillAuthoringService({
      llm: {
        async chat() {
          return { content: JSON.stringify({
            id: "design-apps",
            name: "Design Apps",
            description: "Diseña aplicaciones usando investigación web.",
            tools: ["web_search", "create_note"],
            instructions: "Investigá patrones actuales y proponé una interfaz concreta.",
          }) };
        },
      },
    });

    const result = await service.generate({ description: "create a skill for designing apps (uses web-search)" });
    expect(result.skill.id).toBe("design-apps");
    expect(result.skill.tools).toEqual(["web_search"]);
    expect(result.skill.instructions).toContain("{{web_context}}");
    expect(result.skill.instructions).toContain("{{user_prompt}}");
    expect(result.issues.some(issue => issue.severity === "error")).toBe(false);
    expect(result.assumptions.join(" ")).toContain("tools no solicitadas");
  });

  it("guarda Markdown compatible con el loader y no sobrescribe por defecto", async () => {
    const vault = new MemoryVault();
    const service = new SkillAuthoringService({ adapter: vault });
    const result = await service.generate({ description: "create a skill for designing apps (uses web-search)" });
    const saved = await service.save(result);

    expect(saved.skillPath).toBe("sanctum-skills/designing-apps.md");
    const parsed = parseSkillMarkdown(await vault.read(saved.skillPath));
    expect(parsed.id).toBe("designing-apps");
    expect(parsed.tools).toEqual(["web_search"]);
    await expect(service.save(result)).rejects.toBeInstanceOf(AgentAuthoringError);
  });

  it("archiva la versión anterior antes de una actualización aprobada", async () => {
    const vault = new MemoryVault();
    vault.folders.add("sanctum-skills");
    vault.files.set("sanctum-skills/designing-apps.md", "versión anterior");
    const service = new SkillAuthoringService({ adapter: vault });
    const result = await service.generate({ id: "designing-apps", description: "diseña apps", tools: [] });
    const saved = await service.save(result, { overwrite: true, archiveExisting: true });

    expect(saved.historyPath).toMatch(/^sanctum-skills\/\.history\/designing-apps-/);
    expect(await vault.read(saved.historyPath!)).toBe("versión anterior");
    expect(await vault.read(saved.skillPath)).toContain("id: designing-apps");
  });
});
