// DEC-0005: un contrato de embedding; la API de Gemini es la única implementación
// ponytail: solo API Gemini. Techo: sin clave no hay vectores. Subir a EmbeddingGemma 2 (google/embeddinggemma-2, 768-d) con runtime local y reindexado; no mezclar vectores.

export const PRIORITY_MODELS = [
  "gemini-embedding-2",
  "gemini-embedding-001",
] as const;

export const OUTPUT_DIMS = 768;

export const MAX_TEXT_LENGTH = 3000;

export function embedContentJsonBody(model: string, text: string): {
  model: string;
  content: { parts: [{ text: string }] };
  outputDimensionality: number;
} {
  return {
    model: `models/${model}`,
    content: { parts: [{ text }] },
    outputDimensionality: OUTPUT_DIMS,
  };
}
