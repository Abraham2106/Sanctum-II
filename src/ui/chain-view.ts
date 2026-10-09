import { ItemView, WorkspaceLeaf, Notice, setIcon } from "obsidian";
import { InputModal } from "./input-modal";
import type { Chain } from "../chains/types";
import { ChainStore } from "../chains/store";
import { DagValidationError, topologicalOrder } from "../chains/executor";
import type { TurnDeps } from "../orchestrator/agent-turn";
import type { VaultAdapter } from "../core/vault-adapter";
import type { IndexGenerationSnapshot } from "../projects/index-generations";
import { ChainCanvas } from "./chain-canvas";
import { ChainResultModal } from "./chain-result-modal";
import { runChainForView } from "./chain-run";
import { chainExecutionPathFilter } from "./chain-path-filter";
import { classifyIndexUiState, indexUiStatusHint, indexUiStatusLabel } from "./projects/index-state";

export const VIEW_TYPE_CHAINS = "sanctum-chains";

export interface ChainViewRuntime {
  beginMeshRequest?: () => AbortSignal;
  cancelMeshRequest?: () => void;
  getActiveFolder?: () => string | null;
  getIndexSnapshot?: () => IndexGenerationSnapshot | null;
}

export class ChainView extends ItemView {
  private currentChainId: string | null = null;
  private chainNameEl!: HTMLInputElement;
  private statusBannerEl!: HTMLElement;
  private canvas!: ChainCanvas;
  private running = false;

  private store: ChainStore;
  private vaultAdapter: VaultAdapter;
  private getTurnDeps: () => TurnDeps;
  private runtime: ChainViewRuntime;

  constructor(
    leaf: WorkspaceLeaf,
    deps: {
      chainStore: ChainStore;
      vaultAdapter: VaultAdapter;
      getTurnDeps: () => TurnDeps;
      runtime?: ChainViewRuntime;
    },
  ) {
    super(leaf);
    this.store = deps.chainStore;
    this.vaultAdapter = deps.vaultAdapter;
    this.getTurnDeps = deps.getTurnDeps;
    this.runtime = deps.runtime ?? {};
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
    nameWrap.createDiv({ text: "Orquestador de agentes", attr: { style: "font-size:10px;color:var(--text-3)" } });

    let cancelBtn: HTMLButtonElement | null = null;
    const mkBtn = (lucide: string, label: string, fn: () => void, extraCls?: string) => {
      const cls = "s-action-btn";
      const b = tb.createEl("button", { cls: extraCls ? `${cls} ${extraCls}` : cls });
      if (lucide) {
        const ic = b.createSpan({ attr: { style: "display:flex;font-size:14px" } });
        setIcon(ic, lucide);
      }
      if (label) b.createSpan({ text: " " + label });
      const accessibleLabel =
        label || (lucide === "trash-2" ? "Limpiar canvas" : lucide === "save" ? "Guardar mesh" : lucide);
      b.title = accessibleLabel;
      b.setAttribute("aria-label", accessibleLabel);
      b.onclick = fn;
      return b;
    };
    mkBtn("folder-open", "Abrir", () => this.showChainMenu());
    mkBtn("shuffle", "Auto", () => this.canvas.autoArrange());
    mkBtn("trash-2", "", () => {
      this.canvas.clear();
      this.autoSave();
    });
    mkBtn("save", "", () => this.saveChain());
    cancelBtn = mkBtn("square", "Cancelar", () => this.runtime.cancelMeshRequest?.(), "secondary");
    cancelBtn.style.display = "none";
    mkBtn("play", "Ejecutar", () => this.runChain(cancelBtn), "primary");

    this.statusBannerEl = c.createDiv({
      attr: { style: "display:none;padding:6px 12px;font-size:11px;border-bottom:1px solid var(--border)" },
    });
    this.refreshIndexBanner();

    const body = c.createDiv({ attr: { style: "flex:1;display:flex;overflow:hidden" } });
    const side = body.createDiv({ cls: "och-palette" });
    const canvasHost = body.createDiv({ attr: { style: "flex:1;min-width:0" } });
    this.canvas = new ChainCanvas({
      canvasWrap: canvasHost,
      onAutoSave: () => this.autoSave(),
    });
    this.canvas.mount(canvasHost);
    this.canvas.buildPalette(side);

    const help = side.createEl("details", { cls: "och-help" });
    help.createEl("summary", { text: "Cómo encadenar" });
    const helpBox = help.createDiv({ cls: "och-help-text" });
    const addHelpLine = (text: string) => {
      const d = helpBox.createDiv();
      d.innerHTML = text;
    };
    addHelpLine("• Arrastra desde el punto <b>derecho</b> ● de una burbuja hacia otra para conectarlas.");
    addHelpLine("• Arrastra la burbuja para moverla.");
    addHelpLine("• Pasa el cursor y toca <b>✕</b> para eliminar.");
    addHelpLine("• Haz clic en una conexión para borrarla.");

    await this.loadChainList();
  }

  private refreshIndexBanner(): void {
    const snap = this.runtime.getIndexSnapshot?.() ?? null;
    const uiState = classifyIndexUiState(snap);
    if (uiState === "ready" && !snap?.stale) {
      this.statusBannerEl.style.display = "none";
      return;
    }
    this.statusBannerEl.style.display = "block";
    const hint = indexUiStatusHint(uiState);
    this.statusBannerEl.setText(`${indexUiStatusLabel(uiState)}${hint ? ` — ${hint}` : ""}`);
    this.statusBannerEl.style.color =
      uiState === "rebuild_required" || uiState === "corrupt" ? "var(--orange)" : "var(--text-3)";
  }

  private async runChain(cancelBtn: HTMLButtonElement | null): Promise<void> {
    if (this.running) return;
    if (!this.canvas.nodes.length) {
      new Notice("Agregá agentes primero");
      return;
    }
    const modal = new InputModal(this.app, "Ejecutar cadena", "Prompt de entrada", "Investigá sobre QML");
    const input = await modal.ask();
    if (!input) return;

    this.running = true;
    if (cancelBtn) cancelBtn.style.display = "";
    this.canvas.results.clear();
    this.refreshIndexBanner();

    const chain = this.buildChainSnapshot();
    const pathFilter = chainExecutionPathFilter(this.runtime.getActiveFolder?.() ?? null);
    const signal = this.runtime.beginMeshRequest?.();
    const baseDeps = { ...this.getTurnDeps(), signal };

    let order: string[] = [];
    try {
      order = chain.nodes.map((n) => n.id);
      try {
        order = topologicalOrder(this.canvas.nodes, this.canvas.edges);
      } catch (err) {
        if (err instanceof DagValidationError) {
          new Notice(err.message, 8000);
          return;
        }
        throw err;
      }
      this.canvas.showOrderBadges(order);
      new Notice(`Ejecutando ${order.length} paso(s)…`, 0);

      for (let i = 0; i < order.length; i++) {
        this.canvas.setNodeRunning(order[i], i + 1);
      }

      const outcome = await runChainForView(chain, baseDeps, this.vaultAdapter, input, pathFilter, signal);

      for (const row of outcome.results) {
        this.canvas.results.set(row.nodeId, {
          nodeId: row.nodeId,
          agentId: row.agentId ?? "",
          output: row.output,
          status: "ok",
        });
        this.canvas.setNodeOutcome(row.nodeId, true);
      }
      for (const nid of order) {
        if (!outcome.results.some((r) => r.nodeId === nid)) {
          this.canvas.setNodeOutcome(nid, false);
        }
      }

      new ChainResultModal(this.app, outcome).open();
      const tail =
        outcome.status === "completed"
          ? ""
          : outcome.status === "cancelled"
            ? " — cancelada"
            : " — con errores";
      new Notice(`Cadena ${outcome.status} (${outcome.results.length}/${order.length} pasos)${tail}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Error en cadena: ${msg}`, 8000);
    } finally {
      this.running = false;
      if (cancelBtn) cancelBtn.style.display = "none";
    }
  }

  private buildChainSnapshot(): Chain {
    return {
      id: this.currentChainId || `cadena-${Date.now()}`,
      name: this.chainNameEl.value,
      invocation: `@${this.currentChainId || "mesh"}`,
      description: `${this.canvas.nodes.length} agentes,${this.canvas.edges.length} conexiones`,
      projectId: "global",
      nodes: [...this.canvas.nodes],
      edges: [...this.canvas.edges],
      defaultForProject: false,
    };
  }

  private autoSave(): void {
    if (!this.currentChainId) return;
    this.store.save(this.buildChainSnapshot()).catch(() => new Notice("Error al guardar. ¿Existe sanctum-chains/?", 5000));
  }

  private async saveChain(): Promise<void> {
    if (!this.canvas.nodes.length) {
      new Notice("Agregá agentes primero");
      return;
    }
    const name = this.chainNameEl.value.trim() || `Cadena ${Date.now()}`;
    if (!this.currentChainId) this.currentChainId = `cadena-${Date.now()}`;
    await this.store.save(this.buildChainSnapshot());
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
          row.createSpan({ text: `${c.name} (${c.nodes?.length || 0} pasos)`, attr: { style: "flex:1" } });
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
    this.canvas.clear();
    this.currentChainId = chain.id;
    this.chainNameEl.value = chain.name;
    this.canvas.loadFromChain(chain.nodes, chain.edges);
    new Notice(`Cadena "${chain.name}" cargada`);
  }
}
