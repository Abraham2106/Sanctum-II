import { SuggestModal, App } from "obsidian";

export class FolderSelectModal extends SuggestModal<string> {
  private folders: string[] = [];

  constructor(
    app: App,
    private onSelect: (path: string) => void,
    private basePath: string = "",
  ) {
    super(app);
    this.setPlaceholder("Buscar carpeta…");
    this.loadFolders();
  }

  private async loadFolders(): Promise<void> {
    const all: string[] = [];
    const crawl = async (path: string) => {
      try {
        const listing = await this.app.vault.adapter.list(path);
        for (const folder of listing.folders) {
          const normalized = folder.replace(/\\/g, "/");
          all.push(normalized);
          await crawl(normalized);
        }
      } catch {}
    };
    const start = this.basePath || "";
    const exists = await this.app.vault.adapter.exists(start).catch(() => false);
    if (exists || !start) {
      if (start) all.push(start);
      await crawl(start);
    }
    // Also list root folders
    if (!start) {
      try {
        const root = await this.app.vault.adapter.list("");
        for (const f of root.folders) {
          const norm = f.replace(/\\/g, "/");
          if (!all.includes(norm)) all.push(norm);
        }
      } catch {}
    }
    this.folders = all.sort();
  }

  getSuggestions(query: string): string[] {
    const q = query.toLowerCase();
    return this.folders.filter(f => f.toLowerCase().includes(q));
  }

  renderSuggestion(folder: string, el: HTMLElement): void {
    el.createSpan({ text: "📁 " });
    el.createSpan({ text: folder });
  }

  onChooseSuggestion(folder: string): void {
    this.onSelect(folder);
  }
}
