/**
 * DEC-0022: [] denies all paths; undefined means no extra folder restriction.
 * Views must never pass [] to executeTurn / executeChain as a scope widen or grant.
 */
export function resolveComposerPathFilter(folderValue: string | null | undefined): string[] | undefined {
  const trimmed = folderValue?.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return undefined;
  return [`${normalized}/**`];
}

export function chainExecutionPathFilter(activeFolder: string | null | undefined): string[] | undefined {
  return resolveComposerPathFilter(activeFolder ?? undefined);
}
