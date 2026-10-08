import { describe, expect, it } from "vitest";
import {
  formatTail,
  mergeLines,
  parseChannelNote,
  questionText,
  renderChannelNote,
  shouldAnswer,
  tailLines,
  type DiscordLine,
} from "./channel-log";

describe("renderChannelNote / parseChannelNote", () => {
  it("roundtrips channel name, id, at, author and content", () => {
    const lines: DiscordLine[] = [
      {
        id: "msg1",
        at: "2026-01-01T00:00:00Z",
        author: "alice",
        content: "hola\nmundo",
      },
    ];
    const md = renderChannelNote("general", lines);
    expect(md).toBe(
      "# general\n- msg1 2026-01-01T00:00:00Z **alice**: hola mundo\n",
    );
    expect(parseChannelNote(md)).toEqual({
      channelName: "general",
      lines: [
        {
          id: "msg1",
          at: "2026-01-01T00:00:00Z",
          author: "alice",
          content: "hola mundo",
        },
      ],
    });
  });

  it("roundtrips author a*b as ab after stripping asterisks on render", () => {
    const lines: DiscordLine[] = [
      { id: "m", at: "2026-01-01T00:00:00Z", author: "a*b", content: "hi" },
    ];
    const md = renderChannelNote("ch", lines);
    expect(parseChannelNote(md)).toEqual({
      channelName: "ch",
      lines: [
        {
          id: "m",
          at: "2026-01-01T00:00:00Z",
          author: "ab",
          content: "hi",
        },
      ],
    });
  });

  it("uses canal when name is empty and ignores non-matching lines", () => {
    const md = "# canal\nnot a line\n- x y **z**: ok\n";
    expect(parseChannelNote(md).lines).toHaveLength(1);
    expect(renderChannelNote("", [])).toBe("# canal\n");
  });
});

describe("mergeLines", () => {
  it("keeps order, drops duplicate ids and !sync but keeps !sanctum", () => {
    const existing: DiscordLine[] = [
      { id: "a", at: "t1", author: "u", content: "one" },
    ];
    const incoming: DiscordLine[] = [
      { id: "a", at: "t2", author: "u", content: "dup" },
      { id: "b", at: "t3", author: "u", content: "!sync" },
      { id: "c", at: "t4", author: "u", content: "!sanctum hola" },
    ];
    expect(mergeLines(existing, incoming)).toEqual([
      { id: "a", at: "t1", author: "u", content: "one" },
      { id: "c", at: "t4", author: "u", content: "!sanctum hola" },
    ]);
  });
});

describe("shouldAnswer", () => {
  it("is true for mention or !sanctum, false for other commands or plain text", () => {
    expect(shouldAnswer({ content: "hi", mentionsBot: true })).toBe(true);
    expect(shouldAnswer({ content: "!sanctum ping", mentionsBot: false })).toBe(
      true,
    );
    expect(shouldAnswer({ content: "!resumen", mentionsBot: true })).toBe(
      false,
    );
    expect(shouldAnswer({ content: "plain", mentionsBot: false })).toBe(false);
  });
});

describe("questionText", () => {
  it("strips !sanctum prefix and mention tokens", () => {
    expect(questionText("!Sanctum  <@123>  qué tal")).toBe("qué tal");
    expect(questionText("<@!999> hola")).toBe("hola");
  });
});

describe("tailLines", () => {
  it("returns last n lines and [] when n < 1", () => {
    const lines: DiscordLine[] = [
      { id: "1", at: "t", author: "a", content: "x" },
      { id: "2", at: "t", author: "b", content: "y" },
      { id: "3", at: "t", author: "c", content: "z" },
    ];
    expect(tailLines(lines, 2).map((l) => l.id)).toEqual(["2", "3"]);
    expect(tailLines(lines, 0)).toEqual([]);
    expect(tailLines(lines, 40).length).toBe(3);
  });
});

describe("formatTail", () => {
  it("joins author: content with newlines", () => {
    const lines: DiscordLine[] = [
      { id: "1", at: "t", author: "alice", content: "hi" },
      { id: "2", at: "t", author: "bob", content: "yo" },
    ];
    expect(formatTail(lines)).toBe("alice: hi\nbob: yo");
  });
});
