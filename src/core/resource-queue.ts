/**
 * DEC-0022: per-adapter shared serialization queues for vault-backed resources.
 * Locks are ordered lexicographically when multiple resources are taken together.
 */

const tailsByAdapter = new WeakMap<object, Map<string, Promise<void>>>();

function queueMap(adapter: object): Map<string, Promise<void>> {
  let map = tailsByAdapter.get(adapter);
  if (!map) {
    map = new Map();
    tailsByAdapter.set(adapter, map);
  }
  return map;
}

/** Reject path segments that would escape a vault subtree. */
export function validateVaultSegmentId(id: string, kind: string): void {
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`Invalid ${kind} id`);
  }
  if (id.includes("..") || /[/\\:\0]/.test(id)) {
    throw new Error(`${kind} id traversal denied`);
  }
  if (id !== id.trim()) {
    throw new Error(`Invalid ${kind} id`);
  }
}

export async function withResourceLock<T>(
  adapter: object,
  resource: string,
  work: () => Promise<T>
): Promise<T> {
  return withResourceLocks(adapter, [resource], work);
}

type HeldLock = { resource: string; release: () => void; gate: Promise<void> };

export async function withResourceLocks<T>(
  adapter: object,
  resources: string[],
  work: () => Promise<T>
): Promise<T> {
  const unique = [...new Set(resources)].sort();
  if (unique.length === 0) return work();

  const queues = queueMap(adapter);
  const held: HeldLock[] = [];

  for (const resource of unique) {
    const previous = queues.get(resource) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    queues.set(resource, gate);
    await previous;
    held.push({ resource, release, gate });
  }

  try {
    return await work();
  } finally {
    for (let i = held.length - 1; i >= 0; i--) {
      const { resource, release, gate } = held[i];
      release();
      if (queues.get(resource) === gate) {
        queues.delete(resource);
      }
    }
  }
}
