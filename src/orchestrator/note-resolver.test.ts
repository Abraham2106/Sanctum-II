import { describe, it, expect } from "vitest";
import { resolveNoteReference } from "./note-resolver";

describe("resolveNoteReference exact title match (DEC-0016)", () => {
  it('title "a", query "modifica la nota" → not_found', async () => {
    const notes = [{ path: "Projects/test/a.md", title: "a", created_at: 100 }];
    const result = await resolveNoteReference("modifica la nota", notes, undefined, undefined);
    expect(result.method).toBe("not_found");
    expect(result.path).toBeNull();
  });

  it('title "ML", query "revisa el HTML" → not_found', async () => {
    const notes = [{ path: "Projects/test/ML.md", title: "ML", created_at: 100 }];
    const result = await resolveNoteReference("revisa el HTML", notes, undefined, undefined);
    expect(result.method).toBe("not_found");
    expect(result.path).toBeNull();
  });

  it('title "QML Research", query "QML" → exact', async () => {
    const notes = [{ path: "Projects/test/QML.md", title: "QML Research", created_at: 100 }];
    const result = await resolveNoteReference("QML", notes, undefined, undefined);
    expect(result.method).toBe("exact");
    expect(result.path).toBe("Projects/test/QML.md");
  });

  it('title "Quantum ML Research", query "quantum" → exact', async () => {
    const notes = [{ path: "Projects/test/QML.md", title: "Quantum ML Research", created_at: 100 }];
    const result = await resolveNoteReference("quantum", notes, undefined, undefined);
    expect(result.method).toBe("exact");
    expect(result.path).toBe("Projects/test/QML.md");
  });

  it('title "QML", query "revisa el QML ahora" → exact', async () => {
    const notes = [{ path: "Projects/test/QML.md", title: "QML", created_at: 100 }];
    const result = await resolveNoteReference("revisa el QML ahora", notes, undefined, undefined);
    expect(result.method).toBe("exact");
    expect(result.path).toBe("Projects/test/QML.md");
  });
});
