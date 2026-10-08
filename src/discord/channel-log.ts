// DEC-0019: Discord conversa; Grok solo si hay XAI_API_KEY

export type DiscordLine = {
  id: string;
  at: string;
  author: string;
  content: string;
};

const LINE_RE = /^- (\S+) (\S+) \*\*([^*]+)\*\*: (.*)$/;

function collapseContent(text: string): string {
  // ponytail: el texto guardado pierde los saltos de línea
  return text.replace(/\s+/g, " ").trim();
}

export function renderChannelNote(
  channelName: string,
  lines: DiscordLine[],
): string {
  const title = channelName.trim() ? channelName.trim() : "canal";
  const parts = [`# ${title}`];
  for (const line of lines) {
    const content = collapseContent(line.content);
    parts.push(`- ${line.id} ${line.at} **${line.author}**: ${content}`);
  }
  return `${parts.join("\n")}\n`;
}

export function parseChannelNote(md: string): {
  channelName: string;
  lines: DiscordLine[];
} {
  const rows = md.split(/\r?\n/);
  let channelName = "canal";
  const lines: DiscordLine[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (i === 0 && row.startsWith("# ")) {
      channelName = row.slice(2).trim() || "canal";
      continue;
    }
    const m = LINE_RE.exec(row);
    if (!m) continue;
    lines.push({
      id: m[1],
      at: m[2],
      author: m[3],
      content: m[4],
    });
  }

  return { channelName, lines };
}

export function mergeLines(
  existing: DiscordLine[],
  incoming: DiscordLine[],
): DiscordLine[] {
  const seen = new Set<string>();
  const out: DiscordLine[] = [];

  const keep = (line: DiscordLine) => {
    const id = line.id.trim();
    if (!id || seen.has(id)) return;
    const t = line.content.trim();
    if (t.startsWith("!") && !/^!sanctum\b/i.test(t)) return;
    seen.add(id);
    out.push({ ...line, id });
  };

  for (const line of existing) keep(line);
  for (const line of incoming) keep(line);
  return out;
}

export function shouldAnswer(input: {
  content: string;
  mentionsBot: boolean;
}): boolean {
  const t = input.content.trim();
  if (/^!sanctum\b/i.test(t)) return true;
  if (t.startsWith("!")) return false;
  return input.mentionsBot;
}

export function questionText(content: string): string {
  return content
    .replace(/^!sanctum\b/i, "")
    .replace(/<@!?\d+>/g, "")
    .trim();
}

export function tailLines(lines: DiscordLine[], n: number): DiscordLine[] {
  if (n < 1) return [];
  return lines.slice(-n);
}

export function formatTail(lines: DiscordLine[]): string {
  return lines.map((l) => `${l.author}: ${l.content}`).join("\n");
}
