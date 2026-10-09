import type { Project } from "./types";

// DEC-0018: quitar del proyecto no vacía la nota
export function detachAttachedFile(project: Project, path: string): Project {
  return {
    ...project,
    attachedFiles: project.attachedFiles.filter((f) => f.path !== path),
    files: (project.files || []).filter((fp) => fp !== path),
  };
}
