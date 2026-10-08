// DEC-0008: este trabajo vive aparte del archivo que lo mezcla

import { App, Modal, Notice } from "obsidian";

export class ResultModal extends Modal {
  constructor(
    app: App,
    private output: string,
    private steps: number,
    private hasError: boolean,
    private criticScore?: string,
  ) {
    super(app);
  }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.maxWidth = "700px";
    contentEl.style.maxHeight = "80vh";
    contentEl.style.overflowY = "auto";

    contentEl.createDiv({
      text: `Resultado final (${this.steps} pasos)${this.hasError ? " — con errores" : ""}`,
      attr: {
        style:
          "font-weight:700;font-size:16px;color:var(--brand);margin-bottom:8px;padding-bottom:8px;border-bottom:2px solid var(--brand)",
      },
    });

    if (this.criticScore) {
      const critDiv = contentEl.createDiv({
        attr: {
          style:
            "padding:8px 10px;border-radius:6px;margin-bottom:12px;font-size:12px;white-space:pre-wrap;background:var(--orange-soft);color:var(--orange);border:1px solid var(--orange)",
        },
      });
      critDiv.setText(this.criticScore);
    }

    const body = contentEl.createDiv({
      attr: {
        style:
          "font-size:13px;color:var(--text-2);line-height:1.6;white-space:pre-wrap;word-break:break-word",
      },
    });
    body.setText(this.output);

    const btnRow = contentEl.createDiv({
      attr: { style: "margin-top:16px;display:flex;justify-content:flex-end" },
    });
    const copyBtn = btnRow.createEl("button", {
      text: "📋 Copiar",
      attr: {
        style:
          "padding:6px 14px;border-radius:6px;border:1px solid var(--border);background:var(--raised);color:var(--text-2);cursor:pointer;font-size:12px",
      },
    });
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(this.output);
      new Notice("📋 Copiado al portapapeles");
    };
    const closeBtn = btnRow.createEl("button", {
      text: "Cerrar",
      attr: {
        style:
          "padding:6px 14px;border-radius:6px;border:none;background:var(--brand);color:#fff;cursor:pointer;font-size:12px;margin-left:8px",
      },
    });
    closeBtn.onclick = () => this.close();
  }
  onClose(): void {
    this.contentEl.empty();
  }
}
