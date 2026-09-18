import assert from "node:assert/strict";
import test from "node:test";

import {
  findMappedEnumDatabaseValues,
  literalsAssignedTo,
  parseSchema,
} from "./check-no-mapped-enum-database-value.mjs";

// The real shape, from work-coordination.prisma.
const SCHEMA = `
enum InitiativeGateKey {
  classification
  research
  design_spec                @map("design-spec")
  post_implementation_review @map("post-implementation-review")
}

enum PlainEnum {
  alpha
  beta
}

model InitiativeGateReceipt {
  id      String             @id
  gateKey InitiativeGateKey?
  label   String
}

model Unrelated {
  id     String @id
  status PlainEnum
}
`;

const schema = () => parseSchema([SCHEMA]);

test("only members whose @map differs are recorded, keyed by database value", () => {
  const { enums } = schema();
  const gate = enums.get("InitiativeGateKey");
  assert.equal(gate.get("post-implementation-review"), "post_implementation_review");
  assert.equal(gate.get("design-spec"), "design_spec");
  assert.equal(gate.get("classification"), undefined, "a member that maps to itself cannot be spelled wrong");
  assert.equal(enums.get("PlainEnum").size, 0);
});

test("only fields typed by a mapped enum are tracked", () => {
  const { fields } = schema();
  assert.equal(fields.get("InitiativeGateReceipt").get("gateKey"), "InitiativeGateKey");
  assert.equal(fields.get("InitiativeGateReceipt").get("label"), undefined, "a String field is not an enum");
  assert.equal(fields.get("Unrelated"), undefined, "PlainEnum maps nothing, so the model is not tracked");
});

// RED: the shape that shipped declare_break_fix completely broken (BI-D36E2916).
test("a query using the database spelling is a finding", () => {
  const source = `
    await prisma.initiativeGateReceipt.findMany({
      where: { gateKey: "post-implementation-review" },
    });
  `;
  const findings = findMappedEnumDatabaseValues(source, schema());
  assert.equal(findings.length, 1);
  assert.equal(findings[0].used, "post-implementation-review");
  assert.equal(findings[0].expected, "post_implementation_review");
  assert.equal(findings[0].field, "gateKey");
});

test("the member spelling passes", () => {
  const source = `
    await prisma.initiativeGateReceipt.findMany({
      where: { gateKey: "post_implementation_review" },
    });
  `;
  assert.deepEqual(findMappedEnumDatabaseValues(source, schema()), []);
});

test("the filter and list forms are covered, not just the direct one", () => {
  const equals = `await prisma.initiativeGateReceipt.findFirst({ where: { gateKey: { equals: "design-spec" } } });`;
  assert.equal(findMappedEnumDatabaseValues(equals, schema()).length, 1);

  const list = `await prisma.initiativeGateReceipt.count({ where: { gateKey: { in: ["design-spec", "research"] } } });`;
  assert.equal(findMappedEnumDatabaseValues(list, schema()).length, 1, "only the mapped value is a finding");
});

// PRECISION. The hyphenated spelling is the legitimate wire key nearly
// everywhere - receipt schemas, tool grants, GATE_NAMES - so a guard that
// matched the bare string anywhere would be unusable noise.
test("the same string is untouched outside a Prisma query", () => {
  const source = `
    const GATE_NAMES = ["post-implementation-review", "design-spec"];
    if (receipt.gate === "post-implementation-review") return true;
  `;
  assert.deepEqual(findMappedEnumDatabaseValues(source, schema()), []);
});

test("the same string is untouched on a field that is not that enum", () => {
  const source = `
    await prisma.initiativeGateReceipt.findMany({
      where: { label: "post-implementation-review" },
    });
  `;
  assert.deepEqual(findMappedEnumDatabaseValues(source, schema()), [], "label is a String, not the enum");
});

test("a model that is not in the schema is ignored", () => {
  const source = `await prisma.somethingElse.findMany({ where: { gateKey: "design-spec" } });`;
  assert.deepEqual(findMappedEnumDatabaseValues(source, schema()), []);
});

test("a write path is covered too, not only reads", () => {
  const source = `await prisma.initiativeGateReceipt.create({ data: { gateKey: "design-spec" } });`;
  assert.equal(findMappedEnumDatabaseValues(source, schema()).length, 1);
});

test("literalsAssignedTo reads each supported value shape", () => {
  assert.deepEqual(literalsAssignedTo(`{ gateKey: "a" }`, "gateKey"), ["a"]);
  assert.deepEqual(literalsAssignedTo(`{ gateKey: { equals: "a" } }`, "gateKey"), ["a"]);
  assert.deepEqual(literalsAssignedTo(`{ gateKey: { in: ["a", "b"] } }`, "gateKey"), ["a", "b"]);
  assert.deepEqual(literalsAssignedTo(`{ other: "a" }`, "gateKey"), []);
});
