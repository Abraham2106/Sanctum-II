import { describe, expect, it } from "vitest";
import {
  buildLocalIdentity,
  canonicalJsonString,
  configFingerprint,
  DOCUMENT_PREFIX,
  prepareEmbeddingText,
  QUERY_PREFIX,
  truncateUtf16CodeUnits,
  validateEmbeddingBatch,
  validateEmbeddingVector,
} from "./embedding-identity";

const REV = "abcdef0123456789abcdef0123456789abcdef01";

const RUNTIME = {
  python: "3.12.0",
  torch: "2.5.0",
  transformers: "4.48.0",
  sentence_transformers: "3.3.0",
};

describe("embedding-identity (DEC-0023)", () => {
  it("computes stable canonical fingerprint matching Python key order", () => {
    const identity = buildLocalIdentity(REV, 768, "cpu", "float32", RUNTIME);
    const fp = configFingerprint(identity.descriptor);
    expect(identity.configFingerprint).toBe(fp);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    const again = configFingerprint(JSON.parse(canonicalJsonString(identity.descriptor)));
    expect(again).toBe(fp);
    expect(fp).toBe("52fc6aa0cb3d5a4f68dbeddca443dff11ae679a1b41e43d44c35c59c6f3503d7");
  });

  it("applies query/document prefix exactly once in client preparation", () => {
    const raw = "hello";
    expect(prepareEmbeddingText(raw, "query")).toBe(`${QUERY_PREFIX}${raw}`);
    expect(prepareEmbeddingText(raw, "document")).toBe(`${DOCUMENT_PREFIX}${raw}`);
  });

  it("truncates to first 3000 UTF-16 code units", () => {
    const emoji = "😀";
    const long = "a".repeat(2999) + emoji;
    const out = truncateUtf16CodeUnits(long);
    expect(out).toBe("a".repeat(2999));
    expect(truncateUtf16CodeUnits("a".repeat(3000)).length).toBe(3000);
  });

  it("rejects invalid vectors (zero norm, NaN, boolean-as-number, count mismatch)", () => {
    expect(validateEmbeddingVector([1, 0, 0], 3)).toBe(true);
    expect(validateEmbeddingVector([0, 0, 0], 3)).toBe(false);
    expect(validateEmbeddingVector([Number.NaN, 0, 0], 3)).toBe(false);
    expect(validateEmbeddingVector([1, 0], 3)).toBe(false);
    expect(validateEmbeddingBatch([[1, 0, 0]], 1, 3)).toBe(true);
    expect(validateEmbeddingBatch([[1, 0, 0], [0, 1, 0]], 1, 3)).toBe(false);
    expect(validateEmbeddingBatch([[true as unknown as number, 0, 0]], 1, 3)).toBe(false);
  });
});
