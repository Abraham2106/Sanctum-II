import { describe, it, expect } from "vitest"
import { readToolContext } from "./tool-context.js"

describe("readToolContext", () => {
  it("returns empty when context is not a string", () => {
    expect(readToolContext({})).toBe("")
    expect(readToolContext({ context: 42 })).toBe("")
    expect(readToolContext({ context: null })).toBe("")
  })

  it("returns a short string unchanged", () => {
    expect(readToolContext({ context: "hello" })).toBe("hello")
  })

  it("truncates a string of 8001 characters to 8000", () => {
    const long = "a".repeat(8001)
    expect(readToolContext({ context: long })).toBe("a".repeat(8000))
    expect(readToolContext({ context: long }).length).toBe(8000)
  })
})
