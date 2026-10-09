import { describe, expect, it, vi } from "vitest";
import { executeWriteIntent } from "./note-generator";

describe("note-generator provider resolution (DEC-0022)", () => {
  it("prefers agent model over project and global in chat call options", async () => {
    const opencodeClient = {
      chat: vi.fn().mockResolvedValue({
        content: "# Título\n\nCuerpo",
        usage: { prompt: 1, completion: 1 },
      }),
    };
    const deps = {
      agent: {
        id: "researcher",
        name: "Researcher",
        avatar: "",
        model: "agent-model",
        description: "",
        triggers: [],
        tools: [],
        permissions: { read_paths: [], write_paths: [] },
        system_prompt: "system",
      },
      opencodeClient,
      noteWriter: {
        create: vi.fn().mockResolvedValue({
          success: true,
          action: "created",
          path: "Research/t.md",
          message: "ok",
        }),
        update: vi.fn(),
      },
      tracer: {
        start: vi.fn().mockReturnValue("trace-1"),
        finish: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn(),
      },
      vaultAdapter: { exists: vi.fn().mockResolvedValue(false) },
      writePaths: ["/Research/**"],
      outputPath: "Research",
      projectModel: "project-model",
      globalChat: { provider: "openai", model: "global-model" },
    };

    await executeWriteIntent(deps as any, { name: "T", topic: "QAOA" });

    expect(opencodeClient.chat).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      undefined,
      expect.objectContaining({ model: "agent-model", provider: "openai" }),
    );
  });
});
