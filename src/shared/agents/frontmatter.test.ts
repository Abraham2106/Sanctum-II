import { describe, expect, it } from "vitest";
import {
  FrontmatterError,
  normalizeDocumentText,
  parseFrontmatter,
  splitFrontmatter,
} from "./frontmatter";

describe("frontmatter (DEC-0022)", () => {
  const lfAgent =
    '---\nid: forager\npermissions:\n  read_paths: ["/Research/**"]\n  write_paths: []\n---\nAgent body\n';

  it("normalizes UTF-8 BOM", () => {
    const withBom = `\ufeff${lfAgent}`;
    expect(splitFrontmatter(withBom)).toEqual(splitFrontmatter(lfAgent));
  });

  it("accepts Windows CRLF line endings", () => {
    const crlf = lfAgent.replace(/\n/g, "\r\n");
    expect(splitFrontmatter(crlf)).toEqual(splitFrontmatter(lfAgent));
  });

  it("throws FRONTMATTER_BLOCK_MISSING when delimiters are absent", () => {
    try {
      splitFrontmatter("# no frontmatter\n");
      expect.unreachable("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FrontmatterError);
      expect((err as FrontmatterError).code).toBe("FRONTMATTER_BLOCK_MISSING");
    }
  });

  it("throws FRONTMATTER_YAML_INVALID on malformed YAML", () => {
    const bad = "---\nid: [unclosed\n---\nbody\n";
    try {
      splitFrontmatter(bad);
      expect.unreachable("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FrontmatterError);
      expect((err as FrontmatterError).code).toBe("FRONTMATTER_YAML_INVALID");
    }
  });

  it("normalizeDocumentText strips BOM and CRLF", () => {
    expect(normalizeDocumentText("\ufeffa\r\nb\rc")).toBe("a\nb\nc");
  });

  it("parseFrontmatter rejects scalar YAML at root", () => {
    try {
      parseFrontmatter("just-a-string");
      expect.unreachable("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FrontmatterError);
      expect((err as FrontmatterError).code).toBe("FRONTMATTER_NOT_OBJECT");
    }
  });
});
