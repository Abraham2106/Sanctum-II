// DEC-0008: mesh orchestration outside main; no auto-write on needs_review.

import { runMeshWithCritic } from "../orchestrator/mesh";
import type { MeshResultFull } from "../orchestrator/mesh";
import { writeNoteAtPath } from "../orchestrator/note-generator";
import { parseWriteIntent } from "../utils";
import type { PluginHost } from "./plugin-host";

export class PluginTurns {
  constructor(private readonly host: PluginHost) {}

  cancelMesh(): void {
    this.host.services.cancelMeshRequest();
  }

  async runMesh(userPrompt: string): Promise<MeshResultFull> {
    const snap = this.host.services.captureRequestSnapshot(this.host.agent);
    const writeIntent = parseWriteIntent(userPrompt);
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

    const meshAbort = this.host.services.beginMeshRequest();
    this.host.notice("🔀 Ejecutando mesh...", 0);
    try {
      const result = await runMeshWithCritic({
        userPrompt: actualPrompt,
        vaultAdapter: this.host.adapter,
        opencodeClient: this.host.opencodeClient,
        geminiBalancer: snap.geminiBalancer,
        vectorStore: snap.vectorStore,
        tracer: this.host.tracer,
        pathFilter: snap.pathFilter,
        tavilyApiKey: this.host.settings.tavilyApiKey,
        kgOptions: snap.kgOptions,
        edgeStore: snap.kgEdgeStore,
        projectContext: snap.projectContext || undefined,
        skillContext: snap.skillContext || undefined,
        projectId: snap.projectId,
        signal: meshAbort.signal,
      });

      const accepted =
        result.meshStatus === "accepted" || result.criticVerdict === "accept";
      if (accepted && writeIntent) {
        if (!noteName) {
          const fileMatch = result.researcherOutput.match(/^filename:\s*(.+)/m);
          if (fileMatch) {
            noteName =
              fileMatch[1].trim().replace(/[<>:"/\\|?*]/g, "").replace(/\.\./g, "").slice(0, 60) +
              ".md";
          } else {
            noteName =
              `${writeIntent.topic.replace(/[<>:"/\\|?*]/g, "").replace(/\.\./g, "").replace(/\s+/g, "-").slice(0, 40)}.md`;
          }
        }
        const outputPathSnapshot = snap.project?.outputPath || "Research";
        const noteFullPath = `${outputPathSnapshot}/${noteName}`;
        const writePaths = this.host.services.effectiveWritePaths(snap.agent);
        try {
          const wr = await writeNoteAtPath(
            {
              noteWriter: this.host.noteWriter,
              vaultAdapter: this.host.adapter,
              writePaths,
            },
            noteFullPath,
            result.researcherOutput,
          );
          if (wr.success) result.createdNotePath = wr.path;
          else this.host.notice(`⚠️ ${wr.message}`);
        } catch (err: any) {
          this.host.notice(`⚠️ ${err.message}`);
        }
      } else if (writeIntent && !accepted) {
        console.info("[Mesh] Skipping note write — status:", result.meshStatus);
      }
      return result;
    } finally {
      this.host.services.clearMeshAbort();
    }
  }
}
