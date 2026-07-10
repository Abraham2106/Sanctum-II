import type { Skill } from "./types";

const SKILLS_DIR = "sanctum-skills";

function parseSkillMd(content: string): Skill {
  const parts = content.split("---");
  if (parts.length < 3) throw new Error("Skill debe tener frontmatter --- separado");
  const fmLines = parts[1].trim().split("\n");
  const bodyRaw = parts.slice(2).join("---").trim();
  const data: Record<string, any> = {};

  for (const line of fmLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---" || !trimmed.includes(":")) continue;
    const colonIdx = trimmed.indexOf(":");
    const key = trimmed.slice(0, colonIdx).trim();
    let value: any = trimmed.slice(colonIdx + 1).trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else if (value === "true" || value === "false") {
      value = value === "true";
    } else if (!isNaN(Number(value))) {
      value = Number(value);
    } else {
      value = value.replace(/^["']|["']$/g, "");
    }
    data[key] = value;
  }

  return {
    id: data.id || "unknown",
    name: data.name || data.id || "Unknown",
    description: data.description || "",
    tools: data.tools || [],
    model: data.model,
    instructions: bodyRaw,
  };
}

export async function listSkills(
  adapter: { read: (p: string) => Promise<string>; list: (p: string) => Promise<{ files: string[]; folders: string[] }>; exists: (p: string) => Promise<boolean> },
): Promise<Skill[]> {
  const exists = await adapter.exists(SKILLS_DIR).catch(() => false);
  if (!exists) return [];
  const listing = await adapter.list(SKILLS_DIR);
  const mdFiles = listing.files.filter(f => f.endsWith(".md"));
  const skills: Skill[] = [];
  for (const path of mdFiles) {
    try {
      const content = await adapter.read(path);
      skills.push(parseSkillMd(content));
    } catch {}
  }
  return skills;
}

export async function loadSkill(
  adapter: { read: (p: string) => Promise<string> },
  id: string,
): Promise<Skill | null> {
  try {
    const content = await adapter.read(`${SKILLS_DIR}/${id}.md`);
    return parseSkillMd(content);
  } catch {
    return null;
  }
}
