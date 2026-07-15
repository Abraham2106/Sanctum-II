import { setIcon } from "obsidian";
import type { MeshResultFull } from "../orchestrator/mesh";

export class ChatRightPanel {
  private el!: HTMLElement;
  private traceContent!: HTMLElement;
  private sourcesContent!: HTMLElement;
  private tabContent!: HTMLElement;
  private built = false;

  build(parent: HTMLElement): void {
    if (this.built) return;
    this.built = true;
    this.el = parent;

    const header = this.el.createDiv({ cls: "s-right-header" });
    const headerIcon = header.createSpan();
    setIcon(headerIcon, "activity");
    header.createSpan({ text: " Trace & Fuentes" });

    const tabs = this.el.createDiv({ cls: "s-tabs" });
    const traceTab = tabs.createDiv({ cls: "s-tab is-active", text: "Trace" });
    const sourcesTab = tabs.createDiv({ cls: "s-tab", text: "Fuentes" });

    // Tab target
    this.tabContent = this.el.createDiv({ cls: "s-tab-content is-active" });
    this.traceContent = this.tabContent.createDiv();
    this.sourcesContent = this.el.createDiv({ cls: "s-tab-content" });

    traceTab.onclick = () => this.switchTab("trace", traceTab, sourcesTab);
    sourcesTab.onclick = () => this.switchTab("sources", traceTab, sourcesTab);

    this.renderEmptyTrace();
  }

  private switchTab(which: "trace" | "sources", traceTab: HTMLElement, sourcesTab: HTMLElement): void {
    traceTab.classList.toggle("is-active", which === "trace");
    sourcesTab.classList.toggle("is-active", which === "sources");
    this.traceContent.style.display = which === "trace" ? "block" : "none";
    this.sourcesContent.style.display = which === "sources" ? "block" : "none";
  }

  renderEmptyTrace(): void {
    this.traceContent.empty();
    const empty = this.traceContent.createDiv({ cls: "s-empty-state" });
    const icon = empty.createDiv({ cls: "s-empty-icon" });
    setIcon(icon, "clock");
    empty.createDiv({ text: "El trace del último Mesh aparecerá aquí." });
  }

  renderTracePanel(result: MeshResultFull): void {
    this.traceContent.empty();
    const ls = result.loopState;
    if (!ls?.history?.length) { this.renderEmptyTrace(); return; }

    // Score progression
    if (ls.attempts?.length > 0) {
      const prog = this.traceContent.createDiv({ cls: "s-trace-progression" });
      const progTitle = prog.createDiv({ cls: "s-trace-prog-title" });
      setIcon(progTitle.createSpan(), "bar-chart");
      progTitle.createSpan({ text: " Progreso de scores" });

      for (const a of ls.attempts) {
        const row = prog.createDiv({ cls: "s-trace-prog-row" });
        const isBest = a.total_score === Math.max(...ls.attempts.map(x => x.total_score));
        const label = row.createDiv({ cls: "s-trace-prog-label" });
        label.setText(`#${a.attempt}`);
        if (isBest) label.addClass("is-best");

        const barOuter = row.createDiv({ cls: "s-trace-prog-bar" });
        const fillPct = Math.min(100, Math.max(0, a.total_score));
        const barFill = barOuter.createDiv({ cls: "s-trace-prog-fill" });
        barFill.style.width = `${fillPct}%`;

        const scoreText = row.createDiv({ cls: "s-trace-prog-score" });
        scoreText.setText(`${a.total_score}/100`);

        if (a.criteria?.length) {
          const chips = row.createDiv({ cls: "s-trace-prog-criteria" });
          for (const c of a.criteria) {
            const chip = chips.createDiv({ cls: "s-trace-prog-chip" });
            chip.createSpan({ text: c.name.replace(/_/g, " ").slice(0, 14) });
            const val = chip.createSpan({ cls: `crit-${c.score >= 16 ? "high" : c.score >= 10 ? "med" : "low"}` });
            val.setText(`${c.score}`);
          }
        }
      }
    }

    // Timeline
    for (const entry of ls.history) {
      const step = this.traceContent.createDiv({ cls: "s-trace-step" });
      let dotColor = "brand";
      if (entry.agent === "researcher") dotColor = "brand";
      if (entry.agent === "critic") {
        if (entry.verdict === "accept") dotColor = "green";
        else if (entry.verdict === "reject") dotColor = ls.current_step === "escalated" ? "red" : "orange";
      }
      if (entry.agent === "forager") dotColor = "muted";

      const dot = step.createDiv({ cls: `s-trace-dot ${dotColor}` });
      const body = step.createDiv({ cls: "s-trace-body" });

      const iconId = entry.agent === "forager" ? "search" : entry.agent === "researcher" ? "book-open" : "scale";
      const titleSpan = body.createDiv({ cls: "s-trace-title" });
      const stepIcon = titleSpan.createSpan();
      setIcon(stepIcon, iconId);
      titleSpan.createSpan({ text: ` ${entry.agent}` });

      const meta = body.createDiv({ cls: "s-trace-meta" });
      if (entry.score !== undefined) meta.setText(`Score: ${entry.score}/100 · ${entry.verdict}`);
      if (entry.usage) {
        const tok = body.createDiv({ cls: "s-trace-tokens" });
        tok.createEl("span", { text: `↑ ${entry.usage.prompt}` });
        tok.createEl("span", { text: `↓ ${entry.usage.completion}` });
      }
      if (entry.output) body.createDiv({ cls: "s-trace-output", text: entry.output.slice(0, 200) });
    }

    const summary = this.traceContent.createDiv({ attr: { style: "margin-top:12px;font-size:12px;color:var(--text-3);padding:8px;background:var(--raised);border-radius:6px;" } });
    summary.setText(`${result.criticVerdict === "escalated" ? "⚠️ Escalado" : "✅ Aceptado"} · ${result.attempts} intento(s) · Score: ${result.criticScore}/100`);
  }

  renderSourcesPanel(sources: { note_path: string; score: number }[]): void {
    this.sourcesContent.empty();
    if (!sources.length) {
      const empty = this.sourcesContent.createDiv({ cls: "s-empty-state" });
      const emptyIcon = empty.createDiv({ cls: "s-empty-icon" });
      setIcon(emptyIcon, "file-text");
      empty.createDiv({ text: "Sin fuentes RAG en este mensaje." });
      return;
    }
    for (const s of sources) {
      const card = this.sourcesContent.createDiv({ cls: "s-source-card" });
      const header = card.createDiv({ cls: "s-source-card-header" });
      const nameDiv = header.createDiv({ cls: "s-source-card-name" });
      const docIcon = nameDiv.createSpan();
      setIcon(docIcon, "file-text");
      nameDiv.createSpan({ text: ` ${s.note_path.replace(/^.*\//, "")}` });
      const scoreClass = s.score >= 0.85 ? "high" : s.score >= 0.70 ? "med" : "low";
      header.createDiv({ cls: `s-source-score ${scoreClass}`, text: s.score.toFixed(3) });
      card.createDiv({ cls: "s-source-excerpt", text: s.note_path });
    }
  }

  updateSources(sources: { note_path: string; score: number }[]): void {
    this.renderSourcesPanel(sources);
  }
}
