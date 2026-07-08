import { Notice } from "obsidian";
import type SanctumPlugin from "../main";
import { ragQuery } from "./tests";

export function registerCommands(plugin: SanctumPlugin): void {
  plugin.addCommand({
    id: "open-sanctum-chat",
    name: "Abrir chat de Sanctum II",
    callback: () => plugin.initLeaf(),
  });

  plugin.addCommand({
    id: "test-embeddings",
    name: "Probar embeddings (Gemini)",
    callback: () => plugin.testEmbeddings(),
  });

  plugin.addCommand({
    id: "test-chat",
    name: "Probar chat (OpenCode)",
    callback: () => plugin.testChat(),
  });

  plugin.addCommand({
    id: "orchestrate",
    name: "Orquestar: @agente_base responde con IA",
    callback: () => plugin.runOrchestrate("Decime qué contiene la carpeta /Research/ según tu conocimiento general."),
  });

  plugin.addCommand({
    id: "index-research",
    name: "Indexar carpeta /Research/",
    callback: () => plugin.indexResearch(),
  });

  plugin.addCommand({
    id: "query-research",
    name: "Buscar en /Research/ (RAG)",
    callback: async () => {
      await ragQuery(plugin.geminiBalancer, plugin.vectorStore, plugin.agent, "¿Qué dice /Research/?");
    },
  });

  plugin.addCommand({
    id: "create-note-with-ai",
    name: "Generar nota con IA y guardarla en /Research/",
    callback: () => plugin.createNoteWithAI(),
  });

  plugin.addCommand({
    id: "mesh-forager-researcher",
    name: "Ejecutar mesh Forager→Researcher",
    callback: async () => {
      const response = await plugin.runMesh("Tipos de aprendizaje en machine learning");
      new Notice("Mesh completado. Revisá la consola (Ctrl+Shift+I)");
      console.log("Sanctum mesh result:", response);
    },
  });

  plugin.addCommand({
    id: "sanctum-append-to-note",
    name: "Agregar contenido a una nota existente",
    callback: () => new Notice("Escribí 'agregá a Nota.md' en el chat"),
  });
}
