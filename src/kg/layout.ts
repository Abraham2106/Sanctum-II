import type { KgEdge } from "./types";

export interface NodePos {
  x: number;
  y: number;
  fixed?: boolean;
}

export interface LayoutResult {
  positions: Map<string, NodePos>;
  layers?: Map<string, number>;
  adjacency: Map<string, string[]>;
}

function buildAdjacency(edges: KgEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    let a = adj.get(e.from);
    if (!a) { a = []; adj.set(e.from, a); }
    a.push(e.to);
    let b = adj.get(e.to);
    if (!b) { b = []; adj.set(e.to, b); }
    b.push(e.from);
  }
  return adj;
}

export function forceLayout(
  edges: KgEdge[],
  width: number,
  height: number,
  iterations: number = 120
): LayoutResult {
  const adj = buildAdjacency(edges);
  const allNodes = [...new Set(edges.flatMap(e => [e.from, e.to]))];
  const pos = new Map<string, NodePos>();

  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.35;
  for (let i = 0; i < allNodes.length; i++) {
    const angle = (2 * Math.PI * i) / allNodes.length;
    pos.set(allNodes[i], {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }

  const area = width * height;
  const k = Math.sqrt(area / allNodes.length);
  const repulsion = k * k;
  const attraction = 0.01;
  const damping = 0.85;
  const vel = new Map<string, { vx: number; vy: number }>();

  for (const id of allNodes) vel.set(id, { vx: 0, vy: 0 });

  for (let iter = 0; iter < iterations; iter++) {
    const forces = new Map<string, { fx: number; fy: number }>();
    for (const id of allNodes) forces.set(id, { fx: 0, fy: 0 });

    // Repulsive: all pairs
    for (let i = 0; i < allNodes.length; i++) {
      for (let j = i + 1; j < allNodes.length; j++) {
        const a = allNodes[i];
        const b = allNodes[j];
        const pa = pos.get(a)!;
        const pb = pos.get(b)!;
        let dx = pb.x - pa.x;
        let dy = pb.y - pa.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) dist = 1;
        const f = repulsion / (dist * dist);
        const fx = (dx / dist) * f;
        const fy = (dy / dist) * f;
        forces.get(a)!.fx -= fx;
        forces.get(a)!.fy -= fy;
        forces.get(b)!.fx += fx;
        forces.get(b)!.fy += fy;
      }
    }

    // Attractive: along edges
    for (const e of edges) {
      const pa = pos.get(e.from);
      const pb = pos.get(e.to);
      if (!pa || !pb) continue;
      let dx = pb.x - pa.x;
      let dy = pb.y - pa.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = attraction * (dist - k) / dist;
      forces.get(e.from)!.fx += dx * f;
      forces.get(e.from)!.fy += dy * f;
      forces.get(e.to)!.fx -= dx * f;
      forces.get(e.to)!.fy -= dy * f;
    }

    // Center gravity
    for (const id of allNodes) {
      const p = pos.get(id)!;
      const f = forces.get(id)!;
      f.fx += (cx - p.x) * 0.001;
      f.fy += (cy - p.y) * 0.001;
    }

    // Apply forces with damping
    for (const id of allNodes) {
      const p = pos.get(id)!;
      if (p.fixed) continue;
      const v = vel.get(id)!;
      const f = forces.get(id)!;
      v.vx = (v.vx + f.fx) * damping;
      v.vy = (v.vy + f.fy) * damping;
      p.x += v.vx;
      p.y += v.vy;
      p.x = Math.max(10, Math.min(width - 10, p.x));
      p.y = Math.max(10, Math.min(height - 10, p.y));
    }
  }

  return { positions: pos, adjacency: adj };
}

export function convolutionalLayout(
  seed: string,
  edges: KgEdge[],
  width: number,
  height: number,
  maxHops: number = 3
): LayoutResult {
  const adj = buildAdjacency(edges);
  const layer = new Map<string, number>();
  const q = [seed];
  layer.set(seed, 0);
  while (q.length > 0) {
    const u = q.shift()!;
    const ul = layer.get(u)!;
    if (ul >= maxHops) continue;
    const neighbors = adj.get(u) || [];
    for (const v of neighbors) {
      if (!layer.has(v)) {
        layer.set(v, ul + 1);
        q.push(v);
      }
    }
  }

  // Unreachable nodes → last layer + 1
  const maxLayer = Math.max(...layer.values(), 0);
  const allNodes = [...new Set(edges.flatMap(e => [e.from, e.to]))];
  for (const n of allNodes) {
    if (!layer.has(n)) layer.set(n, maxLayer + 1);
  }

  const layers: number[] = [...new Set(layer.values())].sort((a, b) => a - b);
  const cols = layers.length;
  const margin = 60;
  const colW = (width - margin * 2) / Math.max(cols, 1);
  const positions = new Map<string, NodePos>();

  for (const [node, l] of layer) {
    const nodesInLayer = allNodes.filter(n => layer.get(n) === l);
    const idx = nodesInLayer.indexOf(node);
    const count = nodesInLayer.length;
    const spacing = Math.min(50, (height - margin * 2) / Math.max(count, 1));
    const totalH = count * spacing;
    const startY = (height - totalH) / 2;
    positions.set(node, {
      x: margin + l * colW + colW / 2,
      y: startY + idx * spacing + spacing / 2,
    });
  }

  return { positions, adjacency: adj, layers: layer };
}

export function neighborsOf(
  node: string,
  adj: Map<string, string[]>
): Set<string> {
  const result = new Set<string>([node]);
  const n = adj.get(node);
  if (n) for (const v of n) result.add(v);
  return result;
}
