// DEC-0008: pendingAction confirmation flow outside chat-orchestrator.

import type { AppServices, RequestSnapshot } from "./services";
import type { ChatResponse } from "./chat-orchestrator";
import { classifyIntent } from "../orchestrator/conversation";
import { loadAgentFromVault } from "../agents/agent-loader";
import { fallbackAgent } from "../agents/fallback";
import {
  createNoteFromIntent,
  effectiveWritePathsForAgent,
  findSourceContent,
  isWriteAuthorizedForAgent,
} from "./write-turn";
import { executeWriteIntent as executeWriteIntentFromNoteGen, generateNoteFromSource } from "../orchestrator/note-generator";

export async function tryResolvePendingAction(
  svc: AppServices,
  userMessage: string,
  snap: RequestSnapshot,
  resumeAgentMessage: (
    followUp: string,
    snap: RequestSnapshot,
  ) => Promise<ChatResponse>,
): Promise<ChatResponse | null> {
  if (!snap.threadId || !snap.projectId) return null;
  const data = await svc.projectStore.loadThreadData(snap.projectId, snap.threadId).catch(() => null);
  if (!data?.pendingAction) return null;

  const intent = classifyIntent(userMessage, data.pendingAction);
  const projectId = snap.projectId;
  const threadId = snap.threadId;

  if (intent.type === "rejection") {
    await svc.projectStore.patchThreadData(projectId, threadId, (d) => {
      d.pendingAction = undefined;
      return d;
    });
    return { content: "👍 Ok, no se realiza la acción." };
  }

  if (intent.type === "confirmation") {
    const pa = data.pendingAction;
    if (pa.type === "create_note") {
      let agent = snap.agent || fallbackAgent();
      if (pa.params.sourceAgentId) {
        try {
          agent = await loadAgentFromVault(svc.adapter, `${pa.params.sourceAgentId}.md`);
        } catch (err: any) {
          console.warn(
            `[Note] source agent "${pa.params.sourceAgentId}" unavailable:`,
            err?.message || err,
          );
        }
      }
      const noteName = pa.params.noteName || pa.params.title || "nota";
      const sourceContent = pa.params.sourceContent || pa.params.fullProposal || pa.description || noteName;
      const writePaths = effectiveWritePathsForAgent(
        snap.project?.write_paths,
        agent.permissions?.write_paths,
      );
      try {
        const result: any = pa.params.sourceContent
          ? await generateNoteFromSource(
              {
                agent,
                opencodeClient: svc.opencodeClient,
                noteWriter: svc.noteWriter,
                tracer: svc.tracer,
                vaultAdapter: svc.adapter,
                writePaths,
                outputPath: snap.project?.outputPath,
              },
              sourceContent,
              { title: pa.params.suggestedTitle || noteName },
            )
          : await executeWriteIntentFromNoteGen(
              {
                agent,
                opencodeClient: svc.opencodeClient,
                noteWriter: svc.noteWriter,
                tracer: svc.tracer,
                vaultAdapter: svc.adapter,
                writePaths,
                outputPath: snap.project?.outputPath,
              },
              { name: noteName, topic: sourceContent },
            );
        if (typeof result === "string" && /^Error\s*:/i.test(result)) {
          throw new Error(result.replace(/^Error\s*:\s*/i, ""));
        }
        const resultPath =
          typeof result === "object" && result?.path
            ? result.path
            : `${snap.project?.outputPath || "Research"}/${noteName}.md`;
        if (
          !isWriteAuthorizedForAgent(resultPath, snap.project?.write_paths, agent.permissions?.write_paths)
        ) {
          return { content: `Permiso denegado: no se puede escribir ${resultPath}` };
        }
        const resultContent =
          typeof result === "string"
            ? result
            : `✏️ **${result.writeResult.message}**\n\n${result.content}`;
        await svc.projectStore.patchThreadData(projectId, threadId, (d) => {
          d.pendingAction = undefined;
          if (!d.createdNotes) d.createdNotes = [];
          d.createdNotes.push({
            path: resultPath,
            title: typeof result === "object" && result?.title ? result.title : noteName,
            created_at: Date.now(),
          });
          return d;
        });
        return { content: resultContent };
      } catch (err: any) {
        return { content: `Error al crear nota: ${err.message}` };
      }
    }
    if (pa.type === "research") {
      await svc.projectStore.patchThreadData(projectId, threadId, (d) => {
        d.pendingAction = undefined;
        return d;
      });
      const followUp = pa.params.fullProposal || pa.description || "profundizar";
      return resumeAgentMessage(followUp, snap);
    }
  }

  return null;
}

export async function createNoteFromOrchestratorDecision(
  svc: AppServices,
  noteName: string,
  userMessage: string,
  snap: RequestSnapshot,
  convMessages?: import("../orchestrator/conversation").ConversationMessage[],
): Promise<string> {
  const sourceContent = await findSourceContent(svc, convMessages, userMessage, snap);
  if (isReferential(userMessage) && !sourceContent) {
    return "No encontré una investigación previa para convertir en nota. Indicá el tema o compartí primero el contenido fuente.";
  }
  return createNoteFromIntent(svc, noteName, userMessage, snap, sourceContent || undefined);
}

function isReferential(userMessage: string): boolean {
  const normalized = userMessage.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /\b(?:eso|lo anterior|a partir de eso|genera(?:r)? la nota|crea(?:r)? la nota)\b/i.test(
    normalized,
  );
}
