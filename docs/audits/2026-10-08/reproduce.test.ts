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
import { topologicalOrder, executeChain } from '../../../src/chains/executor';
import { startMcpHttp } from '../../../mcp-server/src/mcp/http';
import { McpServer } from '../../../mcp-server/src/mcp/server';
import { splitFrontmatter } from '../../../src/shared/agents/frontmatter';
import { createRunMeshTool } from '../../../mcp-server/src/tools/run-mesh';
import { opencodeChat } from '../../../mcp-server/src/llm/opencode-chat';

vi.mock('obsidian', () => ({ Notice: class { hide() {} } }));
vi.mock('../../../mcp-server/src/llm/opencode-chat', () => ({ opencodeChat: vi.fn() }));

// All fixtures are synthetic. Gemini/LLM calls are explicit doubles; no external API is called.
const roots: string[] = [];
async function vault() {
  const root = await mkdtemp(path.join(tmpdir(), 'sanctum-audit-'));
  roots.push(root);
  return new FsVaultAdapter(root);
}
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('sanctum-audit-')) {
      throw new Error('Refusing cleanup outside an audit fixture');
    }
    await rm(root, { recursive: true, force: true });
  }
});

function project(id: string, readPaths = ['Research']) {
  return { ...defaultProject(id), read_paths: readPaths };
}
function chunk(id: string, note: string, embedding = [1, 0]) {
  return { id, note_path: note, chunk_text: `synthetic ${note}`, embedding };
}

describe('Audit: desired contracts (expected to fail on eafef22)', () => {
  it('A1: empty project read_paths must not embed Research notes', async () => {
    const adapter = await vault();
    await adapter.write('Research/private.md', 'synthetic private text');
    const embed = vi.fn(async () => [1, 0]);
    await indexProject(adapter, { embed } as any, project('a1', []), new VectorStore());
    expect(embed).not.toHaveBeenCalled();
  });

  it('A2: indexing a folder includes nested Markdown notes', async () => {
    const adapter = await vault();
    await adapter.write('Research/root.md', 'root note');
    await adapter.write('Research/child/nested.md', 'nested note');
    const store = new VectorStore();
    await indexProject(adapter, { embed: async () => [1, 0] } as any, project('a2'), store);
    expect(store.allChunks.map(c => c.note_path).sort()).toEqual(['Research/child/nested.md', 'Research/root.md']);
  });

  it('A3: changing chunk_words invalidates an unchanged note manifest', async () => {
    const adapter = await vault();
    await adapter.write('Research/root.md', 'one two three four five six');
    const p = project('a3');
    p.rag.chunk_words = 6;
    const store = new VectorStore();
    const embed = vi.fn(async () => [1, 0]);
    await indexProject(adapter, { embed } as any, p, store);
    p.rag.chunk_words = 2;
    await indexProject(adapter, { embed } as any, p, store);
    expect(store.count).toBe(3);
  });

  it('A4: default MCP store sees the index written for an Obsidian project', async () => {
    const adapter = await vault();
    await adapter.write('Research/root.md', 'synthetic note');
    const p = project('a4');
    const pluginStore = new VectorStore('sanctum-logs/index/a4/vector-store.jsonl');
    await indexProject(adapter, { embed: async () => [1, 0] } as any, p, pluginStore);
    const mcpStore = new VectorStore(); // mcp-server/index.ts constructs this exact default.
    await mcpStore.load(adapter);
    expect(mcpStore.count).toBe(pluginStore.count);
  });

  it('A5: MCP max_results is applied after permission filtering', async () => {
    const adapter = await vault();
    await adapter.write('sanctum-agents/reader.md', '---\nid: reader\npermissions:\n  read_paths: ["Research/**"]\n  write_paths: []\n---\nReader');
    const store = new VectorStore();
    for (let i = 0; i < 5; i++) store.addChunks([chunk(`p${i}`, `Private/${i}.md`)]);
    store.addChunks([chunk('allowed', 'Research/allowed.md', [0.8, 0.6])]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ embedding: { values: [1, 0] } }), { status: 200 })));
    const result = await createQueryVaultTool(adapter, store, 'synthetic-key').handler({ agent_id: 'reader', query: 'synthetic query', max_results: 5 });
    expect(JSON.stringify(result)).toContain('Research/allowed.md');
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
    expect(() => topologicalOrder(nodes, edges)).toThrow();
  });

  it('A9: disconnected chain nodes do not receive each other outputs', async () => {
    const chat = vi.fn(async () => ({ content: 'OUTPUT_FROM_PREVIOUS_NODE', usage: { prompt: 0, completion: 0 } }));
    const agent = { id: 'a', name: 'a', tools: [], system_prompt: '{{user_prompt}}', permissions: { read_paths: [], write_paths: [] } } as any;
    await executeChain({ nodes: [{ id: 'a', agentId: 'a' }, { id: 'b', agentId: 'b' }], edges: [] } as any,
      { agent, opencodeClient: { chat }, geminiBalancer: { hasKeys: false }, vectorStore: new VectorStore(), tracer: {} } as any,
      async () => agent, 'question');
    expect(JSON.stringify(chat.mock.calls[1])).not.toContain('OUTPUT_FROM_PREVIOUS_NODE');
  });

  it('A10: HTTP rejects an untrusted Origin even on loopback', async () => {
    const server = new McpServer({ name: 'audit', version: '1' });
    const http = await startMcpHttp(server, { port: 0 });
    try {
      const response = await fetch(`http://127.0.0.1:${http.port}/mcp`, {
        method: 'POST',
        headers: { Origin: 'https://untrusted.example', 'Content-Type': 'text/plain' },
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
      await createRunMeshTool(adapter, 'https://unused.example', 'synthetic-key', tracer).handler({ prompt: 'synthetic question' });
      expect(traces[0].output).toBe('BETTER_ATTEMPT');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
