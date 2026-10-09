// DEC-0008: skill-creator and agent-generator chat flows outside main.

import { AgentAuthoringError, AgentAuthoringService } from "../agents/authoring/service";
import { SkillAuthoringMesh } from "../skills/authoring/mesh";
import type { SkillAuthoringProgress, SkillGenerationRequest } from "../skills/authoring/types";
import type { PluginHost } from "./plugin-host";
import type { ChatViewHandle } from "../ui/chat-types";
import { VIEW_TYPE_SANCTUM } from "../constants";

export async function createSkillFromChat(
  host: PluginHost,
  request: SkillGenerationRequest,
  onProgress?: (progress: SkillAuthoringProgress) => void,
): Promise<string> {
  if (!request.description) {
    return request.mode === "update"
      ? "Uso: `/skill-creator --update <id> describe cómo mejorar la skill`"
      : "Uso: `/skill-creator crea una skill para diseñar apps`";
  }

  const mesh = new SkillAuthoringMesh({
    adapter: host.adapter,
    opencodeClient: host.opencodeClient,
    geminiBalancer: host.geminiBalancer,
    vectorStore: host.services.vectorStore,
    tracer: host.tracer,
    tavilyApiKey: host.settings.tavilyApiKey,
    projectContext: host.services.activeProjectContext,
    pathFilter: host.services.pathFilter,
    onProgress,
  });
  try {
    const result = await mesh.run(request);
    if (result.status === "escalated") {
      const feedback = result.feedback.length
        ? result.feedback.map((item) => `- ${item}`).join("\n")
        : "- No alcanzó el umbral de calidad.";
      return `**Skill no guardada:** el mejor borrador obtuvo ${result.score}/100 tras ${result.attempts} intentos.\n\n**Feedback:**\n${feedback}\n\n<details><summary>Ver borrador no aprobado</summary>\n\n\`\`\`\`markdown\n${result.generation.skillMarkdown}\`\`\`\`\n</details>`;
    }
    await refreshAgentAutocomplete(host);
    const action = request.mode === "update" ? "actualizada" : "creada";
    host.notice(`Skill "${result.generation.skill.name}" ${action} con ${result.score}/100.`);
    const tools = result.generation.skill.tools.length
      ? result.generation.skill.tools.map((tool) => `\`${tool}\``).join(", ")
      : "ninguna";
    const ragList =
      result.ragSources.slice(0, 3).map((source) => `[[${source.notePath.replace(/\.md$/i, "")}]]`).join(", ") ||
      "sin coincidencias locales";
    const webList = result.webSources.slice(0, 3).map((source) => `[${source.title}](${source.url})`).join(", ");
    const history = result.saved?.historyPath ? `\nHistorial anterior: ${result.saved.historyPath}` : "";
    return `**Skill ${action}:** /${result.generation.skill.id}\n\nNombre: ${result.generation.skill.name}\nTools de ejecución: ${tools}\nQuality gate: **${result.score}/100** · ${result.attempts} intento(s)\nRAG: ${result.ragSources.length} fuente(s) · ${ragList}\nWeb: ${result.webSources.length} fuente(s) · ${webList}\nArchivo: ${result.saved?.skillPath}${history}\nTrace: ${result.traceId}\n\nYa podés invocarla con /${result.generation.skill.id} en el chat.`;
  } catch (error: any) {
    const message =
      error instanceof AgentAuthoringError
        ? error.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message).join(" ")
        : error?.message || "No se pudo guardar la skill.";
    host.notice(message, 7000);
    return `No se pudo crear la skill: ${message}`;
  }
}

export async function openAgentGenerator(host: PluginHost, initialDescription = ""): Promise<string> {
  const { AgentGeneratorModal } = await import("../ui/agent-generator-modal");
  const service = new AgentAuthoringService({ llm: host.opencodeClient, adapter: host.adapter });
  const modal = new AgentGeneratorModal(host.app, service, initialDescription);
  const result = await modal.ask();
  if (!result) return "Creación de agente cancelada.";
  try {
    const saved = await service.save(result);
    await refreshAgentAutocomplete(host);
    host.notice(`Agente "${result.agent.name}" creado.`);
    const skillLine = saved.skillPath ? `\nSkill complementaria: ${saved.skillPath}` : "";
    return `**Agente creado:** @${result.agent.id}\n\nNombre: ${result.agent.name}\nArchivo: ${saved.agentPath}${skillLine}\n\nPodés mencionarlo con @${result.agent.id} en el chat.`;
  } catch (error: any) {
    const message =
      error instanceof AgentAuthoringError
        ? error.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message).join(" ")
        : error?.message || "No se pudo guardar el agente.";
    host.notice(message, 7000);
    return `No se pudo crear el agente: ${message}`;
  }
}

async function refreshAgentAutocomplete(host: PluginHost): Promise<void> {
  const leaves = host.app.workspace.getLeavesOfType(VIEW_TYPE_SANCTUM);
  await Promise.all(
    leaves.map(async (leaf) => {
      const view = leaf.view as unknown as ChatViewHandle;
      await view.refreshAgentAutocomplete?.();
    }),
  );
}
