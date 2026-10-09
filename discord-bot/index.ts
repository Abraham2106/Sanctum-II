// DEC-0019: Discord conversa; Grok solo si hay XAI_API_KEY

import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import fs from "node:fs/promises";
import path from "node:path";
import {
  loadAgentFromVault,
  renderSystemPrompt,
} from "../src/agents/agent-loader.js";
import { parseOpenAiWire } from "../src/llm/chat-wire.js";
import {
  type DiscordLine,
  formatTail,
  mergeLines,
  parseChannelNote,
  questionText,
  renderChannelNote,
  shouldAnswer,
  tailLines,
} from "../src/discord/channel-log.js";
import {
  buildDiscordChatWire,
  buildDiscordHistory,
  buildDiscordSend,
  resolveDiscordChat,
} from "../src/discord/discord-api.js";

const token = (process.env.DISCORD_TOKEN ?? "").trim();
const guildId = (process.env.DISCORD_GUILD_ID ?? "").trim();
const channelIds = (process.env.DISCORD_CHANNEL_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

if (!token || !guildId || channelIds.length === 0) {
  console.error(
    "Faltan DISCORD_TOKEN, DISCORD_GUILD_ID o DISCORD_CHANNEL_IDS.",
  );
  process.exit(1);
}

const channelIdSet = new Set(channelIds);
const vault =
  (process.env.SANCTUM_VAULT_PATH ?? "").trim() ||
  path.resolve(process.cwd(), "notes");

const vaultAdapter = {
  read: (rel: string) =>
    fs.readFile(path.join(vault, rel), "utf8"),
};

function notePath(channelId: string): string | null {
  if (!/^\d+$/.test(channelId)) return null;
  return path.join(vault, "Discord-logs", `${channelId}.md`);
}

async function readNote(
  channelId: string,
  defaultName: string,
): Promise<{ channelName: string; lines: DiscordLine[] }> {
  const p = notePath(channelId);
  if (!p) {
    return { channelName: defaultName, lines: [] };
  }
  try {
    const md = await fs.readFile(p, "utf8");
    return parseChannelNote(md);
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code: unknown }).code
        : undefined;
    if (code === "ENOENT") {
      return { channelName: defaultName, lines: [] };
    }
    throw err;
  }
}

async function writeNote(
  channelId: string,
  channelName: string,
  lines: DiscordLine[],
): Promise<void> {
  const p = notePath(channelId);
  if (!p) return;
  await fs.mkdir(path.join(vault, "Discord-logs"), { recursive: true });
  await fs.writeFile(p, renderChannelNote(channelName, lines), "utf8");
}

const channelLocks = new Map<string, Promise<void>>();

function withChannelLock<T>(
  channelId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = channelLocks.get(channelId) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => fn());
  channelLocks.set(
    channelId,
    next.then(
      () => {},
      () => {},
    ),
  );
  return next;
}

function resolveChannelName(fetched: unknown, fallback: string): string {
  if (
    fetched &&
    typeof fetched === "object" &&
    "name" in fetched &&
    typeof (fetched as { name: unknown }).name === "string"
  ) {
    return (fetched as { name: string }).name;
  }
  return fallback;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("ready", async () => {
  for (const id of channelIds) {
    if (!/^\d+$/.test(id)) continue;
    await withChannelLock(id, async () => {
      let channelName = id;
      try {
        const ch = await client.channels.fetch(id);
        channelName = resolveChannelName(ch, id);
      } catch {
        /* keep id */
      }

      const note = await readNote(id, channelName);
      if (note.lines.length > 0) return;

      const histReq = buildDiscordHistory(id, token, 50);
      let raw: unknown;
      try {
        const res = await fetch(histReq.url, {
          method: histReq.method,
          headers: histReq.headers,
        });
        if (!res.ok) {
          console.error(`history ${id}: HTTP ${res.status}`);
          return;
        }
        raw = await res.json();
      } catch (err) {
        console.error(`history ${id}:`, err);
        return;
      }

      if (!Array.isArray(raw)) return;

      type HistRow = {
        id?: unknown;
        timestamp: string;
        author?: { bot?: boolean; username?: string };
        content?: string;
      };

      const incoming: DiscordLine[] = [...(raw as HistRow[])]
        .reverse()
        .filter(
          (m) =>
            typeof m.id === "string" &&
            m.author?.bot !== true &&
            typeof m.content === "string" &&
            m.content.trim().length > 0,
        )
        .map((m) => ({
          id: m.id as string,
          at: m.timestamp,
          author: m.author?.username ?? "user",
          content: m.content!,
        }));

      const merged = mergeLines(note.lines, incoming);
      await writeNote(id, channelName, merged);
    });
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.guildId !== guildId) return;
  if (!channelIdSet.has(message.channelId)) return;
  if (!/^\d+$/.test(message.channelId)) return;

  const channelId = message.channelId;
  const humanId = message.id;

  await withChannelLock(channelId, async () => {
    const fallbackName = channelId;
    let channelName = fallbackName;
    if (
      message.channel &&
      "name" in message.channel &&
      typeof message.channel.name === "string"
    ) {
      channelName = message.channel.name;
    }

    const note = await readNote(channelId, channelName);
    const humanLine: DiscordLine = {
      id: humanId,
      at: message.createdAt.toISOString(),
      author: message.author.username ?? "user",
      content: message.content,
    };
    const linesAfterHuman = mergeLines(note.lines, [humanLine]);
    await writeNote(channelId, channelName, linesAfterHuman);

    if (
      !shouldAnswer({
        content: message.content,
        mentionsBot: client.user
          ? message.mentions.has(client.user)
          : false,
      })
    ) {
      return;
    }

    const sendFallback = async () => {
      const req = buildDiscordSend(channelId, "No pude responder.", token);
      try {
        await fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body,
        });
      } catch (sendErr) {
        console.error(sendErr);
      }
    };

    try {
      const agent = await loadAgentFromVault(vaultAdapter, "discord.md");
      const system = renderSystemPrompt(
        agent,
        formatTail(tailLines(linesAfterHuman, 40)),
        questionText(message.content),
      );
      const user = questionText(message.content);
      const wire = buildDiscordChatWire(
        resolveDiscordChat(process.env),
        system,
        user,
      );
      const chatRes = await fetch(wire.url, {
        method: wire.method,
        headers: wire.headers,
        body: wire.body,
      });
      if (!chatRes.ok) {
        throw new Error(`chat HTTP ${chatRes.status}`);
      }
      const parsed = parseOpenAiWire(await chatRes.json());
      const outbound = parsed.content;
      const sendReq = buildDiscordSend(channelId, outbound, token);
      const sendRes = await fetch(sendReq.url, {
        method: sendReq.method,
        headers: sendReq.headers,
        body: sendReq.body,
      });
      if (!sendRes.ok) {
        throw new Error(`send HTTP ${sendRes.status}`);
      }

      const sentBody = (await sendRes.json()) as { id?: unknown };
      const sentText = outbound.slice(0, 1900);
      const outId =
        typeof sentBody.id === "string"
          ? sentBody.id
          : `out-${humanId}`;
      const sanctumLine: DiscordLine = {
        id: outId,
        at: new Date().toISOString(),
        author: "sanctum",
        content: sentText,
      };
      const linesFinal = mergeLines(linesAfterHuman, [sanctumLine]);
      await writeNote(channelId, channelName, linesFinal);
    } catch (err) {
      console.error(err);
      await sendFallback();
    }
  });
});

client.login(token);
