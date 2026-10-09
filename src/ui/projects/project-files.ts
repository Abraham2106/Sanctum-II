import { Notice } from "obsidian";
import type { App } from "obsidian";
import type { Project } from "../../projects/types";
import { ensureVaultDirectory } from "../../core/vault-fs";

export function projectFilesDir(project: Project | null): string {
  return `sanctum-files/${project?.id || "default"}`;
}

export async function ingestProjectFile(
  app: App,
  project: Project,
  file: File,
  saveProject: (p: Project) => Promise<void>,
): Promise<void> {
  const text = await file.text();
  const lines = text.split("\n").length;
  const ext = file.name.includes(".") ? file.name.split(".").pop() || "" : "";
  const dir = projectFilesDir(project);
  const vaultPath = `${dir}/${file.name}`;

  await ensureVaultDirectory(app.vault.adapter, dir);
  await app.vault.adapter.write(vaultPath, text);

  const attached = project.attachedFiles || [];
  attached.push({
    path: vaultPath,
    name: file.name,
    ext,
    lines,
    added_at: Date.now(),
  });
  project.attachedFiles = attached;

  if (!project.files.includes(vaultPath)) project.files.push(vaultPath);
  if (!project.read_paths.includes(dir)) project.read_paths.push(dir);

  await saveProject(project);
  new Notice(`📎 ${file.name} adjuntado (${lines} líneas)`);
}

export function openFilePicker(onFiles: (files: File[]) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.onchange = () => onFiles(Array.from(input.files || []));
  input.click();
}
