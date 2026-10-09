import { createHash } from "node:crypto";
import type { EmbeddingDescriptor } from "./embedding-identity";

function sortDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortDeep(record[key]);
  }
  return sorted;
}

export function canonicalJsonString(obj: unknown): string {
  return JSON.stringify(sortDeep(obj));
}

export function canonicalJsonBytes(obj: unknown): Buffer {
  return Buffer.from(canonicalJsonString(obj), "utf-8");
}

export function configFingerprint(descriptor: EmbeddingDescriptor): string {
  return createHash("sha256").update(canonicalJsonBytes(descriptor)).digest("hex");
}
