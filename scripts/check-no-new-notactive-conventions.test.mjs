// Self-test for check-no-new-notactive-conventions.mjs (BI-C357FA5A, W20).
import test from "node:test";
import assert from "node:assert/strict";
import {
  computeViolations,
  evaluateRatchet,
  isLegacyConventionField,
  runCheck,
} from "./check-no-new-notactive-conventions.mjs";

const SCHEMA = `
model KnowledgeArticle {
  id         String    @id
  archivedAt DateTime?
}
model AiModel {
  id        String    @id
  retiredAt DateTime?
}
model FederationLink {
  id            String    @id
  quarantinedAt DateTime?
}
model StorefrontBooking {
  id                   String    @id
  overlapQuarantinedAt DateTime?
}
model UserFact {
  id             String  @id
  supersededById String?
}
model RecurrenceSchedule {
  id                     String  @id
  supersededByScheduleId String?
}
model BacklogItem {
  id           String  @id
  mergedIntoId String?
}
model Resource {
  id          String          @id
  lifecycle   RecordLifecycle @default(active)
  lifecycleAt DateTime?
}
`;

const ENTRIES = [
  "AiModel.retiredAt",
  "BacklogItem.mergedIntoId",
  "FederationLink.quarantinedAt",
  "KnowledgeArticle.archivedAt",
  "RecurrenceSchedule.supersededByScheduleId",
  "StorefrontBooking.overlapQuarantinedAt",
  "UserFact.supersededById",
];

const VALID_BASELINE = {
  version: 1,
  owner: "platform-architecture",
  expiry: "2099-01-01",
  entries: ENTRIES,
};

test("field matcher covers all five column-shaped legacy conventions", () => {
  for (const name of [
    "archivedAt",
    "retiredAt",
    "quarantinedAt",
    "overlapQuarantinedAt",
    "conflictQuarantinedAt",
    "supersededById",
    "supersededByScheduleId",
    "mergedIntoId",
  ]) {
    assert.ok(isLegacyConventionField(name), name);
  }
  // The unified convention and ordinary columns never match.
  for (const name of ["lifecycle", "lifecycleAt", "lifecycleReason", "releasedAt", "createdAt", "duplicateOfId"]) {
    assert.ok(!isLegacyConventionField(name), name);
  }
});

test("computeViolations reports Model.field keys and skips the unified convention", () => {
  assert.deepEqual(computeViolations(SCHEMA), ENTRIES);
});

test("baselined columns pass; a NEW legacy column fails the ratchet", () => {
  assert.equal(runCheck({ schemaSource: SCHEMA, baseline: VALID_BASELINE }).ok, true);

  const withNew = `${SCHEMA}\nmodel Widget {\n  id String @id\n  archivedAt DateTime?\n}\n`;
  const bad = runCheck({ schemaSource: withNew, baseline: VALID_BASELINE });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.ratchet.newViolations, ["Widget.archivedAt"]);
});

test("a migrated column is reported stale for retightening", () => {
  const shrunk = SCHEMA.replace(/model AiModel \{[^}]*\}\n/, "");
  const result = runCheck({ schemaSource: shrunk, baseline: VALID_BASELINE });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ratchet.stale, ["AiModel.retiredAt"]);
});

test("an expired or ownerless baseline fails", () => {
  assert.equal(
    runCheck({ schemaSource: SCHEMA, baseline: { ...VALID_BASELINE, expiry: "2020-01-01" } }).ok,
    false,
  );
  assert.equal(runCheck({ schemaSource: SCHEMA, baseline: { ...VALID_BASELINE, owner: " " } }).ok, false);
});

test("evaluateRatchet separates new from stale", () => {
  const r = evaluateRatchet(["A.x", "B.y"], ["B.y", "C.z"]);
  assert.deepEqual(r.newViolations, ["A.x"]);
  assert.deepEqual(r.stale, ["C.z"]);
});
