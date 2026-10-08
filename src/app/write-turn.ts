// DEC-0008: este trabajo vive aparte del archivo que lo mezcla
import { fallbackAgent } from "../agents/fallback";
import {
  executeWriteIntent as executeWriteIntentFromNoteGen,
  generateNoteFromSource,
} from "../orchestrator/note-generator";
import type { ConversationMessage } from "../orchestrator/conversation";
import { parseWriteIntent } from "../utils";
import type { AppServices } from "./services";

export interface RequestSnapshot {
  projectId: string | undefined;
  threadId: string | undefined;
  project: import("../projects/types").Project | null;
  agent: import("../agents/types").AgentDefinition | null;
  pathFilter: string[] | undefined;
  projectContext: import("../projects/context").ProjectContext | null;
  skillContext: import("../skills/types").Skill | null;
  vectorStore: AppServices["vectorStore"];
  geminiBalancer: AppServices["geminiBalancer"];
  kgEdgeStore: AppServices["kgEdgeStore"];
}

export async function executeWriteIntent(
  svc: AppServices,
  userMessage: string,
  snap: RequestSnapshot,
): Promise<string | null> {
  const intent = parseWriteIntent(userMessage);
  if (!intent) return null;
  const sourceContent = isReferentialNoteRequest(userMessage)
    ? await findSourceContent(svc, undefined, userMessage, snap)
    : undefined;
  if (isReferentialNoteRequest(userMessage) && !sourceContent) {
    return "No encontré una investigación previa para convertir en nota. Indicá el tema o compartí primero el contenido fuente.";
  }
  return await createNoteFromIntent(svc, intent.name || intent.topic!, intent.topic!, snap, sourceContent || undefined);
}

export async function createNoteFromIntent(
  svc: AppServices,
  name: string,
  topic: string,
  snap: RequestSnapshot,
  sourceContent?: string,
): Promise<string> {
  const agent = snap.agent || fallbackAgent();
  try {
    const result: any = sourceContent
      ? await generateNoteFromSource(
        {
          agent,
          opencodeClient: svc.opencodeClient,
          noteWriter: svc.noteWriter,
          tracer: svc.tracer,
          vaultAdapter: svc.adapter,
          writePaths: snap.project?.write_paths || [],
          outputPath: snap.project?.outputPath,
        },
        sourceContent,
        { title: name },
      )
      : await executeWriteIntentFromNoteGen(
      {
        agent,
        opencodeClient: svc.opencodeClient,
        noteWriter: svc.noteWriter,
        tracer: svc.tracer,
        vaultAdapter: svc.adapter,
        writePaths: snap.project?.write_paths || [],
        outputPath: snap.project?.outputPath,
      },
      { name, topic },
    );
    const resultPath = typeof result === "object" && result?.path
      ? result.path
      : `${snap.project?.outputPath || "Research"}/${name}.md`;
    if (snap.threadId && snap.projectId) {
      await svc.projectStore.patchThreadData(snap.projectId, snap.threadId, d => {
        if (!d.createdNotes) d.createdNotes = [];
        d.createdNotes.push({ path: resultPath, title: typeof result === "object" && result?.title ? result.title : name, created_at: Date.now() });
        return d;
      });
    }
    return typeof result === "string" ? result : `✏️ **${result.writeResult.message}**\n\n${result.content}`;
  } catch (err: any) {
    return `Error al crear nota: ${err.message}`;
  }
}

/** Find the last substantive assistant response for referential commands. */
export async function findSourceContent(
  svc: AppServices,
  convMessages?: ConversationMessage[],
  userMessage?: string,
  snap?: RequestSnapshot,
): Promise<string | null> {
  const referential = !userMessage || isReferentialNoteRequest(userMessage);
  if (!referential) return null;
  const fromHistory = [...(convMessages || [])].reverse().find(m => m.role === "assistant" && m.content.trim().length > 80 && !/^(?:pensando|error al crear nota)/i.test(m.content.trim()));
  if (fromHistory?.content) return fromHistory.content;
  if (snap?.projectId && snap.threadId) {
    const data = await svc.projectStore.loadThreadData(snap.projectId, snap.threadId).catch(() => null);
    const fromThread = [...(data?.messages || [])].reverse().find((m: any) => m.role === "assistant" && typeof m.content === "string" && m.content.trim().length > 80 && !/^(?:pensando|error al crear nota)/i.test(m.content.trim()));
    if (fromThread?.content) return fromThread.content;
  }
  return null;
}

export function isReferentialNoteRequest(userMessage: string): boolean {
  const normalized = userMessage.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /\b(?:eso|lo anterior|la investigacion|la respuesta|a partir de eso|genera(?:r)? la nota|crea(?:r)? la nota)\b/i.test(normalized);
}
