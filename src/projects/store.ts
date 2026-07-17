import type { MemoryEntry, Project, Thread, ThreadData, PendingAction, CreatedNote } from "./types";
import { defaultProject } from "./types";
import { PROJECTS_DIR, DEFAULT_MODEL } from "../constants";
import { parseScalar } from "../shared/agents/frontmatter";
import type { VaultAdapter } from "../core/vault-adapter";
import { ensureVaultDirectory, isNotFoundError } from "../core/vault-fs";

/** Strip path separators and control chars from thread/project IDs to prevent path traversal */
function sanitizeId(id: string): string {
  if (!id) return id;
  return id.replace(/[/\\:;!@#$%^&*()<>"'|?*~`]/g, "").slice(0, 120);
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
    try { attachedFiles = typeof data.attachedFiles === "string" ? JSON.parse(data.attachedFiles) : data.attachedFiles; } catch (err: any) { console.warn("[Store] attachedFiles parse:", err.message); }
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
    model: data.model || DEFAULT_MODEL,
    rag: {
      embed_model: data.rag?.embed_model || "gemini-embedding-2",
      dims: data.rag?.dims || 768,
      chunk_words: data.rag?.chunk_words || 400,
      top_k: data.rag?.top_k || 5,
      min_similarity: data.rag?.min_similarity || 0.65,
    },
    files: data.files || [],
    attachedFiles,
    starred: data.starred === true,
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
  if (p.starred) lines.push(`starred: true`);
  if (p.files?.length) lines.push(`files: [${p.files.map(x => `"${x}"`).join(", ")}]`);
  if (p.attachedFiles?.length) lines.push(`attachedFiles: ${JSON.stringify(p.attachedFiles)}`);
  lines.push("instructions: |");
  for (const line of p.instructions.split("\n")) lines.push("  " + line);
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

export class ProjectStore {
  private threadLocks = new Map<string, Promise<void>>();

  constructor(private adapter: VaultAdapter) {}

  private async withThreadLock<T>(id: string, threadId: string, work: () => Promise<T>): Promise<T> {
    const key = `${id}/${sanitizeId(threadId) || threadId}`;
    const previous = this.threadLocks.get(key) || Promise.resolve();
    let release = () => {};
    const current = new Promise<void>(resolve => { release = resolve; });
    this.threadLocks.set(key, current);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.threadLocks.get(key) === current) this.threadLocks.delete(key);
    }
  }

  private projectPath(id: string): string { return `${PROJECTS_DIR}/${id}.md`; }
  private memoryDir(id: string): string { return `sanctum-memory/${id}`; }
  private memoryPath(id: string): string { return `${this.memoryDir(id)}/memory.jsonl`; }
  private threadsDir(id: string): string { return `sanctum-logs/threads/${id}`; }

  private async ensureDir(dir: string): Promise<void> {
    await ensureVaultDirectory(this.adapter, dir);
  }

  /** Obsidian rename() refuses to replace an existing file; writes are serialized by their caller. */
  private async writeSerialized(path: string, content: string): Promise<void> {
    await this.adapter.write(path, content);
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
    await this.writeSerialized(this.projectPath(p.id), serializeProject(p));
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

  /** Lists projects that load cleanly; skips corrupt/empty files without aborting. */
  async listValidProjects(): Promise<{ id: string; project: Project }[]> {
    const ids = await this.listProjects();
    const valid: { id: string; project: Project }[] = [];
    for (const id of ids) {
      try {
        valid.push({ id, project: await this.loadProject(id) });
      } catch (err: any) {
        console.warn(`[Store] proyecto inválido omitido (${id}):`, err?.message || err);
      }
    }
    return valid;
  }

  async loadMemory(id: string): Promise<MemoryEntry[]> {
    try {
      const raw = await this.adapter.read(this.memoryPath(id));
      const entries: MemoryEntry[] = [];
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try { entries.push(JSON.parse(line)); } catch (err: any) { console.warn("[Store] memory JSONL parse:", err.message); }
      }
      return entries;
    } catch (err: any) {
      if (!isNotFoundError(err)) console.warn("[Store] loadMemory:", err?.message || err);
      return [];
    }
  }

  async appendMemory(id: string, entry: MemoryEntry): Promise<void> {
    await this.ensureDir(this.memoryDir(id));
    const path = this.memoryPath(id);
    let existing = "";
    try { existing = await this.adapter.read(path); } catch (err: any) { if (!isNotFoundError(err)) console.warn("[Store] appendMemory read:", err?.message || err); }
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
    const files = (listing.files || []).filter(f => f.endsWith(".json"));
    for (const f of files) {
      try {
        const content = await this.adapter.read(f);
        const data = JSON.parse(content);
        if (data.thread) threads.push(data.thread);
      } catch (err: any) { console.warn(`[Store] loadThread ${f}:`, err.message); }
    }
    return threads.sort((a, b) => b.updated_at - a.updated_at);
  }

  async loadThreadData(id: string, threadId: string): Promise<ThreadData | null> {
    const safeId = sanitizeId(threadId);
    if (!safeId) return null;
    const path = `${this.threadsDir(id)}/${safeId}.json`;
    try {
      const content = await this.adapter.read(path);
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async saveThreadData(id: string, thread: Thread, messages: any[], extra?: { summary?: string; pendingAction?: PendingAction; createdNotes?: CreatedNote[] }): Promise<void> {
    await this.withThreadLock(id, thread.thread_id, () => this.saveThreadDataUnlocked(id, thread, messages, extra));
  }

  private async saveThreadDataUnlocked(id: string, thread: Thread, messages: any[], extra?: { summary?: string; pendingAction?: PendingAction; createdNotes?: CreatedNote[] }): Promise<void> {
    const dir = this.threadsDir(id);
    await this.ensureDir(dir);
    if (!thread.starred) thread.starred = false;
    const safeTid = sanitizeId(thread.thread_id) || thread.thread_id;
    let disk: Pick<ThreadData, "summary" | "pendingAction" | "createdNotes"> = {};
    try {
      const raw = await this.adapter.read(`${dir}/${safeTid}.json`);
      const parsed = JSON.parse(raw);
      if (parsed.summary) disk.summary = parsed.summary;
      if (parsed.pendingAction) disk.pendingAction = parsed.pendingAction;
      if (parsed.createdNotes) disk.createdNotes = parsed.createdNotes;
    } catch (err: any) {
      if (!isNotFoundError(err)) console.warn(`[Store] saveThreadData merge ${dir}/${safeTid}.json:`, err?.message || err);
    }
    const hasExtra = (key: "summary" | "pendingAction" | "createdNotes") =>
      extra !== undefined && Object.prototype.hasOwnProperty.call(extra, key);
    const data: ThreadData = {
      thread,
      messages,
      summary: hasExtra("summary") ? extra?.summary : disk.summary,
      pendingAction: hasExtra("pendingAction") ? extra?.pendingAction : disk.pendingAction,
      createdNotes: hasExtra("createdNotes") ? extra?.createdNotes : disk.createdNotes,
    };
    await this.writeSerialized(`${dir}/${safeTid}.json`, JSON.stringify(data, null, 2));
  }

  async deleteThread(id: string, threadId: string): Promise<void> {
    const safeId = sanitizeId(threadId);
    if (!safeId) return;
    const path = `${this.threadsDir(id)}/${safeId}.json`;
    try {
      if (this.adapter.remove) await this.adapter.remove(path);
      else await this.adapter.write(path, "");
    } catch (_err: any) {}
  }

  /**
   * Serialized read-modify-write for thread data within this process.
   */
  async patchThreadData(id: string, threadId: string, updater: (data: ThreadData) => ThreadData): Promise<ThreadData | null> {
    return this.withThreadLock(id, threadId, async () => {
      const data = await this.loadThreadData(id, threadId);
      if (!data) return null;
      const patched = updater(data);
      await this.saveThreadDataUnlocked(id, patched.thread, patched.messages, patched);
      return patched;
    });
  }

  /** Convenience: loads existing thread data or creates skeleton, then saves new messages atomically. */
  async updateThreadMessages(id: string, threadId: string, messages: any[]): Promise<void> {
    await this.withThreadLock(id, threadId, async () => {
      const safeId = sanitizeId(threadId) || threadId;
      const existing = await this.loadThreadData(id, safeId);
      const thread: any = existing?.thread || {
        thread_id: safeId, project_id: id,
        title: "Nueva conversación", created_at: Date.now(), updated_at: Date.now(), starred: false,
      };
      thread.updated_at = Date.now();
      const firstUserMsg = messages.find((m: any) => m.role === "user");
      if (firstUserMsg?.content) thread.title = firstUserMsg.content.slice(0, 60);
      await this.saveThreadDataUnlocked(id, thread, messages, existing || undefined);
    });
  }

  async renameThread(id: string, threadId: string, newTitle: string): Promise<void> {
    const safeId = sanitizeId(threadId);
    if (!safeId) return;
    const data = await this.loadThreadData(id, safeId);
    if (!data) return;
    data.thread.title = newTitle;
    data.thread.updated_at = Date.now();
    await this.saveThreadData(id, data.thread, data.messages, data);
  }

  async toggleStarThread(id: string, threadId: string): Promise<Thread | null> {
    const safeId = sanitizeId(threadId);
    if (!safeId) return null;
    const data = await this.loadThreadData(id, safeId);
    if (!data) return null;
    data.thread.starred = !data.thread.starred;
    await this.saveThreadData(id, data.thread, data.messages, data);
    return data.thread;
  }

  async moveThread(id: string, threadId: string, targetProjectId: string): Promise<void> {
    const safeId = sanitizeId(threadId);
    if (!safeId) return;
    if (id === targetProjectId) return;
    await this.withThreadLock(id, safeId, async () => {
      const data = await this.loadThreadData(id, safeId);
      if (!data) return;
      data.thread.project_id = targetProjectId;
      data.thread.updated_at = Date.now();
      await this.saveThreadData(targetProjectId, data.thread, data.messages, {
        summary: data.summary,
        pendingAction: data.pendingAction,
        createdNotes: data.createdNotes,
      });
      const sourcePath = `${this.threadsDir(id)}/${safeId}.json`;
      if (this.adapter.remove) await this.adapter.remove(sourcePath);
      else await this.adapter.write(sourcePath, "");
    });
  }

  async createProject(id: string, name?: string): Promise<Project> {
    const p = defaultProject(id, name || id);
    await this.saveProject(p);
    return p;
  }

  /** Deletes a project's metadata file. Thread data and memory files remain orphaned. */
  async deleteProject(id: string): Promise<void> {
    const path = this.projectPath(id);
    try {
      if (this.adapter.remove) await this.adapter.remove(path);
      else await this.adapter.write(path, "");
    } catch (_err: any) {}
  }
}
