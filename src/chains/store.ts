import type { Chain } from "./types";
import { defaultChain } from "./types";
import type { VaultAdapter } from "../core/vault-adapter";
import { ensureVaultDirectory } from "../core/vault-fs";

const CHAINS_DIR = "sanctum-chains";

export class ChainStore {
  constructor(private adapter: VaultAdapter) {}

  private chainPath(name: string): string { return `${CHAINS_DIR}/${name}.json`; }

  async load(name: string): Promise<Chain | null> {
    try {
      const raw = await this.adapter.read(this.chainPath(name));
      return JSON.parse(raw);
    } catch { return null; }
  }

  async save(chain: Chain): Promise<void> {
    await ensureVaultDirectory(this.adapter, CHAINS_DIR);
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
