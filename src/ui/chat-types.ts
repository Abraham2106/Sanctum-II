import type { MeshResultFull } from "../orchestrator/mesh";
import type { AgentDefinition } from "../agents/types";
import type { App } from "obsidian";
import type { ConversationMessage } from "../orchestrator/conversation";

export interface ChatMessage {
  role: "user" | "agent";
  content: string;
  label?: string;
  timestamp?: number;
  sources?: { note_path: string; score: number }[];
  meshMeta?: { attempts: number; score?: number; verdict?: string };
}

export interface ChatViewHandle {
  setThreadId(id: string): void;
  postMessage(text: string): Promise<void>;
  reloadForProject?(threadId: string): Promise<void>;
}

export interface RailAgent {
  id: string;
  name: string;
  avatar: string;
  internal?: boolean;
  model?: string;
}

export interface ChatViewPlugin {
  app: App;
  agent: AgentDefinition | null;
  agentName: string;
  vectorStore: { count: number };
  activeFolder: string | null;
  sendChatMessage(msg: string, convMessages?: ConversationMessage[], convSummary?: string): Promise<{ content: string; conversationSummary?: string } | string>;
  indexResearch(folder?: string): Promise<void>;
  setActiveFolder(folder: string | null): void;
  runOrchestrate(prompt: string): Promise<void>;
  createNoteWithAI(): Promise<void>;
  testEmbeddings(): Promise<void>;
  testChat(): Promise<void>;
  runMesh(prompt: string): Promise<MeshResultFull>;
  getLatestTrace(): Promise<string>;
  getActiveThreadId(): string;
  getActiveProjectId(): string | null;
  loadThreadMessages(threadId: string): Promise<ChatMessage[]>;
  saveThreadMessages(threadId: string, messages: ChatMessage[]): Promise<void>;
  loadThreadMessagesForProject(projectId: string, threadId: string): Promise<ChatMessage[]>;
  loadConversationSummaryForProject?(projectId: string, threadId: string): Promise<string | undefined>;
  saveThreadMessagesForProject(projectId: string, threadId: string, messages: ChatMessage[]): Promise<void>;
  getActiveProjectName(): string;
  getActiveProjectIcon(): string;
  setSkillContext?: (skillId: string | null) => void;
  clearChatHistory?: () => void;
}

export function getAgentIcon(agentId: string): string {
  if (agentId === "forager") return "search";
  if (agentId === "researcher") return "book-open";
  if (agentId === "critic") return "scale";
  return "bot";
}

export function renderAvatar(parent: HTMLElement, avatar: string, agentId: string, setIcon: (el: HTMLElement, icon: string) => void) {
  parent.empty();
  const icon = getAgentIcon(agentId);
  if (icon !== "bot") {
    setIcon(parent, icon);
  } else if (avatar && !/[\u{1F300}-\u{1F9FF}]/u.test(avatar) && avatar.length < 25) {
    setIcon(parent, avatar);
  } else {
    setIcon(parent, "bot");
  }
  parent.style.fontSize = "16px";
}
