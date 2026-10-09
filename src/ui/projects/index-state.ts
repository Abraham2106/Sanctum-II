import type { IndexGenerationSnapshot, IndexSnapshotStatus } from "../../projects/index-generations";

export type IndexUiState = IndexSnapshotStatus | "stale" | "loading" | "error";

export function classifyIndexUiState(snapshot: IndexGenerationSnapshot | null | undefined): IndexUiState {
  if (!snapshot) return "unavailable";
  if (snapshot.stale) return "stale";
  return snapshot.status;
}

export function indexUiStatusLabel(state: IndexUiState): string {
  switch (state) {
    case "ready":
      return "Índice listo";
    case "rebuild_required":
      return "Reconstrucción requerida";
    case "stale":
      return "Índice desactualizado (stale)";
    case "unavailable":
      return "Sin índice";
    case "corrupt":
      return "Índice corrupto";
    case "loading":
      return "Cargando índice…";
    case "error":
      return "Error de índice";
    default:
      return state;
  }
}

export function indexUiStatusHint(state: IndexUiState): string {
  switch (state) {
    case "rebuild_required":
      return "El layout o la identidad del embedding cambió. Reindexá explícitamente.";
    case "stale":
      return "El vault cambió desde la última generación. Reindexá cuando quieras actualizar.";
    case "corrupt":
      return "La generación activa no pasó validación. Reindexá el proyecto.";
    default:
      return "";
  }
}
