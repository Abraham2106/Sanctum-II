export interface ProjectRag {
  embed_model: string;
  dims: number;
  chunk_words: number;
  top_k: number;
  min_similarity: number;
}

export interface ProjectFile {
  path: string;
  name: string;
  ext: string;
  lines: number;
  added_at: number;
}

export interface Project {
  id: string;
  name: string;
  icon: string;
  description: string;
  instructions: string;
  read_paths: string[];
  write_paths: string[];
  model: string;
  rag: ProjectRag;
  files: string[];
  attachedFiles: ProjectFile[];
}

export interface MemoryEntry {
  timestamp: number;
  text: string;
  source?: string;
}

export interface Thread {
  thread_id: string;
  project_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  starred: boolean;
}

export interface ThreadData {
  thread: Thread;
  messages: any[];
  summary?: string;
  pendingAction?: PendingAction;
}

export interface PendingAction {
  type: string;
  description: string;
  params: Record<string, any>;
  proposed_at: number;
}

export const DEFAULT_PROJECT_RAG: ProjectRag = {
  embed_model: "gemini-embedding-2",
  dims: 768,
  chunk_words: 400,
  top_k: 5,
  min_similarity: 0.65,
};

export function defaultProject(id: string, name?: string): Project {
  return {
    id,
    name: name || id,
    icon: "◈",
    description: "",
    instructions: "",
    read_paths: ["/Research/"],
    write_paths: ["/sanctum-memory/" + id + "/"],
    model: "deepseek-v4-flash",
    rag: { ...DEFAULT_PROJECT_RAG },
    files: [],
    attachedFiles: [],
  };
}
