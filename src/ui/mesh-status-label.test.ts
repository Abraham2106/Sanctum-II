import { describe, expect, it } from "vitest";
import { meshCountsAsAccepted, meshStatusHeadline, meshStatusSummaryLine } from "./mesh-status-label";

describe("mesh-status-label (T-043)", () => {
  it("does not label needs_review as accepted", () => {
    expect(meshStatusHeadline("needs_review")).toBe("Revisión requerida");
    expect(meshCountsAsAccepted("needs_review")).toBe(false);
    expect(meshStatusSummaryLine("needs_review", 2, 72)).toContain("Revisión requerida");
    expect(meshStatusSummaryLine("needs_review", 2, 72)).not.toContain("Aceptado");
  });

  it("labels canonical mesh states", () => {
    expect(meshStatusHeadline("accepted")).toBe("Aceptado");
    expect(meshStatusHeadline("escalated")).toBe("Escalado");
    expect(meshStatusHeadline("failed")).toBe("Fallido");
    expect(meshStatusHeadline("cancelled")).toBe("Cancelado");
    expect(meshStatusHeadline("timed_out")).toBe("Tiempo agotado");
  });
});
