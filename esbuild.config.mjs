import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

// ── Plugin de Obsidian (entry point existente) ──
const pluginCtx = await esbuild.context({
  banner: {
    js: `const __SANCTUM_DEV__ = ${!prod};`,
  },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "fs",
    "path",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/lang-markdown",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/markdown",
    "@lezer/lr",
  ],
  format: "cjs",
  target: "ES2021",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
});

// ── MCP Server (standalone Node process) ──
const mcpCtx = await esbuild.context({
  entryPoints: ["mcp-server/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "ES2021",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "mcp-server/dist/index.cjs",
});

if (prod) {
  await pluginCtx.rebuild();
  await mcpCtx.rebuild();
  process.exit(0);
} else {
  // Watchers corren en paralelo
  await Promise.all([pluginCtx.watch(), mcpCtx.watch()]);
}
