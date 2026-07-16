import { Notice } from "obsidian";
import type { AgentDefinition } from "../agents/types";
import type { GeminiBalancer } from "../embeddings/gemini-balancer";
import type { OpenCodeClient } from "../llm/opencode-client";
import type { VectorStore } from "../rag/vector-store";
import type { Tracer } from "../observability/tracer";
import { renderSystemPrompt } from "../agents/agent-loader";
import { searchTavily, formatWebContext } from "../tools/tavily";
import { expandFromSeeds } from "../kg/kg";
import type { KgOptions } from "../kg/types";
import type { KgEdgeStore } from "../kg/kg-store";
import { injectProjectPrefix } from "../projects/context";
import type { ProjectContext } from "../projects/context";
import type { Skill } from "../skills/types";
import { renderSkillPrompt } from "../skills/loader";
import { buildConversationPayload } from "./conversation";
import type { ConversationMessage } from "./conversation";
import { pathMatchesAny } from "../utils";
import { RAG_DEFAULTS } from "../constants";

const MIN_SIMILARITY = RAG_DEFAULTS.MIN_SIMILARITY;

export interface TurnDeps {
  agent: AgentDefinition;
  opencodeClient: OpenCodeClient;
  geminiBalancer: GeminiBalancer;
  vectorStore: VectorStore;
  tracer: Tracer;
  tavilyApiKey?: string;
  tavilyQuery?: string;
  kgOptions?: KgOptions;
  edgeStore?: KgEdgeStore;
  projectContext?: ProjectContext;
  skillContext?: Skill;
  conversationMessages?: ConversationMessage[];
  conversationSummary?: string;
  traceId?: string;
}

export interface TurnResult {
  content: string;
  usage: { prompt: number; completion: number };
  ragContext: string;
  conversationSummary?: string;
}

function hasWebSearchTool(agent: AgentDefinition, skill?: Skill): boolean {
  return agent.tools?.includes("web_search") || skill?.tools?.includes("web_search") || false;
}

export async function executeTurn(
  deps: TurnDeps,
  userInput: string,
  skipRag: boolean = false,
  pathFilter?: string[]
): Promise<TurnResult> {
  const project = deps.projectContext?.project;
  const topK = project?.rag?.top_k || 5;
  const minSim = project?.rag?.min_similarity || MIN_SIMILARITY;
  const activePathFilter = pathFilter !== undefined ? pathFilter : (project?.read_paths ?? []);
  const agentPerms = deps.agent?.permissions?.read_paths;

  let ragContext = "";
  if (!skipRag && deps.geminiBalancer.hasKeys && deps.vectorStore.count > 0) {
    const queryEmbedding = await deps.geminiBalancer.embed(userInput);
    // Search wide — pathFilter may narrow later
    const searchK = (activePathFilter?.length) ? Math.max(50, deps.vectorStore.count) : topK;
    let results = deps.vectorStore.search(queryEmbedding, searchK).filter((r) => r.score >= minSim);
    console.info(`[RAG] search K=${searchK} → pre-filter: ${results.length} chunks (≥${minSim}), top scores: ${results.slice(0, 5).map(r => `${r.chunk.note_path.split("/").pop()}:${r.score.toFixed(3)}`).join(" | ")}`);

    // If sim threshold filtered everything out, retry without it
    if (results.length === 0) {
      const allResults = deps.vectorStore.search(queryEmbedding, searchK);
      if (allResults.length > 0) {
        results = allResults;
        console.error(`[RAG] ⚠ Threshold ${minSim} too strict — usando todos los chunks (best score: ${allResults[0].score.toFixed(3)})`);
        new Notice(`⚠ Similitud máxima: ${allResults[0].score.toFixed(2)} (umbral era ${minSim}). Usando todos los chunks.`, 5000);
      }
    }

    // KG expansion: from seed chunks, expand via persisted edges
    const kgOpts = deps.kgOptions;
    if (kgOpts?.enabled && results.length > 0 && deps.edgeStore && deps.edgeStore.count > 0) {
      const seedNotes = [...new Set(results.map(r => r.chunk.note_path))];
      const expansion = expandFromSeeds(deps.vectorStore, seedNotes, queryEmbedding, kgOpts, deps.edgeStore);
      for (const ac of expansion.added_chunks) {
        const passesPathFilter = !activePathFilter?.length || pathMatchesAny(ac.note_path, activePathFilter);
        const passesAgentPerms = !agentPerms?.length || pathMatchesAny(ac.note_path, agentPerms);
        if (!passesPathFilter || !passesAgentPerms) continue;
        results.push({
          chunk: { id: "", note_path: ac.note_path, chunk_text: ac.chunk_text, embedding: [] },
          score: ac.score,
        });
        if (deps.traceId) deps.tracer.addChunk(deps.traceId, {
          source: "kg",
          chunk: ac.chunk_text,
          similarity_score: ac.score,
          from_note: ac.note_path,
          relation: ac.relation,
        });
      }
    }

    const beforeFilterCount = results.length;
    results = deps.vectorStore.filterByPaths(results, activePathFilter);
    if (agentPerms !== undefined) {
      results = deps.vectorStore.filterByPaths(results, agentPerms);
    }
    if (beforeFilterCount > 0 && results.length === 0) {
      console.warn(`[Permissions] Filtro combinado vacío (${beforeFilterCount} chunks descartados). pathFilter=${JSON.stringify(activePathFilter || "none")}, agent.read_paths=${JSON.stringify(agentPerms || "none")}`);
    }
    console.info(`[RAG] post-filter (pathFilter=${JSON.stringify(activePathFilter || "none")} × agentPerms=${JSON.stringify(agentPerms || "none")}): ${results.length} chunks`);
    results = results.slice(0, topK);
    if (results.length === 0) {
      const samplePaths = deps.vectorStore.allChunks.slice(0, 3).map(c => c.note_path).join(", ");
      new Notice(`⚠ RAG: 0 resultados. Store: ${deps.vectorStore.count} chunks · filtro: ${JSON.stringify(activePathFilter)} · rutas: ${samplePaths || "(vacío)"}`, 8000);
    }
    for (const r of results) {
      if (deps.traceId) deps.tracer.addChunk(deps.traceId, {
        source: "rag",
        chunk: r.chunk.chunk_text,
        similarity_score: r.score,
        from_note: r.chunk.note_path,
      });
    }
    ragContext = results.map((r) => `[${r.chunk.note_path}]\n${r.chunk.chunk_text}`).join("\n\n");
  } else if (!skipRag) {
    if (!deps.geminiBalancer.hasKeys) {
      new Notice("⚠ RAG: sin Gemini API keys", 5000);
    } else if (deps.vectorStore.count === 0) {
      new Notice(`⚠ RAG: store vacío (${deps.vectorStore.getStorePath()}). Indexá desde el proyecto.`, 8000);
    }
  }

  let webContext = "";
  if (deps.agent && hasWebSearchTool(deps.agent, deps.skillContext)) {
    if (!deps.tavilyApiKey) {
      console.warn("Sanctum: Tavily API key no configurada — web search saltado");
    } else {
      new Notice("🌐 Buscando en web vía Tavily...", 2000);
      try {
        const searchQuery = deps.tavilyQuery || userInput.slice(0, 400);
        const tavilyResponse = await searchTavily(deps.tavilyApiKey, searchQuery);
        webContext = formatWebContext(tavilyResponse.results, tavilyResponse.answer);
        if (webContext) console.error(`[Web] ${tavilyResponse.results.length} resultados de Tavily`);
      } catch (err: any) {
        console.warn("Sanctum: Tavily search failed:", err.message);
      }
    }
  }

  let renderedPrompt = deps.agent ? renderSystemPrompt(deps.agent, ragContext, userInput) : userInput;
  renderedPrompt = renderedPrompt.replace(/\{\{web_context\}\}/g, webContext || "");

  if (deps.projectContext?.systemPrefix) {
    renderedPrompt = injectProjectPrefix(renderedPrompt, deps.projectContext.systemPrefix);
  }

  if (deps.skillContext?.instructions) {
    if (deps.skillContext.tools?.length) {
      const agentTools = new Set(deps.agent?.tools || []);
      const extraTools = deps.skillContext.tools.filter(t => !agentTools.has(t));
      if (extraTools.length > 0) {
      console.info(`[Permissions] Skill "${deps.skillContext.name}" expande tools del agente "${deps.agent?.id || "unknown"}": ${JSON.stringify(extraTools)}. El acceso a paths sigue limitado por agent.read_paths=${JSON.stringify(deps.agent?.permissions?.read_paths || "none")}.`);
      }
    }
    const renderedSkill = renderSkillPrompt(deps.skillContext, ragContext, webContext, userInput);
    renderedPrompt = `--- Skill: ${deps.skillContext.name} ---\n${renderedSkill}\n\n---\n\n${renderedPrompt}`;
  }

  let result;
  if (deps.conversationMessages && deps.conversationMessages.length > 0) {
    // Inject the final user message
    const allMessages: ConversationMessage[] = [
      ...deps.conversationMessages,
      { role: "user", content: userInput },
    ];
    const payload = buildConversationPayload(renderedPrompt, allMessages, deps.conversationSummary);
    result = await deps.opencodeClient.chat(payload.messages);
    return { content: result.content, usage: result.usage, ragContext, conversationSummary: payload.newSummary };
  } else {
    result = await deps.opencodeClient.chat(renderedPrompt, userInput, ragContext || undefined);
  }

  return { content: result.content, usage: result.usage, ragContext };
}
