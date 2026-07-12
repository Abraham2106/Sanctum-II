import type { KgEdge } from "./types";
import { isInternalPath } from "../utils";

export interface NativeLinkProvider {
  getResolvedLinks(): Record<string, Record<string, number>>;
}

export function getExplicitEdges(provider: NativeLinkProvider): KgEdge[] {
  const resolved = provider.getResolvedLinks();
  const edges: KgEdge[] = [];
  const seen = new Set<string>();

  for (const [source, targets] of Object.entries(resolved)) {
    if (isInternalPath(source)) continue;
    for (const [target, count] of Object.entries(targets)) {
      if (count <= 0) continue;
      if (isInternalPath(target)) continue;
      const key = [source, target].sort().join("::");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        from: source,
        to: target,
        type: "explicit",
        weight: 1.0,
        relation: "wikilink",
      });
    }
  }

  return edges;
}
