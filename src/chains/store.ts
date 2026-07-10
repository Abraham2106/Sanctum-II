import type { Chain } from "./types";
import { defaultChain } from "./types";

const CHAINS_DIR = "sanctum-chains";

export class ChainStore {
  constructor(
    private adapter: {
      read: (p: string) => Promise<string>;
      write: (p: string, c: string) => Promise<void>;
      list: (p: string) => Promise<{ files: string[]; folders: string[] }>;
      exists: (p: string) => Promise<boolean>;
    }
  ) {}

  private chainPath(name: string): string { return `${CHAINS_DIR}/${name}.json`; }

  async load(name: string): Promise<Chain | null> {
    try {
      const raw = await this.adapter.read(this.chainPath(name));
      return JSON.parse(raw);
    } catch { return null; }
  }

  async save(chain: Chain): Promise<void> {
    const dir = CHAINS_DIR;
    try { await this.adapter.write(`${dir}/.gitkeep`, ""); } catch {
      // If .gitkeep creation fails, the directory might not exist;
      // The next write will also fail, which is caught by the caller.
    }
    await this.adapter.write(this.chainPath(chain.id), JSON.stringify(chain, null, 2));
  }

  async list(): Promise<string[]> {
    try {
      const listing = await this.adapter.list(CHAINS_DIR);
      return listing.files.filter(f => f.endsWith(".json")).map(f => f.replace(/^.*[\\/]/, "").replace(".json", ""));
    } catch { return []; }
  }

  async delete(name: string): Promise<void> {
    try { await this.adapter.write(this.chainPath(name), ""); } catch {}
  }

  async create(id: string, projectId: string, name?: string): Promise<Chain> {
    const c = defaultChain(id, projectId);
    if (name) c.name = name;
    await this.save(c);
    return c;
  }
}
