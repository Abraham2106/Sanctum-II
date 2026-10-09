import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL } from "../constants";
import type { AgentDefinition } from "../agents/types";
import type { Project } from "../projects/types";
import { DEFAULT_PROJECT_RAG } from "../projects/types";
import type { ChatPort, EmbedderPort, VectorStorePort } from "./ports";
import { bindEmbedderPort } from "./ports";
import { resolveChatCallOptions, runPortableTurn } from "./turn";

const agent: AgentDefinition = {
  id: "test",
  name: "Test",
  avatar: "🤖",
  model: DEFAULT_MODEL,
  description: "",
  triggers: [],
  tools: [],
  permissions: { read_paths: ["/**"], write_paths: [] },
  system_prompt: "{{rag_context}}",
};

function makeProject(readPaths: string[]): Project {
  return {
    id: "p1",
    name: "P",
    icon: "",
    description: "",
    instructions: "",
    read_paths: readPaths,
    write_paths: [],
    outputPath: "Projects/p1",
    model: DEFAULT_MODEL,
    rag: { ...DEFAULT_PROJECT_RAG, dims: 3 },
    files: [],
    attachedFiles: [],
  };
}

describe("runPortableTurn (DEC-0022)", () => {
  it("denied scope does not call embedder", async () => {
    const embed = vi.fn().mockResolvedValue([1, 0, 0]);
    const embedder: EmbedderPort = { hasKeys: true, embed };
    const chat: ChatPort = {
      chat: vi.fn().mockResolvedValue({ content: "ok", usage: { prompt: 1, completion: 1 } }),
      chatMessages: vi.fn(),
    };
    const store: VectorStorePort = {
      count: 1,
      identity: { embedModel: DEFAULT_PROJECT_RAG.embed_model, dims: 3, projectId: "p1" },
      allChunks: () => [
        { id: "1", notePath: "Research/a.md", chunkText: "x", embedding: [1, 0, 0] },
      ],
    };

    await runPortableTurn({
      userInput: "hola",
      selectionPaths: [],
      agent,
      projectContext: {
        project: makeProject(["/Research/**"]),
        memory: [],
        systemPrefix: "",
      },
      ports: { chat, embedder, vectorStore: store },
    });

    expect(embed).not.toHaveBeenCalled();
  });

  it("missing project denies embed", async () => {
    const embed = vi.fn().mockResolvedValue([1, 0, 0]);
    const embedder: EmbedderPort = { hasKeys: true, embed };
    const chat: ChatPort = {
      chat: vi.fn().mockResolvedValue({ content: "ok", usage: { prompt: 1, completion: 1 } }),
      chatMessages: vi.fn(),
    };
    const store: VectorStorePort = {
      count: 1,
      identity: { embedModel: DEFAULT_PROJECT_RAG.embed_model, dims: 3, projectId: "p1" },
      allChunks: () => [],
    };

    await runPortableTurn({
      userInput: "hola",
      agent,
      ports: { chat, embedder, vectorStore: store },
    });

    expect(embed).not.toHaveBeenCalled();
  });

  it("passes sealed embed model to embedder on RAG turn", async () => {
    const embed = vi.fn().mockResolvedValue([1, 0, 0]);
    const embedder: EmbedderPort = { hasKeys: true, embed };
    const chat: ChatPort = {
      chat: vi.fn().mockResolvedValue({ content: "ok", usage: { prompt: 1, completion: 1 } }),
      chatMessages: vi.fn(),
    };
    const store: VectorStorePort = {
      count: 1,
      identity: { embedModel: DEFAULT_PROJECT_RAG.embed_model, dims: 3, projectId: "p1" },
      allChunks: () => [
        { id: "1", notePath: "Research/ok.md", chunkText: "allowed", embedding: [1, 0, 0] },
      ],
    };

    await runPortableTurn({
      userInput: "q",
      agent,
      projectContext: {
        project: makeProject(["/Research/**"]),
        memory: [],
        systemPrefix: "",
      },
      ports: { chat, embedder, vectorStore: store },
    });

    expect(embed).toHaveBeenCalledWith("q", {
      model: DEFAULT_PROJECT_RAG.embed_model,
      purpose: "query",
      expectedIdentity: undefined,
      signal: undefined,
    });
  });

  it("nonverifiable store identity skips embed (rebuild_required)", async () => {
    const embed = vi.fn().mockResolvedValue([1, 0, 0]);
    const embedder: EmbedderPort = { hasKeys: true, embed };
    const chat: ChatPort = {
      chat: vi.fn().mockResolvedValue({ content: "ok", usage: { prompt: 1, completion: 1 } }),
      chatMessages: vi.fn(),
    };
    const store: VectorStorePort = {
      count: 2,
      identity: undefined,
      allChunks: () => [
        { id: "1", notePath: "Research/ok.md", chunkText: "x", embedding: [1, 0, 0] },
      ],
    };

    await runPortableTurn({
      userInput: "q",
      agent,
      projectContext: {
        project: makeProject(["/Research/**"]),
        memory: [],
        systemPrefix: "",
      },
      ports: { chat, embedder, vectorStore: store },
    });

    expect(embed).not.toHaveBeenCalled();
  });

  it("denied paths never appear in ragContext", async () => {
    const embedder: EmbedderPort = {
      hasKeys: true,
      embed: vi.fn().mockResolvedValue([1, 0, 0]),
    };
    const chat: ChatPort = {
      chat: vi.fn().mockResolvedValue({ content: "ok", usage: { prompt: 1, completion: 1 } }),
      chatMessages: vi.fn(),
    };
    const store: VectorStorePort = {
      count: 2,
      identity: { embedModel: DEFAULT_PROJECT_RAG.embed_model, dims: 3, projectId: "p1" },
      allChunks: () => [
        { id: "1", notePath: "Research/ok.md", chunkText: "allowed", embedding: [1, 0, 0] },
        { id: "2", notePath: "Finanzas/no.md", chunkText: "secret", embedding: [1, 0, 0] },
      ],
    };

    const result = await runPortableTurn({
      userInput: "q",
      agent: {
        ...agent,
        permissions: { read_paths: ["/Research/**"], write_paths: [] },
      },
      projectContext: {
        project: makeProject(["/Research/**", "/Finanzas/**"]),
        memory: [],
        systemPrefix: "",
      },
      ports: { chat, embedder, vectorStore: store },
    });

    expect(result.ragContext).toContain("Research/ok.md");
    expect(result.ragContext).not.toContain("Finanzas");
    expect(result.ragContext).not.toContain("secret");
  });

  it("wrong store projectId skips embed and retrieval", async () => {
    const embed = vi.fn().mockResolvedValue([1, 0, 0]);
    const allChunks = vi.fn().mockReturnValue([
      { id: "1", notePath: "Research/ok.md", chunkText: "allowed", embedding: [1, 0, 0] },
    ]);
    const embedder: EmbedderPort = { hasKeys: true, embed };
    const chat: ChatPort = {
      chat: vi.fn().mockResolvedValue({ content: "ok", usage: { prompt: 1, completion: 1 } }),
      chatMessages: vi.fn(),
    };
    const store: VectorStorePort = {
      count: 1,
      identity: { embedModel: DEFAULT_PROJECT_RAG.embed_model, dims: 3, projectId: "other" },
      allChunks,
    };
    const tracer = { addChunk: vi.fn() };

    const result = await runPortableTurn({
      userInput: "q",
      agent,
      traceId: "t-wrong",
      projectContext: {
        project: makeProject(["/Research/**"]),
        memory: [],
        systemPrefix: "",
      },
      ports: { chat, embedder, vectorStore: store, tracer },
    });

    expect(embed).not.toHaveBeenCalled();
    expect(allChunks).not.toHaveBeenCalled();
    expect(tracer.addChunk).not.toHaveBeenCalled();
    expect(result.ragContext).toBe("");
  });

  it("passes resolved chat options to chat and conversation chatMessages", async () => {
    const chat = vi.fn().mockResolvedValue({ content: "ok", usage: { prompt: 1, completion: 1 } });
    const chatMessages = vi
      .fn()
      .mockResolvedValue({ content: "conv", usage: { prompt: 2, completion: 2 } });
    const embedder: EmbedderPort = { hasKeys: false, embed: vi.fn() };
    const store: VectorStorePort = { count: 0, allChunks: () => [] };

    await runPortableTurn({
      userInput: "plain",
      skipRag: true,
      agent: { ...agent, model: "agent-model" },
      globalChat: { model: "global-model", provider: "openai" },
      chatOptions: { provider: "openai", signal: new AbortController().signal },
      ports: {
        chat: { chat, chatMessages },
        embedder,
        vectorStore: store,
      },
    });

    expect(chat).toHaveBeenCalledWith(
      expect.any(String),
      "plain",
      undefined,
      expect.objectContaining({ model: "agent-model", provider: "openai" }),
    );

    await runPortableTurn({
      userInput: "follow-up",
      skipRag: true,
      agent: { ...agent, model: "" },
      projectContext: {
        project: { ...makeProject([]), model: "project-model" },
        memory: [],
        systemPrefix: "",
      },
      conversationMessages: [{ role: "user", content: "prior" }],
      ports: {
        chat: { chat, chatMessages },
        embedder,
        vectorStore: store,
      },
    });

    expect(chatMessages).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ model: "project-model", provider: "openai" }),
    );
  });

  it("resolveChatCallOptions prefers agent model over project and global", () => {
    const opts = resolveChatCallOptions(
      { ...agent, model: "agent-m" },
      "project-m",
      { model: "global-m", provider: "anthropic" },
    );
    expect(opts.model).toBe("agent-m");
    expect(opts.provider).toBe("anthropic");
  });

  it("aborted signal skips chat port", async () => {
    const controller = new AbortController();
    controller.abort();
    const chat = vi.fn().mockResolvedValue({ content: "ok", usage: { prompt: 1, completion: 1 } });
    const chatMessages = vi.fn();
    const embedder: EmbedderPort = { hasKeys: false, embed: vi.fn() };
    const store: VectorStorePort = { count: 0, allChunks: () => [] };

    await expect(
      runPortableTurn({
        userInput: "hi",
        skipRag: true,
        signal: controller.signal,
        agent,
        ports: { chat: { chat, chatMessages }, embedder, vectorStore: store },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(chat).not.toHaveBeenCalled();
    expect(chatMessages).not.toHaveBeenCalled();
  });

  it("passes turn signal on query embed options", async () => {
    const controller = new AbortController();
    const embed = vi.fn().mockResolvedValue([1, 0, 0]);
    const embedder: EmbedderPort = { hasKeys: true, embed };
    const chat: ChatPort = {
      chat: vi.fn().mockResolvedValue({ content: "ok", usage: { prompt: 1, completion: 1 } }),
      chatMessages: vi.fn(),
    };
    const store: VectorStorePort = {
      count: 1,
      identity: { embedModel: DEFAULT_PROJECT_RAG.embed_model, dims: 3, projectId: "p1" },
      allChunks: () => [
        { id: "1", notePath: "Research/ok.md", chunkText: "allowed", embedding: [1, 0, 0] },
      ],
    };

    await runPortableTurn({
      userInput: "q",
      signal: controller.signal,
      agent,
      projectContext: {
        project: makeProject(["/Research/**"]),
        memory: [],
        systemPrefix: "",
      },
      ports: { chat, embedder, vectorStore: store },
    });

    expect(embed).toHaveBeenCalledWith("q", {
      model: DEFAULT_PROJECT_RAG.embed_model,
      purpose: "query",
      expectedIdentity: undefined,
      signal: controller.signal,
    });
  });

  it("bindEmbedderPort forwards sealed model when embed has default second arg (length 1)", async () => {
    const embed = vi.fn(async (text: string, model = "default-model") => [1, 0, 0]);
    const port = bindEmbedderPort(true, embed);
    await port.embed("hello", { model: "sealed-model" });
    expect(embed).toHaveBeenCalledWith("hello", "sealed-model");
  });
});
