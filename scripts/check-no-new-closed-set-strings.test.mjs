// Self-test for check-no-new-closed-set-strings.mjs (BI-817ED2D4).
// Proves the guard logic on fixtures: candidate detection (suffix + closed-set
// comment), enum/CHECK/baseline exemptions, ratchet semantics (new fails,
// baselined passes, shrink passes), and baseline validity (expiry).
import test from "node:test";
import assert from "node:assert/strict";

import {
  CLOSED_SET_SUFFIXES,
  parseSchema,
  parseCheckCoveredColumns,
  isClosedSetCandidate,
  computeViolations,
  validateBaseline,
  evaluateRatchet,
  runCheck,
} from "./check-no-new-closed-set-strings.mjs";

const FIXTURE_SCHEMA = `
enum WidgetStatus {
  open
  closed
}

model Widget {
  id          String  @id @default(cuid())
  status      WidgetStatus @default(open)
  kind        String // gear | sprocket
  mood        String? // happy | sad | indifferent
  claimStatus String?
  freeText    String? // arbitrary operator note
  tags        String[]
  title       String
}

model Gadget {
  id     String @id
  status String @default("new")

  @@map("GadgetPhysical")
}
`;

const FIXTURE_MIGRATION = `
-- expand step
ALTER TABLE "GadgetPhysical" ADD CONSTRAINT "GadgetPhysical_status_closed_set"
  CHECK ("status" IN ('new', 'used')) NOT VALID;
`;

const VALID_BASELINE = {
  version: 1,
  owner: "platform-architecture",
  expiry: "2099-01-01",
  entries: ["Widget.claimStatus", "Widget.kind", "Widget.mood"],
};

test("parseSchema resolves @@map table names and declared enums", () => {
  const { models, enumNames } = parseSchema(FIXTURE_SCHEMA);
  assert.ok(enumNames.has("WidgetStatus"));
  assert.equal(models.find((m) => m.name === "Gadget").tableName, "GadgetPhysical");
  assert.equal(models.find((m) => m.name === "Widget").tableName, "Widget");
});

test("candidate detection: suffixes, closed-set comments; enum/list/plain excluded", () => {
  const { models } = parseSchema(FIXTURE_SCHEMA);
  const widget = models.find((m) => m.name === "Widget");
  const byName = Object.fromEntries(widget.fields.map((f) => [f.name, f]));

  assert.ok(isClosedSetCandidate(byName.kind), "suffix `kind` is a candidate");
  assert.ok(isClosedSetCandidate(byName.claimStatus), "camelCase *Status suffix matches");
  assert.ok(isClosedSetCandidate(byName.mood), "closed-set `// a | b | c` comment matches");
  assert.ok(!isClosedSetCandidate(byName.status), "enum-typed field is not a String candidate");
  assert.ok(!isClosedSetCandidate(byName.tags), "String[] is not a candidate");
  assert.ok(!isClosedSetCandidate(byName.freeText), "plain comment without pipes is not a candidate");
  assert.ok(!isClosedSetCandidate(byName.title), "plain String is not a candidate");
  assert.deepEqual([...CLOSED_SET_SUFFIXES], ["status", "state", "kind", "type"]);
});

test("CHECK coverage is parsed from migrations and exempts via @@map table name", () => {
  const covered = parseCheckCoveredColumns([FIXTURE_MIGRATION]);
  assert.ok(covered.has("GadgetPhysical.status"));
  const violations = computeViolations(parseSchema(FIXTURE_SCHEMA), covered);
  assert.ok(!violations.includes("Gadget.status"), "CHECK-covered column is compliant");
  assert.deepEqual(violations, ["Widget.claimStatus", "Widget.kind", "Widget.mood"]);
});

test("baselined violations pass", () => {
  const result = runCheck({
    schemaSource: FIXTURE_SCHEMA,
    migrationTexts: [FIXTURE_MIGRATION],
    baseline: VALID_BASELINE,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ratchet.newViolations, []);
});

test("a NEW closed-set String column fails", () => {
  const schema = FIXTURE_SCHEMA.replace(
    "  title       String\n",
    '  title       String\n  syncState   String? // pending | done\n',
  );
  const result = runCheck({
    schemaSource: schema,
    migrationTexts: [FIXTURE_MIGRATION],
    baseline: VALID_BASELINE,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.ratchet.newViolations, ["Widget.syncState"]);
});

test("a shrink passes and reports the stale entries for retightening", () => {
  const schema = FIXTURE_SCHEMA.replace("  claimStatus String?\n", "");
  const result = runCheck({
    schemaSource: schema,
    migrationTexts: [FIXTURE_MIGRATION],
    baseline: VALID_BASELINE,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ratchet.stale, ["Widget.claimStatus"]);
});

test("a new column covered by a *_closed_set CHECK in a migration passes", () => {
  const schema = FIXTURE_SCHEMA.replace(
    "  title       String\n",
    "  title       String\n  syncState   String?\n",
  );
  const migration = `${FIXTURE_MIGRATION}
ALTER TABLE "Widget" ADD CONSTRAINT "Widget_syncState_closed_set"
  CHECK ("syncState" IN ('pending', 'done')) NOT VALID;
`;
  const result = runCheck({
    schemaSource: schema,
    migrationTexts: [migration],
    baseline: VALID_BASELINE,
  });
  assert.equal(result.ok, true);
});

test("an expired baseline fails until deliberately re-reviewed", () => {
  const result = runCheck({
    schemaSource: FIXTURE_SCHEMA,
    migrationTexts: [FIXTURE_MIGRATION],
    baseline: { ...VALID_BASELINE, expiry: "2020-01-01" },
  });
  assert.equal(result.ok, false);
  assert.match(result.baselineFailures.join("\n"), /expired/);
});

test("baseline shape is validated", () => {
  assert.deepEqual(validateBaseline(VALID_BASELINE, { today: "2026-08-16" }), []);
  assert.ok(validateBaseline({ version: 2 }, { today: "2026-08-16" }).length >= 3);
  assert.ok(
    validateBaseline({ ...VALID_BASELINE, entries: "nope" }, { today: "2026-08-16" })
      .some((f) => /entries/.test(f)),
  );
});

test("ratchet math distinguishes new from stale", () => {
  const { newViolations, stale } = evaluateRatchet(["A.x", "B.y"], ["B.y", "C.z"]);
  assert.deepEqual(newViolations, ["A.x"]);
  assert.deepEqual(stale, ["C.z"]);
});
