// DEC-0008: este trabajo vive aparte del archivo que lo mezcla
import { forceLayout, convolutionalLayout, neighborsOf } from "../kg/layout";
import type { LayoutResult } from "../kg/layout";
import type { KgEdge } from "../kg/types";
import type { NodePos } from "../kg/layout";

export interface KgSceneState {
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

export class KgScene {
  svgEl!: SVGSVGElement;
  vpEl!: SVGGElement;

  constructor(
    private state: KgSceneState,
    private onSelectNode: (id: string | null) => void,
  ) {}

  mount(svgWrap: HTMLElement): void {
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
      this.onSelectNode(nodeGroup ? nodeGroup.dataset.node! : null);
    };

    this.svgEl.onmouseleave = () => {
      this.state.dragging = false;
      this.state.dragNode = null;
    };
  }

  computeLayout(): void {
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
  }

  render(): void {
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

  applyTransform(): void {
    this.vpEl.setAttribute("transform", `translate(${this.state.tx},${this.state.ty}) scale(${this.state.scale})`);
  }

  zoom(factor: number, cx: number, cy: number): void {
    const newScale = this.state.scale * factor;
    if (newScale < 0.35 || newScale > 4) return;
    this.state.tx = cx - (cx - this.state.tx) * factor;
    this.state.ty = cy - (cy - this.state.ty) * factor;
    this.state.scale = newScale;
    this.applyTransform();
  }
}
