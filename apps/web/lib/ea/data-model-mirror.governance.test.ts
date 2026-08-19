// apps/web/lib/ea/data-model-mirror.governance.test.ts
// BI-DG-002 (spec §6.1): the EA mirror projects logical asset/classification onto
// registered models' elements — and leaves unregistered models untouched.
import { describe, expect, it } from "vitest";
import { buildDesiredState } from "./data-model-mirror";
import type {
  PrismaModelFact,
  PrismaSchemaFacts,
} from "../build/code-graph/extractors/prisma-schema-adapter";

function field(name: string): PrismaModelFact["fields"][number] {
  return {
    name,
    mappedColumn: null,
    rawType: "String",
    kind: "scalar",
    isList: false,
    isRequired: true,
    isId: false,
    isUnique: false,
    hasDefault: false,
    isUpdatedAt: false,
    isIgnored: false,
    relation: null,
    line: 1,
  };
}

function model(name: string): PrismaModelFact {
  return {
    name,
    mappedTable: null,
    isIgnored: false,
    startLine: 1,
    endLine: 2,
    fields: [field("id"), field("content")],
    blockIndexes: [],
  };
}

const facts: PrismaSchemaFacts = {
  models: [model("AgentMessage"), model("SomethingUnregistered")],
  enums: [],
  relations: [],
};

describe("EA mirror governance projection", () => {
  const elements = buildDesiredState(facts).elements;
  const registered = elements.find((e) => e.name === "AgentMessage");
  const unregistered = elements.find((e) => e.name === "SomethingUnregistered");

  it("projects the logical asset/classification onto a registered model element", () => {
    const gov = (registered?.properties as Record<string, unknown>).governance as
      | Record<string, unknown>
      | undefined;
    expect(gov?.assetId).toBe("data:agent-conversation");
    expect(gov?.sensitivity).toBe("confidential");
    expect(gov?.classificationState).toBe("confirmed");
  });

  it("leaves an unregistered model element without a governance block", () => {
    expect((unregistered?.properties as Record<string, unknown>).governance).toBeUndefined();
  });

  it("does not add a second ERD — still one element per model", () => {
    expect(elements.length).toBe(2);
  });
});
