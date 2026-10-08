// DEC-0008: este trabajo vive aparte del archivo que lo mezcla
import type { KgEdge } from "../kg/types";

export interface KgInspectorData {
  adjacency: Map<string, string[]>;
  edges: KgEdge[];
}

export class KgInspector {
  private root!: HTMLElement;

  mount(parent: HTMLElement): HTMLElement {
    this.root = parent.createDiv({ cls: "s-kg-inspector" });
    this.root.createDiv({ cls: "s-kg-inspector-title", text: "Inspector" });
    return this.root;
  }

  update(id: string | null, data: KgInspectorData, onSendToChat: (seed: string) => void): void {
    this.root.empty();
    this.root.createDiv({ cls: "s-kg-inspector-title", text: "Inspector" });

    if (!id) {
      this.root.createDiv({ cls: "s-kg-inspector-empty", text: "Seleccioná un nodo" });
      return;
    }

    const content = this.root.createDiv({ cls: "s-kg-inspector-content" });

    // Header
    const header = content.createDiv({ cls: "s-kg-inspector-header" });
    header.createSpan({ text: id.replace(/\.md$/i, "").split("/").pop() || id, attr: { style: "font-weight:700;font-size:14px" } });
    content.createDiv({ cls: "s-kg-inspector-path", text: id, attr: { style: "font-size:11px;color:var(--text-3);margin-bottom:8px" } });

    // Meta chips
    const degree = data.adjacency.get(id)?.length || 0;
    const meta = content.createDiv({ cls: "s-kg-inspector-meta" });
    meta.createSpan({ cls: "s-kg-chip", text: `Grado ${degree}` });

    // Connections list
    const neighbors = data.adjacency.get(id) || [];
    if (neighbors.length > 0) {
      content.createDiv({ text: "Conexiones", attr: { style: "font-weight:600;font-size:12px;margin:10px 0 6px;color:var(--text-2)" } });

      for (const nid of neighbors) {
        const row = content.createDiv({ cls: "s-kg-inspector-row" });

        // Find the edge to get type/relation
        const edge = data.edges.find(e =>
          (e.from === id && e.to === nid) || (e.from === nid && e.to === id)
        );

        const dot = row.createSpan({ cls: "s-kg-inspector-dot" });
        if (edge?.type === "reinforced") dot.style.background = "var(--brand)";
        else if (edge?.type === "explicit") dot.style.background = "rgba(255,255,255,0.4)";
        else dot.style.background = "var(--brand)";
        dot.style.opacity = edge?.type === "semantic" ? "0.5" : "1";

        const name = (nid.replace(/\.md$/i, "").split("/").pop() || nid).slice(0, 22);
        row.createSpan({ text: name, attr: { style: "flex:1;font-size:12px;color:var(--text-2)" } });

        const chip = row.createSpan({ cls: "s-kg-inspector-chip" });
        chip.setText(edge?.relation || "wikilink");

        if (edge?.type === "semantic" && edge.weight) {
          row.createSpan({ text: edge.weight.toFixed(2), attr: { style: "font-size:10px;color:var(--text-3);width:30px;text-align:right;font-family:monospace" } });
        }
      }
    }

    // Actions
    const actions = content.createDiv({ cls: "s-kg-inspector-actions" });
    const openBtn = actions.createEl("button", { cls: "s-kg-inspector-btn", text: "Abrir nota" });
    openBtn.onclick = () => {
      onSendToChat(id);
    };
    const chatBtn = actions.createEl("button", { cls: "s-kg-inspector-btn primary", text: "Enviar al chat" });
    chatBtn.onclick = () => {
      onSendToChat(id);
    };
  }
}
