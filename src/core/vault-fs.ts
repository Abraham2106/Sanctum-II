import type { VaultAdapter } from "./vault-adapter";

/** Returns true when an adapter error means that a file or directory is absent. */
export function isNotFoundError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  if (candidate?.code === "ENOENT") return true;
  return typeof candidate?.message === "string" && /(?:ENOENT|not found|no such file|does not exist)/i.test(candidate.message);
}

/**
 * Creates a vault directory and all missing parents. Obsidian's DataAdapter.mkdir
 * is intentionally non-recursive, so every segment must be created explicitly.
 */
export async function ensureVaultDirectory(adapter: Pick<VaultAdapter, "exists" | "mkdir">, rawPath: string): Promise<void> {
  const normalized = rawPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) return;

  const segments = normalized.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === ".." || segment.includes("\0"))) {
    throw new Error(`Invalid vault directory path: ${rawPath}`);
  }

  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    if (await adapter.exists(current)) continue;
    try {
      await adapter.mkdir(current);
    } catch (error) {
      // Another caller may have created the directory between exists() and mkdir().
      if (!(await adapter.exists(current))) throw error;
    }
  }
}
