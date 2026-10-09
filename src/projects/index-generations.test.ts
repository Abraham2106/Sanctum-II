import { describe, expect, it } from "vitest";
import {
  findNewestCompleteGeneration,
  generationFile,
  loadIndexGenerationSnapshot,
  validateCompleteGeneration,
  writeGenerationArtifacts,
  type IndexGenerationMetadata,
} from "./index-generations";
import { buildGeminiIdentity } from "../embeddings/embedding-identity";
import { buildTestGeminiIdentity } from "./indexer";

function memoryVault() {
  const dirs = new Set<string>();
  const files = new Map<string, string>();
  const ensureDir = (path: string) => {
    const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      dirs.add(cur);
    }
  };
  return {
    files,
    read: async (path: string) => {
      const v = files.get(path);
      if (v === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return v;
    },
    write: async (path: string, content: string) => {
      ensureDir(path.split("/").slice(0, -1).join("/"));
      files.set(path, content);
    },
    mkdir: async (path: string) => {
      ensureDir(path);
    },
    list: async (path: string) => {
      const prefix = path.replace(/\\/g, "/").replace(/\/$/, "");
      const fileOut: string[] = [];
      const folderOut = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(`${prefix}/`)) continue;
        const rest = key.slice(prefix.length + 1);
        const slash = rest.indexOf("/");
        if (slash === -1) fileOut.push(key);
        else folderOut.add(`${prefix}/${rest.slice(0, slash)}`);
      }
      for (const d of dirs) {
        if (!d.startsWith(`${prefix}/`)) continue;
        const rest = d.slice(prefix.length + 1);
        if (!rest.includes("/")) folderOut.add(d);
      }
      return { files: fileOut, folders: [...folderOut] };
    },
    exists: async (path: string) => dirs.has(path) || files.has(path),
    rename: async (oldPath: string, newPath: string) => {
      const content = files.get(oldPath);
      if (content === undefined) throw new Error("missing");
      files.delete(oldPath);
      files.set(newPath, content);
    },
    remove: async (path: string) => {
      files.delete(path);
    },
  };
}

function sampleMetadata(projectId: string, generationId: string): IndexGenerationMetadata {
  const identity = buildGeminiIdentity("gemini-embedding-2", 2);
  return {
    version: 1,
    generationId,
    projectId,
    createdAt: new Date().toISOString(),
    indexFingerprint: "abc",
    chunkWords: 400,
    embedModel: "gemini-embedding-2",
    dims: 2,
    identity,
  };
}

describe("index generations (DEC-0022)", () => {
  it("publishes commit only via tmp rename and validates hashes", async () => {
    const adapter = memoryVault();
    const meta = sampleMetadata("p1", "gen-a");
    await writeGenerationArtifacts(adapter, "p1", "gen-a", {
      metadata: meta,
      manifest: { "Research/a.md": "deadbeef" },
      vectorStore: "",
      kgEdges: "",
    });
    expect(await adapter.exists(generationFile("p1", "gen-a", "commit.json"))).toBe(true);
    expect(await adapter.exists(generationFile("p1", "gen-a", "commit.json.tmp"))).toBe(false);
    const validated = await validateCompleteGeneration(adapter, "p1", "gen-a");
    expect(validated.ok).toBe(true);
  });

  it("ignores incomplete generations and selects newest complete", async () => {
    const adapter = memoryVault();
    await writeGenerationArtifacts(adapter, "p1", "0001-old", {
      metadata: sampleMetadata("p1", "0001-old"),
      manifest: {},
      vectorStore: "",
      kgEdges: "",
    });
    const incompleteDir = generationFile("p1", "0002-broken", "metadata.json");
    await adapter.write(incompleteDir, "{}");
    const found = await findNewestCompleteGeneration(adapter, "p1");
    expect(found?.generationId).toBe("0001-old");
  });

  it("classifies legacy layout as rebuild_required", async () => {
    const adapter = memoryVault();
    await adapter.write("sanctum-logs/index/legacy/manifest.json", "{}");
    const snap = await loadIndexGenerationSnapshot(adapter, "legacy");
    expect(snap.status).toBe("rebuild_required");
  });

  it("restart reads the last complete generation snapshot", async () => {
    const adapter = memoryVault();
    await writeGenerationArtifacts(adapter, "p1", "gen-one", {
      metadata: sampleMetadata("p1", "gen-one"),
      manifest: {},
      vectorStore: "",
      kgEdges: "",
    });
    await adapter.mkdir("sanctum-logs/index/p1/generations/gen-two");
    await adapter.write(generationFile("p1", "gen-two", "manifest.json"), "{}");
    const snap = await loadIndexGenerationSnapshot(adapter, "p1");
    expect(snap.status).toBe("ready");
    expect(snap.generationId).toBe("gen-one");
  });
});

describe("index fingerprint helpers", () => {
  it("buildTestGeminiIdentity matches project rag dims", () => {
    const id = buildTestGeminiIdentity({
      id: "x",
      rag: { embed_model: "gemini-embedding-2", dims: 2, chunk_words: 3, top_k: 1, min_similarity: 0 },
    } as any);
    expect(id.dims).toBe(2);
  });
});
