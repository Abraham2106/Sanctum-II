import { ItemView, WorkspaceLeaf, Notice, setIcon } from "obsidian";
import { InputModal } from "./input-modal";
import type { Chain, ChainNode } from "../chains/types";
import { ChainStore } from "../chains/store";
import { topologicalOrder } from "../chains/executor";
import { loadAgentFromVault } from "../agents/agent-loader";
import type { TurnDeps } from "../orchestrator/agent-turn";
import type { VaultAdapter } from "../core/vault-adapter";
import { AGENT_TYPES } from "./chain-types";
import type { ExecutionResult } from "./chain-types";
import { ChainCanvas } from "./chain-canvas";
import { ResultModal } from "./chain-result";

export const VIEW_TYPE_CHAINS = "sanctum-chains";

export class ChainView extends ItemView {
  private results = new Map<string, ExecutionResult>();
  private currentChainId: string | null = null;

  private chainNameEl!: HTMLInputElement;
  private canvas!: ChainCanvas;

  private store: ChainStore;
  private vaultAdapter: VaultAdapter;
  private getTurnDeps: () => TurnDeps;

  constructor(
    leaf: WorkspaceLeaf,
    deps: { chainStore: ChainStore; vaultAdapter: VaultAdapter; getTurnDeps: () => TurnDeps },
  ) {
    super(leaf);
    this.store = deps.chainStore;
    this.vaultAdapter = deps.vaultAdapter;
    this.getTurnDeps = deps.getTurnDeps;
  }
  getViewType(): string {
    return VIEW_TYPE_CHAINS;
  }
  getDisplayText(): string {
    return "Orquestador";
  }
  getIcon(): string {
    return "git-branch";
  }

  async onOpen(): Promise<void> {
    this.canvas = new ChainCanvas({ onAutoSave: () => this.autoSave() });

    const c = this.containerEl.children[1] as HTMLElement;
    c.empty();
    c.addClass("sanctum-root");
    c.addClass("sanctum-chain-view");
    c.style.height = "100%";
    c.style.display = "flex";
    c.style.flexDirection = "column";
    c.style.background = "var(--canvas)";

    const tb = c.createDiv({ cls: "och-topbar" });
    const brandTile = tb.createSpan({ cls: "och-brand-tile" });
    setIcon(brandTile, "git-branch");
    const nameWrap = tb.createDiv({ attr: { style: "flex:1;min-width:0" } });
    this.chainNameEl = nameWrap.createEl("input", { cls: "och-topbar-input" });
    this.chainNameEl.value = "Mesh sin nombre";
    nameWrap.createDiv({
      text: "Orquestador de agentes",
      attr: { style: "font-size:10px;color:var(--text-3)" },
    });

    const mkBtn = (lucide: string, label: string, fn: () => void, extraCls?: string) => {
      const cls = "s-action-btn";
      const b = tb.createEl("button", { cls: extraCls ? `${cls} ${extraCls}` : cls });
      if (lucide) {
        const ic = b.createSpan({ attr: { style: "display:flex;font-size:14px" } });
        setIcon(ic, lucide);
      }
      if (label) b.createSpan({ text: " " + label });
      const accessibleLabel =
        label ||
        (lucide === "trash-2"
          ? "Limpiar canvas"
          : lucide === "save"
            ? "Guardar mesh"
            : lucide);
      b.title = accessibleLabel;
      b.setAttribute("aria-label", accessibleLabel);
      b.onclick = fn;
    };
    mkBtn("folder-open", "Abrir", () => this.showChainMenu());
    mkBtn("shuffle", "Auto", () => this.canvas.autoArrange());
    mkBtn("trash-2", "", () => this.clear());
    mkBtn("save", "", () => this.saveChain());
    mkBtn("play", "Ejecutar", () => this.runChain(), "primary");

    const body = c.createDiv({ attr: { style: "flex:1;display:flex;overflow:hidden" } });

    const side = body.createDiv({ cls: "och-palette" });
    side.createDiv({ cls: "och-palette-label", text: "AGENTES" });
    for (const a of AGENT_TYPES) {
      const it = side.createDiv({ cls: "s-rail-item" });
      const avatar = it.createSpan({
        attr: {
          style: `width:30px;height:30px;border-radius:8px;background:${a.color}33;display:flex;align-items:center;justify-content:center;flex-shrink:0`,
        },
      });
      avatar.style.color = a.color;
      setIcon(avatar, a.lucide);
      const m = it.createDiv({ cls: "s-rail-info" });
      m.createDiv({ text: a.name, attr: { style: "font-weight:600;font-size:11px" } });
      m.createDiv({ text: `@${a.id}`, attr: { style: "font-size:9px;color:var(--text-3)" } });
      it.draggable = true;
      it.ondragstart = (e) => e.dataTransfer!.setData("agentId", a.id);
      it.onclick = () => {
        const r = this.canvas.canvasWrap.getBoundingClientRect();
        const center = this.canvas.clientToCanvas(r.left + r.width / 2, r.top + r.height / 2);
        this.canvas.addNode(
          a.id,
          center.x + (Math.random() * 80 - 40),
          center.y + (Math.random() * 80 - 40),
        );
      };
    }

    const help = side.createEl("details", { cls: "och-help" });
    help.createEl("summary", { text: "Cómo encadenar" });
    const helpBox = help.createDiv({ cls: "och-help-text" });
    const addHelpLine = (text: string) => {
      const d = helpBox.createDiv();
      d.innerHTML = text;
    };
    addHelpLine(
      "• Arrastra desde el punto <b>derecho</b> ● de una burbuja hacia otra para conectarlas.",
    );
    addHelpLine("• Arrastra la burbuja para moverla.");
    addHelpLine("• Pasa el cursor y toca <b>✕</b> para eliminar.");
    addHelpLine("• Haz clic en una conexión para borrarla.");

    this.canvas.mount(body);

    this.loadChainList();
  }

  private async runChain(): Promise<void> {
    const { nodes, edges, nodeEls } = this.canvas;
    if (!nodes.length) {
      new Notice("Agregá agentes primero");
      return;
    }
    const order = topologicalOrder(nodes, edges);
    const modal = new InputModal(this.app, "Ejecutar cadena", "Prompt de entrada", "Investigá sobre QML");
    const input = await modal.ask();
    if (!input) return;
    this.results.clear();
    new Notice(`Ejecutando ${order.length} paso(s)…`, 0);

    order.forEach((nid, i) => {
      const e = nodeEls.get(nid);
      if (!e) return;
      const b = e.querySelector(".och-badge") as HTMLElement;
      if (b) {
        b.textContent = String(i + 1);
        b.style.display = "flex";
      }
    });

    const baseDeps = this.getTurnDeps();
    let scratchpad = "";
    let hasError = false;

    const criticAttempts = new Map<string, number>();
    const MAX_ATTEMPTS = 3;

    for (let i = 0; i < order.length; i++) {
      const nid = order[i],
        node = nodes.find((x) => x.id === nid);
      if (!node) continue;

      const predecessors = edges.filter((e) => e.to === nid).map((e) => e.from);
      const isCritic = node.agentId === "critic";

      if (isCritic && predecessors.length > 0) {
        let accepted = false;
        let attempt = 0;
        const predId = predecessors[0];

        while (!accepted && attempt < MAX_ATTEMPTS) {
          attempt++;

          const critRes = await this.executeNode(nid, node, input, scratchpad, baseDeps, attempt, MAX_ATTEMPTS);
          if (!critRes) {
            hasError = true;
            break;
          }

          let verdict = "accept";
          let score = 80;
          try {
            const start = critRes.indexOf("{"),
              end = critRes.lastIndexOf("}");
            if (start >= 0 && end >= 0) {
              const json = JSON.parse(critRes.substring(start, end + 1));
              const ev = json.evaluation || json;
              verdict = ev.verdict || "accept";
              score = ev.total_score ?? 80;
            }
          } catch {}

          criticAttempts.set(nid, attempt);
          this.results.set(nid, { nodeId: nid, agentId: node.agentId, output: critRes, status: "ok" });
          scratchpad += `\n\n=== Critic intento ${attempt}/${MAX_ATTEMPTS}: Score ${score}/100 (${verdict}) ===\n${critRes.slice(0, 1500)}`;

          const el = nodeEls.get(nid);
          if (el) {
            const badge = el.querySelector(".och-badge") as HTMLElement;
            if (badge) {
              badge.textContent = `R${attempt}`;
              badge.style.background = verdict === "accept" ? "var(--green)" : "var(--orange)";
            }
          }

          if (score >= 80 || verdict === "accept") {
            accepted = true;
          } else if (attempt < MAX_ATTEMPTS) {
            const predNode = nodes.find((x) => x.id === predId);
            if (predNode) {
              const feedback = this.extractFeedback(critRes);
              scratchpad += `\n-- Feedback del Critic: ${feedback.slice(0, 200)}`;
              const predRes = await this.executeNode(
                predId,
                predNode,
                input,
                scratchpad,
                baseDeps,
                attempt,
                MAX_ATTEMPTS,
              );
              if (predRes) {
                this.results.set(predId, {
                  nodeId: predId,
                  agentId: predNode.agentId,
                  output: predRes,
                  status: "ok",
                });
                scratchpad += `\n\n=== Regenerado (intento ${attempt}) ===\n${predRes.slice(0, 3000)}`;
                const predBadge = nodeEls.get(predId)?.querySelector(".och-badge") as HTMLElement;
                if (predBadge) predBadge.textContent = `R${attempt}`;
              }
            }
          }
        }
        if (!accepted) hasError = true;
        continue;
      }

      const result = await this.executeNode(nid, node, input, scratchpad, baseDeps, 1, MAX_ATTEMPTS);
      if (result) {
        this.results.set(nid, { nodeId: nid, agentId: node.agentId, output: result, status: "ok" });
        scratchpad += `\n\n=== Paso ${i + 1}: ${node.agentId} ===\n${result.slice(0, 3000)}`;
      } else {
        hasError = true;
        break;
      }
    }

    const lastId = order[order.length - 1];
    const lastResult = this.results.get(lastId);
    let displayOutput = lastResult?.output || "";
    let criticScore = "";
    const lastNode = nodes.find((n) => n.id === lastId);
    if (lastNode?.agentId === "critic" && lastResult?.output?.startsWith("{")) {
      for (let i = order.length - 2; i >= 0; i--) {
        const prevRes = this.results.get(order[i]);
        if (prevRes && prevRes.output) {
          displayOutput = prevRes.output;
          break;
        }
      }
      try {
        const json = JSON.parse(
          lastResult.output.substring(
            lastResult.output.indexOf("{"),
            lastResult.output.lastIndexOf("}") + 1,
          ),
        );
        const ev = json.evaluation || json;
        const total = ev.total_score ?? "?";
        const verdict = ev.verdict === "accept" ? "Aceptado" : "Revisión requerida";
        const feedback = ev.feedback_for_regeneration?.slice(0, 3) || [];
        const att = criticAttempts.get(lastId) || 1;
        criticScore = `${verdict} · Score del Critic: ${total}/100 (${ev.verdict || "?"}) — Intento ${att}/${MAX_ATTEMPTS}`;
        if (feedback.length) criticScore += "\nFeedback: " + feedback.join("; ");
      } catch {}
    }

    if (lastResult) {
      new ResultModal(this.app, displayOutput, order.length, hasError, criticScore).open();
    } else {
      new Notice("La cadena no produjo ningún resultado.", 5000);
    }
    new Notice(`Cadena completada (${order.length} pasos)${hasError ? " — con errores" : ""}`);
  }

  private async executeNode(
    nid: string,
    node: ChainNode,
    input: string,
    scratchpad: string,
    baseDeps: TurnDeps,
    attempt: number,
    maxAttempts: number,
  ): Promise<string | null> {
    const el = this.canvas.nodeEls.get(nid);
    let workAnim: Animation | null = null;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (el) {
      const b = el.querySelector(".och-bubble") as HTMLElement;
      b.style.borderColor = "var(--brand)";
      b.style.borderWidth = "3px";
      b.style.boxShadow = "0 0 20px rgba(124,108,240,0.5)";
      if (!reduceMotion)
        workAnim = b.animate(
          [
            { boxShadow: "0 0 10px rgba(124,108,240,0.4)", borderColor: "#8e7be6" },
            { boxShadow: "0 0 30px rgba(124,108,240,0.8)", borderColor: "#5e9fe8" },
            { boxShadow: "0 0 10px rgba(124,108,240,0.4)", borderColor: "#8e7be6" },
          ],
          { duration: 1200, iterations: Infinity, easing: "ease-in-out" },
        );
      const dot = el.querySelector(".och-result") as HTMLElement;
      if (dot) {
        dot.style.display = "flex";
        dot.style.background = "var(--brand)";
        dot.textContent = "…";
        if (!reduceMotion)
          dot.animate([{ opacity: 1 }, { opacity: 0.3 }, { opacity: 1 }], {
            duration: 800,
            iterations: Infinity,
          });
      }
    }

    try {
      const agent = await loadAgentFromVault(this.vaultAdapter, `${node.agentId}.md`);
      let enriched = input;
      if (scratchpad)
        enriched = `Prompt original del usuario:\n${input}\n\n--- Outputs anteriores de la cadena ---\n${scratchpad}\n\n---\nResponde a la pregunta del usuario usando el contexto de los pasos anteriores.`;
      const { executeTurn } = await import("../orchestrator/agent-turn");
      const result = await executeTurn({ ...baseDeps, agent }, enriched, false, []);

      if (el) {
        if (workAnim) workAnim.cancel();
        const b = el.querySelector(".och-bubble") as HTMLElement;
        b.style.borderColor = "var(--green)";
        b.style.borderWidth = "2px";
        b.style.boxShadow = "0 0 16px rgba(114,188,143,0.4)";
        if (!reduceMotion)
          b.animate(
            [
              { boxShadow: "0 0 0 0 rgba(114,188,143,0.6)" },
              { boxShadow: "0 0 12px 0 rgba(114,188,143,0)" },
            ],
            { duration: 700 },
          );
        const d = el.querySelector(".och-result") as HTMLElement;
        if (d) {
          d.style.display = "flex";
          d.style.background = "var(--green)";
          d.textContent = "✓";
          d.getAnimations().forEach((a) => a.cancel());
        }
      }
      return result.content;
    } catch (err: any) {
      if (el) {
        if (workAnim) workAnim.cancel();
        const b = el.querySelector(".och-bubble") as HTMLElement;
        b.style.borderColor = "var(--red)";
        b.style.borderWidth = "2px";
        b.style.boxShadow = "0 0 16px rgba(233,115,102,0.4)";
        if (!reduceMotion)
          b.animate(
            [
              { boxShadow: "0 0 0 0 rgba(233,115,102,0.6)" },
              { boxShadow: "0 0 12px 0 rgba(233,115,102,0)" },
            ],
            { duration: 400 },
          );
        const d = el.querySelector(".och-result") as HTMLElement;
        if (d) {
          d.style.display = "flex";
          d.style.background = "var(--red)";
          d.textContent = "✗";
          d.getAnimations().forEach((a) => a.cancel());
        }
      }
      return null;
    }
  }

  private extractFeedback(output: string): string {
    try {
      const s = output.indexOf("{"),
        e = output.lastIndexOf("}");
      if (s >= 0 && e >= 0) {
        const json = JSON.parse(output.substring(s, e + 1));
        const fb = json.evaluation?.feedback_for_regeneration || json.feedback_for_regeneration || [];
        return Array.isArray(fb) ? fb.join("; ") : String(fb);
      }
    } catch {}
    return output.slice(0, 500);
  }

  private autoSave(): void {
    if (!this.currentChainId) return;
    const { nodes, edges } = this.canvas;
    const chain: Chain = {
      id: this.currentChainId,
      name: this.chainNameEl.value,
      invocation: `@${this.currentChainId}`,
      description: `${nodes.length} agentes,${edges.length} conexiones`,
      projectId: "global",
      nodes: [...nodes],
      edges: [...edges],
      defaultForProject: false,
    };
    this.store.save(chain).catch(() => new Notice("Error al guardar. ¿Existe sanctum-chains/?", 5000));
  }

  private async saveChain(): Promise<void> {
    const { nodes, edges } = this.canvas;
    if (!nodes.length) {
      new Notice("Agregá agentes primero");
      return;
    }
    const name = this.chainNameEl.value.trim() || `Cadena ${Date.now()}`;
    if (!this.currentChainId) this.currentChainId = `cadena-${Date.now()}`;
    const chain: Chain = {
      id: this.currentChainId,
      name,
      invocation: `@${this.currentChainId}`,
      description: `${nodes.length} agentes,${edges.length} conexiones`,
      projectId: "global",
      nodes: [...nodes],
      edges: [...edges],
      defaultForProject: false,
    };
    await this.store.save(chain);
    new Notice(`💾 Cadena "${name}" guardada`);
  }

  private async loadChainList(): Promise<void> {
    const ids = await this.store.list();
    if (ids.length === 0) this.canvas.loadDemo();
  }

  private showChainMenu(): void {
    const menu = document.body.createDiv({ cls: "s-thread-menu" });
    menu.style.position = "fixed";
    menu.style.zIndex = "10000";
    this.store.list().then((ids) => {
      if (ids.length === 0)
        menu.createDiv({
          text: "No hay cadenas guardadas",
          attr: { style: "font-size:11px;color:var(--text-3);padding:6px 10px" },
        });
      for (const id of ids) {
        const row = menu.createDiv({ cls: "s-thread-menu-item" });
        this.store.load(id).then((c) => {
          if (!c) return;
          row.createSpan({
            text: `${c.name} (${c.nodes?.length || 0} pasos)`,
            attr: { style: "flex:1" },
          });
          row.onclick = () => {
            this.loadChain(c!);
            menu.remove();
          };
        });
      }
    });
    const { right: r, bottom: b } = this.chainNameEl.getBoundingClientRect();
    menu.style.top = b + 4 + "px";
    menu.style.right = window.innerWidth - r + "px";
    setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }), 0);
  }

  private loadChain(chain: Chain): void {
    this.clear();
    this.currentChainId = chain.id;
    this.chainNameEl.value = chain.name;
    this.canvas.replaceGraph(chain.nodes, chain.edges);
    new Notice(`Cadena "${chain.name}" cargada`);
  }

  private clear(): void {
    this.canvas.clearCanvas();
    this.results.clear();
  }
}
