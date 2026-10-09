import type { EmbeddingHealthSnapshot } from "../plugin/embedding-service";

export function embeddingHealthLabel(snapshot: EmbeddingHealthSnapshot): string {
  switch (snapshot.state) {
    case "ready":
      return "Embeddings listos";
    case "loading":
      return "Cargando runtime local…";
    case "unconfigured":
      return "Proveedor no configurado";
    case "missing_runtime":
      return "Runtime local no detectado";
    case "auth_failure":
      return "Autenticación local rechazada";
    case "config_mismatch":
      return "Configuración incompatible (rebuild required)";
    case "failed":
      return "Error del servicio de embeddings";
    default:
      return snapshot.state;
  }
}

/** Never include secrets such as the bearer token. */
export function embeddingHealthDetail(snapshot: EmbeddingHealthSnapshot): string {
  const backend = snapshot.config.backend;
  const dims = snapshot.config.dims;
  const port = snapshot.config.localPort;
  if (backend === "gemini") {
    return `Backend Gemini · ${dims}d. El chat LLM usa su propio proveedor; embeddings offline no implican chat offline.`;
  }
  return `Backend local en 127.0.0.1:${port} · ${dims}d. Iniciá el sidecar Python manualmente; no se descargan pesos desde el plugin.`;
}
