// DEC-0008: shared host surface for plugin service modules.

import type { App } from "obsidian";
import type { AgentDefinition } from "../agents/types";
import type { GeminiBalancer } from "../embeddings/gemini-balancer";
import type { OpenCodeClient } from "../llm/opencode-client";
import type { NoteWriter } from "../core/note-writer";
import type { Tracer } from "../observability/tracer";
import type { KgEdgeStore } from "../kg/kg-store";
import type { ProjectStore } from "../projects/store";
import type { VectorStore } from "../rag/vector-store";
import type { SanctumSettings } from "../constants";
import type { AppServices } from "../app/services";
import type { VaultAdapter } from "../core/vault-adapter";

export type NoticeFn = (message: string, durationMs?: number) => void;

export interface PluginHost {
  app: App;
  adapter: VaultAdapter;
  settings: SanctumSettings;
  services: AppServices;
  agent: AgentDefinition | null;
  vectorStore: VectorStore;
  kgEdgeStore: KgEdgeStore;
  vectorStores: Map<string, VectorStore>;
  kgEdgeStores: Map<string, KgEdgeStore>;
  activeFolder: string | null;
  noteWriter: NoteWriter;
  tracer: Tracer;
  opencodeClient: OpenCodeClient;
  geminiBalancer: GeminiBalancer;
  projectStore: ProjectStore;
  saveSettings(): Promise<void>;
  syncServices(): void;
  refreshChatViews(): void;
  refreshKgViews(): void;
  generateThreadId(): string;
  notice: NoticeFn;
}
