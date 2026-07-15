import { ItemView, WorkspaceLeaf, Notice, setIcon } from "obsidian";
import type { KgEdge } from "../kg/types";
import type { KgEdgeStore } from "../kg/kg-store";
import { forceLayout, convolutionalLayout, neighborsOf } from "../kg/layout";
import type { NodePos, LayoutResult } from "../kg/layout";

export const VIEW_TYPE_KG = "sanctum-kg";

export interface KgViewDeps {
  edgeStore: KgEdgeStore;
  onSendToChat: (seed: string) => void;
}

interface ViewState {
  edges: KgEdge[];
  positions: Map<string, NodePos>;
  adjacency: Map<string, string[]>;
  layers?: Map<string, number>;
  selected: string | null;
  mode: "force" | "convolutional";
  showExplicit: boolean;
  showReinforced: boolean;
  showSemantic: boolean;
  scale: number;
  tx: number;
  ty: number;
  dragging: boolean;
  dragNode: string | null;
  dragStartX: number;
  dragStartY: number;
  dragOrigX: number;
  dragOrigY: number;
}

export class KgView extends ItemView {
  private state: ViewState;
  private svgEl!: SVGSVGElement;
  private vpEl!: SVGGElement;
  private inspectorEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private modeBtns!: NodeListOf<HTMLElement>;

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
  }

  getViewType(): string { return VIEW_TYPE_KG; }
  getDisplayText(): string { return "Knowledge Graph"; }
  getIcon(): string { return "git-fork"; }

  async onOpen(): Promise<void> {
    this.buildDOM();
    this.loadEdges();
    this.render();
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

    // SVG canvas
    const svgWrap = canvasRow.createDiv({ attr: { style: "flex:1;position:relative;overflow:hidden" } });
    this.svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg") as unknown as SVGSVGElement;
    this.svgEl.setAttribute("width", "100%");
    this.svgEl.setAttribute("height", "100%");
    this.svgEl.style.display = "block";
    this.svgEl.style.background = "var(--canvas)";
    svgWrap.appendChild(this.svgEl);

    this.vpEl = document.createElementNS("http://www.w3.org/2000/svg", "g") as unknown as SVGGElement;
    this.vpEl.id = "vp";
    this.svgEl.appendChild(this.vpEl);

    // Zoom controls
    const zoomDiv = svgWrap.createDiv({ attr: { style: "position:absolute;bottom:12px;right:12px;display:flex;gap:4px" } });
    const zoomIn = zoomDiv.createEl("button", { cls: "s-kg-icon-btn", text: "+" });
    zoomIn.onclick = () => this.zoom(1.3, this.svgEl.clientWidth / 2, this.svgEl.clientHeight / 2);
    const zoomOut = zoomDiv.createEl("button", { cls: "s-kg-icon-btn", text: "−" });
    zoomOut.onclick = () => this.zoom(1 / 1.3, this.svgEl.clientWidth / 2, this.svgEl.clientHeight / 2);
    const zoomReset = zoomDiv.createEl("button", { cls: "s-kg-icon-btn", text: "⌖" });
    zoomReset.onclick = () => { this.state.scale = 1; this.state.tx = 0; this.state.ty = 0; this.applyTransform(); };

    // Mouse events
    this.svgEl.onwheel = (e) => {
      e.preventDefault();
      const rect = this.svgEl.getBoundingClientRect();
      this.zoom(e.deltaY > 0 ? 1 / 1.15 : 1.15, e.clientX - rect.left, e.clientY - rect.top);
    };

    this.svgEl.onmousedown = (e) => {
      if (e.button !== 0) return;
      const target = e.target as SVGElement;
      const nodeGroup = target.closest("[data-node]") as SVGGElement | null;
      if (nodeGroup) {
        const id = nodeGroup.dataset.node!;
        this.state.dragNode = id;
        this.state.dragStartX = e.clientX;
        this.state.dragStartY = e.clientY;
        const p = this.state.positions.get(id)!;
        this.state.dragOrigX = p.x;
        this.state.dragOrigY = p.y;
        return;
      }
      this.state.dragging = true;
      this.state.dragStartX = e.clientX;
      this.state.dragStartY = e.clientY;
      this.state.dragOrigX = this.state.tx;
      this.state.dragOrigY = this.state.ty;
    };

    this.svgEl.onmousemove = (e) => {
      if (this.state.dragNode) {
        const dx = (e.clientX - this.state.dragStartX) / this.state.scale;
        const dy = (e.clientY - this.state.dragStartY) / this.state.scale;
        const p = this.state.positions.get(this.state.dragNode)!;
        if (p) {
          p.x = this.state.dragOrigX + dx;
          p.y = this.state.dragOrigY + dy;
          p.fixed = true;
          this.render();
        }
        return;
      }
      if (this.state.dragging) {
        this.state.tx = this.state.dragOrigX + (e.clientX - this.state.dragStartX);
        this.state.ty = this.state.dragOrigY + (e.clientY - this.state.dragStartY);
        this.applyTransform();
      }
    };

    this.svgEl.onmouseup = (e) => {
      if (this.state.dragNode) {
        this.state.dragNode = null;
        return;
      }
      if (this.state.dragging) {
        this.state.dragging = false;
        return;
      }
      // Click (no drag) → select
      const target = e.target as SVGElement;
      const nodeGroup = target.closest("[data-node]") as SVGGElement | null;
      this.selectNode(nodeGroup ? nodeGroup.dataset.node! : null);
    };

    this.svgEl.onmouseleave = () => {
      this.state.dragging = false;
      this.state.dragNode = null;
    };

    // Inspector panel
    this.inspectorEl = canvasRow.createDiv({ cls: "s-kg-inspector" });
    this.inspectorEl.createDiv({ cls: "s-kg-inspector-title", text: "Inspector" });

    // Status bar
    this.statusEl = container.createDiv({ cls: "s-kg-status" });
  }

  private loadEdges(): void {
    this.state.edges = this.deps.edgeStore.getAllEdges();
    if (this.state.edges.length === 0) {
      this.statusEl.setText("Sin edges — indexá notas primero.");
      return;
    }
    this.computeLayout();
  }

  private computeLayout(): void {
    const rect = this.svgEl.getBoundingClientRect();
    const w = Math.max(rect.width, 400);
    const h = Math.max(rect.height, 300);

    let result: LayoutResult;
    if (this.state.mode === "convolutional") {
      const seed = this.state.selected || this.state.edges[0]?.from;
      result = convolutionalLayout(seed, this.state.edges, w, h);
      this.state.layers = result.layers;
    } else {
      result = forceLayout(this.state.edges, w, h);
      this.state.layers = undefined;
    }

    this.state.positions = result.positions;
    this.state.adjacency = result.adjacency;
    this.render();
    this.updateStats();
  }

  private setMode(mode: "force" | "convolutional", forceBtn: HTMLElement, convBtn: HTMLElement): void {
    if (this.state.mode === mode) return;
    this.state.mode = mode;
    forceBtn.classList.toggle("is-active", mode === "force");
    convBtn.classList.toggle("is-active", mode === "convolutional");
    this.computeLayout();
  }

  private toggleEdgeType(type: string, btn: HTMLElement): void {
    const key = type === "explicit" ? "showExplicit" : type === "reinforced" ? "showReinforced" : "showSemantic";
    (this.state as any)[key] = !(this.state as any)[key];
    btn.classList.toggle("is-active");
    this.render();
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
    this.render();
    this.updateInspector(id);
    this.updateStats();
  }

  private render(): void {
    while (this.vpEl.firstChild) this.vpEl.removeChild(this.vpEl.firstChild);
    this.applyTransform();

    const { positions, edges, selected, showExplicit, showReinforced, showSemantic } = this.state;
    if (positions.size === 0) return;

    const neighbors = selected ? neighborsOf(selected, this.state.adjacency) : null;

    // Edges
    for (const e of edges) {
      if (e.type === "explicit" && !showExplicit) continue;
      if (e.type === "reinforced" && !showReinforced) continue;
      if (e.type === "semantic" && !showSemantic) continue;

      const pa = positions.get(e.from);
      const pb = positions.get(e.to);
      if (!pa || !pb) continue;

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(pa.x));
      line.setAttribute("y1", String(pa.y));
      line.setAttribute("x2", String(pb.x));
      line.setAttribute("y2", String(pb.y));

      const isDim = neighbors && !neighbors.has(e.from) && !neighbors.has(e.to);
      const cls = isDim ? "s-kg-edge dim" : "s-kg-edge";
      line.setAttribute("class", cls);

      if (e.type === "explicit") {
        line.setAttribute("stroke", "rgba(255,255,255,0.22)");
        line.setAttribute("stroke-width", "1.4");
      } else if (e.type === "reinforced") {
        line.setAttribute("stroke", "var(--brand)");
        line.setAttribute("stroke-width", "3");
      } else {
        const w = 1.2 + e.weight * 2.2;
        const opacity = 0.45 + e.weight * 0.4;
        line.setAttribute("stroke", "var(--brand)");
        line.setAttribute("stroke-width", String(w));
        line.setAttribute("stroke-opacity", String(opacity));
        line.setAttribute("stroke-dasharray", "5,4");
      }

      this.vpEl.appendChild(line);
    }

    // Nodes
    for (const [id, pos] of positions) {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("data-node", id);
      g.style.cursor = "pointer";

      const isSelected = id === selected;
      const isDim = neighbors && !neighbors.has(id);

      const radius = isSelected ? 10 : Math.max(5, Math.min(12, Math.sqrt(this.state.adjacency.get(id)?.length || 1) * 3));

      if (isSelected) {
        const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        ring.setAttribute("cx", String(pos.x));
        ring.setAttribute("cy", String(pos.y));
        ring.setAttribute("r", String(radius + 4));
        ring.setAttribute("fill", "none");
        ring.setAttribute("stroke", "var(--brand)");
        ring.setAttribute("stroke-width", "2");
        g.appendChild(ring);
      }

      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(pos.x));
      circle.setAttribute("cy", String(pos.y));
      circle.setAttribute("r", String(radius));
      circle.setAttribute("fill", isSelected ? "var(--brand)" : "var(--raised)");
      circle.setAttribute("stroke", isSelected ? "var(--brand)" : "var(--border-strong)");
      circle.setAttribute("stroke-width", "1.5");
      circle.style.transition = "fill .15s, opacity .15s";
      if (isDim) circle.setAttribute("opacity", "0.13");
      g.appendChild(circle);

      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", String(pos.x));
      label.setAttribute("y", String(pos.y + radius + 14));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("font-size", "10");
      label.setAttribute("fill", isDim ? "rgba(255,255,255,0.13)" : isSelected ? "var(--text)" : "var(--text-3)");
      label.setAttribute("font-weight", isSelected ? "700" : "400");
      const shortName = id.replace(/\.md$/i, "").split("/").pop() || id;
      label.textContent = shortName.length > 18 ? shortName.slice(0, 16) + "…" : shortName;
      g.appendChild(label);

      this.vpEl.appendChild(g);
    }
  }

  private applyTransform(): void {
    this.vpEl.setAttribute("transform", `translate(${this.state.tx},${this.state.ty}) scale(${this.state.scale})`);
  }

  private zoom(factor: number, cx: number, cy: number): void {
    const newScale = this.state.scale * factor;
    if (newScale < 0.35 || newScale > 4) return;
    this.state.tx = cx - (cx - this.state.tx) * factor;
    this.state.ty = cy - (cy - this.state.ty) * factor;
    this.state.scale = newScale;
    this.applyTransform();
  }

  private updateInspector(id: string | null): void {
    this.inspectorEl.empty();
    this.inspectorEl.createDiv({ cls: "s-kg-inspector-title", text: "Inspector" });

    if (!id) {
      this.inspectorEl.createDiv({ cls: "s-kg-inspector-empty", text: "Seleccioná un nodo" });
      return;
    }

    const content = this.inspectorEl.createDiv({ cls: "s-kg-inspector-content" });

    // Header
    const header = content.createDiv({ cls: "s-kg-inspector-header" });
    header.createSpan({ text: id.replace(/\.md$/i, "").split("/").pop() || id, attr: { style: "font-weight:700;font-size:14px" } });
    content.createDiv({ cls: "s-kg-inspector-path", text: id, attr: { style: "font-size:11px;color:var(--text-3);margin-bottom:8px" } });

    // Meta chips
    const degree = this.state.adjacency.get(id)?.length || 0;
    const meta = content.createDiv({ cls: "s-kg-inspector-meta" });
    meta.createSpan({ cls: "s-kg-chip", text: `Grado ${degree}` });

    // Connections list
    const neighbors = this.state.adjacency.get(id) || [];
    if (neighbors.length > 0) {
      content.createDiv({ text: "Conexiones", attr: { style: "font-weight:600;font-size:12px;margin:10px 0 6px;color:var(--text-2)" } });

      for (const nid of neighbors) {
        const row = content.createDiv({ cls: "s-kg-inspector-row" });

        // Find the edge to get type/relation
        const edge = this.state.edges.find(e =>
          (e.from === id && e.to === nid) || (e.from === nid && e.to === id)
        );

        const dot = row.createSpan({ cls: "s-kg-inspector-dot" });
        if (edge?.type === "reinforced") dot.style.background = "var(--brand)";
        else if (edge?.type === "explicit") dot.style.background = "rgba(255,255,255,0.4)";
        else dot.style.background = "var(--brand)";
        dot.style.opacity = edge?.type === "semantic" ? "0.5" : "1";

        const name = (nid.replace(/\.md$/i, "").split("/").pop() || nid).slice(0, 22);
        row.createSpan({ text: name, attr: { style: "flex:1;font-size:12px;color:var(--text-2)" } });

        const chip = row.createSpan({ cls: "s-kg-inspector-chip" });
        chip.setText(edge?.relation || "wikilink");

        if (edge?.type === "semantic" && edge.weight) {
          row.createSpan({ text: edge.weight.toFixed(2), attr: { style: "font-size:10px;color:var(--text-3);width:30px;text-align:right;font-family:monospace" } });
        }
      }
    }

    // Actions
    const actions = content.createDiv({ cls: "s-kg-inspector-actions" });
    const openBtn = actions.createEl("button", { cls: "s-kg-inspector-btn", text: "Abrir nota" });
    openBtn.onclick = () => {
      this.deps.onSendToChat(id);
    };
    const chatBtn = actions.createEl("button", { cls: "s-kg-inspector-btn primary", text: "Enviar al chat" });
    chatBtn.onclick = () => {
      this.deps.onSendToChat(id);
    };
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


