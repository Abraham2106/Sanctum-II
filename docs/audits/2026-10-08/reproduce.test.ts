import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FsVaultAdapter } from '../../../mcp-server/src/core/fs-vault-adapter';
import { VectorStore } from '../../../src/rag/vector-store';
import { indexProject } from '../../../src/projects/indexer';
import { defaultProject } from '../../../src/projects/types';
import { ProjectStore } from '../../../src/projects/store';
import { createQueryVaultTool } from '../../../mcp-server/src/tools/query-vault';
import { DagValidationError, topologicalOrder, executeChain } from '../../../src/chains/executor';
import { startMcpHttp } from '../../../mcp-server/src/mcp/http';
import { McpServer } from '../../../mcp-server/src/mcp/server';
import { splitFrontmatter } from '../../../src/shared/agents/frontmatter';
import { createRunMeshTool } from '../../../mcp-server/src/tools/run-mesh';
import { opencodeChat } from '../../../mcp-server/src/llm/opencode-chat';
import { writeGenerationArtifacts, type IndexGenerationMetadata } from '../../../src/projects/index-generations';
import { buildGeminiIdentity } from '../../../src/embeddings/embedding-identity';
import { buildTestGeminiIdentity } from '../../../src/projects/indexer';
import { chunkToSetLine } from '../../../src/rag/vector-store-encoding';
import type { Chunk } from '../../../src/rag/vector-store';
import type { EmbedderPort } from '../../../src/runtime/ports';
import type { SanctumSettings } from '../../../src/constants';

vi.mock('obsidian', () => ({ Notice: class { hide() {} } }));
vi.mock('../../../mcp-server/src/llm/opencode-chat', () => ({ opencodeChat: vi.fn() }));

// Audit reproductions (docs/audits/2026-10-08/README.md). Synthetic fixtures only.
const roots: string[] = [];
async function vault() {
  const root = await mkdtemp(path.join(tmpdir(), 'sanctum-audit-'));
  roots.push(root);
  return new FsVaultAdapter(root);
}
afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.SANCTUM_PROJECT_ID;
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('sanctum-audit-')) {
      throw new Error('Refusing cleanup outside an audit fixture');
    }
    await rm(root, { recursive: true, force: true });
  }
});

function project(id: string, readPaths = ['Research']) {
  const p = { ...defaultProject(id), read_paths: readPaths };
  p.rag = { ...p.rag, dims: 2, embed_model: 'gemini-embedding-2' };
  return p;
}
function chunk(id: string, note: string, embedding = [1, 0]) {
  return { id, note_path: note, chunk_text: `synthetic ${note}`, embedding };
}

function sampleMetadata(projectId: string, generationId: string): IndexGenerationMetadata {
  const identity = buildGeminiIdentity('gemini-embedding-2', 2);
  return {
    version: 1,
    generationId,
    projectId,
    createdAt: new Date().toISOString(),
    indexFingerprint: 'fp-audit',
    chunkWords: 400,
    embedModel: 'gemini-embedding-2',
    dims: 2,
    identity,
  };
}

function lineFor(notePath: string, text: string, embedding: number[]): string {
  const c: Chunk = { id: `c-${notePath}`, note_path: notePath, chunk_text: text, embedding };
  return chunkToSetLine(c);
}

function auditSettings(): SanctumSettings {
  return {
    geminiApiKeys: 'audit-key',
    embeddingBackend: 'gemini',
    localEmbeddingPort: 8767,
    localEmbeddingToken: '',
    localEmbeddingRevision: '',
    localEmbeddingDims: 768,
    localEmbeddingDevice: 'cpu',
    localEmbeddingDtype: 'float32',
  } as SanctumSettings;
}

function auditEmbedder(projectForIdentity = project('audit')): EmbedderPort {
  return {
    hasKeys: true,
    embed: async () => [1, 0],
    identity: buildTestGeminiIdentity(projectForIdentity),
  };
}

describe('Audit: DEC-0022 contracts (2026-10-08 findings, post-fix)', () => {
  it('A1: empty project read_paths must not embed Research notes', async () => {
    const adapter = await vault();
    await adapter.write('Research/private.md', 'synthetic private text');
    const embed = vi.fn(async () => [1, 0]);
    const port: EmbedderPort = { hasKeys: true, embed, identity: buildTestGeminiIdentity(project('a1', [])) };
    await indexProject(adapter, port, project('a1', []), new VectorStore('sanctum-logs/index/a1/vector-store.jsonl'), {
      settings: auditSettings(),
    });
    expect(embed).not.toHaveBeenCalled();
  });

  it('A2: indexing a folder includes nested Markdown notes', async () => {
    const adapter = await vault();
    await adapter.mkdir('Research/child');
    await adapter.write('Research/root.md', 'root note');
    await adapter.write('Research/child/nested.md', 'nested note');
    const p = project('a2');
    const store = new VectorStore('sanctum-logs/index/a2/vector-store.jsonl');
    await indexProject(adapter, auditEmbedder(p), p, store, { settings: auditSettings() });
    expect(store.allChunks.map(c => c.note_path).sort()).toEqual(['Research/child/nested.md', 'Research/root.md']);
  });

  it('A3: changing chunk_words invalidates an unchanged note manifest', async () => {
    const adapter = await vault();
    await adapter.write('Research/root.md', 'one two three four five six');
    const p = project('a3');
    p.rag.chunk_words = 6;
    p.rag.dims = 2;
    const store = new VectorStore('sanctum-logs/index/a3/vector-store.jsonl');
    await indexProject(adapter, auditEmbedder(p), p, store, { settings: auditSettings() });
    p.rag.chunk_words = 2;
    await indexProject(adapter, auditEmbedder(p), p, store, { settings: auditSettings() });
    expect(store.count).toBe(3);
  });

  it('A4: MCP query requires project_id and reads a published generation (no global index)', async () => {
    const adapter = await vault();
    await adapter.write(
      'sanctum-projects/a4.md',
      `---
id: a4
read_paths: [Research/]
rag:
  embed_model: gemini-embedding-2
  dims: 2
  min_similarity: 0.5
---
`,
    );
    await adapter.write(
      'sanctum-agents/forager.md',
      '---\nid: forager\npermissions:\n  read_paths: [Research/]\n  write_paths: []\n---\n{{user_prompt}}',
    );
    await writeGenerationArtifacts(adapter, 'a4', 'g1', {
      metadata: sampleMetadata('a4', 'g1'),
      manifest: {},
      vectorStore: lineFor('Research/root.md', 'indexed note', [1, 0]),
      kgEdges: '',
    });

    const embed = vi.fn(async () => [1, 0]);
    const port: EmbedderPort = { hasKeys: true, embed, identity: buildTestGeminiIdentity(project('a4')) };
    const tool = createQueryVaultTool({
      vault: adapter,
      createEmbedderForProject: () => port,
    });

    const missingProject = await tool.handler({ agent_id: 'forager', query: 'q' });
    expect(missingProject.isError).toBe(true);
    expect(missingProject.content[0].text).toBe('Error: PROJECT_REQUIRED');

    const globalLegacy = new VectorStore();
    await globalLegacy.load(adapter);
    expect(globalLegacy.count).toBe(0);

    const withProject = await tool.handler({ project_id: 'a4', agent_id: 'forager', query: 'q' });
    expect(withProject.isError).toBeUndefined();
    expect(withProject.content[0].text).toContain('Research/root.md');
  });

  it('A5: MCP max_results is applied after permission filtering', async () => {
    const adapter = await vault();
    await adapter.write(
      'sanctum-projects/p5.md',
      `---
id: p5
read_paths: [Research/]
rag:
  embed_model: gemini-embedding-2
  dims: 2
  min_similarity: 0.5
---
`,
    );
    await adapter.write('sanctum-agents/reader.md', '---\nid: reader\npermissions:\n  read_paths: ["Research/**"]\n  write_paths: []\n---\nReader');
    const vectorStore = [
      lineFor('Research/allowed.md', 'visible', [1, 0]),
      lineFor('Private/0.md', 'hidden', [1, 0]),
      lineFor('Private/1.md', 'hidden', [1, 0]),
      lineFor('Private/2.md', 'hidden', [1, 0]),
      lineFor('Private/3.md', 'hidden', [1, 0]),
      lineFor('Private/4.md', 'hidden', [1, 0]),
    ].join('');
    await writeGenerationArtifacts(adapter, 'p5', 'g1', {
      metadata: sampleMetadata('p5', 'g1'),
      manifest: {},
      vectorStore,
      kgEdges: '',
    });
    const embed = vi.fn(async () => [1, 0]);
    const tool = createQueryVaultTool({
      vault: adapter,
      createEmbedderForProject: () => ({ hasKeys: true, embed }),
    });
    const result = await tool.handler({
      project_id: 'p5',
      agent_id: 'reader',
      query: 'synthetic query',
      max_results: 5,
    });
    expect(JSON.stringify(result)).toContain('Research/allowed.md');
    expect(JSON.stringify(result)).not.toContain('Private/');
  });

  it('A6: overlapping memory appends preserve both entries', async () => {
    const files = new Map<string, string>();
    const adapter = {
      exists: async () => true,
      mkdir: async () => {},
      list: async () => ({ files: [], folders: [] }),
      read: async (p: string) => files.get(p) ?? '',
      write: async (p: string, text: string) => { files.set(p, text); },
    };
    const store = new ProjectStore(adapter);
    await Promise.all([
      store.appendMemory('project', { timestamp: 1, text: 'first' }),
      store.appendMemory('project', { timestamp: 2, text: 'second' }),
    ]);
    expect((await store.loadMemory('project')).map(e => e.text)).toEqual(['first', 'second']);
  });

  it('A7: adding chunks during a pending save remains durable on the next save', async () => {
    let disk = '';
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const adapter = {
      read: async () => disk,
      write: async (_: string, value: string) => { disk = value; },
      append: async (_: string, value: string) => { await gate; disk += value; },
    };
    const store = new VectorStore();
    store.addChunks([chunk('a', 'Research/a.md')]);
    const saving = store.save(adapter);
    store.addChunks([chunk('b', 'Research/b.md')]);
    release();
    await saving;
    await store.save(adapter);
    const loaded = new VectorStore();
    await loaded.load(adapter);
    expect(loaded.count).toBe(store.count);
  });

  it('A8: a directed cycle is rejected before executing a chain', () => {
    const nodes = [{ id: 'a', agentId: 'a' }, { id: 'b', agentId: 'b' }] as any;
    const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] as any;
    expect(() => topologicalOrder(nodes, edges)).toThrow(DagValidationError);
  });

  it('A9: disconnected chain nodes do not receive each other outputs', async () => {
    const chat = vi.fn(async () => ({ content: 'OUTPUT_FROM_PREVIOUS_NODE', usage: { prompt: 0, completion: 0 } }));
    const agent = { id: 'a', name: 'a', tools: [], system_prompt: '{{user_prompt}}', permissions: { read_paths: [], write_paths: [] } } as any;
    await executeChain(
      { id: 'c', name: 'c', invocation: '@c', description: '', projectId: 'p', nodes: [{ id: 'a', agentId: 'a' }, { id: 'b', agentId: 'b' }], edges: [], defaultForProject: false } as any,
      { agent, opencodeClient: { chat }, geminiBalancer: { hasKeys: false }, vectorStore: new VectorStore(), tracer: {} } as any,
      async () => agent,
      'question',
    );
    expect(JSON.stringify(chat.mock.calls[1])).not.toContain('OUTPUT_FROM_PREVIOUS_NODE');
  });

  it('A10: HTTP rejects an untrusted Origin even on loopback (token required)', async () => {
    const server = new McpServer({ name: 'audit', version: '1' });
    const http = await startMcpHttp(server, { port: 0, token: 'audit-token', allowedOrigins: ['http://127.0.0.1:5173'] });
    try {
      const response = await fetch(`http://127.0.0.1:${http.port}/mcp`, {
        method: 'POST',
        headers: {
          Origin: 'https://untrusted.example',
          'Content-Type': 'text/plain',
          Authorization: 'Bearer audit-token',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      });
      expect(response.status).toBe(403);
    } finally { await http.close(); }
  });

  it('A11: frontmatter parsing accepts Windows CRLF line endings', () => {
    const lf = '---\nid: forager\npermissions:\n  read_paths: ["/Research/**"]\n  write_paths: []\n---\nAgent body\n';
    const expected = splitFrontmatter(lf);
    expect(splitFrontmatter(lf.replace(/\n/g, '\r\n'))).toEqual(expected);
  });

  it('A12: MCP mesh returns its best attempt when the next attempt worsens', async () => {
    const adapter = await vault();
    for (const id of ['forager', 'researcher', 'critic']) {
      await adapter.write(`sanctum-agents/${id}.md`, `---\nid: ${id}\n---\n{{user_prompt}}`);
    }
    const evaluation = (score: number) => JSON.stringify({ total_score: score, threshold: 80, verdict: 'reject', criteria: [], feedback_for_regeneration: ['improve'] });
    vi.mocked(opencodeChat).mockReset();
    for (const content of ['FORAGER', 'BETTER_ATTEMPT', evaluation(60), 'WORSE_ATTEMPT', evaluation(50)]) {
      vi.mocked(opencodeChat).mockResolvedValueOnce({ content, usage: { prompt: 0, completion: 0 } });
    }
    const traces: any[] = [];
    const tracer = { writeTrace: async (trace: any) => { traces.push(trace); return 'synthetic-trace'; } } as any;
    vi.useFakeTimers();
    try {
      const result = await createRunMeshTool(adapter, 'https://unused.example', 'synthetic-key', tracer).handler({ prompt: 'synthetic question' });
      expect(result.content[0].text).toContain('BETTER_ATTEMPT');
      expect(traces[0].output).toBe('BETTER_ATTEMPT');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
