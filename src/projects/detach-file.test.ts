import { describe, expect, it } from "vitest";
import { detachAttachedFile } from "./detach-file";
import type { Project } from "./types";
import { defaultProject } from "./types";

describe("detachAttachedFile", () => {
  it("removes path from attachedFiles and files without mutating input", () => {
    const project: Project = {
      ...defaultProject("test"),
      files: ["A.md", "B.md"],
      attachedFiles: [{ path: "A.md", name: "A", ext: "md", lines: 1, added_at: 1 }],
    };
    const result = detachAttachedFile(project, "A.md");
    expect(result.attachedFiles).toEqual([]);
    expect(result.files).toEqual(["B.md"]);
    expect(project.attachedFiles).toHaveLength(1);
    expect(project.files).toContain("A.md");
  });
});
