import { describe, expect, it, vi } from "vitest";
import { cancelInFlightChat, cancelInFlightMesh } from "./chat-cancel-wiring";

describe("chat-cancel-wiring (T-043)", () => {
  it("calls plugin cancelChatRequest when wired", () => {
    const cancelChatRequest = vi.fn();
    cancelInFlightChat({ cancelChatRequest });
    expect(cancelChatRequest).toHaveBeenCalledTimes(1);
  });

  it("calls plugin cancelMeshRequest when wired", () => {
    const cancelMeshRequest = vi.fn();
    cancelInFlightMesh({ cancelMeshRequest });
    expect(cancelMeshRequest).toHaveBeenCalledTimes(1);
  });
});
