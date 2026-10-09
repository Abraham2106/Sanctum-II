import type { Project } from "./types";
import { DEFAULT_PROJECT_RAG } from "./types";
import { serializeFrontmatter, splitFrontmatter } from "../shared/agents/frontmatter";

export function parseProjectMd(content: string): Project {
  const { frontmatter: data, body } = splitFrontmatter(content);

  const id = data.id || "project";
  let attachedFiles: Project["attachedFiles"] = [];
  if (data.attachedFiles) {
    try {
      attachedFiles =
        typeof data.attachedFiles === "string" ? JSON.parse(data.attachedFiles) : data.attachedFiles;
    } catch (err: any) {
      console.warn("[Store] attachedFiles parse:", err.message);
    }
  }
  const model =
    data.model !== undefined && data.model !== null ? String(data.model) : ""; // DEC-0022: ausencia → ''
  const ragBlock = data.rag && typeof data.rag === "object" ? data.rag : {};
  const instructionsRaw =
    typeof data.instructions === "string" ? data.instructions : data.instructions != null ? String(data.instructions) : "";

  return {
    id,
    name: data.name || id,
    icon: data.icon || "◈",
    description: data.description || "",
    instructions: instructionsRaw || body,
    read_paths: Array.isArray(data.read_paths) ? data.read_paths : [],
    write_paths: Array.isArray(data.write_paths) ? data.write_paths : [],
    outputPath: data.outputPath || `Projects/${id}`,
    model,
    rag: {
      embed_model: ragBlock.embed_model || "gemini-embedding-2",
      dims: ragBlock.dims ?? 768,
      chunk_words: ragBlock.chunk_words ?? DEFAULT_PROJECT_RAG.chunk_words,
      top_k: ragBlock.top_k ?? 5,
      min_similarity:
        ragBlock.min_similarity !== undefined && ragBlock.min_similarity !== null
          ? ragBlock.min_similarity
          : DEFAULT_PROJECT_RAG.min_similarity,
    },
    files: Array.isArray(data.files) ? data.files : [],
    attachedFiles,
    starred: data.starred === true,
  };
}

export function serializeProject(p: Project): string {
  const frontmatter: Record<string, unknown> = {
    id: p.id,
    name: p.name,
    icon: p.icon,
    model: p.model,
    read_paths: p.read_paths,
    write_paths: p.write_paths,
    outputPath: p.outputPath || `Projects/${p.id}`,
    rag: {
      embed_model: p.rag.embed_model,
      dims: p.rag.dims,
      chunk_words: p.rag.chunk_words,
      top_k: p.rag.top_k,
      min_similarity: p.rag.min_similarity,
    },
    instructions: p.instructions,
  };
  if (p.description) frontmatter.description = p.description;
  if (p.starred) frontmatter.starred = true;
  if (p.files?.length) frontmatter.files = p.files;
  if (p.attachedFiles?.length) frontmatter.attachedFiles = p.attachedFiles;

  return `---\n${serializeFrontmatter(frontmatter)}\n---\n\n`;
}
