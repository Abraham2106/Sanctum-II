import type { AgentDefinition } from "../agents/types";
import type { OpenCodeClient } from "../llm/opencode-client";
import type { NoteWriter, WriteResult } from "../core/note-writer";
import type { Tracer } from "../observability/tracer";
import { renderSystemPrompt } from "../agents/agent-loader";
import { slugify, extractTitle, globMatch, isInternalPath } from "../utils";
import { RESEARCH_PATH } from "../constants";

export function makeInstruction(topic: string): string {
  return `Generá contenido detallado y bien estructurado sobre: ${topic}. Empezá con '# Título' en la primera línea. Incluí secciones, ejemplos y referencias. Respondé SOLO con el contenido Markdown.`;
}

export function canWriteToPath(path: string, writePaths: string[] | undefined): boolean {
  if (!writePaths || writePaths.length === 0) return false;
  if (isInternalPath(path)) return false;
  return writePaths.some((p) => globMatch(path, p));
}

export interface NoteGenDeps {
  agent: AgentDefinition;
  opencodeClient: OpenCodeClient;
  noteWriter: NoteWriter;
  tracer: Tracer;
  vaultAdapter: { exists(p: string): Promise<boolean> };
  writePaths: string[];
  outputPath?: string;
}

export interface GenerateResult {
  content: string;
  path: string;
  writeResult: WriteResult;
}

async function generateNoteContent(deps: NoteGenDeps, instruction: string): Promise<GenerateResult> {
  const rendered = renderSystemPrompt(deps.agent, "", instruction);
  const result = await deps.opencodeClient.chat(rendered, instruction);
  const title = extractTitle(result.content) || slugify(instruction.slice(0, 40));
  const basePath = deps.outputPath || RESEARCH_PATH;
  const path = `${basePath}/${slugify(title)}.md`;

  if (!canWriteToPath(path, deps.writePaths)) {
    throw new Error(`Sin permisos de escritura para ${path}`);
  }

  const exists = await deps.vaultAdapter.exists(path).catch(() => false);
  const writeResult = exists
    ? await deps.noteWriter.update(path, result.content)
    : await deps.noteWriter.create(path, result.content);

  return { content: result.content, path, writeResult };
}

export async function executeWriteIntent(deps: NoteGenDeps, intent: { name: string; topic: string }): Promise<string> {
  const instruction = makeInstruction(intent.topic);
  deps.tracer.start(deps.agent.id, deps.agent.system_prompt, instruction);

  try {
    const { content, path, writeResult } = await generateNoteContent(deps, instruction);
    await deps.tracer.finish(content, { action: "create_note", path, topic: intent.topic });
    return `✏️ **${writeResult.message}**\n\n${content}`;
  } catch (err: any) {
    deps.tracer.abort(err.message);
    return `Error: ${err.message}`;
  }
}

/**
 * Intentionally inconsistent with executeWriteIntent: this function THROWs on error
 * (caller shows Notice) while executeWriteIntent returns error as string (caller
 * displays as chat content). Both patterns fit their respective callers.
 */
export async function createNoteAction(deps: NoteGenDeps): Promise<string> {
  const instruction = makeInstruction("un tema interesante de investigación");
  deps.tracer.start(deps.agent.id, deps.agent.system_prompt, instruction);

  try {
    const { content, path, writeResult } = await generateNoteContent(deps, instruction);
    await deps.tracer.finish(content, { action: "create_note", path });
    return path;
  } catch (err: any) {
    deps.tracer.abort(err.message);
    throw err;
  }
}
