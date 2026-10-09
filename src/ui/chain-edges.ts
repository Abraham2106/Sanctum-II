import type { ChainEdge, ChainNode } from "../chains/types";
import { genId } from "./chain-types";

export function portPos(nodes: ChainNode[], id: string, which: "in" | "out") {
  const n = nodes.find((x) => x.id === id);
  if (!n) return null;
  const w = 200;
  return which === "out" ? { x: n.x + w / 2, y: n.y } : { x: n.x - w / 2, y: n.y };
}

export function bezierPath(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

export function renderChainEdges(
  svgEl: SVGSVGElement,
  nodes: ChainNode[],
  edges: ChainEdge[],
  onRemoveEdge: (edgeId: string) => void,
): void {
  svgEl.querySelectorAll(".och-edge-group").forEach((g) => g.remove());
  for (const e of edges) {
    const a = portPos(nodes, e.from, "out");
    const b = portPos(nodes, e.to, "in");
    if (!a || !b) continue;
    const d = bezierPath(a.x, a.y, b.x, b.y);
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "och-edge-group");
    const h = document.createElementNS("http://www.w3.org/2000/svg", "path");
    h.setAttribute("d", d);
    h.setAttribute("stroke", "transparent");
    h.setAttribute("stroke-width", "16");
    h.setAttribute("fill", "none");
    h.style.pointerEvents = "stroke";
    h.style.cursor = "pointer";
    h.onclick = () => onRemoveEdge(e.id);
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    p.setAttribute("class", "och-edge-path");
    p.setAttribute("stroke", "var(--brand)");
    p.setAttribute("stroke-width", "2.5");
    p.setAttribute("stroke-dasharray", "5 7");
    p.setAttribute("fill", "none");
    p.setAttribute("marker-end", "url(#ar)");
    g.appendChild(p);
    g.appendChild(h);
    svgEl.appendChild(g);
  }
}

export function createLinkPreviewPath(svgEl: SVGSVGElement): SVGPathElement {
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("stroke", "var(--brand)");
  p.setAttribute("stroke-width", "2.5");
  p.setAttribute("stroke-dasharray", "5 6");
  p.setAttribute("fill", "none");
  svgEl.appendChild(p);
  return p;
}

export function newChainEdge(from: string, to: string): ChainEdge {
  return { id: genId("e"), from, to };
}
