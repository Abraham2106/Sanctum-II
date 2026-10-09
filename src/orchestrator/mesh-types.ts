import type { LoopState, MeshRunResult, MeshStatus } from "../shared/mesh/types";

export interface MeshResultFull {
  foragerOutput: string;
  researcherOutput: string;
  criticScore?: number;
  criticVerdict: "accept" | "escalated" | "needs_review" | "reject";
  meshStatus: MeshStatus;
  attempts: number;
  loopState: LoopState;
  createdNotePath?: string;
  meshCore?: MeshRunResult;
}
