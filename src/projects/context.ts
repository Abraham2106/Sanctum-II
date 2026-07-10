import type { Project, MemoryEntry } from "./types";

export interface ProjectContext {
  project: Project;
  memory: MemoryEntry[];
  systemPrefix: string;
}

export async function buildProjectContext(
  project: Project,
  loadMemory: (id: string) => Promise<MemoryEntry[]>
): Promise<ProjectContext> {
  const memory = await loadMemory(project.id);
  const memoryBlock = memory.length
    ? "\n\n---\nMemoria persistente del proyecto:\n" + memory.map(m => `- ${m.text}`).join("\n")
    : "";

  const systemPrefix = [
    project.instructions,
    memoryBlock,
  ].filter(Boolean).join("\n\n");

  return { project, memory, systemPrefix };
}

export function injectProjectPrefix(systemPrompt: string, prefix: string): string {
  if (!prefix) return systemPrompt;
  return prefix + "\n\n---\n\n" + systemPrompt;
}
