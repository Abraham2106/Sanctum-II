import { describe, it, expect, vi } from "vitest";
import { VectorStore } from "../rag/vector-store";
import type { VectorIdentity } from "../runtime/ports";
import { resolveNoteReference } from "./note-resolver";

function sealedFor(projectId: string, dims = 2): VectorIdentity {
  return {
    embedModel: "gemini-embedding-2",
    dims,
    projectId,
    generationId: "gen-1",
    provenance: "fp-1",
  };
}

describe("resolveNoteReference exact title match (DEC-0016)", () => {
  it('title "a", query "modifica la nota" → not_found', async () => {
    const notes = [{ path: "Projects/test/a.md", title: "a", created_at: 100 }];
    const result = await resolveNoteReference("modifica la nota", notes, undefined, undefined);
    expect(result.method).toBe("not_found");
    expect(result.path).toBeNull();
  });

  it('title "ML", query "revisa el HTML" → not_found', async () => {
    const notes = [{ path: "Projects/test/ML.md", title: "ML", created_at: 100 }];
    const result = await resolveNoteReference("revisa el HTML", notes, undefined, undefined);
    expect(result.method).toBe("not_found");
    expect(result.path).toBeNull();
  });

  it('title "QML Research", query "QML" → exact', async () => {
    const notes = [{ path: "Projects/test/QML.md", title: "QML Research", created_at: 100 }];
    const result = await resolveNoteReference("QML", notes, undefined, undefined);
    expect(result.method).toBe("exact");
    expect(result.path).toBe("Projects/test/QML.md");
  });

  it('title "Quantum ML Research", query "quantum" → exact', async () => {
    const notes = [{ path: "Projects/test/QML.md", title: "Quantum ML Research", created_at: 100 }];
    const result = await resolveNoteReference("quantum", notes, undefined, undefined);
    expect(result.method).toBe("exact");
    expect(result.path).toBe("Projects/test/QML.md");
  });

  it('title "QML", query "revisa el QML ahora" → exact', async () => {
    const notes = [{ path: "Projects/test/QML.md", title: "QML", created_at: 100 }];
    const result = await resolveNoteReference("revisa el QML ahora", notes, undefined, undefined);
    expect(result.method).toBe("exact");
    expect(result.path).toBe("Projects/test/QML.md");
  });
});

describe("resolveNoteReference scoped retrieval (DEC-0022)", () => {
  it("denies when selection tries to widen beyond project read scope", async () => {
    const notes = [{ path: "Private/secret.md", title: "Secret", created_at: 1 }];

    const result = await resolveNoteReference(
      "Secret",
      notes,
      undefined,
      undefined,
      {
        projectReadPaths: ["/Projects/test/**"],
        agentReadPaths: ["/**"],
        selectionPaths: ["/Private/**", "/Projects/test/**"],
        projectId: "test",
        projectRag: { embed_model: "gemini-embedding-2", dims: 2 },
      },
      sealedFor("test", 2),
    );

    expect(result.method).toBe("not_found");
  });

  it("returns scoped semantic match when path is authorized", async () => {
    const store = new VectorStore("scoped-ok.jsonl");
    store.addChunks(
      [
        {
          id: "q#0",
          note_path: "Projects/test/QML.md",
          chunk_text: "quantum",
          embedding: [1, 0],
        },
      ],
      "Projects/test/QML.md",
    );

    const gemini = { hasKeys: true, embed: vi.fn(async () => [1, 0]) } as any;

    const result = await resolveNoteReference(
      "quantum ml",
      [{ path: "Projects/test/QML.md", title: "QML", created_at: 1 }],
      store,
      gemini,
      {
        projectReadPaths: ["/Projects/test/**"],
        agentReadPaths: ["/**"],
        projectId: "test",
        projectRag: { embed_model: "gemini-embedding-2", dims: 2, min_similarity: 0.1, top_k: 5 },
      },
      sealedFor("test", 2),
    );

    expect(result.method).toBe("rag_semantic");
    expect(result.path).toBe("Projects/test/QML.md");
  });
});
