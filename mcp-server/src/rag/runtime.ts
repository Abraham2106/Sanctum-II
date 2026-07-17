import type { VectorStore } from "../../../src/rag/vector-store.js"

export interface RagRuntime {
  store: VectorStore
  projectId?: string
}

export type RagRuntimeResolver = (projectId?: string) => Promise<RagRuntime>
export type RagRuntimeSource = VectorStore | RagRuntimeResolver

export async function resolveRagRuntime(source: RagRuntimeSource, projectId?: string): Promise<RagRuntime> {
  if (typeof source === "function") return source(projectId)
  return { store: source, projectId: projectId?.trim() || undefined }
}
