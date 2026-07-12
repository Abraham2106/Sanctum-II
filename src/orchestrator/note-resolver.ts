import type { CreatedNote } from "../projects/types";
import type { VectorStore } from "../rag/vector-store";
import type { GeminiBalancer } from "../embeddings/gemini-balancer";

export interface NoteResolution {
  path: string | null;
  method: "exact" | "rag_semantic" | "not_found" | "ambiguous";
  candidates?: { path: string; score: number; title: string }[];
}

const AMBIGUITY_THRESHOLD = 0.05;

export async function resolveNoteReference(
  query: string,
  createdNotes: CreatedNote[] | undefined,
  vectorStore: VectorStore | undefined,
  geminiBalancer: GeminiBalancer | undefined,
): Promise<NoteResolution> {
  // Step 1: exact match on createdNotes
  if (createdNotes && createdNotes.length > 0) {
    const q = query.toLowerCase();
    const matches = createdNotes.filter(n =>
      n.title.toLowerCase().includes(q) || q.includes(n.title.toLowerCase())
    );
    if (matches.length === 1) {
      return {
        path: matches[0].path,
        method: "exact",
        candidates: [{ path: matches[0].path, score: 1.0, title: matches[0].title }],
      };
    }
    if (matches.length > 1) {
      return {
        path: null,
        method: "ambiguous",
        candidates: matches.map(m => ({ path: m.path, score: 1.0, title: m.title })),
      };
    }
  }

  // Step 2: RAG semantic search
  if (vectorStore && geminiBalancer && geminiBalancer.hasKeys && vectorStore.count > 0) {
    try {
      const queryEmbedding = await geminiBalancer.embed(query);
      let results = vectorStore.search(queryEmbedding, 10);

      // Filter to only createdNotes paths if available
      if (createdNotes && createdNotes.length > 0) {
        const notePaths = new Set(createdNotes.map(n => n.path));
        results = results.filter(r => notePaths.has(r.chunk.note_path));
      }

      // Deduplicate by note_path, keep highest score
      const seen = new Map<string, number>();
      for (const r of results) {
        const existing = seen.get(r.chunk.note_path);
        if (existing === undefined || r.score > existing) {
          seen.set(r.chunk.note_path, r.score);
        }
      }

      const candidates = Array.from(seen.entries()).map(([path, score]) => ({
        path,
        score,
        title: path.split("/").pop()?.replace(".md", "") || path,
      })).sort((a, b) => b.score - a.score);

      if (candidates.length === 0) {
        return { path: null, method: "not_found" };
      }

      // Check ambiguity
      if (candidates.length >= 2 && (candidates[0].score - candidates[1].score) < AMBIGUITY_THRESHOLD) {
        return { path: null, method: "ambiguous", candidates: candidates.slice(0, 3) };
      }

      return { path: candidates[0].path, method: "rag_semantic", candidates };
    } catch (err: any) {
      console.warn("[NoteResolver] RAG search failed:", err.message);
    }
  }

  return { path: null, method: "not_found" };
}
