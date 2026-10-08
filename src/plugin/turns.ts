// DEC-0008: este trabajo vive aparte del archivo que lo mezcla

import { Notice } from "obsidian";
import type { MeshResultFull } from "../orchestrator/mesh";
import { runMeshWithCritic } from "../orchestrator/mesh";
import { writeNoteAtPath } from "../orchestrator/note-generator";
import type { ChatResponse } from "../app/chat-orchestrator";
import type { ConversationMessage } from "../orchestrator/conversation";
import { parseSkillCreatorCommand } from "../skills/authoring/command";
import type { SkillAuthoringProgress, SkillGenerationRequest } from "../skills/authoring/types";
import type { AppServices } from "../app/services";
import type { GeminiBalancer } from "../embeddings/gemini-balancer";
import type { OpenCodeClient } from "../llm/opencode-client";
import type { VectorStore } from "../rag/vector-store";
import type { Tracer } from "../observability/tracer";
import type { NoteWriter } from "../core/note-writer";
import type { KgEdgeStore } from "../kg/kg-store";
import type { SanctumSettings } from "../constants";
import type { ChatOrchestrator } from "../app/chat-orchestrator";
import type { Vault } from "obsidian";

export interface TurnPluginHost {
  app: { vault: Vault };
  settings: SanctumSettings;
  services: AppServices;
  activeFolder: string | null;
  opencodeClient: OpenCodeClient;
  geminiBalancer: GeminiBalancer;
  vectorStore: VectorStore;
  kgEdgeStore: KgEdgeStore;
  tracer: Tracer;
  noteWriter: NoteWriter;
  chatOrch: ChatOrchestrator;
  createSkillFromChat(
    request: SkillGenerationRequest,
    onProgress?: (progress: SkillAuthoringProgress) => void,
  ): Promise<string>;
  openAgentGenerator(initialDescription?: string): Promise<string>;
  parseWriteIntent(text: string): { name?: string; topic: string } | null;
}

export async function sendChatMessage(
  plugin: TurnPluginHost,
  userMessage: string,
  convMessages?: ConversationMessage[],
  convSummary?: string,
  onSkillProgress?: (progress: SkillAuthoringProgress) => void,
): Promise<ChatResponse | string> {
  const skillRequest = parseSkillCreatorCommand(userMessage);
  if (skillRequest) {
    return plugin.createSkillFromChat(skillRequest, onSkillProgress);
  }

  const genMatch = userMessage.trim().match(/^@(?:agent-creator|agent-generator)(?:\s+([\s\S]*))?$/i);
  if (genMatch) {
    return plugin.openAgentGenerator(genMatch[1]?.trim() || "");
  }

  const result = await plugin.chatOrch.handleMessage(userMessage, convMessages, convSummary);
  return result;
}

export async function runMesh(plugin: TurnPluginHost, userPrompt: string): Promise<MeshResultFull> {
  const activeProject = plugin.services.activeProject;
  const projectSnapshot = activeProject
    ? {
        ...activeProject,
        read_paths: [...activeProject.read_paths],
        write_paths: [...activeProject.write_paths],
        rag: { ...activeProject.rag },
        files: [...(activeProject.files || [])],
        attachedFiles: [...(activeProject.attachedFiles || [])],
      }
    : null;
  const projectContextSnapshot = plugin.services.activeProjectContext;
  const vectorStoreSnapshot = plugin.services.vectorStore;
  const kgEdgeStoreSnapshot = plugin.kgEdgeStore.snapshot();
  const activeFolderSnapshot = plugin.activeFolder;
  const kgOptionsSnapshot = { ...plugin.services.kgOptions };
  const skillContextSnapshot = plugin.services.skillContext
    ? {
        ...plugin.services.skillContext,
        tools: [...(plugin.services.skillContext.tools || [])],
      }
    : null;
  const writePathsSnapshot = [...(projectSnapshot?.write_paths || [])];
  const outputPathSnapshot = projectSnapshot?.outputPath || "Research";
  const writeIntent = plugin.parseWriteIntent(userPrompt);
  let actualPrompt = userPrompt;
  let noteName = (writeIntent?.name || "")
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\.\./g, "")
    .trim();
  if (noteName && !/\.md$/i.test(noteName)) noteName += ".md";

  if (writeIntent) {
    let instruction = `\n\n---\n**Instrucción automática — Modo Creación de Nota:**\nEl usuario ha pedido crear una nota en su base de conocimiento. Tu respuesta final debe estar formateada como un documento Markdown completo. Es OBLIGATORIO que incluyas al final del documento entre 3 y 5 etiquetas (hashtags como \`#quantum-computing\`, \`#concept\`) que conecten semánticamente los temas tratados, para que el sistema de grafos de Obsidian pueda relacionar esta nota con el resto del vault.`;
    if (!noteName) {
      instruction += `\n\nAdemás, tu respuesta debe comenzar EXACTAMENTE con una línea que contenga el identificador del nombre del archivo en este formato: filename: Nombre-Del-Archivo.`;
    }
    actualPrompt = `${userPrompt}${instruction}`;
  }

  const notice = new Notice(`🔀 Ejecutando mesh...`, 0);
  try {
    const result = await runMeshWithCritic({
      userPrompt: actualPrompt,
      vaultAdapter: plugin.app.vault.adapter,
      opencodeClient: plugin.opencodeClient,
      geminiBalancer: plugin.geminiBalancer,
      vectorStore: vectorStoreSnapshot,
      tracer: plugin.tracer,
      pathFilter: activeFolderSnapshot ? [`${activeFolderSnapshot}/**`] : undefined,
      tavilyApiKey: plugin.settings.tavilyApiKey,
      kgOptions: kgOptionsSnapshot,
      edgeStore: kgEdgeStoreSnapshot,
      projectContext: projectContextSnapshot || undefined,
      skillContext: skillContextSnapshot || undefined,
    });
    if (result.criticVerdict === "accept" && writeIntent) {
      if (!noteName) {
        const fileMatch = result.researcherOutput.match(/^filename:\s*(.+)/m);
        if (fileMatch) {
          noteName = fileMatch[1].trim().replace(/[<>:"/\\|?*]/g, "").replace(/\.\./g, "").slice(0, 60) + ".md";
        } else {
          noteName = `${writeIntent.topic.replace(/[<>:"/\\|?*]/g, "").replace(/\.\./g, "").replace(/\s+/g, "-").slice(0, 40)}.md`;
        }
      }
      const noteFullPath = `${outputPathSnapshot}/${noteName}`;
      try {
        const wr = await writeNoteAtPath(
          { noteWriter: plugin.noteWriter, vaultAdapter: plugin.app.vault.adapter, writePaths: writePathsSnapshot },
          noteFullPath,
          result.researcherOutput,
        );
        if (wr.success) result.createdNotePath = wr.path;
        else new Notice(`⚠️ ${wr.message}`);
      } catch (err: any) {
        new Notice(`⚠️ ${err.message}`);
      }
    }
    notice.hide();
    return result;
  } catch (err: any) {
    notice.hide();
    throw err;
  }
}
