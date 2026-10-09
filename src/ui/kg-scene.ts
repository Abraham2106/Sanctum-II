import type { KgEdge } from "../kg/types";
import { neighborsOf } from "../kg/layout";
import type { NodePos } from "../kg/layout";

export function renderKgScene(
  vpEl: SVGGElement,
  params: {
    positions: Map<string, NodePos>;
    edges: KgEdge[];
    selected: string | null;
    adjacency: Map<string, string[]>;
    showExplicit: boolean;
    showReinforced: boolean;
    showSemantic: boolean;
  },
): void {
  while (vpEl.firstChild) vpEl.removeChild(vpEl.firstChild);

  const { positions, edges, selected, showExplicit, showReinforced, showSemantic } = params;
  if (positions.size === 0) return;

  const neighbors = selected ? neighborsOf(selected, params.adjacency) : null;

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
    line.setAttribute("class", isDim ? "s-kg-edge dim" : "s-kg-edge");

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

    vpEl.appendChild(line);
  }

  for (const [id, pos] of positions) {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("data-node", id);
    g.style.cursor = "pointer";

    const isSelected = id === selected;
    const isDim = neighbors && !neighbors.has(id);
    const radius = isSelected ? 10 : Math.max(5, Math.min(12, Math.sqrt(params.adjacency.get(id)?.length || 1) * 3));

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

    vpEl.appendChild(g);
  }
}
