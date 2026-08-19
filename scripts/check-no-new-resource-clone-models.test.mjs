// Self-test for check-no-new-resource-clone-models.mjs (BI-99C76A90, W19).
import test from "node:test";
import assert from "node:assert/strict";
import {
  CLONE_SUFFIX_RE,
  UNIFIED_FAMILY,
  computeViolations,
  evaluateRatchet,
  runCheck,
} from "./check-no-new-resource-clone-models.mjs";

const SCHEMA_WITH_CLONES = `
model Resource {
  id String @id
}
model ResourceAvailability {
  id String @id
}
model ResourceCapacityPool {
  id String @id
}
model ResourceCapacityAllocation {
  id String @id
}
model RecurrenceSchedule {
  id String @id
}
model BeautyResourceAvailability {
  id String @id
}
model HospitalityCapacityAllocation {
  id String @id
}
model EmployeeAvailabilityWindow {
  id String @id
}
model RecurringSchedule {
  id String @id
}
model StaffingShift {
  id String @id
}
`;

const VALID_BASELINE = {
  version: 1,
  owner: "platform-architecture",
  expiry: "2099-01-01",
  entries: [
    "BeautyResourceAvailability",
    "EmployeeAvailabilityWindow",
    "HospitalityCapacityAllocation",
    "RecurringSchedule",
  ],
};

test("suffix regex matches clone shapes including AvailabilityWindow", () => {
  assert.ok(CLONE_SUFFIX_RE.test("BeautyResourceAvailability"));
  assert.ok(CLONE_SUFFIX_RE.test("EmployeeAvailabilityWindow"));
  assert.ok(CLONE_SUFFIX_RE.test("FarmCapacityAllocation"));
  assert.ok(CLONE_SUFFIX_RE.test("BarnCapacityPool"));
  assert.ok(CLONE_SUFFIX_RE.test("CropRecurrenceSchedule"));
  assert.ok(!CLONE_SUFFIX_RE.test("StaffingShift"));
  assert.ok(!CLONE_SUFFIX_RE.test("Resource"));
});

test("unified family is exempt; clones are violations", () => {
  const violations = computeViolations(SCHEMA_WITH_CLONES);
  assert.deepEqual(violations, [
    "BeautyResourceAvailability",
    "EmployeeAvailabilityWindow",
    "HospitalityCapacityAllocation",
    "RecurringSchedule",
  ]);
  for (const name of UNIFIED_FAMILY) assert.ok(!violations.includes(name));
});

test("baselined clones pass; a NEW clone fails the ratchet", () => {
  const ok = runCheck({ schemaSource: SCHEMA_WITH_CLONES, baseline: VALID_BASELINE });
  assert.equal(ok.ok, true);

  const withNewClone = `${SCHEMA_WITH_CLONES}\nmodel AgricultureResourceAvailability {\n  id String @id\n}\n`;
  const bad = runCheck({ schemaSource: withNewClone, baseline: VALID_BASELINE });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.ratchet.newViolations, ["AgricultureResourceAvailability"]);
});

test("a retired clone is reported stale for retightening", () => {
  const shrunk = SCHEMA_WITH_CLONES.replace(/model RecurringSchedule \{[^}]*\}\n/, "");
  const result = runCheck({ schemaSource: shrunk, baseline: VALID_BASELINE });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ratchet.stale, ["RecurringSchedule"]);
});

test("an expired or ownerless baseline fails", () => {
  const expired = runCheck({
    schemaSource: SCHEMA_WITH_CLONES,
    baseline: { ...VALID_BASELINE, expiry: "2020-01-01" },
  });
  assert.equal(expired.ok, false);
  assert.ok(expired.budgetFailures.length > 0);

  const ownerless = runCheck({
    schemaSource: SCHEMA_WITH_CLONES,
    baseline: { ...VALID_BASELINE, owner: "" },
  });
  assert.equal(ownerless.ok, false);
});

test("evaluateRatchet separates new from stale", () => {
  const r = evaluateRatchet(["A", "B"], ["B", "C"]);
  assert.deepEqual(r.newViolations, ["A"]);
  assert.deepEqual(r.stale, ["C"]);
});
