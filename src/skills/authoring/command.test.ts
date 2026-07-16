import { describe, expect, it } from "vitest";
import { parseSkillCreatorCommand } from "./command";

describe("parseSkillCreatorCommand", () => {
  it("parsea creación y actualización explícita", () => {
    expect(parseSkillCreatorCommand("/skill-creator crea una skill para QAOA")).toEqual({
      mode: "create",
      description: "crea una skill para QAOA",
    });
    expect(parseSkillCreatorCommand("/skill-creator --update quantum-coder mejora validación")).toEqual({
      mode: "update",
      targetId: "quantum-coder",
      description: "mejora validación",
    });
  });

  it("no captura otros mensajes", () => {
    expect(parseSkillCreatorCommand("usa /skill-creator después")).toBeNull();
  });
});
