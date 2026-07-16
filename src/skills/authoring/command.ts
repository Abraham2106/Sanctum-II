import type { SkillGenerationRequest } from "./types";

export function parseSkillCreatorCommand(input: string): SkillGenerationRequest | null {
  const match = input.trim().match(/^\/skill-creator(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const payload = match[1]?.trim() || "";
  const update = payload.match(/^--update\s+([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s+([\s\S]*))?$/i);
  if (update) {
    return {
      mode: "update",
      targetId: update[1].toLowerCase(),
      description: update[2]?.trim() || "",
    };
  }
  return { mode: "create", description: payload };
}
