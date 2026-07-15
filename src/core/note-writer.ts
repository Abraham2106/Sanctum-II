export interface WriteResult {
  success: boolean;
  path: string;
  action: "created" | "updated" | "appended" | "error";
  message: string;
}

export class NoteWriter {
  constructor(
    private adapter: {
      read: (p: string) => Promise<string>;
      write: (p: string, content: string) => Promise<void>;
      exists: (p: string) => Promise<boolean>;
    }
  ) {}

  private async ensureDir(filePath: string): Promise<void> {
    const parts = filePath.split("/");
    for (let i = 1; i < parts.length; i++) {
      const partial = parts.slice(0, i).join("/");
      try {
        await this.adapter.write(`${partial}/.gitkeep`, "");
      } catch {}
    }
  }

  async create(path: string, content: string): Promise<WriteResult> {
    const exists = await this.adapter.exists(path);
    if (exists) {
      return {
        success: false,
        path,
        action: "error",
        message: `La nota ya existe: ${path}`,
      };
    }
    await this.ensureDir(path);
    await this.adapter.write(path, content);
    return {
      success: true,
      path,
      action: "created",
      message: `Nota creada: ${path}`,
    };
  }

  async update(path: string, content: string): Promise<WriteResult> {
    const exists = await this.adapter.exists(path);
    if (!exists) {
      return {
        success: false,
        path,
        action: "error",
        message: `La nota no existe: ${path}`,
      };
    }
    await this.ensureDir(path);
    await this.adapter.write(path, content);
    return {
      success: true,
      path,
      action: "updated",
      message: `Nota actualizada: ${path}`,
    };
  }

  async append(path: string, content: string): Promise<WriteResult> {
    let existing = "";
    try {
      existing = await this.adapter.read(path);
    } catch {
      // la nota no existe, se crea
    }
    const newContent = existing ? `${existing}\n\n${content}` : content;
    await this.ensureDir(path);
    await this.adapter.write(path, newContent);
    return {
      success: true,
      path,
      action: existing ? "appended" : "created",
      message: existing
        ? `Contenido agregado a: ${path}`
        : `Nota creada: ${path}`,
    };
  }

  async replace(path: string, search: string, replacement: string): Promise<WriteResult> {
    try {
      const content = await this.adapter.read(path);
      if (!content.includes(search)) {
        return {
          success: false,
          path,
          action: "error",
          message: `Texto no encontrado en ${path}`,
        };
      }
      const newContent = content.replace(search, replacement);
      await this.ensureDir(path);
      await this.adapter.write(path, newContent);
      return {
        success: true,
        path,
        action: "updated",
        message: `Texto reemplazado en: ${path}`,
      };
    } catch {
      return {
        success: false,
        path,
        action: "error",
        message: `No se pudo leer: ${path}`,
      };
    }
  }
}
