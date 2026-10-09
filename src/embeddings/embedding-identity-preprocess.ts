import {
  DOCUMENT_PREFIX,
  PREPROCESS_MAX_UTF16,
  QUERY_PREFIX,
  type EmbeddingPurpose,
} from "./embedding-identity";

export function purposePrefix(purpose: EmbeddingPurpose): string {
  if (purpose === "query") return QUERY_PREFIX;
  if (purpose === "document") return DOCUMENT_PREFIX;
  throw new Error("INVALID_PURPOSE");
}

export function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      i += 1;
      continue;
    }
    if (cp >= 0xdc00 && cp <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function truncateUtf16CodeUnits(text: string, maxUnits: number = PREPROCESS_MAX_UTF16): string {
  if (hasLoneSurrogate(text)) {
    throw new Error("INVALID_TEXT");
  }
  let units = 0;
  let end = 0;
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const cost = cp > 0xffff ? 2 : 1;
    if (units + cost > maxUnits) {
      break;
    }
    units += cost;
    i += cp > 0xffff ? 2 : 1;
    end = i;
  }
  return text.slice(0, end);
}

export function prepareEmbeddingText(raw: string, purpose: EmbeddingPurpose): string {
  const truncated = truncateUtf16CodeUnits(raw);
  return `${purposePrefix(purpose)}${truncated}`;
}
