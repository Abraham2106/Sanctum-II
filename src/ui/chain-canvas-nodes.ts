import { Notice, setIcon } from "obsidian";
import type { ChainNode, ChainEdge } from "../chains/types";
import { AGENT_TYPES, genId, getAgentById } from "./chain-types";
import { createLinkPreviewPath } from "./chain-edges";

export interface ChainCanvasNodeHost {
  canvasWrap: HTMLElement;
  nodesLayer: HTMLElement;
  svgEl: SVGSVGElement;
  nodes: ChainNode[];
  edges: ChainEdge[];
  nodeEls: Map<string, HTMLElement>;
  scale: number;
  tx: number;
  ty: number;
  linking: { fromId: string; path: SVGPathElement } | null;
  setLinking: (v: ChainCanvasNodeHost["linking"]) => void;
  onAutoSave: () => void;
  addEdge: (from: string, to: string) => void;
  removeNode: (id: string) => void;
  renderEdges: () => void;
  updateEmpty: () => void;
}

export function buildChainPalette(host: ChainCanvasNodeHost, side: HTMLElement): void {
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
      const r = host.canvasWrap.getBoundingClientRect();
      addChainNode(
        host,
        a.id,
        (r.width / 2 - host.tx) / host.scale + (Math.random() * 80 - 40),
        (r.height / 2 - host.ty) / host.scale + (Math.random() * 80 - 40),
      );
    };
  }
}

export function addChainNode(host: ChainCanvasNodeHost, agentId: string, x: number, y: number): string {
  const a = getAgentById(agentId);
  if (!a) return "";
  const id = genId("n");
  host.nodes.push({ id, agentId, x, y });
  const el = host.nodesLayer.createDiv({ attr: { "data-node-id": id } });
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
  host.nodeEls.set(id, el);
  const iconSpan = el.querySelector(".och-node-icon") as HTMLElement;
  if (iconSpan) setIcon(iconSpan, a.lucide);
  const del = el.querySelector(".och-del") as HTMLElement;
  del.onclick = (ev) => {
    ev.stopPropagation();
    host.removeNode(id);
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
    startChainLink(host, ev, id);
  };
  outputPort.onkeydown = (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    ev.preventDefault();
    ev.stopPropagation();
    if (host.linking) {
      const from = host.linking.fromId;
      host.linking.path.remove();
      host.setLinking(null);
      if (from !== id && !host.edges.some((edge) => edge.from === from && edge.to === id)) host.addEdge(from, id);
    } else {
      startChainLink(host, ev, id);
      new Notice("Seleccioná otro agente y presioná Enter para conectarlo");
    }
  };
  attachChainNodeDrag(host, el, id);
  host.updateEmpty();
  host.onAutoSave();
  return id;
}

export function attachChainNodeDrag(host: ChainCanvasNodeHost, el: HTMLElement, nodeId: string): void {
  const bub = el.querySelector(".och-bubble") as HTMLElement;
  let dragging: { ox: number; oy: number } | null = null;
  bub.onpointerdown = (e) => {
    if ((e.target as HTMLElement).classList.contains("och-del")) return;
    const r = host.canvasWrap.getBoundingClientRect();
    const n = host.nodes.find((x) => x.id === nodeId);
    if (!n) return;
    dragging = {
      ox: (e.clientX - r.left - host.tx) / host.scale - n.x,
      oy: (e.clientY - r.top - host.ty) / host.scale - n.y,
    };
    bub.setPointerCapture(e.pointerId);
    e.stopPropagation();
  };
  bub.onpointermove = (e) => {
    if (!dragging) return;
    const r = host.canvasWrap.getBoundingClientRect();
    const n = host.nodes.find((x) => x.id === nodeId);
    if (!n) return;
    n.x = (e.clientX - r.left - host.tx) / host.scale - dragging.ox;
    n.y = (e.clientY - r.top - host.ty) / host.scale - dragging.oy;
    el.style.left = n.x + "px";
    el.style.top = n.y + "px";
    host.renderEdges();
  };
  bub.onpointerup = () => {
    dragging = null;
    host.onAutoSave();
  };
  bub.onpointercancel = () => {
    dragging = null;
  };
}

function startChainLink(host: ChainCanvasNodeHost, _e: Event, fromId: string): void {
  const p = createLinkPreviewPath(host.svgEl);
  host.setLinking({ fromId, path: p });
}
