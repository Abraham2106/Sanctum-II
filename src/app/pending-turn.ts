// DEC-0008: este trabajo vive aparte del archivo que lo mezcla
import { loadAgentFromVault } from "../agents/agent-loader";
import { fallbackAgent } from "../agents/fallback";
import {
  executeWriteIntent as executeWriteIntentFromNoteGen,
  generateNoteFromSource,
} from "../orchestrator/note-generator";
import { classifyIntent } from "../orchestrator/conversation";
import type { AppServices } from "./services";
import type { ChatResponse } from "./chat-orchestrator";
import type { RequestSnapshot } from "./write-turn";

export type HandleAgentMessageFn = (
  userMessage: string,
  mentionMatch: RegExpMatchArray | null,
  convMessages: undefined,
  convSummary: undefined,
  snap: RequestSnapshot,
) => Promise<ChatResponse>;

export async function tryResolvePendingAction(
  svc: AppServices,
  userMessage: string,
  snap: RequestSnapshot,
  handleAgentMessage: HandleAgentMessageFn,
): Promise<ChatResponse | null> {
  if (!snap.threadId || !snap.projectId) return null;
  const data = await svc.projectStore.loadThreadData(snap.projectId, snap.threadId).catch(() => null);
  if (!data?.pendingAction) return null;

  const intent = classifyIntent(userMessage, data.pendingAction);
  const projectId = snap.projectId;
  const threadId = snap.threadId;

  if (intent.type === "rejection") {
    await svc.projectStore.patchThreadData(projectId, threadId, d => { d.pendingAction = undefined; return d; });
    return { content: "👍 Ok, no se realiza la acción." };
  }

  if (intent.type === "confirmation") {
    const pa = data.pendingAction;
    if (pa.type === "create_note") {
      let agent = snap.agent || fallbackAgent();
      // Preserve the agent that produced the source when it is available;
      // this keeps formatting instructions consistent across turns while
      // the source snapshot remains the authoritative input.
      if (pa.params.sourceAgentId) {
        try {
          agent = await loadAgentFromVault(svc.adapter, `${pa.params.sourceAgentId}.md`);
        } catch (err: any) {
          console.warn(`[Note] source agent "${pa.params.sourceAgentId}" unavailable:`, err?.message || err);
        }
      }
      const noteName = pa.params.noteName || pa.params.title || "nota";
      const sourceContent = pa.params.sourceContent || pa.params.fullProposal || pa.description || noteName;
      try {
        const result: any = pa.params.sourceContent
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
            { title: pa.params.suggestedTitle || noteName },
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
          { name: noteName, topic: sourceContent },
        );
        if (typeof result === "string" && /^Error\s*:/i.test(result)) {
          throw new Error(result.replace(/^Error\s*:\s*/i, ""));
        }
        const resultContent = typeof result === "string"
          ? result
          : `✏️ **${result.writeResult.message}**\n\n${result.content}`;
        const resultPath = typeof result === "object" && result?.path
          ? result.path
          : `${snap.project?.outputPath || "Research"}/${noteName}.md`;
        await svc.projectStore.patchThreadData(projectId, threadId, d => {
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
        // Keep pendingAction intact so the user can retry after a transient
        // provider, permission or filesystem failure.
        return { content: `Error al crear nota: ${err.message}` };
      }
    }
    if (pa.type === "research") {
      await svc.projectStore.patchThreadData(projectId, threadId, d => { d.pendingAction = undefined; return d; });
      const followUp = pa.params.fullProposal || pa.description || "profundizar";
      return handleAgentMessage(followUp, null, undefined, undefined, snap);
    }
  }

  return null;
}
