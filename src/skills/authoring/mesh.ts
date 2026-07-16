import { loadAgentFromVault, renderSystemPrompt } from "../../agents/agent-loader";
import type { AgentTool } from "../../agents/authoring/types";
import { pathMatchesAny } from "../../utils";
import { loadSkill } from "../loader";
import { formatWebContext, searchTavily, type TavilyResponse } from "../../tools/tavily";
import {
  extractSkillJson,
  finalizeSkillDraft,
  inferSkillTools,
  SkillAuthoringService,
} from "./service";
import type {
  SkillAuthoringMeshOptions,
  SkillAuthoringMeshResult,
  SkillAuthoringProgress,
  SkillCriticEvaluation,
  SkillCriticScore,
  SkillGenerationRequest,
  SkillGenerationResult,
  SkillRagSource,
  SkillWebSource,
} from "./types";

const QUALITY_THRESHOLD = 85;
const MAX_ATTEMPTS = 3;
const CRITERION_MAX: Record<SkillCriticScore["name"], number> = {
  contextual_grounding: 20,
  domain_accuracy: 20,
  web_currentness: 20,
  sanctum_contract: 20,
  edge_cases_output: 10,
  clarity_density: 10,
};
const CRITERION_NAMES = Object.keys(CRITERION_MAX) as SkillCriticScore["name"][];

interface ContextAnalysis {
  topic: string;
  vault_findings: string[];
  project_conventions: string[];
  gaps: string[];
  web_query: string;
}

export class SkillAuthoringMeshError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "SkillAuthoringMeshError";
  }
}

function cleanBriefForSearch(description: string): string {
  const value = description
    .replace(/^\s*\/skill-creator(?:\s+--update\s+[a-z0-9-]+)?\s*/i, "")
    .replace(/\([^)]*(?:uses?|usa|tools?)[^)]*\)/gi, " ")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return value.slice(0, 260) || "software skill design";
}

function parseContextAnalysis(raw: string): ContextAnalysis {
  const parsed = extractSkillJson(raw);
  const strings = (value: unknown): string[] => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map(item => item.trim())
    : [];
  return {
    topic: typeof parsed.topic === "string" ? parsed.topic.trim() : "",
    vault_findings: strings(parsed.vault_findings),
    project_conventions: strings(parsed.project_conventions),
    gaps: strings(parsed.gaps),
    web_query: typeof parsed.web_query === "string" ? parsed.web_query.trim() : "",
  };
}

export function parseSkillCriticEvaluation(raw: string, deterministicErrors: string[] = []): SkillCriticEvaluation {
  let parsed: Record<string, any> = {};
  const feedback: string[] = [...deterministicErrors];
  try {
    parsed = extractSkillJson(raw) as Record<string, any>;
  } catch {
    feedback.push("El crítico no devolvió JSON válido.");
  }

  const received = new Map<string, any>();
  if (Array.isArray(parsed.criteria)) {
    for (const criterion of parsed.criteria) {
      if (criterion && typeof criterion.name === "string") received.set(criterion.name, criterion);
    }
  }

  const criteria: SkillCriticScore[] = CRITERION_NAMES.map(name => {
    const rawCriterion = received.get(name);
    const maximum = CRITERION_MAX[name];
    const score = typeof rawCriterion?.score === "number"
      ? Math.max(0, Math.min(maximum, rawCriterion.score))
      : 0;
    if (!rawCriterion) feedback.push(`El crítico omitió el criterio ${name}.`);
    return { name, score, note: typeof rawCriterion?.note === "string" ? rawCriterion.note : "" };
  });
  if (Array.isArray(parsed.feedback)) {
    for (const item of parsed.feedback) if (typeof item === "string" && item.trim()) feedback.push(item.trim());
  }

  const totalScore = criteria.reduce((sum, criterion) => sum + criterion.score, 0);
  const scoreOf = (name: SkillCriticScore["name"]) => criteria.find(criterion => criterion.name === name)?.score || 0;
  const criticalGate = scoreOf("contextual_grounding") >= 14
    && scoreOf("domain_accuracy") >= 14
    && scoreOf("web_currentness") >= 14
    && scoreOf("sanctum_contract") >= 14;
  const accepted = deterministicErrors.length === 0 && totalScore >= QUALITY_THRESHOLD && criticalGate;
  if (!accepted && feedback.length === 0) feedback.push("El borrador no alcanzó el quality gate especializado.");
  return { criteria, totalScore, accepted, feedback: [...new Set(feedback)] };
}

function syntheticRejection(message: string): SkillCriticEvaluation {
  return {
    criteria: CRITERION_NAMES.map(name => ({ name, score: 0, note: message })),
    totalScore: 0,
    accepted: false,
    feedback: [message],
  };
}

export class SkillAuthoringMesh {
  constructor(private readonly options: SkillAuthoringMeshOptions) {}

  private progress(progress: SkillAuthoringProgress): void {
    this.options.onProgress?.(progress);
  }

  private async invokeAgent(fileName: string, userInput: string, ragContext = "", webContext = ""): Promise<string> {
    const agent = await loadAgentFromVault(this.options.adapter, fileName);
    let systemPrompt = renderSystemPrompt(agent, ragContext, userInput);
    systemPrompt = systemPrompt.replace(/\{\{web_context\}\}/g, webContext);
    const response = await this.options.opencodeClient.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userInput },
    ]);
    return response.content;
  }

  private async retrieveRag(description: string, traceId: string): Promise<{ context: string; sources: SkillRagSource[] }> {
    const projectContext = this.options.projectContext;
    if (!projectContext?.project) throw new SkillAuthoringMeshError("PROJECT_REQUIRED", "Seleccioná un proyecto antes de crear una skill contextual.");
    if (!this.options.geminiBalancer.hasKeys) throw new SkillAuthoringMeshError("RAG_KEYS_REQUIRED", "El mesh necesita claves de Gemini para consultar el RAG.");
    if (this.options.vectorStore.count === 0) throw new SkillAuthoringMeshError("RAG_INDEX_EMPTY", "El índice RAG del proyecto está vacío. Indexá el proyecto antes de crear la skill.");

    const query = cleanBriefForSearch(description);
    const embedding = await this.options.geminiBalancer.embed(query);
    const project = projectContext.project;
    const topK = project.rag?.top_k || 5;
    const minSimilarity = project.rag?.min_similarity ?? 0.65;
    const searchK = Math.max(50, this.options.vectorStore.count);
    let results = this.options.vectorStore.search(embedding, searchK)
      .filter(result => result.score >= minSimilarity)
      .filter(result => !project.read_paths.length || pathMatchesAny(result.chunk.note_path, project.read_paths));
    if (this.options.pathFilter?.length) {
      results = results.filter(result => pathMatchesAny(result.chunk.note_path, this.options.pathFilter));
    }
    results = results.slice(0, topK);

    const sourceScores = new Map<string, number>();
    for (const result of results) {
      sourceScores.set(result.chunk.note_path, Math.max(sourceScores.get(result.chunk.note_path) || 0, result.score));
      this.options.tracer.addChunk(traceId, {
        source: "rag",
        chunk: result.chunk.chunk_text,
        similarity_score: result.score,
        from_note: result.chunk.note_path,
      });
    }
    const sources = [...sourceScores.entries()].map(([notePath, score]) => ({ notePath, score }));
    const context = results.map(result => `[${result.chunk.note_path}]\n${result.chunk.chunk_text}`).join("\n\n");
    return { context, sources };
  }

  private async researchWeb(description: string): Promise<{ response: TavilyResponse; query: string }> {
    if (!this.options.tavilyApiKey) throw new SkillAuthoringMeshError("TAVILY_REQUIRED", "El mesh necesita una API key de Tavily para investigar el tema.");
    const query = cleanBriefForSearch(description);
    const search = this.options.searchWeb || ((value: string, maxResults?: number) => searchTavily(this.options.tavilyApiKey!, value, maxResults));
    let response = await search(`${query} official documentation primary sources`, 5);
    if (!response.results?.length) {
      response = await search(`${query} reference implementation standards best practices`, 5);
    }
    if (!response.results?.length) throw new SkillAuthoringMeshError("WEB_RESULTS_EMPTY", "La investigación web no devolvió fuentes después de dos consultas.");
    return { response, query };
  }

  async run(request: SkillGenerationRequest): Promise<SkillAuthoringMeshResult> {
    if (!request.description.trim()) throw new SkillAuthoringMeshError("DESCRIPTION_REQUIRED", "Describí qué debe hacer la skill.");
    const traceId = this.options.tracer.start("skill-authoring-mesh", "", request.description);
    let ragSources: SkillRagSource[] = [];
    let webSources: SkillWebSource[] = [];

    try {
      const creatorGuide = await loadSkill(this.options.adapter, "skill-creator");
      if (!creatorGuide) throw new SkillAuthoringMeshError("CREATOR_SKILL_MISSING", "No se encontró sanctum-skills/skill-creator.md.");

      let existingMarkdown = "";
      let existingTools: AgentTool[] | undefined;
      if (request.mode === "update") {
        const targetId = request.targetId?.trim();
        if (!targetId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(targetId)) {
          throw new SkillAuthoringMeshError("UPDATE_ID_INVALID", "El modo --update requiere un ID kebab-case válido.");
        }
        const targetPath = `sanctum-skills/${targetId}.md`;
        if (!await this.options.adapter.exists(targetPath)) throw new SkillAuthoringMeshError("UPDATE_TARGET_MISSING", `No existe ${targetPath}.`);
        existingMarkdown = await this.options.adapter.read(targetPath);
        const existing = await loadSkill(this.options.adapter, targetId);
        existingTools = (existing?.tools || []).filter((tool): tool is AgentTool => ["rag_query", "web_search", "create_note", "append_to_note"].includes(tool));
      }

      this.progress({ stage: "rag", message: "Consultando el contexto del proyecto…" });
      const rag = await this.retrieveRag(request.description, traceId);
      ragSources = rag.sources;
      const contextInput = `Brief de la skill:\n${request.description}\n\nNo envíes información privada a la web.`;
      const contextRaw = await this.invokeAgent("skill-context-analyst.md", contextInput, rag.context);
      const contextAnalysis = parseContextAnalysis(contextRaw);
      this.progress({ stage: "web", ragSources, message: ragSources.length ? `${ragSources.length} notas relevantes.` : "Sin coincidencias locales; investigando en web." });

      const web = await this.researchWeb(request.description);
      webSources = web.response.results.map(result => ({ title: result.title, url: result.url, score: result.score }));
      const publicGapSummary = contextAnalysis.gaps.map(gap => gap.replace(/[\[\]{}<>]/g, "").slice(0, 160));
      const webInput = `Brief público:\n${request.description}\n\nVacíos temáticos a resolver:\n${publicGapSummary.map(gap => `- ${gap}`).join("\n") || "- Ninguno identificado"}`;
      const webResearch = await this.invokeAgent("skill-web-researcher.md", webInput, "", formatWebContext(web.response.results, web.response.answer));
      this.progress({ stage: "author", ragSources, webSources, attempt: 1, message: `${webSources.length} fuentes web verificadas.` });

      const inferredTools = inferSkillTools(request.description);
      const effectiveRequest: SkillGenerationRequest = {
        ...request,
        tools: request.tools !== undefined
          ? request.tools
          : (request.mode === "update" && inferredTools.length === 0 ? existingTools || [] : inferredTools),
      };
      const feedback: string[] = [];
      let bestGeneration: SkillGenerationResult | undefined;
      let bestEvaluation = syntheticRejection("Todavía no se generó un borrador válido.");
      let attempts = 0;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        attempts = attempt;
        this.progress({ stage: "author", attempt, ragSources, webSources, message: attempt === 1 ? "Redactando skill contextual…" : "Regenerando con feedback acumulado…" });
        const authorPacket = [
          `<brief>\n${request.description}\n</brief>`,
          `<runtime_tools>\n${JSON.stringify(effectiveRequest.tools || [])}\n</runtime_tools>`,
          existingMarkdown ? `<existing_skill>\n${existingMarkdown}\n</existing_skill>` : "",
          `<skill_creator_guide>\n${creatorGuide.instructions}\n</skill_creator_guide>`,
          `<rag_analysis>\n${JSON.stringify(contextAnalysis, null, 2)}\n</rag_analysis>`,
          `<rag_evidence>\n${rag.context || "Sin evidencia local relacionada."}\n</rag_evidence>`,
          `<web_research>\n${webResearch}\n</web_research>`,
          feedback.length ? `<critic_feedback>\n${feedback.map(item => `- ${item}`).join("\n")}\n</critic_feedback>` : "",
        ].filter(Boolean).join("\n\n");

        let generation: SkillGenerationResult;
        let parseFailure = "";
        try {
          const authorRaw = await this.invokeAgent("skill-author.md", authorPacket);
          generation = finalizeSkillDraft(effectiveRequest, extractSkillJson(authorRaw));
        } catch (error: any) {
          parseFailure = `El autor no devolvió un SkillDraft JSON válido: ${error?.message || error}`;
          generation = finalizeSkillDraft(effectiveRequest, {});
          generation.issues.push({ code: "SKILL_AUTHOR_JSON_INVALID", severity: "error", field: "draft", message: parseFailure });
        }

        const deterministicErrors = generation.issues.filter(issue => issue.severity === "error").map(issue => issue.message);
        this.progress({ stage: "critic", attempt, ragSources, webSources, message: "Evaluando evidencia, profundidad y contrato…" });
        let evaluation: SkillCriticEvaluation;
        if (parseFailure) {
          evaluation = syntheticRejection(parseFailure);
        } else {
          const criticPacket = [
            `<brief>\n${request.description}\n</brief>`,
            `<rag_analysis>\n${JSON.stringify(contextAnalysis, null, 2)}\n</rag_analysis>`,
            `<web_research>\n${webResearch}\n</web_research>`,
            `<draft>\n${generation.skillMarkdown}\n</draft>`,
            `<deterministic_issues>\n${deterministicErrors.join("\n") || "none"}\n</deterministic_issues>`,
          ].join("\n\n");
          const criticRaw = await this.invokeAgent("skill-critic.md", criticPacket);
          evaluation = parseSkillCriticEvaluation(criticRaw, deterministicErrors);
        }

        if (!bestGeneration || evaluation.totalScore > bestEvaluation.totalScore) {
          bestGeneration = generation;
          bestEvaluation = evaluation;
        }
        this.progress({ stage: "critic", attempt, score: evaluation.totalScore, ragSources, webSources, message: evaluation.accepted ? "Quality gate aprobado." : "Quality gate rechazado; preparando mejoras." });

        if (evaluation.accepted) {
          const service = new SkillAuthoringService({ adapter: this.options.adapter });
          const saved = await service.save(generation, {
            overwrite: request.mode === "update",
            archiveExisting: request.mode === "update",
          });
          await this.options.tracer.finish(traceId, generation.skillMarkdown, {
            type: "skill_authoring_mesh",
            status: "accepted",
            score: evaluation.totalScore,
            attempts,
            rag_sources: ragSources,
            web_sources: webSources,
            history_path: saved.historyPath,
          });
          this.progress({ stage: "done", attempt, score: evaluation.totalScore, ragSources, webSources, message: "Skill aprobada y guardada." });
          return {
            status: "accepted",
            generation,
            score: evaluation.totalScore,
            attempts,
            feedback: evaluation.feedback,
            ragSources,
            webSources,
            traceId,
            saved,
          };
        }
        feedback.push(...evaluation.feedback);
      }

      const generation = bestGeneration || finalizeSkillDraft(effectiveRequest, {});
      await this.options.tracer.finish(traceId, generation.skillMarkdown, {
        type: "skill_authoring_mesh",
        status: "escalated",
        score: bestEvaluation.totalScore,
        attempts,
        feedback: bestEvaluation.feedback,
        rag_sources: ragSources,
        web_sources: webSources,
      });
      this.progress({ stage: "failed", attempt: attempts, score: bestEvaluation.totalScore, ragSources, webSources, message: "El borrador no superó el quality gate y no fue guardado." });
      return {
        status: "escalated",
        generation,
        score: bestEvaluation.totalScore,
        attempts,
        feedback: bestEvaluation.feedback,
        ragSources,
        webSources,
        traceId,
      };
    } catch (error: any) {
      this.options.tracer.abort(traceId, error?.message || String(error));
      this.progress({ stage: "failed", ragSources, webSources, message: error?.message || "Falló el mesh de autoría." });
      throw error;
    }
  }
}
