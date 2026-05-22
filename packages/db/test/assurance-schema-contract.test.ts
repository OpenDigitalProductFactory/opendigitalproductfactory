import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(__dirname, "../prisma/schema.prisma"), "utf8");

function modelBlock(modelName: string): string {
  const match = schema.match(new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`, "m"));
  return match?.[0] ?? "";
}

describe("Assurance BOM schema", () => {
  it("adds assurance run and BOM persistence models", () => {
    expect(modelBlock("AssuranceRun")).toContain("toolExecutionId");
    expect(modelBlock("BomDocument")).toContain("raw");
    expect(modelBlock("BomComponent")).toContain("componentKey");
    expect(modelBlock("BomComponentOccurrence")).toContain("occurrenceKey");
  });

  it("does not add AssuranceFinding in Phase 1A", () => {
    expect(modelBlock("AssuranceFinding")).toBe("");
  });
});
