import type { GeminiBalancer } from "../embeddings/gemini-balancer";
import { VectorStore, type Chunk } from "./vector-store";

const RESEARCH_PATH = "Research";
const CHUNK_MAX_WORDS = 400;

function chunkText(text: string, notePath: string): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += CHUNK_MAX_WORDS) {
    chunks.push(words.slice(i, i + CHUNK_MAX_WORDS).join(" "));
  }
  if (chunks.length === 0) chunks.push("");
  return chunks;
}

export interface IndexResult {
  totalNotes: number;
  totalChunks: number;
  errors: string[];
}

export async function indexResearchFolder(
  vaultAdapter: {
    read: (p: string) => Promise<string>;
    list: (p: string) => Promise<{ files: string[]; folders: string[] }>;
    exists: (p: string) => Promise<boolean>;
  },
  gemini: GeminiBalancer,
  store: VectorStore,
  subPath?: string
): Promise<IndexResult> {
  const errors: string[] = [];
  let totalChunks = 0;

  const targetPath = subPath || RESEARCH_PATH;
  const exists = await vaultAdapter.exists(targetPath);
  if (!exists) {
    return { totalNotes: 0, totalChunks: 0, errors: [`La carpeta /${targetPath}/ no existe en el vault`] };
  }

  const listing = await vaultAdapter.list(targetPath);
  const mdFiles = listing.files.filter((f) => f.endsWith(".md"));

  for (const filePath of mdFiles) {
    try {
      const content = await vaultAdapter.read(filePath);
      const noteName = filePath.replace(/\\/g, "/");
      const textChunks = chunkText(content, noteName);

      const newChunks: Chunk[] = [];
      for (let ci = 0; ci < textChunks.length; ci++) {
        const text = textChunks[ci];
        if (!text.trim()) continue;

        const embedding = await gemini.embed(text.slice(0, 3000));
        newChunks.push({
          id: `${noteName}#chunk-${ci}`,
          note_path: noteName,
          chunk_text: text,
          embedding,
        });
      }

      store.addChunks(newChunks, noteName);
      totalChunks += newChunks.length;
    } catch (err: any) {
      errors.push(`${filePath}: ${err.message}`);
    }
  }

  return { totalNotes: mdFiles.length, totalChunks, errors };
}
