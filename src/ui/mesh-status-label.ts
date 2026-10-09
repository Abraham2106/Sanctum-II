import type { MeshStatus } from "../shared/mesh/types";

/** User-visible mesh outcome label (DEC-0022). Never maps needs_review to accepted. */
export function meshStatusHeadline(status: MeshStatus): string {
  switch (status) {
    case "accepted":
      return "Aceptado";
    case "needs_review":
      return "Revisión requerida";
    case "escalated":
      return "Escalado";
    case "failed":
      return "Fallido";
    case "cancelled":
      return "Cancelado";
    case "timed_out":
      return "Tiempo agotado";
    default:
      return status;
  }
}

export function meshStatusSummaryLine(
  status: MeshStatus,
  attempts: number,
  criticScore?: number,
): string {
  const scorePart = criticScore !== undefined ? ` · Score: ${criticScore}/100` : "";
  const icon =
    status === "accepted"
      ? "✅"
      : status === "escalated"
        ? "⚠️"
        : status === "needs_review"
          ? "📝"
          : status === "cancelled"
            ? "⏹"
            : status === "timed_out"
              ? "⏱"
              : status === "failed"
                ? "❌"
                : "ℹ️";
  return `${icon} ${meshStatusHeadline(status)} · ${attempts} intento(s)${scorePart}`;
}

/** True only when mesh status is explicitly accepted (not needs_review). */
export function meshCountsAsAccepted(status: MeshStatus): boolean {
  return status === "accepted";
}
