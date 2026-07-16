import type { Skill } from "./types";
import { splitFrontmatter } from "../shared/agents/frontmatter";

const SKILLS_DIR = "sanctum-skills";

export function parseSkillMarkdown(content: string): Skill {
  const { frontmatter: data, body: bodyRaw } = splitFrontmatter(content);

  return {
    id: data.id || "unknown",
    name: data.name || data.id || "Unknown",
    description: data.description || "",
    tools: data.tools || [],
    model: data.model,
    instructions: bodyRaw,
  };
}

export function renderSkillPrompt(skill: Skill, ragContext: string, webContext: string, userPrompt: string): string {
  return skill.instructions
    .replace(/\{\{rag_context\}\}/g, ragContext)
    .replace(/\{\{web_context\}\}/g, webContext)
    .replace(/\{\{user_prompt\}\}/g, userPrompt);
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
      skills.push(parseSkillMarkdown(content));
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
    return parseSkillMarkdown(content);
  } catch {
    return null;
  }
}
