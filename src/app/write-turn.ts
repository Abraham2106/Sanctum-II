// DEC-0008: note write intent and resolver scope live outside chat-orchestrator.
// DEC-0022: project ∩ agent write scope; read scope passed to note resolver.

import type { AppServices } from "./services";
import type { RequestSnapshot } from "./services";
import { executeWriteIntent as executeWriteIntentFromNoteGen, generateNoteFromSource, canWriteToPath } from "../orchestrator/note-generator";
import { resolveNoteReference } from "../orchestrator/note-resolver";
import { executeTurn } from "../orchestrator/agent-turn";
import { fallbackAgent } from "../agents/fallback";
import { parseWriteIntent } from "../utils";
import { buildEffectiveReadScope, isPathAuthorized } from "../runtime/permissions";
import type { ConversationMessage } from "../orchestrator/conversation";
import type { GeminiBalancer } from "../embeddings/gemini-balancer";
import type { EmbedderPort } from "../runtime/ports";

export function effectiveWritePathsForAgent(
  projectWritePaths: string[] | undefined,
  agentWritePaths: string[] | undefined,
): string[] {
  const project = projectWritePaths ?? [];
  if (!project.length) return [];
  if (!agentWritePaths?.length) return [];
  return project;
}

export function isWriteAuthorizedForAgent(
  path: string,
  projectWritePaths: string[] | undefined,
  agentWritePaths: string[] | undefined,
): boolean {
  const scope = buildEffectiveReadScope({
    projectReadPaths: projectWritePaths ?? [],
    agentReadPaths: agentWritePaths ?? [],
  });
  if (!scope.allowed) return false;
  return isPathAuthorized(path, scope) && canWriteToPath(path, projectWritePaths ?? []);
}

function embedderAsGeminiBalancer(embedder: EmbedderPort, fallback: GeminiBalancer): GeminiBalancer {
  if (embedder.hasKeys) {
    return {
      hasKeys: true,
      keyCount: 1,
      embed: (text, model?, dims?) =>
        embedder.embed(text, { model, purpose: "query", signal: undefined }),
    } as GeminiBalancer;
  }
  return fallback;
}

export function buildNoteResolverScope(snap: RequestSnapshot, agent = snap.agent) {
  return {
    projectReadPaths: snap.project?.read_paths ?? [],
    agentReadPaths: agent?.permissions?.read_paths,
    selectionPaths: snap.pathFilter,
    projectId: snap.projectId,
    projectRag: snap.project?.rag
      ? {
          embed_model: snap.project.rag.embed_model,
          dims: snap.project.rag.dims,
          top_k: snap.project.rag.top_k,
          min_similarity: snap.project.rag.min_similarity,
        }
      : undefined,
  };
}

export async function findSourceContent(
  svc: AppServices,
  convMessages: ConversationMessage[] | undefined,
  userMessage: string | undefined,
  snap: RequestSnapshot,
): Promise<string | null> {
  const referential = !userMessage || isReferentialNoteRequest(userMessage);
  if (!referential) return null;
  const fromHistory = [...(convMessages || [])]
    .reverse()
    .find(
      (m) =>
        m.role === "assistant" &&
        m.content.trim().length > 80 &&
        !/^(?:pensando|error al crear nota)/i.test(m.content.trim()),
    );
  if (fromHistory?.content) return fromHistory.content;
  if (snap.projectId && snap.threadId) {
    const data = await svc.projectStore
      .loadThreadData(snap.projectId, snap.threadId)
      .catch(() => null);
    const fromThread = [...(data?.messages || [])]
      .reverse()
      .find(
        (m: any) =>
          m.role === "assistant" &&
          typeof m.content === "string" &&
          m.content.trim().length > 80 &&
          !/^(?:pensando|error al crear nota)/i.test(m.content.trim()),
      );
    if (fromThread?.content) return fromThread.content;
  }
  return null;
}

export function isReferentialNoteRequest(userMessage: string): boolean {
  const normalized = userMessage.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /\b(?:eso|lo anterior|la investigacion|la respuesta|a partir de eso|genera(?:r)? la nota|crea(?:r)? la nota)\b/i.test(
    normalized,
  );
}

export async function executeWriteIntentMessage(
  svc: AppServices,
  userMessage: string,
  snap: RequestSnapshot,
  convMessages?: ConversationMessage[],
): Promise<string | null> {
  const intent = parseWriteIntent(userMessage);
  if (!intent) return null;
  const sourceContent = isReferentialNoteRequest(userMessage)
    ? await findSourceContent(svc, convMessages, userMessage, snap)
    : undefined;
  if (isReferentialNoteRequest(userMessage) && !sourceContent) {
    return "No encontré una investigación previa para convertir en nota. Indicá el tema o compartí primero el contenido fuente.";
  }
  return createNoteFromIntent(svc, intent.name || intent.topic!, intent.topic!, snap, sourceContent ?? undefined);
}

export async function createNoteFromIntent(
  svc: AppServices,
  name: string,
  topic: string,
  snap: RequestSnapshot,
  sourceContent?: string,
  agentOverride?: import("../agents/types").AgentDefinition,
): Promise<string> {
  const agent = agentOverride || snap.agent || fallbackAgent();
  const writePaths = effectiveWritePathsForAgent(
    snap.project?.write_paths,
    agent.permissions?.write_paths,
  );
  try {
    const result: any = sourceContent
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
          { title: name },
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
          { name, topic },
        );
    const resultPath =
      typeof result === "object" && result?.path
        ? result.path
        : `${snap.project?.outputPath || "Research"}/${name}.md`;
    if (!isWriteAuthorizedForAgent(resultPath, snap.project?.write_paths, agent.permissions?.write_paths)) {
      return `Permiso denegado: no se puede escribir ${resultPath}`;
    }
    if (snap.threadId && snap.projectId) {
      await svc.projectStore.patchThreadData(snap.projectId, snap.threadId, (d) => {
        if (!d.createdNotes) d.createdNotes = [];
        d.createdNotes.push({
          path: resultPath,
          title: typeof result === "object" && result?.title ? result.title : name,
          created_at: Date.now(),
        });
        return d;
      });
    }
    return typeof result === "string" ? result : `✏️ **${result.writeResult.message}**\n\n${result.content}`;
  } catch (err: any) {
    return `Error al crear nota: ${err.message}`;
  }
}

export async function modifyNoteFromIntent(
  svc: AppServices,
  userMessage: string,
  decisionNoteName: string | undefined,
  snap: RequestSnapshot,
): Promise<string> {
  const named = typeof decisionNoteName === "string" ? decisionNoteName.trim() : "";
  const threadData =
    snap.projectId && snap.threadId
      ? await svc.projectStore.loadThreadData(snap.projectId, snap.threadId).catch(() => null)
      : null;
  const scopeInput = buildNoteResolverScope(snap);
  const balancer = embedderAsGeminiBalancer(snap.embedder, snap.geminiBalancer);
  let resolution = await resolveNoteReference(
    named || userMessage,
    threadData?.createdNotes,
    snap.indexStatus === "ready" ? snap.vectorStore : undefined,
    snap.indexStatus === "ready" ? balancer : undefined,
    scopeInput,
    snap.sealedGeneration,
  );
  if (named && resolution.method === "not_found") {
    resolution = await resolveNoteReference(
      userMessage,
      threadData?.createdNotes,
      snap.indexStatus === "ready" ? snap.vectorStore : undefined,
      snap.indexStatus === "ready" ? balancer : undefined,
      scopeInput,
      snap.sealedGeneration,
    );
  }
  if (resolution.method === "not_found") {
    return "No encontré ninguna nota que coincida. ¿Podrías decirme el nombre exacto?";
  }
  if (resolution.method === "ambiguous") {
    const names = (resolution.candidates || []).map((c) => c.title).join(", ");
    return `Encontré varias notas posibles: ${names}. ¿A cuál te referís?`;
  }
  if (!resolution.path) return "No encontré una ruta válida para esa nota.";
  const agent = snap.agent || fallbackAgent();
  if (
    !isWriteAuthorizedForAgent(resolution.path, snap.project?.write_paths, agent.permissions?.write_paths)
  ) {
    return `Permiso denegado: no se puede modificar ${resolution.path}`;
  }
  try {
    const currentContent = await svc.adapter.read(resolution.path);
    const modPrompt = `Nota actual:\n${currentContent.slice(0, 3000)}\n\nInstrucción del usuario: ${userMessage}\n\nRegenerá la nota completa incorporando los cambios pedidos. Responde SOLO con el contenido Markdown completo de la nota modificada.`;
    const result = await executeTurn(
      {
        agent,
        opencodeClient: svc.opencodeClient,
        geminiBalancer: snap.geminiBalancer,
        embedder: snap.embedder,
        vectorStore: snap.vectorStore,
        tracer: svc.tracer,
        tavilyApiKey: svc.settings?.tavilyApiKey,
        kgOptions: svc.kgOptions,
        edgeStore: snap.kgEdgeStore,
        projectContext: snap.projectContext || undefined,
        skillContext: snap.skillContext || undefined,
        sealedGeneration: snap.sealedGeneration,
        signal: snap.chatAbort.signal,
      },
      modPrompt,
      true,
      snap.pathFilter,
    );
    const wr = await svc.noteWriter.update(resolution.path, result.content);
    return `✏️ **${wr.message}**\n\n${result.content.slice(0, 300)}…`;
  } catch (err: any) {
    return `Error al modificar nota: ${err.message}`;
  }
}
