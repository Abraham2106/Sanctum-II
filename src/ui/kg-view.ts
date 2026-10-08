import { ItemView, WorkspaceLeaf } from "obsidian";
import type { KgEdgeStore } from "../kg/kg-store";
import { KgScene, type KgSceneState } from "./kg-scene";
import { KgInspector } from "./kg-inspector";

export const VIEW_TYPE_KG = "sanctum-kg";

export interface KgViewDeps {
  edgeStore: KgEdgeStore;
  onSendToChat: (seed: string) => void;
}

type EdgeVisibilityKey = "showExplicit" | "showReinforced" | "showSemantic";

export class KgView extends ItemView {
  private state: KgSceneState;
  private scene!: KgScene;
  private inspector = new KgInspector();
  private statusEl!: HTMLElement;
  private searchInput!: HTMLInputElement;

  constructor(leaf: WorkspaceLeaf, private deps: KgViewDeps) {
    super(leaf);
    this.state = {
      edges: [],
      positions: new Map(),
      adjacency: new Map(),
      selected: null,
      mode: "force",
      showExplicit: true,
      showReinforced: true,
      showSemantic: true,
      scale: 1,
      tx: 0,
      ty: 0,
      dragging: false,
      dragNode: null,
      dragStartX: 0,
      dragStartY: 0,
      dragOrigX: 0,
      dragOrigY: 0,
    };
    this.scene = new KgScene(this.state, (id) => this.selectNode(id));
  }

  getViewType(): string { return VIEW_TYPE_KG; }
  getDisplayText(): string { return "Knowledge Graph"; }
  getIcon(): string { return "git-fork"; }

  setEdgeStore(edgeStore: KgEdgeStore): void {
    this.deps.edgeStore = edgeStore;
    if (this.containerEl) this.scene.render();
  }

  async onOpen(): Promise<void> {
    this.buildDOM();
    this.loadEdges();
    this.scene.render();
  }

  private buildDOM(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("sanctum-root");
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.height = "100%";

    // Topbar
    const topbar = container.createDiv({ cls: "s-kg-topbar" });
    topbar.createSpan({ text: "🔬 Knowledge Graph", attr: { style: "font-weight:700;font-size:14px" } });
    const stats = topbar.createSpan({ cls: "s-kg-stats" });
    stats.id = "kg-stats";

    const toolbar = topbar.createDiv({ cls: "s-kg-toolbar" });

    // Mode toggle
    const modeGroup = toolbar.createDiv({ cls: "s-mode-toggle" });
    const forceBtn = modeGroup.createEl("button", { cls: "s-mode-btn is-active", text: "Grafo" });
    forceBtn.dataset.mode = "force";
    const convBtn = modeGroup.createEl("button", { cls: "s-kg-btn", text: "Capas" });
    convBtn.dataset.mode = "convolutional";
    forceBtn.onclick = () => this.setMode("force", forceBtn, convBtn);
    convBtn.onclick = () => this.setMode("convolutional", forceBtn, convBtn);

    // Edge type toggles
    const toggleExp = toolbar.createEl("button", { cls: "s-kg-toggle is-active", text: "Explícitas" });
    toggleExp.dataset.type = "explicit";
    toggleExp.onclick = () => this.toggleEdgeType("explicit", toggleExp);

    const toggleRef = toolbar.createEl("button", { cls: "s-kg-toggle is-active", text: "Reforzadas" });
    toggleRef.dataset.type = "reinforced";
    toggleRef.onclick = () => this.toggleEdgeType("reinforced", toggleRef);

    const toggleSem = toolbar.createEl("button", { cls: "s-kg-toggle is-active", text: "Semánticas" });
    toggleSem.dataset.type = "semantic";
    toggleSem.onclick = () => this.toggleEdgeType("semantic", toggleSem);

    // Search
    this.searchInput = toolbar.createEl("input", {
      cls: "s-kg-search",
      attr: { placeholder: "Buscar nota…", type: "search" },
    });
    this.searchInput.oninput = () => this.searchNode(this.searchInput.value);

    // Canvas row
    const canvasRow = container.createDiv({ attr: { style: "flex:1;display:flex;overflow:hidden" } });

    const svgWrap = canvasRow.createDiv({ attr: { style: "flex:1;position:relative;overflow:hidden" } });
    this.scene.mount(svgWrap);

    this.inspector.mount(canvasRow);

    // Status bar
    this.statusEl = container.createDiv({ cls: "s-kg-status" });
  }

  private loadEdges(): void {
    this.state.edges = this.deps.edgeStore.getAllEdges();
    if (this.state.edges.length === 0) {
      this.statusEl.setText("Sin edges — indexá notas primero.");
      return;
    }
    this.scene.computeLayout();
    this.updateStats();
  }

  private setMode(mode: "force" | "convolutional", forceBtn: HTMLElement, convBtn: HTMLElement): void {
    if (this.state.mode === mode) return;
    this.state.mode = mode;
    forceBtn.classList.toggle("is-active", mode === "force");
    convBtn.classList.toggle("is-active", mode === "convolutional");
    this.scene.computeLayout();
    this.updateStats();
  }

  private toggleEdgeType(type: "explicit" | "reinforced" | "semantic", btn: HTMLElement): void {
    const key: EdgeVisibilityKey = type === "explicit" ? "showExplicit" : type === "reinforced" ? "showReinforced" : "showSemantic";
    this.state[key] = !this.state[key];
    btn.classList.toggle("is-active");
    this.scene.render();
  }

  private searchNode(query: string): void {
    if (!query.trim()) { this.selectNode(null); return; }
    const q = query.toLowerCase();
    for (const [id] of this.state.positions) {
      if (id.toLowerCase().includes(q)) {
        this.selectNode(id);
        return;
      }
    }
  }

  private selectNode(id: string | null): void {
    this.state.selected = id;
    this.scene.render();
    this.inspector.update(id, {
      adjacency: this.state.adjacency,
      edges: this.state.edges,
    }, (seed) => this.deps.onSendToChat(seed));
    this.updateStats();
  }

  private updateStats(): void {
    const total = this.state.positions.size;
    const explicit = this.state.edges.filter(e => e.type === "explicit").length;
    const reinforced = this.state.edges.filter(e => e.type === "reinforced").length;
    const semantic = this.state.edges.filter(e => e.type === "semantic").length;
    const statsEl = this.containerEl.querySelector("#kg-stats");
    if (statsEl) {
      statsEl.textContent = ` · ${total} notas · ${explicit}E ${reinforced}R ${semantic}S`;
    }
    this.statusEl.setText(`Nodos: ${total} · Aristas: ${this.state.edges.length} · Rueda: zoom · Arrastrar fondo: mover · Arrastrar nodo: reposicionar`);
  }
}
