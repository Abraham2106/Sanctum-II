import { isNotFoundError } from "../core/vault-fs";
import type { VectorStoreAdapter } from "./vector-store";

export async function readExistingOrEmpty(
  adapter: Pick<VectorStoreAdapter, "read">,
  path: string
): Promise<string> {
  try {
    return await adapter.read(path);
  } catch (error) {
    if (isNotFoundError(error)) return "";
    throw error;
  }
}

export async function appendToFile(
  adapter: VectorStoreAdapter,
  path: string,
  content: string
): Promise<void> {
  if (typeof adapter.append === "function") {
    await adapter.append(path, content);
    return;
  }
  let existing = "";
  if (typeof adapter.exists === "function") {
    if (await adapter.exists(path)) {
      existing = await readExistingOrEmpty(adapter, path);
    }
  } else {
    existing = await readExistingOrEmpty(adapter, path);
  }
  await adapter.write(path, existing ? `${existing}${content}` : content);
}
