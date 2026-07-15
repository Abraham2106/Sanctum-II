export interface KgEdge {
  from: string;
  to: string;
  type: "explicit" | "semantic" | "reinforced";
  weight: number;
  relation: "wikilink" | "semantic" | "wikilink+semantic";
}

export interface KgExpansionResult {
  edges_traversed: KgEdge[];
  added_chunks: { note_path: string; chunk_text: string; score: number; relation?: string }[];
  seed_notes: string[];
  neighbor_notes: string[];
}

export interface KgOptions {
  enabled: boolean;
  minSimilarity: number;
  hops: number;
  maxNeighborsPerHop: number;
  useExplicit: boolean;
  reinforceBoost: boolean;
}

export const DEFAULT_KG_OPTIONS: KgOptions = {
  enabled: true,
  minSimilarity: 0.75,
  hops: 1,
  maxNeighborsPerHop: 3,
  useExplicit: true,
  reinforceBoost: true,
};
