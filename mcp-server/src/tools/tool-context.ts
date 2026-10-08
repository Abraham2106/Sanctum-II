// DEC-0021: el MCP anuncia el uso y lista notas

export function readToolContext(args: Record<string, unknown>): string {
  const context = args.context
  if (typeof context !== "string") {
    return ""
  }
  // ponytail: el contexto se corta a 8000; subir cuando haga falta el texto entero.
  if (context.length > 8000) {
    return context.slice(0, 8000)
  }
  return context
}
