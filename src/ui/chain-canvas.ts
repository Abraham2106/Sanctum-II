import { Notice, setIcon } from "obsidian";
import type { ChainNode, ChainEdge } from "../chains/types";
import { topologicalOrder } from "../chains/executor";
import { AGENT_TYPES, genId, getAgentById } from "./chain-types";
import { bezierPath, createLinkPreviewPath, newChainEdge, portPos, renderChainEdges } from "./chain-edges";
import type { ExecutionResult } from "./chain-types";

export interface ChainCanvasHost {
  canvasWrap: HTMLElement;
  onAutoSave: () => void;
}

export class ChainCanvas {
  nodes: ChainNode[] = [];
  edges: ChainEdge[] = [];
  results = new Map<string, ExecutionResult>();

  private nodeEls = new Map<string, HTMLElement>();
  private dragging: { nodeId: string; ox: number; oy: number } | null = null;
  private linking: { fromId: string; path: SVGPathElement } | null = null;
  private panning: { sx: number; sy: number } | null = null;
  private scale = 1;
  private tx = 0;
  private ty = 0;

  private vpEl!: HTMLElement;
  private svgEl!: SVGSVGElement;
  private nodesLayer!: HTMLElement;
  emptyEl!: HTMLElement;

  constructor(private readonly host: ChainCanvasHost) {}

  mount(parent: HTMLElement): void {
    this.host.canvasWrap = parent.createDiv({
      attr: {
        style:
          "flex:1;position:relative;overflow:hidden;background:radial-gradient(circle at 1px 1px, rgba(255,255,255,.05)1px,transparent 0);background-size:22px 22px;background-color:var(--canvas)",
      },
    });
    const wrap = this.host.canvasWrap;
    wrap.ondragover = (e) => e.preventDefault();
    wrap.ondrop = (e) => {
      e.preventDefault();
      const id = e.dataTransfer!.getData("agentId");
      if (!id) return;
      const r = wrap.getBoundingClientRect();
      this.addNode(id, (e.clientX - r.left - this.tx) / this.scale, (e.clientY - r.top - this.ty) / this.scale);
    };

    this.vpEl = wrap.createDiv({ attr: { style: "position:absolute;inset:0;transform-origin:0 0" } });
    this.applyVp();

    this.svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svgEl.setAttribute("width", "100%");
    this.svgEl.setAttribute("height", "100%");
    this.svgEl.style.position = "absolute";
    this.svgEl.style.inset = "0";
    this.svgEl.style.pointerEvents = "none";
    this.svgEl.style.zIndex = "1";
    this.svgEl.innerHTML = `<defs><marker id="ar" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L7,3 L0,6Z" fill="#8b7cf6"/></marker></defs>`;
    this.vpEl.appendChild(this.svgEl);
    this.nodesLayer = wrap.createDiv();
    this.nodesLayer.style.position = "absolute";
    this.nodesLayer.style.inset = "0";
    this.nodesLayer.style.zIndex = "2";
    this.vpEl.appendChild(this.nodesLayer);

    this.emptyEl = wrap.createDiv({
      attr: {
        style:
          "position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;color:var(--text-3);z-index:0",
      },
    });
    const emptyInner = this.emptyEl.createDiv({ attr: { style: "text-align:center;pointer-events:auto" } });
    const emptyIcon = emptyInner.createDiv({
      attr: { style: "font-size:48px;opacity:.4;margin-bottom:8px;color:var(--brand)" },
    });
    setIcon(emptyIcon, "git-branch");
    emptyInner.createDiv({
      text: "Tu Mesh está vacío",
      attr: { style: "font-size:16px;font-weight:600;color:var(--text-2);margin-bottom:6px" },
    });
    emptyInner.createDiv({
      text: "Arrastra un agente desde la izquierda o haz clic para empezar",
      attr: { style: "font-size:12px;color:var(--text-3);margin-bottom:16px" },
    });
    const addFirstBtn = emptyInner.createEl("button", {
      text: "+ Agregar primer agente",
      attr: {
        style:
          "padding:6px 14px;border-radius:8px;border:1px solid var(--border);background:var(--raised);color:var(--text-2);cursor:pointer;font-size:12px",
      },
    });
    addFirstBtn.onclick = () => {
      const r = wrap.getBoundingClientRect();
      this.addNode("forager", r.width / 2, r.height / 2);
    };

    const zoomGroup = wrap.createDiv({
      attr: {
        style:
          "position:absolute;bottom:16px;right:16px;z-index:10;display:flex;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--surface)",
      },
    });
    const mkZoom = (label: string, fn: () => void) => {
      const b = zoomGroup.createEl("button", {
        attr: {
          style:
            "width:34px;height:34px;border:none;background:transparent;color:var(--text-3);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;transition:background .12s;border-right:1px solid var(--border)",
        },
      });
      b.innerHTML = label;
      b.onmouseenter = () => {
        b.style.background = "var(--hover)";
      };
      b.onmouseleave = () => {
        b.style.background = "transparent";
      };
      b.onclick = fn;
      if (label === "⌖") b.style.borderRight = "none";
    };
    mkZoom("+", () => this.zoom(1.3, wrap.clientWidth / 2, wrap.clientHeight / 2));
    mkZoom("−", () => this.zoom(1 / 1.3, wrap.clientWidth / 2, wrap.clientHeight / 2));
    mkZoom("⌖", () => {
      this.scale = 1;
      this.tx = 0;
      this.ty = 0;
      this.applyVp();
    });
    wrap.onwheel = (e) => {
      e.preventDefault();
      const r = wrap.getBoundingClientRect();
      this.zoom(e.deltaY > 0 ? 1 / 1.15 : 1.15, e.clientX - r.left, e.clientY - r.top);
    };
    wrap.onpointerdown = (e) => {
      if ((e.target as HTMLElement).closest("[data-node-id]") || (e.target as HTMLElement).closest(".och-port-out"))
        return;
      this.panning = { sx: e.clientX - this.tx, sy: e.clientY - this.ty };
    };
    wrap.onpointermove = (e) => {
      if (!this.panning) return;
      this.tx = e.clientX - this.panning.sx;
      this.ty = e.clientY - this.panning.sy;
      this.applyVp();
    };
    wrap.onpointerup = () => {
      this.panning = null;
    };

    wrap.addEventListener("pointermove", (e) => {
      if (!this.linking) return;
      const r = wrap.getBoundingClientRect();
      const s = portPos(this.nodes, this.linking.fromId, "out");
      if (!s) return;
      this.linking.path.setAttribute(
        "d",
        bezierPath(s.x, s.y, (e.clientX - r.left - this.tx) / this.scale, (e.clientY - r.top - this.ty) / this.scale),
      );
    });
    wrap.addEventListener("pointerup", (e) => {
      if (!this.linking) return;
      const t = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-node-id]") as HTMLElement | null;
      const toId = t?.dataset?.nodeId;
      if (t && toId && this.linking && toId !== this.linking.fromId && !this.edges.some((ed) => ed.from === this.linking!.fromId && ed.to === toId))
        this.addEdge(this.linking!.fromId, toId);
      this.linking!.path.remove();
      this.linking = null;
    });
  }

  buildPalette(side: HTMLElement): void {
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
        const r = this.host.canvasWrap.getBoundingClientRect();
        this.addNode(
          a.id,
          (r.width / 2 - this.tx) / this.scale + (Math.random() * 80 - 40),
          (r.height / 2 - this.ty) / this.scale + (Math.random() * 80 - 40),
        );
      };
    }
  }

  addNode(agentId: string, x: number, y: number): string {
    const a = getAgentById(agentId);
    if (!a) return "";
    const id = genId("n");
    this.nodes.push({ id, agentId, x, y });
    const el = this.nodesLayer.createDiv({ attr: { "data-node-id": id } });
    el.addClass("och-node");
    el.style.setProperty("--nodeColor", a.color);
    el.style.position = "absolute";
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.transform = "translate(-50%,-50%)";
    el.style.zIndex = "3";
    el.style.width = "200px";
    el.innerHTML = `<div class="och-badge" style="position:absolute;top:-10px;left:-10px;min-width:20px;height:20px;border-radius:10px;background:${a.color};color:#fff;display:none;align-items:center;justify-content:center;font-size:11px;font-weight:800">-</div>
      <div class="och-result" style="display:none;position:absolute;bottom:-6px;right:-6px;width:14px;height:14px;border-radius:50%;align-items:center;justify-content:center;font-size:8px;color:#fff"></div>
      <div class="och-bubble"><div class="och-del" role="button" tabindex="0" aria-label="Eliminar agente">×</div>
        <div style="display:flex;align-items:center;gap:8px"><span class="och-node-icon" style="font-size:16px"></span><div><div style="font-size:12px;font-weight:700">${a.name}</div><div style="font-size:10px;color:var(--text-3)">@${a.id}</div></div></div>
        <div style="font-size:10px;color:var(--text-3);margin-top:4px">${a.desc}</div></div>
      <div class="och-port-in" aria-hidden="true"></div>
      <div class="och-port-out" role="button" tabindex="0" aria-label="Conectar agente ${a.name}"></div>`;
    this.nodeEls.set(id, el);
    const iconSpan = el.querySelector(".och-node-icon") as HTMLElement;
    if (iconSpan) setIcon(iconSpan, a.lucide);
    const del = el.querySelector(".och-del") as HTMLElement;
    del.onclick = (ev) => {
      ev.stopPropagation();
      this.removeNode(id);
    };
    del.onkeydown = (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        del.click();
      }
    };
    const outputPort = el.querySelector(".och-port-out") as HTMLElement;
    outputPort.onpointerdown = (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      this.startLink(ev, id);
    };
    outputPort.onkeydown = (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      ev.stopPropagation();
      if (this.linking) {
        const from = this.linking.fromId;
        this.linking.path.remove();
        this.linking = null;
        if (from !== id && !this.edges.some((edge) => edge.from === from && edge.to === id)) this.addEdge(from, id);
      } else {
        this.startLink(ev, id);
        new Notice("Seleccioná otro agente y presioná Enter para conectarlo");
      }
    };
    this.makeDraggable(el, id);
    this.updateEmpty();
    this.host.onAutoSave();
    return id;
  }

  removeNode(id: string): void {
    this.nodeEls.get(id)?.remove();
    this.nodeEls.delete(id);
    this.nodes = this.nodes.filter((n) => n.id !== id);
    this.edges = this.edges.filter((e) => e.from !== id && e.to !== id);
    this.results.delete(id);
    this.renderEdges();
    this.updateEmpty();
    this.host.onAutoSave();
  }

  clear(): void {
    this.nodeEls.forEach((e) => e.remove());
    this.nodeEls.clear();
    this.nodes = [];
    this.edges = [];
    this.results.clear();
    this.renderEdges();
    this.updateEmpty();
  }

  setNodeRunning(nodeId: string, step?: number): void {
    const el = this.nodeEls.get(nodeId);
    if (!el) return;
    const b = el.querySelector(".och-bubble") as HTMLElement;
    b.style.borderColor = "var(--brand)";
    b.style.borderWidth = "3px";
    const badge = el.querySelector(".och-badge") as HTMLElement;
    if (badge && step !== undefined) {
      badge.textContent = String(step);
      badge.style.display = "flex";
    }
    const dot = el.querySelector(".och-result") as HTMLElement;
    if (dot) {
      dot.style.display = "flex";
      dot.style.background = "var(--brand)";
      dot.textContent = "…";
    }
  }

  setNodeOutcome(nodeId: string, ok: boolean): void {
    const el = this.nodeEls.get(nodeId);
    if (!el) return;
    const b = el.querySelector(".och-bubble") as HTMLElement;
    b.style.borderColor = ok ? "var(--green)" : "var(--red)";
    b.style.borderWidth = "2px";
    const d = el.querySelector(".och-result") as HTMLElement;
    if (d) {
      d.style.display = "flex";
      d.style.background = ok ? "var(--green)" : "var(--red)";
      d.textContent = ok ? "✓" : "✗";
    }
  }

  showOrderBadges(order: string[]): void {
    order.forEach((nid, i) => {
      const e = this.nodeEls.get(nid);
      if (!e) return;
      const b = e.querySelector(".och-badge") as HTMLElement;
      if (b) {
        b.textContent = String(i + 1);
        b.style.display = "flex";
      }
    });
  }

  autoArrange(): void {
    const order = topologicalOrder(this.nodes, this.edges);
    const r = this.host.canvasWrap.getBoundingClientRect();
    const startX = 170,
      gap = 210,
      y = r.height / 2;
    const placed = new Set(order);
    order.forEach((id, i) => {
      const n = this.nodes.find((x) => x.id === id);
      if (!n) return;
      n.x = startX + i * gap;
      n.y = y + (i % 2 ? 40 : -40);
      const e = this.nodeEls.get(id);
      if (e) {
        e.style.left = n.x + "px";
        e.style.top = n.y + "px";
      }
    });
    let k = order.length;
    this.nodes
      .filter((n) => !placed.has(n.id))
      .forEach((n) => {
        n.x = startX + k++ * gap;
        n.y = y - 120;
        const e = this.nodeEls.get(n.id);
        if (e) {
          e.style.left = n.x + "px";
          e.style.top = n.y + "px";
        }
      });
    this.renderEdges();
  }

  loadDemo(): void {
    const r = this.host.canvasWrap.getBoundingClientRect();
    if (r.width < 100) {
      setTimeout(() => this.loadDemo(), 200);
      return;
    }
    const a = this.addNode("forager", r.width * 0.22, r.height / 2 - 30);
    const b = this.addNode("researcher", r.width * 0.48, r.height / 2 + 20);
    const c = this.addNode("critic", r.width * 0.74, r.height / 2 - 30);
    setTimeout(() => {
      if (this.nodes.length >= 3) {
        this.addEdge(a, b);
        this.addEdge(b, c);
      }
    }, 50);
  }

  loadFromChain(nodes: ChainNode[], edges: ChainEdge[]): void {
    this.clear();
    const map = new Map<string, string>();
    for (const n of nodes) map.set(n.id, this.addNode(n.agentId, n.x, n.y));
    setTimeout(() => {
      for (const e of edges) {
        const f = map.get(e.from);
        const t = map.get(e.to);
        if (f && t) this.addEdge(f, t);
      }
    }, 50);
  }

  private makeDraggable(el: HTMLElement, nodeId: string): void {
    const bub = el.querySelector(".och-bubble") as HTMLElement;
    bub.onpointerdown = (e) => {
      if ((e.target as HTMLElement).classList.contains("och-del")) return;
      const r = this.host.canvasWrap.getBoundingClientRect();
      const n = this.nodes.find((x) => x.id === nodeId);
      if (!n) return;
      this.dragging = {
        nodeId,
        ox: (e.clientX - r.left - this.tx) / this.scale - n.x,
        oy: (e.clientY - r.top - this.ty) / this.scale - n.y,
      };
      bub.setPointerCapture(e.pointerId);
      e.stopPropagation();
    };
    bub.onpointermove = (e) => {
      if (!this.dragging || this.dragging.nodeId !== nodeId) return;
      const r = this.host.canvasWrap.getBoundingClientRect();
      const n = this.nodes.find((x) => x.id === nodeId);
      if (!n) return;
      n.x = (e.clientX - r.left - this.tx) / this.scale - this.dragging.ox;
      n.y = (e.clientY - r.top - this.ty) / this.scale - this.dragging.oy;
      el.style.left = n.x + "px";
      el.style.top = n.y + "px";
      this.renderEdges();
    };
    bub.onpointerup = () => {
      this.dragging = null;
      this.host.onAutoSave();
    };
    bub.onpointercancel = () => {
      this.dragging = null;
    };
  }

  private addEdge(from: string, to: string) {
    this.edges.push(newChainEdge(from, to));
    this.renderEdges();
    this.host.onAutoSave();
  }

  private startLink(_e: Event, fromId: string) {
    const p = createLinkPreviewPath(this.svgEl);
    this.linking = { fromId, path: p };
  }

  private renderEdges(): void {
    renderChainEdges(this.svgEl, this.nodes, this.edges, (edgeId) => {
      this.edges = this.edges.filter((ed) => ed.id !== edgeId);
      this.renderEdges();
      this.host.onAutoSave();
    });
  }

  private applyVp(): void {
    this.vpEl.style.transform = `translate(${this.tx}px,${this.ty}px) scale(${this.scale})`;
  }

  private zoom(f: number, cx: number, cy: number): void {
    const ns = this.scale * f;
    if (ns < 0.2 || ns > 5) return;
    this.tx = cx - (cx - this.tx) * f;
    this.ty = cy - (cy - this.ty) * f;
    this.scale = ns;
    this.applyVp();
  }

  private updateEmpty(): void {
    this.emptyEl.style.display = this.nodes.length ? "none" : "grid";
  }
}
