import type { MeshResultFull } from "../orchestrator/mesh";
import type { AgentDefinition } from "../agents/types";

export interface ChatMessage {
  role: "user" | "agent";
  content: string;
  label?: string;
  timestamp?: number;
  sources?: { note_path: string; score: number }[];
  meshMeta?: { attempts: number; score?: number; verdict?: string };
}

export interface RailAgent {
  id: string;
  name: string;
  avatar: string;
  internal?: boolean;
  model?: string;
}

export interface ChatViewPlugin {
  agent: AgentDefinition | null;
  agentName: string;
  vectorStore: { count: number };
  activeFolder: string | null;
  sendChatMessage(msg: string, convMessages?: any[], convSummary?: string): Promise<string>;
  indexResearch(folder?: string): Promise<void>;
  setActiveFolder(folder: string | null): void;
  runOrchestrate(prompt: string): Promise<void>;
  createNoteWithAI(): Promise<void>;
  testEmbeddings(): Promise<void>;
  testChat(): Promise<void>;
  runMesh(prompt: string): Promise<MeshResultFull>;
  getLatestTrace(): Promise<string>;
  getActiveThreadId(): string;
  loadThreadMessages(threadId: string): Promise<ChatMessage[]>;
  saveThreadMessages(threadId: string, messages: ChatMessage[]): Promise<void>;
  getActiveProjectName(): string;
  getActiveProjectIcon(): string;
  setSkillContext?: (skillId: string | null) => void;
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
