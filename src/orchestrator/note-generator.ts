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

/** Result of generation and persistence, including the path actually written. */
export interface GenerateResult {
  content: string;
  path: string;
  title: string;
  writeResult: WriteResult;
}

export async function writeNoteAtPath(
  deps: Pick<NoteGenDeps, "noteWriter" | "vaultAdapter" | "writePaths">,
  path: string,
  content: string,
): Promise<WriteResult> {
  if (!canWriteToPath(path, deps.writePaths)) {
    throw new Error(`Sin permisos de escritura para ${path}`);
  }
  // `exists` is a normal negative result for a missing note. Do not convert
  // permission, corruption, or storage failures into a false negative: those
  // errors must reach the caller instead of silently attempting a create.
  const exists = await deps.vaultAdapter.exists(path);
  return exists
    ? deps.noteWriter.update(path, content)
    : deps.noteWriter.create(path, content);
}

async function generateNoteContent(
  deps: NoteGenDeps,
  instruction: string,
  fallbackTitle?: string,
): Promise<GenerateResult> {
  const latexInstruction = "Preserva literalmente bloques LaTeX, delimitadores, comandos, subindices, llaves, etiquetas y saltos de linea; no escapes backslashes ni conviertas formulas a texto plano.";
  const modelInstruction = `${instruction}\n\n${latexInstruction}`;
  const rendered = renderSystemPrompt(deps.agent, "", modelInstruction);
  const result = await deps.opencodeClient.chat(rendered, modelInstruction);
  const title = extractTitle(result.content) || fallbackTitle || slugify(instruction.slice(0, 40));
  const basePath = deps.outputPath || RESEARCH_PATH;
  const path = `${basePath}/${slugify(title)}.md`;
  const writeResult = await writeNoteAtPath(deps, path, result.content);
  if (!writeResult.success) {
    throw new Error(writeResult.message);
  }
  return { content: result.content, path, title, writeResult };
}

/** Generate and persist a note for an explicit standalone topic. */
export async function executeWriteIntent(
  deps: NoteGenDeps,
  intent: { name: string; topic: string },
): Promise<GenerateResult> {
  const instruction = makeInstruction(intent.topic);
  const traceId = deps.tracer.start(deps.agent.id, deps.agent.system_prompt, instruction);

  try {
    const result = await generateNoteContent(deps, instruction, intent.name);
    await deps.tracer.finish(traceId, result.content, {
      action: "create_note",
      path: result.path,
      topic: intent.topic,
    });
    return result;
  } catch (err: any) {
    deps.tracer.abort(traceId, err.message);
    throw err;
  }
}

export interface SourceNoteOptions {
  /** Optional title supplied by the orchestrator or a pending action. */
  title?: string;
}

/**
 * Reformat a previous assistant response into a durable Markdown note.
 * The source is authoritative: this operation does not perform a second
 * research/web/RAG pass or introduce unrelated generic content.
 */
export async function generateNoteFromSource(
  deps: NoteGenDeps,
  sourceContent: string,
  options: SourceNoteOptions = {},
): Promise<GenerateResult> {
  const source = sourceContent.trim();
  if (!source) throw new Error("No hay contenido fuente para generar la nota");

  const titleHint = options.title?.trim();
  const titleLine = titleHint
    ? `Usa este titulo sugerido si no existe uno mejor en la fuente: ${titleHint}.`
    : "Conserva el titulo de la fuente o genera uno tecnico y especifico.";
  const instruction = [
    "Convierte la investigacion siguiente en una nota Markdown autonoma.",
    "Reformula y estructura el contenido, pero conserva todos los detalles tecnicos, formulas, resultados, advertencias y referencias presentes.",
    "Preserva literalmente los bloques LaTeX ($...$, $$...$$, \\( ... \\), \\[ ... \\]), comandos, subindices, llaves, etiquetas y saltos de linea; no escapes ni conviertas formulas a texto plano.",
    "Elimina solamente saludos, preguntas al usuario, ofertas de crear notas y metacomentarios conversacionales.",
    "No inventes informacion, no agregues una guia generica y no hagas una nueva investigacion web o RAG.",
    "Empieza con un encabezado Markdown de nivel 1 y responde SOLO con el contenido Markdown completo.",
    titleLine,
    "",
    "--- INVESTIGACION FUENTE ---",
    source,
    "--- FIN DE LA INVESTIGACION FUENTE ---",
  ].join("\n");
  const traceId = deps.tracer.start(deps.agent.id, deps.agent.system_prompt, instruction);

  try {
    const result = await generateNoteContent(deps, instruction, titleHint);
    await deps.tracer.finish(traceId, result.content, {
      action: "create_note",
      path: result.path,
      source: "conversation",
    });
    return result;
  } catch (err: any) {
    deps.tracer.abort(traceId, err.message);
    throw err;
  }
}

/** Generate the standalone note action used by the UI command. */
export async function createNoteAction(deps: NoteGenDeps): Promise<string> {
  const instruction = makeInstruction("un tema interesante de investigación");
  const traceId = deps.tracer.start(deps.agent.id, deps.agent.system_prompt, instruction);

  try {
    const result = await generateNoteContent(deps, instruction);
    await deps.tracer.finish(traceId, result.content, { action: "create_note", path: result.path });
    return result.path;
  } catch (err: any) {
    deps.tracer.abort(traceId, err.message);
    throw err;
  }
}
