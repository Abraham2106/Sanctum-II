import { isNotFoundError } from "../core/vault-fs";

export type KgPersistAdapter = {
  read?: (p: string) => Promise<string>;
  write: (p: string, content: string) => Promise<void>;
  append?: (p: string, content: string) => Promise<void>;
};

export function kgAdapterHasRead(
  adapter: KgPersistAdapter
): adapter is KgPersistAdapter & { read: (p: string) => Promise<string> } {
  return typeof adapter.read === "function";
}

export async function readExistingOrEmpty(
  adapter: { read: (p: string) => Promise<string> },
  path: string
): Promise<string> {
  try {
    return await adapter.read(path);
  } catch (error) {
    if (isNotFoundError(error)) return "";
    throw error;
  }
}

export class KgPersistRequiresReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KgPersistRequiresReadError";
  }
}
