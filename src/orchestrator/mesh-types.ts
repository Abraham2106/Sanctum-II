import type { LoopState } from "../shared/mesh/types";

export interface MeshResultFull {
  foragerOutput: string;
  researcherOutput: string;
  criticScore?: number;
  criticVerdict: "accept" | "escalated";
  attempts: number;
  loopState: LoopState;
  createdNotePath?: string;
}
