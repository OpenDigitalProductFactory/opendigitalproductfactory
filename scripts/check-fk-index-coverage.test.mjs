// Self-test for the FK index-coverage ratchet (BI-640B011D).
// Covers the three ratchet verdicts: a NEW miss fails, a baselined miss
// passes, and a shrink passes (reporting the stale entries for --update).
import test from "node:test";
import assert from "node:assert/strict";

import {
  parsePrismaModels,
  computeFkIndexMisses,
  computeUnbackedIdColumns,
  validateBaseline,
  runCheck,
} from "./check-fk-index-coverage.mjs";

const SCHEMA_WITH_MISS = `
model Epic {
  id     String @id @default(cuid())
  epicId String @unique
  items  Item[]
}

model Item {
  id     String  @id @default(cuid())
  epicId String?
  looseThingId String
  epic   Epic?   @relation(fields: [epicId], references: [id])
}
`;

const SCHEMA_FIXED = `
model Epic {
  id     String @id @default(cuid())
  epicId String @unique
  items  Item[]
}

model Item {
  id     String  @id @default(cuid())
  epicId String?
  looseThingId String
  epic   Epic?   @relation(fields: [epicId], references: [id])

  @@index([epicId])
}
`;

function baseline(overrides = {}) {
  return {
    version: 1,
    owner: "platform-architecture",
    expiry: "2099-01-01",
    fkMissingIndex: [],
    unbackedIdColumns: [],
    ...overrides,
  };
}

test("parser sees relations, indexes, and identity-key exclusion", () => {
  const models = parsePrismaModels(SCHEMA_WITH_MISS);
  assert.equal(models.length, 2);
  const item = models.find((m) => m.name === "Item");
  assert.deepEqual(item.relations, [{ targetModel: "Epic", fkFields: ["epicId"] }]);
  // Epic.epicId is the model's own @unique identity key, never an unbacked FK.
  assert.deepEqual(computeUnbackedIdColumns(models), ["Item.looseThingId"]);
  assert.deepEqual(computeFkIndexMisses(models), ["Item.epicId"]);
});

test("a NEW miss beyond the baseline fails", () => {
  const result = runCheck({
    schemaSource: SCHEMA_WITH_MISS,
    baseline: baseline({ unbackedIdColumns: ["Item.looseThingId"] }),
    today: "2026-08-16",
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.fk.newMisses, ["Item.epicId"]);
});

test("a baselined miss passes (owned debt, ratchet holds)", () => {
  const result = runCheck({
    schemaSource: SCHEMA_WITH_MISS,
    baseline: baseline({
      fkMissingIndex: ["Item.epicId"],
      unbackedIdColumns: ["Item.looseThingId"],
    }),
    today: "2026-08-16",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.fk.newMisses, []);
  assert.deepEqual(result.fk.stale, []);
});

test("a shrink passes and reports the stale baseline entries", () => {
  const result = runCheck({
    schemaSource: SCHEMA_FIXED,
    baseline: baseline({
      fkMissingIndex: ["Item.epicId"],
      unbackedIdColumns: ["Item.looseThingId"],
    }),
    today: "2026-08-16",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.fk.stale, ["Item.epicId"]);
});

test("a new unbacked *Id column fails the second budget", () => {
  const result = runCheck({
    schemaSource: SCHEMA_WITH_MISS,
    baseline: baseline({ fkMissingIndex: ["Item.epicId"] }),
    today: "2026-08-16",
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.unbacked.newMisses, ["Item.looseThingId"]);
});

test("an expired baseline fails until deliberately extended", () => {
  const failures = validateBaseline(baseline({ expiry: "2026-01-01" }), { today: "2026-08-16" });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /expired/);
  const result = runCheck({
    schemaSource: SCHEMA_FIXED,
    baseline: baseline({ expiry: "2026-01-01" }),
    today: "2026-08-16",
  });
  assert.equal(result.ok, false);
});

test("composite-FK leading index is matched as a set prefix", () => {
  const source = `
model Line {
  id             String @id
  parentId       String
  organizationId String
  parent         Line   @relation("Tree", fields: [parentId, organizationId], references: [id, organizationId])
  children       Line[] @relation("Tree")

  @@unique([id, organizationId])
  @@index([organizationId, parentId])
}
`;
  const models = parsePrismaModels(source);
  // [organizationId, parentId] covers the {parentId, organizationId} FK prefix.
  assert.deepEqual(computeFkIndexMisses(models), []);
});
