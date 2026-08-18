import { describe, expect, it } from "vitest";
import { readCanonicalPrismaSchema } from "../src/schema-source";

const schema = readCanonicalPrismaSchema();

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

  it("adds the Phase 1 narrow AssuranceFinding substrate", () => {
    const block = modelBlock("AssuranceFinding");

    expect(block).toContain("findingKey");
    expect(block).toContain("assuranceRunId");
    expect(block).toContain("bomDocumentId");
    expect(block).toContain("bomComponentId");
    expect(block).toContain("identifierStability");
    expect(block).toContain("reopenCount");
    expect(block).toContain("@@unique([findingKey])");
    expect(block).toContain("@@index([affectedType, affectedId])");
    expect(block).toContain("@@index([policySeverity, releaseImpact])");
  });
});
