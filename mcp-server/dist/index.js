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
var FsVaultAdapter = class {
  constructor(root) {
    this.root = root;
  }
  resolve(p) {
    return import_node_path.default.resolve(this.root, p);
  }
  async read(p) {
    return import_node_fs.promises.readFile(this.resolve(p), "utf8");
  }
  async write(p, data) {
    const full = this.resolve(p);
    await import_node_fs.promises.mkdir(import_node_path.default.dirname(full), { recursive: true });
    await import_node_fs.promises.writeFile(full, data, "utf8");
  }
  async list(p) {
    const full = this.resolve(p);
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
      await import_node_fs.promises.access(this.resolve(p));
      return true;
    } catch {
      return false;
    }
  }
  async append(p, data) {
    const full = this.resolve(p);
    await import_node_fs.promises.mkdir(import_node_path.default.dirname(full), { recursive: true });
    await import_node_fs.promises.appendFile(full, data, "utf8");
  }
};

// mcp-server/src/tools/list-agents.ts
function parseAgentFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const result = {};
  for (const line of yaml.split("\n")) {
    const kv = line.match(/^\s*(\w+)\s*:\s*(.+)\s*$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value === "true") value = true;
    else if (value === "false") value = false;
    else if (/^\d+$/.test(String(value))) value = Number(value);
    else if (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    result[kv[1]] = value;
  }
  return result;
}
function loadAgents(vault2) {
  return vault2.list("sanctum-agents").then(async ({ files }) => {
    const mdFiles = files.filter((f) => f.toLowerCase().endsWith(".md"));
    const agents = [];
    for (const f of mdFiles) {
      try {
        const content = await vault2.read(f);
        const fm = parseAgentFrontmatter(content);
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
function createListAgentsTool(vault2) {
  return {
    name: "sanctum_list_agents",
    description: "Lista todos los agentes disponibles en el vault (fijos del sistema + custom del usuario). Devuelve metadata de cada agente: id, name, avatar, description y si es fijo o custom.",
    inputSchema: {
      type: "object",
      properties: {}
    },
    async handler() {
      const agents = await loadAgents(vault2);
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

// mcp-server/index.ts
var vaultRoot = process.env.SANCTUM_VAULT_PATH ?? import_node_path2.default.resolve(process.cwd(), "notes");
log.info("iniciando sanctum mcp", { vaultRoot });
var vault = new FsVaultAdapter(vaultRoot);
var server = new McpServer({ name: "sanctum-mcp", version: "0.1.0" });
server.registerTool(createListAgentsTool(vault));
server.start();
