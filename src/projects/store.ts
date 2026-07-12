import type { MemoryEntry, Project, Thread, ThreadData } from "./types";
import { defaultProject } from "./types";

const PROJECTS_DIR = "sanctum-projects";

function parseScalar(value: string): any {
  value = value.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    return value.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  }
  if (value === "true" || value === "false") return value === "true";
  if (!isNaN(Number(value)) && value !== "") return Number(value);
  return value.replace(/^["']|["']$/g, "");
}

function parseProjectMd(content: string): Project {
  const parts = content.split("---");
  if (parts.length < 3) {
    throw new Error("Formato inválido: el archivo debe tener frontmatter --- separado");
  }

  const fmLines = parts[1].trim().split("\n");
  const bodyRaw = parts.slice(2).join("---").trim();

  const data: Record<string, any> = {};
  const rag: Record<string, any> = {};
  let inRag = false;
  let inInstructions = false;
  const instructions: string[] = [];

  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i];
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (trimmed === "" || trimmed === "---") continue;

    if (inRag) {
      if (indent > 0 && trimmed.includes(":")) {
        const colonIdx = trimmed.indexOf(":");
        const key = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim();
        rag[key] = parseScalar(value);
        continue;
      } else {
        inRag = false;
      }
    }

    if (inInstructions) {
      if (indent > 0 || trimmed === "") {
        instructions.push(line);
        continue;
      } else {
        inInstructions = false;
      }
    }

    if (!trimmed.includes(":")) continue;
    const colonIdx = trimmed.indexOf(":");
    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();

    if (key === "rag") {
      inRag = true;
      continue;
    }

    if (key === "instructions" && value === "|") {
      inInstructions = true;
      continue;
    }

    data[key] = parseScalar(value);
  }

  data.instructions = instructions.join("\n").trim();
  if (Object.keys(rag).length > 0) data.rag = rag;

  const id = data.id || "project";
  let attachedFiles: any[] = [];
  if (data.attachedFiles) {
    try { attachedFiles = typeof data.attachedFiles === "string" ? JSON.parse(data.attachedFiles) : data.attachedFiles; } catch {}
  }
  return {
    id,
    name: data.name || id,
    icon: data.icon || "◈",
    description: data.description || "",
    instructions: data.instructions || bodyRaw,
    read_paths: data.read_paths || [],
    write_paths: data.write_paths || [],
    outputPath: data.outputPath || `Projects/${id}`,
    model: data.model || "deepseek-v4-flash",
    rag: {
      embed_model: data.rag?.embed_model || "gemini-embedding-2",
      dims: data.rag?.dims || 768,
      chunk_words: data.rag?.chunk_words || 400,
      top_k: data.rag?.top_k || 5,
      min_similarity: data.rag?.min_similarity || 0.65,
    },
    files: data.files || [],
    attachedFiles,
  };
}

function serializeProject(p: Project): string {
  const lines: string[] = ["---"];
  lines.push(`id: ${p.id}`);
  lines.push(`name: ${p.name}`);
  lines.push(`icon: ${p.icon}`);
  if (p.description) lines.push(`description: ${p.description}`);
  lines.push(`model: ${p.model}`);
  lines.push(`read_paths: [${p.read_paths.map(x => `"${x}"`).join(", ")}]`);
  lines.push(`write_paths: [${p.write_paths.map(x => `"${x}"`).join(", ")}]`);
  lines.push(`outputPath: ${p.outputPath || `Projects/${p.id}`}`);
  lines.push("rag:");
  lines.push(`  embed_model: ${p.rag.embed_model}`);
  lines.push(`  dims: ${p.rag.dims}`);
  lines.push(`  chunk_words: ${p.rag.chunk_words}`);
  lines.push(`  top_k: ${p.rag.top_k}`);
  lines.push(`  min_similarity: ${p.rag.min_similarity}`);
  if (p.files?.length) lines.push(`files: [${p.files.map(x => `"${x}"`).join(", ")}]`);
  if (p.attachedFiles?.length) lines.push(`attachedFiles: ${JSON.stringify(p.attachedFiles)}`);
  lines.push("instructions: |");
  for (const line of p.instructions.split("\n")) lines.push("  " + line);
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

export class ProjectStore {
  constructor(
    private adapter: {
      read: (p: string) => Promise<string>;
      write: (p: string, c: string) => Promise<void>;
      list: (p: string) => Promise<{ files: string[]; folders: string[] }>;
      exists: (p: string) => Promise<boolean>;
      mkdir?: (p: string) => Promise<void>;
    }
  ) {}

  private projectPath(id: string): string { return `${PROJECTS_DIR}/${id}.md`; }
  private memoryDir(id: string): string { return `sanctum-memory/${id}`; }
  private memoryPath(id: string): string { return `${this.memoryDir(id)}/memory.jsonl`; }
  private threadsDir(id: string): string { return `sanctum-logs/threads/${id}`; }

  private async ensureDir(dir: string): Promise<void> {
    // mkdir crea el directorio (y sus padres si es necesario) sin error si ya existe
    if (this.adapter.mkdir) {
      try { await this.adapter.mkdir(dir); } catch {}
    }
    // Fallback: escribir un marcador para forzar la creación del directorio
    try { await this.adapter.write(`${dir}/.gitkeep`, ""); } catch {}
  }

  async loadProject(id: string): Promise<Project> {
    const path = this.projectPath(id);
    try {
      const content = await this.adapter.read(path);
      return parseProjectMd(content);
    } catch (err: any) {
      throw new Error(`No se pudo leer ${path}: ${err.message}`);
    }
  }

  async saveProject(p: Project): Promise<void> {
    await this.ensureDir(PROJECTS_DIR);
    await this.adapter.write(this.projectPath(p.id), serializeProject(p));
  }

  async projectExists(id: string): Promise<boolean> {
    return await this.adapter.exists(this.projectPath(id)).catch(() => false);
  }

  async listProjects(): Promise<string[]> {
    const exists = await this.adapter.exists(PROJECTS_DIR).catch(() => false);
    if (!exists) return [];
    const listing = await this.adapter.list(PROJECTS_DIR);
    return listing.files.filter(f => f.endsWith(".md")).map(f => f.replace(/^.*[\\/]/, "").replace(/\.md$/, ""));
  }

  async loadMemory(id: string): Promise<MemoryEntry[]> {
    try {
      const raw = await this.adapter.read(this.memoryPath(id));
      const entries: MemoryEntry[] = [];
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try { entries.push(JSON.parse(line)); } catch {}
      }
      return entries;
    } catch {
      return [];
    }
  }

  async appendMemory(id: string, entry: MemoryEntry): Promise<void> {
    await this.ensureDir(this.memoryDir(id));
    const path = this.memoryPath(id);
    let existing = "";
    try { existing = await this.adapter.read(path); } catch {}
    await this.adapter.write(path, existing + JSON.stringify(entry) + "\n");
  }

  async loadThreads(id: string): Promise<Thread[]> {
    const dir = this.threadsDir(id);
    let listing;
    try {
      listing = await this.adapter.list(dir);
    } catch {
      return [];
    }
    const threads: Thread[] = [];
    const files = (listing.files || []).filter(f => f.endsWith(".json") && !f.endsWith(".gitkeep"));
    for (const f of files) {
      try {
        const content = await this.adapter.read(f);
        const data = JSON.parse(content);
        if (data.thread) threads.push(data.thread);
      } catch {}
    }
    return threads.sort((a, b) => b.updated_at - a.updated_at);
  }

  async loadThreadData(id: string, threadId: string): Promise<ThreadData | null> {
    const path = `${this.threadsDir(id)}/${threadId}.json`;
    try {
      const content = await this.adapter.read(path);
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async saveThreadData(id: string, thread: Thread, messages: any[]): Promise<void> {
    const dir = this.threadsDir(id);
    await this.ensureDir(dir);
    if (!thread.starred) thread.starred = false;
    const data: ThreadData = { thread, messages };
    await this.adapter.write(`${dir}/${thread.thread_id}.json`, JSON.stringify(data, null, 2));
  }

  async deleteThread(id: string, threadId: string): Promise<void> {
    const path = `${this.threadsDir(id)}/${threadId}.json`;
    try { await this.adapter.write(path, ""); } catch {}
  }

  async renameThread(id: string, threadId: string, newTitle: string): Promise<void> {
    const data = await this.loadThreadData(id, threadId);
    if (!data) return;
    data.thread.title = newTitle;
    data.thread.updated_at = Date.now();
    await this.saveThreadData(id, data.thread, data.messages);
  }

  async toggleStarThread(id: string, threadId: string): Promise<Thread | null> {
    const data = await this.loadThreadData(id, threadId);
    if (!data) return null;
    data.thread.starred = !data.thread.starred;
    await this.saveThreadData(id, data.thread, data.messages);
    return data.thread;
  }

  async moveThread(id: string, threadId: string, targetProjectId: string): Promise<void> {
    const data = await this.loadThreadData(id, threadId);
    if (!data) return;
    data.thread.project_id = targetProjectId;
    await this.saveThreadData(id, data.thread, data.messages);
    // Copy to target project
    const targetDir = this.threadsDir(targetProjectId);
    await this.ensureDir(targetDir);
    await this.adapter.write(`${targetDir}/${threadId}.json`, JSON.stringify({ thread: data.thread, messages: data.messages }, null, 2));
  }

  async createProject(id: string, name?: string): Promise<Project> {
    const p = defaultProject(id, name || id);
    await this.saveProject(p);
    return p;
  }
}
