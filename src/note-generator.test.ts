import { describe, expect, it, vi } from "vitest";
import { executeWriteIntent, generateNoteFromSource } from "./orchestrator/note-generator";

function makeDeps(responseContent: string) {
  const noteWriter = {
    create: vi.fn().mockResolvedValue({
      success: true,
      action: "created",
      path: "Projects/q-optimization/qaoa.md",
      message: "Nota creada: Projects/q-optimization/qaoa.md",
    }),
    update: vi.fn(),
  };
  const opencodeClient = {
    chat: vi.fn().mockResolvedValue({ content: responseContent, usage: { prompt: 1, completion: 1 } }),
  };
  const tracer = {
    start: vi.fn().mockReturnValue("trace-1"),
    finish: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
  };
  return {
    deps: {
      agent: {
        id: "researcher",
        name: "Researcher",
        avatar: "",
        model: "test",
        description: "",
        triggers: [],
        tools: [],
        permissions: { read_paths: [], write_paths: [] },
        system_prompt: "Eres un agente de investigacion.",
      },
      opencodeClient,
      noteWriter,
      tracer,
      vaultAdapter: { exists: vi.fn().mockResolvedValue(false) },
      writePaths: ["/Projects/q-optimization/**"],
      outputPath: "Projects/q-optimization",
    } as any,
    noteWriter,
    opencodeClient,
    tracer,
  };
}

describe("note-generator source-backed flow", () => {
  it("passes the complete source to the formatter and returns the real path", async () => {
    const source = "# QAOA, Ising y QUBO\n\nFormula: H = Σ h_i Z_i + Σ J_ij Z_i Z_j\n\nReferencias: [1] fuente tecnica";
    const { deps, opencodeClient } = makeDeps("# QAOA, Ising y QUBO\n\nContenido tecnico preservado");

    const result = await generateNoteFromSource(deps, source, { title: "QAOA Ising QUBO" });

    expect(result.path).toBe("Projects/q-optimization/qaoa-ising-y-qubo.md");
    expect(result.title).toBe("QAOA, Ising y QUBO");
    expect(opencodeClient.chat).toHaveBeenCalledTimes(1);
    const instruction = opencodeClient.chat.mock.calls[0][1] as string;
    expect(instruction).toContain(source);
    expect(instruction).toContain("No inventes informacion");
  });

  it("returns structured results for explicit topics and propagates write failures", async () => {
    const { deps } = makeDeps("# Mi nota\n\nContenido");
    const result = await executeWriteIntent(deps, { name: "Mi nota", topic: "QAOA" });
    expect(result).toMatchObject({ title: "Mi nota", path: "Projects/q-optimization/mi-nota.md" });
    expect(result.writeResult.success).toBe(true);
  });

  it("does not hide an exists/storage failure as a missing note", async () => {
    const { deps, noteWriter } = makeDeps("# Nunca se escribe");
    deps.vaultAdapter.exists.mockRejectedValue(new Error("EACCES"));

    await expect(executeWriteIntent(deps, { name: "Nota", topic: "QAOA" })).rejects.toThrow("EACCES");
    expect(noteWriter.create).not.toHaveBeenCalled();
  });

  it("rejects an empty source before invoking the model", async () => {
    const { deps, opencodeClient } = makeDeps("# Nunca");
    await expect(generateNoteFromSource(deps, "   ")).rejects.toThrow("contenido fuente");
    expect(opencodeClient.chat).not.toHaveBeenCalled();
  });
});
