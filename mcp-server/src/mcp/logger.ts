type Level = "debug" | "info" | "warn" | "error"

const order: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }
const threshold = order[(process.env.SANCTUM_LOG_LEVEL as Level) ?? "info"] ?? order.info

function emit(level: Level, msg: string, meta?: unknown): void {
  if (order[level] < threshold) return
  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
  }
  if (meta !== undefined) line.meta = meta
  process.stderr.write(JSON.stringify(line) + "\n")
}

export const log = {
  debug: (m: string, meta?: unknown) => emit("debug", m, meta),
  info: (m: string, meta?: unknown) => emit("info", m, meta),
  warn: (m: string, meta?: unknown) => emit("warn", m, meta),
  error: (m: string, meta?: unknown) => emit("error", m, meta),
}
