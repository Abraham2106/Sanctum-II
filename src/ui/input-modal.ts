import { Modal, App } from "obsidian";

export class InputModal extends Modal {
  private result: string | null = null;
  private resolve!: (value: string | null) => void;

  constructor(
    app: App,
    private title: string,
    private placeholder: string,
    private defaultValue: string = "",
  ) {
    super(app);
  }

  async ask(): Promise<string | null> {
    return new Promise((res) => {
      this.resolve = res;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createDiv({ text: this.title, attr: { style: "font-weight:600;margin-bottom:12px;font-size:14px" } });

    const input = contentEl.createEl("input", {
      attr: {
        type: "text",
        placeholder: this.placeholder,
        value: this.defaultValue,
        style: "width:100%;padding:8px;border-radius:6px;border:1px solid var(--border-strong);background:var(--surface);color:var(--text);font-size:13px;outline:none;box-sizing:border-box",
      },
    });
    input.focus();
    input.select();

    const btnRow = contentEl.createDiv({ attr: { style: "display:flex;gap:8px;margin-top:12px;justify-content:flex-end" } });

    const cancelBtn = btnRow.createEl("button", {
      text: "Cancelar",
      attr: { style: "padding:6px 14px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text-2);cursor:pointer" },
    });
    cancelBtn.onclick = () => { this.result = null; this.close(); };

    const okBtn = btnRow.createEl("button", {
      text: "Aceptar",
      attr: { style: "padding:6px 14px;border-radius:6px;border:none;background:var(--brand);color:#fff;font-weight:600;cursor:pointer" },
    });
    okBtn.onclick = () => { this.result = input.value; this.close(); };

    input.onkeydown = (e) => {
      if (e.key === "Enter") { this.result = input.value; this.close(); }
      if (e.key === "Escape") { this.result = null; this.close(); }
    };
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolve(this.result);
  }
}
