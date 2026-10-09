import type { MemoryEntry, Project, Thread, ThreadData, PendingAction, CreatedNote } from "./types";
import { defaultProject } from "./types";
import { PROJECTS_DIR } from "../constants";
import type { VaultAdapter } from "../core/vault-adapter";
import { ensureVaultDirectory, isNotFoundError } from "../core/vault-fs";
import { validateVaultSegmentId, withResourceLock, withResourceLocks } from "../core/resource-queue"; // DEC-0022
import { parseProjectMd, serializeProject } from "./project-md";

function assertProjectId(id: string): void {
  validateVaultSegmentId(id, "project");
}

function assertThreadId(threadId: string): void {
  validateVaultSegmentId(threadId, "thread");
  if (threadId.length > 120) throw new Error("Invalid thread id");
}

function assertThreadIdentity(thread: Thread, projectId: string, threadId: string): void {
  if (thread.thread_id !== threadId) {
    throw new Error(`Thread id mismatch: expected ${threadId}, got ${thread.thread_id}`);
  }
  if (thread.project_id !== projectId) {
    throw new Error(`Thread project mismatch: expected ${projectId}, got ${thread.project_id}`);
  }
}

function memoryResource(projectId: string): string {
  return `memory:${projectId}`;
}

function threadResource(projectId: string, threadId: string): string {
  return `thread:${projectId}/${threadId}`;
}

export class ProjectStore {
  constructor(private adapter: VaultAdapter) {}

  private projectPath(id: string): string { return `${PROJECTS_DIR}/${id}.md`; }
  private memoryDir(id: string): string { return `sanctum-memory/${id}`; }
  private memoryPath(id: string): string { return `${this.memoryDir(id)}/memory.jsonl`; }
  private threadsDir(id: string): string { return `sanctum-logs/threads/${id}`; }

  private async ensureDir(dir: string): Promise<void> {
    await ensureVaultDirectory(this.adapter, dir);
  }

  private async writeSerialized(path: string, content: string): Promise<void> {
    await this.adapter.write(path, content);
  }

  async loadProject(id: string): Promise<Project> {
    assertProjectId(id);
    const path = this.projectPath(id);
    try {
      const content = await this.adapter.read(path);
      const project = parseProjectMd(content);
      if (project.id !== id) {
        throw new Error(`Project id mismatch: requested ${id}, file has ${project.id}`);
      }
      return project;
    } catch (err: any) {
      throw new Error(`No se pudo leer ${path}: ${err.message}`);
    }
  }

  async saveProject(p: Project): Promise<void> {
    assertProjectId(p.id);
    await this.ensureDir(PROJECTS_DIR);
    await this.writeSerialized(this.projectPath(p.id), serializeProject(p));
  }

  async projectExists(id: string): Promise<boolean> {
    assertProjectId(id);
    return await this.adapter.exists(this.projectPath(id)).catch(() => false);
  }

  async listProjects(): Promise<string[]> {
    const exists = await this.adapter.exists(PROJECTS_DIR).catch(() => false);
    if (!exists) return [];
    const listing = await this.adapter.list(PROJECTS_DIR);
    return listing.files.filter(f => f.endsWith(".md")).map(f => f.replace(/^.*[\\/]/, "").replace(/\.md$/, ""));
  }

  async loadMemory(id: string): Promise<MemoryEntry[]> {
    assertProjectId(id);
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
    assertProjectId(id);
    await withResourceLock(this.adapter, memoryResource(id), async () => {
      await this.ensureDir(this.memoryDir(id));
      const path = this.memoryPath(id);
      let existing = "";
      try {
        existing = await this.adapter.read(path);
      } catch (err: any) {
        if (!isNotFoundError(err)) throw err;
      }
      await this.adapter.write(path, existing + JSON.stringify(entry) + "\n");
    });
  }

  async loadThreads(id: string): Promise<Thread[]> {
    assertProjectId(id);
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
    assertProjectId(id);
    assertThreadId(threadId);
    const path = `${this.threadsDir(id)}/${threadId}.json`;
    try {
      const content = await this.adapter.read(path);
      const data = JSON.parse(content) as ThreadData;
      assertThreadIdentity(data.thread, id, threadId);
      return data;
    } catch (err: any) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  async saveThreadData(id: string, thread: Thread, messages: any[], extra?: { summary?: string; pendingAction?: PendingAction; createdNotes?: CreatedNote[] }): Promise<void> {
    assertProjectId(id);
    const expectedThreadId = thread.thread_id;
    assertThreadId(expectedThreadId);
    await withResourceLock(this.adapter, threadResource(id, expectedThreadId), () =>
      this.saveThreadDataUnlocked(id, thread, messages, extra, expectedThreadId)
    );
  }

  private async saveThreadDataUnlocked(
    id: string,
    thread: Thread,
    messages: any[],
    extra?: { summary?: string; pendingAction?: PendingAction; createdNotes?: CreatedNote[] },
    expectedThreadId?: string
  ): Promise<void> {
    const threadId = expectedThreadId ?? thread.thread_id;
    assertThreadIdentity(thread, id, threadId);
    const dir = this.threadsDir(id);
    await this.ensureDir(dir);
    if (!thread.starred) thread.starred = false;
    let disk: Pick<ThreadData, "summary" | "pendingAction" | "createdNotes"> = {};
    try {
      const raw = await this.adapter.read(`${dir}/${threadId}.json`);
      const parsed = JSON.parse(raw);
      if (parsed.summary) disk.summary = parsed.summary;
      if (parsed.pendingAction) disk.pendingAction = parsed.pendingAction;
      if (parsed.createdNotes) disk.createdNotes = parsed.createdNotes;
    } catch (err: any) {
      if (!isNotFoundError(err)) throw err;
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
    await this.writeSerialized(`${dir}/${threadId}.json`, JSON.stringify(data, null, 2));
  }

  async deleteThread(id: string, threadId: string): Promise<void> {
    assertProjectId(id);
    assertThreadId(threadId);
    await withResourceLock(this.adapter, threadResource(id, threadId), async () => {
      const path = `${this.threadsDir(id)}/${threadId}.json`;
      try {
        if (this.adapter.remove) await this.adapter.remove(path);
        else await this.adapter.write(path, "");
      } catch (_err: any) {}
    });
  }

  async patchThreadData(id: string, threadId: string, updater: (data: ThreadData) => ThreadData): Promise<ThreadData | null> {
    assertProjectId(id);
    assertThreadId(threadId);
    return withResourceLock(this.adapter, threadResource(id, threadId), async () => {
      const data = await this.loadThreadData(id, threadId);
      if (!data) return null;
      const patched = updater(data);
      assertThreadIdentity(patched.thread, id, threadId);
      await this.saveThreadDataUnlocked(id, patched.thread, patched.messages, patched);
      return patched;
    });
  }

  async updateThreadMessages(id: string, threadId: string, messages: any[]): Promise<void> {
    assertProjectId(id);
    assertThreadId(threadId);
    await withResourceLock(this.adapter, threadResource(id, threadId), async () => {
      const existing = await this.loadThreadData(id, threadId);
      const thread: any = existing?.thread || {
        thread_id: threadId, project_id: id,
        title: "Nueva conversación", created_at: Date.now(), updated_at: Date.now(), starred: false,
      };
      thread.updated_at = Date.now();
      const firstUserMsg = messages.find((m: any) => m.role === "user");
      if (firstUserMsg?.content) thread.title = firstUserMsg.content.slice(0, 60);
      await this.saveThreadDataUnlocked(id, thread, messages, existing || undefined);
    });
  }

  async renameThread(id: string, threadId: string, newTitle: string): Promise<void> {
    assertProjectId(id);
    assertThreadId(threadId);
    await withResourceLock(this.adapter, threadResource(id, threadId), async () => {
      const data = await this.loadThreadData(id, threadId);
      if (!data) return;
      data.thread.title = newTitle;
      data.thread.updated_at = Date.now();
      await this.saveThreadDataUnlocked(id, data.thread, data.messages, data);
    });
  }

  async toggleStarThread(id: string, threadId: string): Promise<Thread | null> {
    assertProjectId(id);
    assertThreadId(threadId);
    return withResourceLock(this.adapter, threadResource(id, threadId), async () => {
      const data = await this.loadThreadData(id, threadId);
      if (!data) return null;
      data.thread.starred = !data.thread.starred;
      await this.saveThreadDataUnlocked(id, data.thread, data.messages, data);
      return data.thread;
    });
  }

  async moveThread(id: string, threadId: string, targetProjectId: string): Promise<void> {
    assertProjectId(id);
    assertProjectId(targetProjectId);
    assertThreadId(threadId);
    if (id === targetProjectId) return;

    const sourceKey = threadResource(id, threadId);
    const targetKey = threadResource(targetProjectId, threadId);
    await withResourceLocks(this.adapter, [sourceKey, targetKey], async () => {
      const data = await this.loadThreadData(id, threadId);
      if (!data) return;

      const destPath = `${this.threadsDir(targetProjectId)}/${threadId}.json`;
      if (await this.adapter.exists(destPath)) {
        throw new Error(`Thread already exists in destination project: ${targetProjectId}/${threadId}`);
      }

      data.thread.project_id = targetProjectId;
      data.thread.updated_at = Date.now();
      await this.saveThreadDataUnlocked(targetProjectId, data.thread, data.messages, {
        summary: data.summary,
        pendingAction: data.pendingAction,
        createdNotes: data.createdNotes,
      });

      const sourcePath = `${this.threadsDir(id)}/${threadId}.json`;
      if (this.adapter.remove) await this.adapter.remove(sourcePath);
      else await this.adapter.write(sourcePath, "");
    });
  }

  async createProject(id: string, name?: string): Promise<Project> {
    assertProjectId(id);
    const p = defaultProject(id, name || id);
    await this.saveProject(p);
    return p;
  }

  async deleteProject(id: string): Promise<void> {
    assertProjectId(id);
    const path = this.projectPath(id);
    try {
      if (this.adapter.remove) await this.adapter.remove(path);
      else await this.adapter.write(path, "");
    } catch (_err: any) {}
  }
}
