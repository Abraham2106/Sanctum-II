export function vectorNorm(values: number[]): number {
  let sum = 0;
  for (const v of values) {
    sum += v * v;
  }
  return Math.sqrt(sum);
}

export function validateEmbeddingVector(values: unknown, dims: number): values is number[] {
  if (!Array.isArray(values) || values.length !== dims) return false;
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) return false;
  }
  if (vectorNorm(values) === 0) return false;
  return true;
}

export function validateEmbeddingBatch(
  embeddings: unknown,
  expectedCount: number,
  dims: number,
): embeddings is number[][] {
  if (!Array.isArray(embeddings) || embeddings.length !== expectedCount) return false;
  for (const row of embeddings) {
    if (!validateEmbeddingVector(row, dims)) return false;
  }
  return true;
}
