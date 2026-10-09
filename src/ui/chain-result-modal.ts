import { Modal, Notice } from "obsidian";
import type { DagExecutionResult } from "../runtime/dag";
import { formatTerminalFinalOutput } from "../runtime/dag";

export class ChainResultModal extends Modal {
  constructor(
    app: ConstructorParameters<typeof Modal>[0],
    private readonly outcome: DagExecutionResult,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.maxWidth = "700px";
    contentEl.style.maxHeight = "80vh";
    contentEl.style.overflowY = "auto";

    const statusLine =
      this.outcome.status === "completed"
        ? `Completado (${this.outcome.order.length} pasos)`
        : this.outcome.status === "cancelled"
          ? `Cancelado (${this.outcome.results.length}/${this.outcome.order.length} pasos)`
          : `Error parcial (${this.outcome.results.length}/${this.outcome.order.length} pasos)`;

    contentEl.createDiv({
      text: `Resultado de cadena — ${statusLine}`,
      attr: {
        style:
          "font-weight:700;font-size:16px;color:var(--brand);margin-bottom:8px;padding-bottom:8px;border-bottom:2px solid var(--brand)",
      },
    });

    if (this.outcome.error) {
      contentEl.createDiv({
        text: this.outcome.error,
        attr: {
          style:
            "padding:8px 10px;border-radius:6px;margin-bottom:12px;font-size:12px;background:var(--red-soft);color:var(--red);border:1px solid var(--red)",
        },
      });
    }

    if (this.outcome.terminalOutputs.length > 1) {
      contentEl.createDiv({
        text: `${this.outcome.terminalOutputs.length} salidas terminales`,
        attr: { style: "font-size:11px;color:var(--text-3);margin-bottom:8px" },
      });
    }

    const body = contentEl.createDiv({
      attr: {
        style:
          "font-size:13px;color:var(--text-2);line-height:1.6;white-space:pre-wrap;word-break:break-word",
      },
    });
    body.setText(formatTerminalFinalOutput(this.outcome.terminalOutputs) || this.outcome.finalOutput);

    const btnRow = contentEl.createDiv({ attr: { style: "margin-top:16px;display:flex;justify-content:flex-end" } });
    const copyBtn = btnRow.createEl("button", {
      text: "📋 Copiar",
      attr: {
        style:
          "padding:6px 14px;border-radius:6px;border:1px solid var(--border);background:var(--raised);color:var(--text-2);cursor:pointer;font-size:12px",
      },
    });
    const text = body.textContent || "";
    copyBtn.onclick = () => {
      void navigator.clipboard.writeText(text);
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
