export function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60000) return "ahora";
  if (d < 3600000) return `${Math.floor(d / 60000)}m`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h`;
  return `${Math.floor(d / 86400000)}d`;
}

export function cardTitle(parent: HTMLElement, lucide: string, text: string, setIcon: (el: HTMLElement, icon: string) => void): HTMLElement {
  const d = parent.createDiv({ cls: "s-proj-card-title" });
  const ic = d.createSpan({ attr: { style: "display:inline-flex;vertical-align:middle;margin-right:4px" } });
  setIcon(ic, lucide);
  d.appendText(" " + text);
  return d;
}
