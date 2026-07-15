#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// mcp-server/index.ts
var import_node_path2 = __toESM(require("node:path"), 1);

// mcp-server/src/mcp/server.ts
var import_node_readline = require("node:readline");

// mcp-server/src/mcp/logger.ts
var order = { debug: 0, info: 1, warn: 2, error: 3 };
var threshold = order[process.env.SANCTUM_LOG_LEVEL ?? "info"] ?? order.info;
function emit(level, msg, meta) {
  if (order[level] < threshold) return;
  const line = {
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    level,
    msg
  };
  if (meta !== void 0) line.meta = meta;
  process.stderr.write(JSON.stringify(line) + "\n");
}
var log = {
  debug: (m, meta) => emit("debug", m, meta),
  info: (m, meta) => emit("info", m, meta),
  warn: (m, meta) => emit("warn", m, meta),
  error: (m, meta) => emit("error", m, meta)
};

// mcp-server/src/mcp/server.ts
var PROTOCOL_VERSION = "2024-11-05";
var RpcError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
var McpServer = class {
  constructor(info) {
    this.info = info;
    this.tools = /* @__PURE__ */ new Map();
    this.pending = 0;
    this.closing = false;
    this.clientInfo = null;
  }
  registerTool(tool) {
    if (this.tools.has(tool.name)) throw new Error(`Tool duplicada: ${tool.name}`);
    this.tools.set(tool.name, tool);
    log.debug("tool registrada", { name: tool.name });
  }
  start() {
    const rl = (0, import_node_readline.createInterface)({ input: process.stdin, crlfDelay: Infinity });
    rl.on("line", (line) => {
      const t = line.trim();
      if (t) void this.handleLine(t);
    });
    rl.on("close", () => {
      this.closing = true;
      log.info("stdin cerrado", { pending: this.pending });
      if (this.pending === 0) process.exit(0);
    });
    log.info("sanctum mcp listo (stdio)", { tools: [...this.tools.keys()] });
  }
  send(res) {
    process.stdout.write(JSON.stringify(res) + "\n");
  }
  async handleLine(line) {
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      log.error("linea json-rpc invalida", { line });
      return;
    }
    const id = req.id ?? null;
    const isNotification = req.id === void 0 || req.id === null;
    this.pending++;
    try {
      const result = await this.dispatch(req);
      if (!isNotification) this.send({ jsonrpc: "2.0", id, result });
    } catch (err) {
      const code = err instanceof RpcError ? err.code : -32e3;
      const message = err instanceof Error ? err.message : String(err);
      log.error("fallo en request", { method: req.method, code, message });
      if (!isNotification) this.send({ jsonrpc: "2.0", id, error: { code, message } });
    } finally {
      this.pending--;
      if (this.closing && this.pending === 0) process.exit(0);
    }
  }
  async dispatch(req) {
    log.debug("dispatch", { method: req.method, id: req.id });
    switch (req.method) {
      case "initialize": {
        const params = req.params ?? {};
        this.clientInfo = params.clientInfo ?? null;
        return {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: this.info
        };
      }
      case "notifications/initialized":
        return void 0;
      case "ping":
        return {};
      case "tools/list":
        return {
          tools: [...this.tools.values()].map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema
          }))
        };
      case "tools/call": {
        const params = req.params ?? {};
        if (!params.name) throw new RpcError(-32602, "tools/call requiere 'name'");
        const tool = this.tools.get(params.name);
        if (!tool) throw new RpcError(-32602, `Tool desconocida: ${params.name}`);
        log.info("tool call", { name: params.name, client: this.clientInfo?.name });
        try {
          return await tool.handler(params.arguments ?? {});
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
        }
      }
      default:
        throw new RpcError(-32601, `Metodo no encontrado: ${req.method}`);
    }
  }
};

// mcp-server/src/core/fs-vault-adapter.ts
var import_node_fs = require("node:fs");
var import_node_path = __toESM(require("node:path"), 1);
var FORBIDDEN_SEGMENTS = /* @__PURE__ */ new Set([
  ".env",
  ".git",
  "node_modules",
  ".obsidian"
]);
var FsVaultAdapter = class {
  constructor(root) {
    this.root = root;
  }
  async resolveSecure(p) {
    if (!p || p.includes("\0")) {
      throw Object.assign(new Error("Invalid path: empty or contains null byte"), { code: "EACCES" });
    }
    if (import_node_path.default.isAbsolute(p)) {
      throw Object.assign(new Error("Access denied: absolute paths not allowed"), { code: "EACCES" });
    }
    const segments = p.split(/[/\\]/);
    if (segments.includes("..")) {
      throw Object.assign(new Error("Access denied: path traversal not allowed"), { code: "EACCES" });
    }
    for (const seg of segments) {
      if (FORBIDDEN_SEGMENTS.has(seg.toLowerCase())) {
        throw Object.assign(new Error("Access denied: forbidden path segment"), { code: "EACCES" });
      }
    }
    const resolved = import_node_path.default.resolve(this.root, p);
    const normalizedRoot = import_node_path.default.resolve(this.root);
    if (!resolved.startsWith(normalizedRoot + import_node_path.default.sep) && resolved !== normalizedRoot) {
      throw Object.assign(new Error("Access denied: path escapes vault root"), { code: "EACCES" });
    }
    const realRoot = await import_node_fs.promises.realpath(normalizedRoot);
    let probe = resolved;
    let realProbe;
    while (true) {
      try {
        realProbe = await import_node_fs.promises.realpath(probe);
        break;
      } catch (err) {
        if (err.code !== "ENOENT" && err.code !== "ENOTDIR") throw err;
        const parent = import_node_path.default.dirname(probe);
        if (parent === probe) throw err;
        probe = parent;
      }
    }
    const rootPrefix = realRoot.endsWith(import_node_path.default.sep) ? realRoot : realRoot + import_node_path.default.sep;
    const comparable = process.platform === "win32" ? (value) => value.toLowerCase() : (value) => value;
    const rootForCompare = comparable(realRoot);
    const probeForCompare = comparable(realProbe);
    if (probeForCompare !== rootForCompare && !probeForCompare.startsWith(comparable(rootPrefix))) {
      throw Object.assign(new Error("Access denied: symlink escapes vault root"), { code: "EACCES" });
    }
    return resolved;
  }
  async read(p) {
    const full = await this.resolveSecure(p);
    return import_node_fs.promises.readFile(full, "utf8");
  }
  async write(p, data) {
    const full = await this.resolveSecure(p);
    await import_node_fs.promises.mkdir(import_node_path.default.dirname(full), { recursive: true });
    await import_node_fs.promises.writeFile(full, data, "utf8");
  }
  async mkdir(p) {
    const full = await this.resolveSecure(p);
    await import_node_fs.promises.mkdir(full, { recursive: true });
  }
  async list(p) {
    const full = await this.resolveSecure(p);
    const files = [];
    const folders = [];
    let entries;
    try {
      entries = await import_node_fs.promises.readdir(full, { withFileTypes: true });
    } catch {
      log.warn("no se pudo leer el directorio", { path: full });
      return { files, folders };
    }
    for (const e of entries) {
      const childPath = import_node_path.default.posix.join(p, e.name);
      if (e.isDirectory()) {
        folders.push(childPath);
      } else {
        files.push(childPath);
      }
    }
    return { files, folders };
  }
  async exists(p) {
    try {
      const full = await this.resolveSecure(p);
      await import_node_fs.promises.access(full);
      return true;
    } catch {
      return false;
    }
  }
  async append(p, data) {
    const full = await this.resolveSecure(p);
    await import_node_fs.promises.mkdir(import_node_path.default.dirname(full), { recursive: true });
    await import_node_fs.promises.appendFile(full, data, "utf8");
  }
  async rename(oldPath, newPath) {
    const oldFull = await this.resolveSecure(oldPath);
    const newFull = await this.resolveSecure(newPath);
    await import_node_fs.promises.mkdir(import_node_path.default.dirname(newFull), { recursive: true });
    await import_node_fs.promises.rename(oldFull, newFull);
  }
  async remove(p) {
    const full = await this.resolveSecure(p);
    await import_node_fs.promises.rm(full, { force: true });
  }
};

// src/utils.ts
function globMatch(path3, pattern) {
  const p = pattern.startsWith("/") ? pattern.slice(1) : pattern;
  if (p === "**" || p === "") return true;
  const regex = new RegExp(
    "^" + p.replace(/\*\*/g, "___DS___").replace(/\*/g, "[^/]*").replace(/___DS___/g, ".*").replace(/\//g, "\\/").replace(/\./g, "\\.")
  );
  return regex.test(path3);
}
function pathMatchesAny(filePath, patterns) {
  if (!patterns) return true;
  if (patterns.length === 0) return false;
  if (patterns.includes("/**") || patterns.includes("**")) return true;
  return patterns.some((p) => globMatch(filePath, p));
}

// src/core/vault-fs.ts
function isNotFoundError(error) {
  const candidate = error;
  if (candidate?.code === "ENOENT") return true;
  return typeof candidate?.message === "string" && /(?:ENOENT|not found|no such file|does not exist)/i.test(candidate.message);
}

// src/rag/vector-store.ts
var DEFAULT_STORE_PATH = "sanctum-logs/vector-store.jsonl";
function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
function float32ArrayToBase64(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
function base64ToFloat32Array(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}
async function appendToFile(adapter, path3, content) {
  if (typeof adapter.append === "function") {
    await adapter.append(path3, content);
  } else {
    let existing = "";
    if (typeof adapter.exists === "function" ? await adapter.exists(path3) : true) {
      try {
        existing = await adapter.read(path3);
      } catch {
      }
    }
    await adapter.write(path3, existing ? `${existing}${content}` : content);
  }
}
var VectorStore = class {
  constructor(storePath) {
    this.chunksMap = /* @__PURE__ */ new Map();
    this.noteToChunksMap = /* @__PURE__ */ new Map();
    this.chunks = [];
    this.pendingTxns = [];
    this.shouldTruncate = false;
    this.dims = 0;
    this.storePath = storePath || DEFAULT_STORE_PATH;
  }
  get count() {
    return this.chunks.length;
  }
  get allChunks() {
    return this.chunks;
  }
  getStorePath() {
    return this.storePath;
  }
  async load(adapter) {
    try {
      const raw = await adapter.read(this.storePath);
      const lines = raw.split("\n");
      this.chunksMap.clear();
      this.noteToChunksMap.clear();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const txn = JSON.parse(line);
          if (txn.t === "set") {
            const floatArr = base64ToFloat32Array(txn.v);
            const embedding = Array.from(floatArr);
            const chunk = {
              id: txn.id,
              note_path: txn.p,
              chunk_text: txn.txt,
              embedding
            };
            this.chunksMap.set(txn.id, chunk);
            let noteSet = this.noteToChunksMap.get(txn.p);
            if (!noteSet) {
              noteSet = /* @__PURE__ */ new Set();
              this.noteToChunksMap.set(txn.p, noteSet);
            }
            noteSet.add(txn.id);
            if (embedding.length > 0 && !this.dims) {
              this.dims = embedding.length;
            }
          } else if (txn.t === "del") {
            const chunk = this.chunksMap.get(txn.id);
            if (chunk) {
              const noteSet = this.noteToChunksMap.get(chunk.note_path);
              if (noteSet) {
                noteSet.delete(txn.id);
                if (noteSet.size === 0) {
                  this.noteToChunksMap.delete(chunk.note_path);
                }
              }
              this.chunksMap.delete(txn.id);
            }
          }
        } catch (e) {
          console.error("Error parsing transaction line in vector store log:", e);
        }
      }
      this.chunks = Array.from(this.chunksMap.values());
      console.error(`[VectorStore] \u2705 Loaded ${this.chunks.length} chunks from ${this.storePath}`);
    } catch (error) {
      this.chunksMap.clear();
      this.noteToChunksMap.clear();
      this.chunks = [];
      if (!isNotFoundError(error)) {
        console.error(`[VectorStore] failed to load ${this.storePath}:`, error);
        throw error;
      }
      console.error(`[VectorStore] \u{1F4C4} No existing store at ${this.storePath} \u2014 starting empty`);
    }
  }
  async save(adapter) {
    if (this.shouldTruncate) {
      const txns = [];
      for (const chunk of this.chunksMap.values()) {
        const b64 = float32ArrayToBase64(new Float32Array(chunk.embedding));
        txns.push(JSON.stringify({
          t: "set",
          id: chunk.id,
          p: chunk.note_path,
          txt: chunk.chunk_text,
          v: b64
        }));
      }
      const fileContent = txns.length > 0 ? txns.join("\n") + "\n" : "";
      await adapter.write(this.storePath, fileContent);
      this.shouldTruncate = false;
      this.pendingTxns = [];
      console.error(`[VectorStore] \u{1F4BE} Truncate-saved ${this.chunks.length} chunks to ${this.storePath} (${(fileContent.length / 1024).toFixed(1)}KB)`);
    } else if (this.pendingTxns.length > 0) {
      const txnCount = this.pendingTxns.length;
      const appendContent = this.pendingTxns.join("");
      await appendToFile(adapter, this.storePath, appendContent);
      this.pendingTxns = [];
      console.info(`[VectorStore] \u{1F4BE} Append-saved ${txnCount} txns to ${this.storePath}`);
    }
  }
  addChunks(newChunks, notePath) {
    const path3 = notePath || (newChunks.length > 0 ? newChunks[0].note_path : void 0);
    if (!path3) return;
    const oldChunkIds = this.noteToChunksMap.get(path3);
    if (oldChunkIds) {
      for (const oldId of oldChunkIds) {
        this.chunksMap.delete(oldId);
        this.pendingTxns.push(JSON.stringify({ t: "del", id: oldId }) + "\n");
      }
      this.noteToChunksMap.delete(path3);
    }
    if (newChunks.length > 0) {
      const newSet = /* @__PURE__ */ new Set();
      for (const c of newChunks) {
        this.chunksMap.set(c.id, c);
        newSet.add(c.id);
        const b64 = float32ArrayToBase64(new Float32Array(c.embedding));
        this.pendingTxns.push(JSON.stringify({
          t: "set",
          id: c.id,
          p: c.note_path,
          txt: c.chunk_text,
          v: b64
        }) + "\n");
      }
      this.noteToChunksMap.set(path3, newSet);
      if (!this.dims && newChunks[0].embedding) {
        this.dims = newChunks[0].embedding.length;
      }
    }
    this.chunks = Array.from(this.chunksMap.values());
  }
  clear() {
    this.chunksMap.clear();
    this.noteToChunksMap.clear();
    this.chunks = [];
    this.pendingTxns = [];
    this.shouldTruncate = true;
    this.dims = 0;
  }
  search(queryEmbedding, topK = 5) {
    const scored = this.chunks.map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding)
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
  filterByPaths(results, allowedPaths) {
    if (allowedPaths.length === 0) return [];
    return results.filter((r) => pathMatchesAny(r.chunk.note_path, allowedPaths));
  }
};

// src/shared/agents/frontmatter.ts
function parseScalar(value) {
  value = value.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    return value.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  }
  if (value === "true" || value === "false") return value === "true";
  if (!isNaN(Number(value)) && value !== "") return Number(value);
  return value.replace(/^["']|["']$/g, "");
}
function parseFrontmatter(raw) {
  const result = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---") continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    result[key] = parseScalar(value);
  }
  return result;
}

// mcp-server/src/tools/list-agents.ts
function loadAgents(vault) {
  return vault.list("sanctum-agents").then(async ({ files }) => {
    const mdFiles = files.filter((f) => f.toLowerCase().endsWith(".md"));
    const agents = [];
    for (const f of mdFiles) {
      try {
        const content = await vault.read(f);
        const mc = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (!mc) continue;
        const fm = parseFrontmatter(mc[1]);
        const id = fm.id;
        if (!id || typeof id !== "string") continue;
        const internal = fm.internal === true;
        agents.push({
          id,
          name: fm.name ?? id,
          avatar: fm.avatar ?? "\u{1F916}",
          description: fm.description ?? "",
          fixed: !internal
        });
      } catch (err) {
        log.warn("error leyendo agente", { file: f, error: String(err) });
      }
    }
    agents.sort((a, b) => a.id.localeCompare(b.id));
    return agents;
  });
}
function createListAgentsTool(vault) {
  return {
    name: "sanctum_list_agents",
    description: "Lista todos los agentes disponibles en el vault (fijos del sistema + custom del usuario). Devuelve metadata de cada agente: id, name, avatar, description y si es fijo o custom.",
    inputSchema: {
      type: "object",
      properties: {}
    },
    async handler() {
      const agents = await loadAgents(vault);
      log.info("sanctum_list_agents", { count: agents.length });
      const text = agents.map(
        (a) => `${a.avatar} **${a.name}** (\`${a.id}\`)${a.fixed ? " \u2014 *fijo del sistema*" : " \u2014 *custom*"}
${a.description}`
      ).join("\n\n");
      return {
        content: [{ type: "text", text: text || "No se encontraron agentes." }]
      };
    }
  };
}

// mcp-server/src/mcp/permission-resolver.ts
var AgentNotFoundError = class extends Error {
  constructor(agentId) {
    super(`AGENT_NOT_FOUND: el agente '${agentId}' no existe en sanctum-agents/`);
    this.name = "AgentNotFoundError";
  }
};
function parseFrontmatterFromMd(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const result = {};
  let currentParent = null;
  let currentNested = null;
  for (const line of yaml.split("\n")) {
    const topKv = line.match(/^(\w+)\s*:\s*(.*)$/);
    if (topKv) {
      if (currentParent && currentNested !== null) {
        result[currentParent] = currentNested;
        currentParent = null;
        currentNested = null;
      }
      const key = topKv[1];
      let value = topKv[2].trim();
      if (value === "" || value === null) {
        currentParent = key;
        currentNested = {};
        continue;
      }
      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (/^\d+$/.test(String(value))) value = Number(value);
      else if (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
        value = value.slice(1, -1).split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
      }
      result[key] = value;
      continue;
    }
    const nestedKv = line.match(/^\s+(\w+)\s*:\s*(.+)$/);
    if (nestedKv && currentParent && currentNested !== null) {
      let value = nestedKv[2].trim();
      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (/^\d+$/.test(String(value))) value = Number(value);
      else if (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
        value = value.slice(1, -1).split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
      }
      currentNested[nestedKv[1]] = value;
    }
  }
  if (currentParent && currentNested !== null) {
    result[currentParent] = currentNested;
  }
  return result;
}
function extractPermissions(fm) {
  const perm = fm.permissions ?? {};
  return {
    agentId: String(fm.id ?? ""),
    readPaths: Array.isArray(perm.read_paths) ? perm.read_paths : [],
    writePaths: Array.isArray(perm.write_paths) ? perm.write_paths : []
  };
}
async function resolvePermissions(vault, agentId) {
  const fileName = `sanctum-agents/${agentId}.md`;
  let content;
  try {
    content = await vault.read(fileName);
  } catch {
    throw new AgentNotFoundError(agentId);
  }
  const fm = parseFrontmatterFromMd(content);
  const perms = extractPermissions(fm);
  log.debug("permisos resueltos", { agentId, readPaths: perms.readPaths });
  return perms;
}
function checkPathPermission(filePath, permissions) {
  return pathMatchesAny(filePath, permissions.readPaths);
}

// mcp-server/src/tools/get-note.ts
function createGetNoteTool(vault) {
  return {
    name: "sanctum_get_note",
    description: "Lee una nota del vault por su path relativo. Valida que el agente tenga permisos (read_paths) sobre la ruta antes de leer el archivo. Si el path no est\xE1 cubierto por los read_paths del agente, devuelve PERMISSION_DENIED sin tocar el filesystem.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "ID del agente (ej. forager, researcher, critic). Sus read_paths determinan si la lectura est\xE1 autorizada."
        },
        path: {
          type: "string",
          description: "Ruta relativa de la nota dentro del vault (ej. Research/nota.md o sanctum-agents/forager.md)."
        }
      },
      required: ["agent_id", "path"]
    },
    async handler(args) {
      const agentId = String(args.agent_id ?? "").trim();
      if (!agentId) throw new Error("'agent_id' es obligatorio");
      const notePath = String(args.path ?? "").trim();
      if (!notePath) throw new Error("'path' es obligatorio");
      const perms = await resolvePermissions(vault, agentId);
      if (!checkPathPermission(notePath, perms)) {
        log.warn("permission denied", { agentId, notePath, readPaths: perms.readPaths });
        return {
          content: [
            {
              type: "text",
              text: `Error: PERMISSION_DENIED - El agente '${agentId}' no tiene read_paths que cubran '${notePath}'. read_paths del agente: ${JSON.stringify(perms.readPaths)}`
            }
          ],
          isError: true
        };
      }
      let content;
      try {
        content = await vault.read(notePath);
      } catch {
        return {
          content: [{ type: "text", text: `Error: FILE_NOT_FOUND - No se encontr\xF3 la nota '${notePath}' en el vault` }],
          isError: true
        };
      }
      log.info("sanctum_get_note", { agentId, notePath });
      return {
        content: [{ type: "text", text: `# ${notePath}

${content}` }]
      };
    }
  };
}

// mcp-server/src/embeddings/gemini-embed.ts
var GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
var PRIORITY_MODELS = ["gemini-embedding-2", "gemini-embedding-001"];
var OUTPUT_DIMS = 768;
var MAX_TEXT_LENGTH = 3e3;
async function callEmbed(key, model, text) {
  const url = `${GEMINI_BASE}/${model}:embedContent?key=${key}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      outputDimensionality: OUTPUT_DIMS
    })
  });
  if (!response.ok) {
    const err = new Error(`Gemini API error [${response.status}] modelo "${model}"`);
    err.status = response.status;
    throw err;
  }
  const data = await response.json();
  if (!data.embedding?.values) {
    throw new Error(`Respuesta inesperada de Gemini API: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data.embedding.values;
}
async function embedText(text, apiKey) {
  const truncated = text.slice(0, MAX_TEXT_LENGTH);
  let lastError = null;
  for (const model of PRIORITY_MODELS) {
    try {
      const result = await callEmbed(apiKey, model, truncated);
      log.debug("gemini embed ok", { model, dims: result.length });
      return result;
    } catch (err) {
      const status = err?.status;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (status === 404 || status === 400) {
        log.warn("gemini model no disponible, saltando", { model, status });
        continue;
      }
      throw lastError;
    }
  }
  throw lastError ?? new Error("Todos los modelos de Gemini fallaron");
}

// mcp-server/src/tools/query-vault.ts
var MIN_SIMILARITY = 0.65;
function createQueryVaultTool(vault, store, geminiApiKey) {
  return {
    name: "sanctum_query_vault",
    description: "Busca fragmentos relevantes en el vault usando RAG. Recibe una query, la convierte a embedding con Gemini, y devuelve los chunks m\xE1s similares del vault filtrados por los read_paths del agente. Si el vault no ha sido indexado, devuelve VAULT_NOT_INDEXED.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "ID del agente cuyo read_paths se usa para filtrar los resultados del RAG."
        },
        query: {
          type: "string",
          description: "Texto o pregunta a buscar en el vault. Se convierte a embedding sem\xE1ntico."
        },
        max_results: {
          type: "number",
          description: "M\xE1ximo de resultados a devolver (default 5)."
        }
      },
      required: ["agent_id", "query"]
    },
    async handler(args) {
      const agentId = String(args.agent_id ?? "").trim();
      if (!agentId) throw new Error("'agent_id' es obligatorio");
      const query = String(args.query ?? "").trim();
      if (!query) throw new Error("'query' es obligatorio");
      const limit = typeof args.max_results === "number" && args.max_results > 0 ? Math.min(args.max_results, 20) : 5;
      if (store.count === 0) {
        log.warn("vault not indexed", { agentId });
        return {
          content: [{ type: "text", text: "Error: VAULT_NOT_INDEXED - El vault no tiene fragmentos indexados. Ejecut\xE1 primero el indexador (Research/ u otra carpeta) desde Obsidian antes de consultar por MCP." }],
          isError: true
        };
      }
      if (!geminiApiKey) {
        log.warn("gemini key no configurada", { agentId });
        return {
          content: [{ type: "text", text: "Error: GEMINI_NOT_CONFIGURED - No hay GEMINI_API_KEYS configuradas en el entorno. Se requiere una key de Gemini para generar embeddings." }],
          isError: true
        };
      }
      const perms = await resolvePermissions(vault, agentId);
      const embedding = await embedText(query, geminiApiKey);
      const rawResults = store.search(embedding, limit);
      const filtered = rawResults.filter((r) => r.score >= MIN_SIMILARITY);
      const permitted = store.filterByPaths(filtered, perms.readPaths);
      log.info("sanctum_query_vault", {
        agentId,
        query: query.slice(0, 80),
        raw: rawResults.length,
        filtered: filtered.length,
        permitted: permitted.length
      });
      if (permitted.length === 0) {
        return {
          content: [{ type: "text", text: `Sin resultados relevantes para "${query}" en los paths permitidos para '${agentId}' read_paths: ${JSON.stringify(perms.readPaths)}.` }]
        };
      }
      const text = permitted.map((r, i) => {
        const note = r.chunk.note_path;
        const excerpt = r.chunk.chunk_text.slice(0, 400).trim();
        return `### ${i + 1}. ${note}  (similitud: ${(r.score * 100).toFixed(0)}%)

${excerpt}${r.chunk.chunk_text.length > 400 ? "..." : ""}`;
      }).join("\n\n---\n\n");
      return {
        content: [{ type: "text", text }]
      };
    }
  };
}

// src/constants.ts
var AGENTS_DIR = "sanctum-agents";
var DEFAULT_MODEL = "deepseek-v4-flash";

// src/agents/agent-loader.ts
function parseAgentMd(content) {
  const parts = content.split("---");
  if (parts.length < 3) {
    throw new Error("Formato inv\xE1lido: el archivo debe tener frontmatter --- separado");
  }
  const frontmatterRaw = parts[1].trim();
  const bodyRaw = parts.slice(2).join("---").trim();
  const frontmatter = parseFrontmatter(frontmatterRaw);
  const permissionsRaw = frontmatter.permissions && typeof frontmatter.permissions === "object" ? frontmatter.permissions : {};
  return {
    id: frontmatter.id || "unknown",
    name: frontmatter.name || "Sin nombre",
    avatar: frontmatter.avatar || "\u{1F916}",
    model: frontmatter.model || DEFAULT_MODEL,
    description: frontmatter.description || "",
    triggers: frontmatter.triggers || [],
    tools: frontmatter.tools || [],
    permissions: {
      read_paths: permissionsRaw.read_paths || frontmatter.read_paths || [],
      write_paths: permissionsRaw.write_paths || frontmatter.write_paths || []
    },
    system_prompt: bodyRaw,
    internal: frontmatter.internal === true || void 0
  };
}
async function loadAgentFromVault(vaultAdapter, fileName = "agente_base.md") {
  const path3 = `${AGENTS_DIR}/${fileName}`;
  try {
    const content = await vaultAdapter.read(path3);
    return parseAgentMd(content);
  } catch (err) {
    throw new Error(`No se pudo leer ${path3}: ${err.message}`);
  }
}
function renderSystemPrompt(agent, ragContext, userPrompt) {
  return agent.system_prompt.replace(/\{\{rag_context\}\}/g, ragContext).replace(/\{\{user_prompt\}\}/g, userPrompt);
}

// mcp-server/src/llm/opencode-chat.ts
var MODEL = "deepseek-v4-flash";
async function opencodeChat(systemPrompt, userPrompt, baseUrl, apiKey) {
  if (!apiKey) {
    throw new Error("OPENCODE_GO_API_KEY no configurada");
  }
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  };
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "sin cuerpo");
    throw new Error(`OpenCode API error [${response.status}] \u2014 ${text.slice(0, 300)}`);
  }
  const data = await response.json();
  if (!data.choices?.[0]?.message) {
    throw new Error(`Respuesta sin choices: ${JSON.stringify(data).slice(0, 200)}`);
  }
  const content = data.choices[0].message.content ?? "";
  log.debug("opencode chat ok", {
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens
  });
  return {
    content,
    usage: {
      prompt: data.usage?.prompt_tokens ?? 0,
      completion: data.usage?.completion_tokens ?? 0
    }
  };
}

// mcp-server/src/tools/invoke-agent.ts
function createInvokeAgentTool(vault, opencodeBaseUrl, opencodeApiKey, tracer) {
  return {
    name: "sanctum_invoke_agent",
    description: "Invoca un agente puntual (no el mesh completo) con un prompt. Carga la definici\xF3n del agente desde sanctum-agents/, resuelve sus permisos, renderiza el system prompt con el cuerpo del agente, y llama al modelo de lenguaje configurado (deepseek-v4-flash). Devuelve el output crudo del agente + trace_id para correlaci\xF3n.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "ID del agente a invocar (ej. forager, researcher, critic, o un agente custom)."
        },
        prompt: {
          type: "string",
          description: "Prompt del usuario. Se inyecta como {{user_prompt}} en el system prompt del agente."
        }
      },
      required: ["agent_id", "prompt"]
    },
    async handler(args) {
      const agentId = String(args.agent_id ?? "").trim();
      if (!agentId) throw new Error("'agent_id' es obligatorio");
      const prompt = String(args.prompt ?? "").trim();
      if (!prompt) throw new Error("'prompt' es obligatorio");
      if (!opencodeApiKey) {
        return {
          content: [{ type: "text", text: "Error: LLM_NOT_CONFIGURED - OPENCODE_GO_API_KEY no est\xE1 configurada. Configurala en el entorno (mcp.json) para invocar agentes." }],
          isError: true
        };
      }
      const startTime = Date.now();
      await resolvePermissions(vault, agentId);
      const agent = await loadAgentFromVault(vault, `${agentId}.md`);
      const systemPrompt = renderSystemPrompt(agent, "", prompt);
      const result = await opencodeChat(systemPrompt, prompt, opencodeBaseUrl, opencodeApiKey);
      const traceId = await tracer.writeTrace({
        type: "agent_invocation",
        agent_id: agentId,
        input: { system_prompt: systemPrompt, user_prompt: prompt },
        output: result.content,
        duration_ms: Date.now() - startTime
      });
      log.info("sanctum_invoke_agent", { agentId, traceId, promptLen: prompt.length, outputLen: result.content.length });
      return {
        content: [
          {
            type: "text",
            text: `## Output de @${agent.name} (${agentId})
\`\`\`trace_id: ${traceId}\`\`\`

${result.content}`
          }
        ]
      };
    }
  };
}

// src/shared/mesh/parse.ts
function parseCriticJSON(raw) {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON found");
    const jsonStr = raw.substring(start, end + 1);
    const parsed = JSON.parse(jsonStr);
    const ev = parsed.evaluation || parsed;
    const criteria = [];
    if (Array.isArray(ev.criteria)) {
      for (const c of ev.criteria) {
        criteria.push({
          name: String(c.name ?? ""),
          score: typeof c.score === "number" ? c.score : 0,
          note: String(c.note ?? "")
        });
      }
    }
    const totalScore = ev.total_score ?? 80;
    const threshold2 = ev.threshold ?? 80;
    const verdict = ev.verdict === "reject" ? "reject" : "accept";
    const feedback = Array.isArray(ev.feedback_for_regeneration) ? ev.feedback_for_regeneration : [];
    if (criteria.length === 0) {
      for (const name of ["coherencia_interna", "uso_de_fuentes", "completitud_vs_prompt", "actualidad_de_datos", "claridad_de_escritura"]) {
        const score = ev[name];
        if (typeof score === "number") {
          criteria.push({ name, score, note: "" });
        }
      }
    }
    return { criteria, total_score: totalScore, threshold: threshold2, verdict, feedback_for_regeneration: feedback };
  } catch (err) {
    console.warn("Sanctum: fallo parseo de Critic JSON", err.message);
    return {
      criteria: [],
      total_score: 0,
      threshold: 80,
      verdict: "reject",
      feedback_for_regeneration: ["Error al parsear respuesta del Critic \u2014 se fuerza regeneraci\xF3n"]
    };
  }
}

// src/shared/mesh/core.ts
function buildCriticInput(originalPrompt, researcherOutput) {
  return `Prompt original del usuario:
${originalPrompt}

Output del Researcher a evaluar:
${researcherOutput}`;
}

// mcp-server/src/tools/run-mesh.ts
var MAX_ATTEMPTS = 3;
var DEFAULT_THRESHOLD = 80;
var ESCALATE_THRESHOLD = 40;
function buildResearcherInput(foragerOutput, feedbackList) {
  if (feedbackList.length === 0) return foragerOutput;
  return `${foragerOutput}

---
Feedback del Critic para regeneraci\xF3n:
${feedbackList.map((f) => `- ${f}`).join("\n")}

Por favor, regenera tu respuesta teniendo en cuenta todo el feedback acumulado. Especialmente mejora los criterios con puntuaci\xF3n m\xE1s baja.`;
}
function createRunMeshTool(vault, opencodeBaseUrl, opencodeApiKey, tracer) {
  return {
    name: "sanctum_run_mesh",
    description: "Dispara el loop completo Forager \u2192 Researcher \u2192 Critic. Forager reformula el prompt y re\xFAne contexto; Researcher produce la investigaci\xF3n; Critic eval\xFAa con score 0-100 y decide aceptar o regenerar (m\xE1x. 3 intentos). Devuelve el resultado final o escalado.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Prompt del usuario para investigar. Ej: 'Investig\xE1 el impacto de X en Y'"
        },
        threshold: {
          type: "number",
          description: "Score m\xEDnimo para aceptar (0-100, default 80). Por debajo se regenera o escala."
        }
      },
      required: ["prompt"]
    },
    async handler(args) {
      const prompt = String(args.prompt ?? "").trim();
      if (!prompt) throw new Error("'prompt' es obligatorio");
      const threshold2 = typeof args.threshold === "number" ? args.threshold : DEFAULT_THRESHOLD;
      if (!opencodeApiKey) {
        return {
          content: [{ type: "text", text: "Error: LLM_NOT_CONFIGURED - OPENCODE_GO_API_KEY no est\xE1 configurada." }],
          isError: true
        };
      }
      const meshTimeoutMs = parseInt(process.env.SANCTUM_MESH_TIMEOUT_MS ?? "120000", 10);
      const result = await Promise.race([
        runMesh(prompt, threshold2, vault, opencodeBaseUrl, opencodeApiKey, tracer),
        new Promise(
          (_, reject) => setTimeout(() => reject(new Error(`MESH_TIMEOUT - El mesh super\xF3 el l\xEDmite de ${meshTimeoutMs}ms`)), meshTimeoutMs)
        )
      ]);
      log.info("sanctum_run_mesh", { traceId: result.trace_id });
      return {
        content: [{ type: "text", text: formatMeshResult(result) }]
      };
    }
  };
}
async function runMesh(prompt, threshold2, vault, baseUrl, apiKey, tracer) {
  const startTime = Date.now();
  const forager = await loadAgentFromVault(vault, "forager.md");
  const researcher = await loadAgentFromVault(vault, "researcher.md");
  const critic = await loadAgentFromVault(vault, "critic.md");
  const foragerBody = renderSystemPrompt(forager, "", prompt);
  const foragerResult = await opencodeChat(foragerBody, prompt, baseUrl, apiKey);
  let bestOutput = "";
  let bestScore = 0;
  let lastFeedback = [];
  const attemptHistory = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const researcherInput = buildResearcherInput(foragerResult.content, attempt > 1 ? lastFeedback : []);
    const researcherBody = renderSystemPrompt(researcher, "", researcherInput);
    const researcherResult = await opencodeChat(researcherBody, researcherInput, baseUrl, apiKey);
    const output = researcherResult.content;
    bestOutput = output;
    const criticInput = buildCriticInput(prompt, output);
    const criticBody = renderSystemPrompt(critic, "", criticInput);
    const criticResult = await opencodeChat(criticBody, criticInput, baseUrl, apiKey);
    const evaluation = parseCriticJSON(criticResult.content);
    const score = evaluation.total_score;
    const feedback = evaluation.feedback_for_regeneration;
    attemptHistory.push({ attempt, score });
    let status;
    let reason;
    if (score >= threshold2) {
      status = "accepted";
    } else if (score <= ESCALATE_THRESHOLD) {
      status = "escalated";
      reason = feedback.length > 0 ? feedback : [`Score ${score} est\xE1 por debajo del umbral de escalate (${ESCALATE_THRESHOLD})`];
    } else if (attempt >= MAX_ATTEMPTS) {
      status = "accepted";
    } else if (attempt > 1 && score <= bestScore) {
      status = "accepted";
    } else {
      if (score > bestScore) {
        bestScore = score;
        bestOutput = output;
      }
      lastFeedback = feedback;
      continue;
    }
    const traceId2 = await tracer.writeTrace({
      type: "mesh_run",
      agent_id: "orchestrator",
      input: { system_prompt: foragerBody, user_prompt: prompt },
      output: bestOutput,
      duration_ms: Date.now() - startTime,
      metadata: {
        status,
        final_score: score,
        attempts: attempt,
        attempt_history: attemptHistory,
        feedback: reason
      }
    });
    return { status, output: bestOutput, final_score: score, attempts: attempt, rejection_reason: reason, trace_id: traceId2 };
  }
  const traceId = await tracer.writeTrace({
    type: "mesh_run",
    agent_id: "orchestrator",
    input: { user_prompt: prompt },
    output: bestOutput,
    duration_ms: Date.now() - startTime,
    metadata: { status: "accepted", final_score: bestScore, attempts: MAX_ATTEMPTS }
  });
  return { status: "accepted", output: bestOutput, final_score: bestScore, attempts: MAX_ATTEMPTS, trace_id: traceId };
}
function formatMeshResult(r) {
  const lines = [];
  lines.push(`## Mesh ${r.status === "accepted" ? "\u2705 Aceptado" : "\u26A0\uFE0F Escalado"}`);
  lines.push(`\`\`\`trace_id: ${r.trace_id}\`\`\``);
  lines.push(`- **Score final:** ${r.final_score}/100`);
  lines.push(`- **Intentos:** ${r.attempts}`);
  if (r.rejection_reason?.length) {
    lines.push(`- **Motivo de escalaci\xF3n:**`);
    for (const reason of r.rejection_reason) lines.push(`  - ${reason}`);
  }
  lines.push(``);
  lines.push(`### Output
${r.output}`);
  return lines.join("\n");
}

// mcp-server/src/observability/trace-writer.ts
var TRACES_DIR = "sanctum-logs/traces";
function generateTraceId() {
  const now = /* @__PURE__ */ new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const rand = Math.random().toString(36).slice(2, 6);
  return `trace_${ts}_${rand}`;
}
var TraceWriter = class {
  constructor(vault) {
    this.vault = vault;
  }
  async writeTrace(record) {
    const trace = {
      ...record,
      trace_id: generateTraceId(),
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      origin: "mcp"
    };
    const fileName = `${TRACES_DIR}/${trace.trace_id}.json`;
    try {
      await this.vault.write(fileName, JSON.stringify(trace, null, 2));
      log.debug("trace escrito", { traceId: trace.trace_id, type: record.type });
    } catch (err) {
      log.error("fallo al escribir trace", { traceId: trace.trace_id, error: String(err) });
    }
    return trace.trace_id;
  }
};

// mcp-server/index.ts
async function main() {
  const vaultRoot = process.env.SANCTUM_VAULT_PATH ?? import_node_path2.default.resolve(process.cwd(), "notes");
  log.info("iniciando sanctum mcp", { vaultRoot });
  const vault = new FsVaultAdapter(vaultRoot);
  const server = new McpServer({ name: "sanctum-mcp", version: "0.1.0" });
  server.registerTool(createListAgentsTool(vault));
  server.registerTool(createGetNoteTool(vault));
  const geminiApiKey = process.env.GEMINI_API_KEYS?.split(",")[0]?.trim();
  const vectorStore = new VectorStore();
  await vectorStore.load(vault);
  log.info("vector store cargado", { chunks: vectorStore.count, hasKey: !!geminiApiKey });
  server.registerTool(createQueryVaultTool(vault, vectorStore, geminiApiKey));
  const opencodeBaseUrl = process.env.OPENCODE_GO_BASE_URL ?? "https://api.opencode.ai/v1";
  const opencodeApiKey = (process.env.OPENCODE_GO_API_KEY ?? "").trim();
  const tracer = new TraceWriter(vault);
  log.info("opencode config", { hasKey: !!opencodeApiKey, baseUrl: opencodeBaseUrl });
  server.registerTool(createInvokeAgentTool(vault, opencodeBaseUrl, opencodeApiKey, tracer));
  server.registerTool(createRunMeshTool(vault, opencodeBaseUrl, opencodeApiKey, tracer));
  server.start();
}
main().catch((err) => {
  log.error("error fatal en main", { error: String(err) });
  process.exit(1);
});
