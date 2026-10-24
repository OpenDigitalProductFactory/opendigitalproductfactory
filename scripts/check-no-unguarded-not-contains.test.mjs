import assert from "node:assert/strict";
import test from "node:test";

import {
  accessorToModel,
  findUnguardedNotContains,
  hasNullCompanion,
  notContainsColumns,
  parseNullableFields,
} from "./check-no-unguarded-not-contains.mjs";

const SCHEMA = `
model BacklogItem {
  id        String  @id
  itemId    String  @unique
  body      String?
  title     String
  tags      String[]
  epic      Epic?   @relation(fields: [epicId], references: [id])
}

model DiscoveredModel {
  id      String @id
  modelId String
}
`;

const nullable = () => parseNullableFields([SCHEMA]);

test("only `Type?` scalars count as nullable", () => {
  const models = nullable();
  assert.ok(models.get("BacklogItem").has("body"));
  assert.ok(!models.get("BacklogItem").has("title"), "a required column cannot be NULL");
  assert.ok(!models.get("BacklogItem").has("tags"), "a list is never NULL in Postgres");
  assert.ok(!models.get("DiscoveredModel").has("modelId"));
});

test("a relation marked optional is not a LIKE-able column", () => {
  // `epic Epic?` parses as optional, but there is no NOT-contains to write
  // against a relation, so its presence in the set is harmless. What must NOT
  // happen is a required scalar leaking in.
  assert.ok(!nullable().get("BacklogItem").has("title"));
});

test("accessor maps to the model by the Prisma camelCase convention", () => {
  assert.equal(accessorToModel("backlogItem"), "BacklogItem");
  assert.equal(accessorToModel("discoveredModel"), "DiscoveredModel");
});

// The live defect used the ARRAY form. A guard that only understood
// `NOT: { col: {...} }` would have reported the repository clean.
test("NOT columns are found in both the object and the array form", () => {
  assert.deepEqual(
    notContainsColumns(`{ where: { NOT: { body: { contains: "x" } } } }`),
    ["body"],
  );
  assert.deepEqual(
    notContainsColumns(`{ where: { NOT: [{ body: { contains: "x" } }, { body: { contains: "y" } }] } }`),
    ["body"],
  );
});

test("a contains that is not under a NOT is not a finding", () => {
  assert.deepEqual(notContainsColumns(`{ where: { body: { contains: "x" } } }`), []);
});

test("the null companion is recognised wherever it sits in the block", () => {
  assert.ok(hasNullCompanion(`OR: [{ body: null }, { NOT: { body: { contains: "x" } } }]`, "body"));
  assert.ok(!hasNullCompanion(`NOT: { body: { contains: "x" } }`, "body"));
  assert.ok(!hasNullCompanion(`OR: [{ title: null }]`, "body"), "a different column is not the companion");
});

// RED: this is the exact shape found live in demand-read-model.ts.
test("a bare NOT-contains on a nullable column is a finding", () => {
  const source = `
    await prisma.backlogItem.findMany({
      where: {
        status: { in: ["open"] },
        NOT: [
          { body: { contains: "[origin:federatedDemand:" } },
        ],
      },
    });
  `;
  const { findings } = findUnguardedNotContains(source, nullable());
  assert.equal(findings.length, 1);
  assert.equal(findings[0].model, "BacklogItem");
  assert.equal(findings[0].column, "body");
});

// GREEN: the shape the #5007 fix shipped, in work-page.ts.
test("the OR-with-null form passes", () => {
  const source = `
    await prisma.backlogItem.findMany({
      where: { OR: [{ body: null }, { NOT: { body: { contains: MARKER } } }] },
    });
  `;
  assert.equal(findUnguardedNotContains(source, nullable()).findings.length, 0);
});

test("a NOT-contains on a required column is not a finding", () => {
  const source = `
    await prisma.discoveredModel.findFirst({
      where: { NOT: { modelId: { contains: "embed" } } },
    });
  `;
  assert.equal(findUnguardedNotContains(source, nullable()).findings.length, 0);
});

// A guard that guesses is worse than one that says it could not tell.
test("an unknown model is reported as unresolved, never as a failure", () => {
  const source = `
    await prisma.somethingNotInTheSchema.findMany({
      where: { NOT: { body: { contains: "x" } } },
    });
  `;
  const { findings, unresolved } = findUnguardedNotContains(source, nullable());
  assert.equal(findings.length, 0);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].model, "SomethingNotInTheSchema");
});

test("each query block is judged on its own null companion", () => {
  const source = `
    await prisma.backlogItem.findMany({
      where: { OR: [{ body: null }, { NOT: { body: { contains: "a" } } }] },
    });
    await prisma.backlogItem.count({
      where: { NOT: { body: { contains: "b" } } },
    });
  `;
  const { findings } = findUnguardedNotContains(source, nullable());
  assert.equal(findings.length, 1, "the guarded block must not launder the unguarded one");
});
