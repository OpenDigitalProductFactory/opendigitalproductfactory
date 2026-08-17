// Self-test for the retention-enrollment ratchet (BI-873F3C48).
// Covers: unenrolled growth model fails; enrolled (purge or retained) passes;
// deliberate allowlist entry passes; expired allowlist entry fails; stale
// allowlist entries are reported.
import test from "node:test";
import assert from "node:assert/strict";

import {
  findGrowthModels,
  extractEnrolledModels,
  validateAllowlist,
  runCheck,
} from "./check-retention-enrollment.mjs";

const SCHEMA = `
model WidgetEvent {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
}

model WidgetAudit {
  id        String   @id @default(cuid())
  occurredAt DateTime
}

model Widget {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
}

model WidgetHistory {
  id   String @id @default(cuid())
  note String
}
`;

const POLICIES_ENROLLED = `
export const PURGE_POLICIES = [
  { model: "widgetEvent", label: "x", category: "audit-log", timestampField: "createdAt", baseRetentionDays: 90, rationale: "y" },
] as const;
export const RETAINED_DATASETS = [
  { model: "widgetAudit", label: "x", regulatoryBasis: "z", minRetentionYears: 7 },
] as const;
`;

function allowlist(entries = []) {
  return { version: 1, entries };
}

test("growth heuristic: name family AND time column required", () => {
  // Widget (name miss) and WidgetHistory (no DateTime axis) are excluded.
  assert.deepEqual(findGrowthModels(SCHEMA), ["WidgetAudit", "WidgetEvent"]);
});

test("registry extraction reads model literals from both axes", () => {
  const enrolled = extractEnrolledModels(POLICIES_ENROLLED);
  assert.ok(enrolled.has("widgetEvent"));
  assert.ok(enrolled.has("widgetAudit"));
});

test("an unenrolled growth model fails", () => {
  const result = runCheck({
    schemaSource: SCHEMA,
    policiesSource: 'export const PURGE_POLICIES = [{ model: "widgetEvent" }];',
    allowlist: allowlist(),
    today: "2026-08-16",
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.unenrolled, ["WidgetAudit"]);
});

test("purge + retained enrollment passes", () => {
  const result = runCheck({
    schemaSource: SCHEMA,
    policiesSource: POLICIES_ENROLLED,
    allowlist: allowlist(),
    today: "2026-08-16",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.unenrolled, []);
});

test("a deliberate allowlist entry passes", () => {
  const result = runCheck({
    schemaSource: SCHEMA,
    policiesSource: 'export const PURGE_POLICIES = [{ model: "widgetEvent" }];',
    allowlist: allowlist([
      { model: "WidgetAudit", reason: "business record", owner: "platform-architecture", expiry: "2099-01-01" },
    ]),
    today: "2026-08-16",
  });
  assert.equal(result.ok, true);
});

test("an expired allowlist entry fails until deliberately extended", () => {
  const entry = { model: "WidgetAudit", reason: "r", owner: "o", expiry: "2026-01-01" };
  const failures = validateAllowlist(allowlist([entry]), { today: "2026-08-16" });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /expired/);
  const result = runCheck({
    schemaSource: SCHEMA,
    policiesSource: POLICIES_ENROLLED,
    allowlist: allowlist([entry]),
    today: "2026-08-16",
  });
  assert.equal(result.ok, false);
});

test("stale allowlist entries (enrolled or no longer growth-shaped) are reported", () => {
  const result = runCheck({
    schemaSource: SCHEMA,
    policiesSource: POLICIES_ENROLLED,
    allowlist: allowlist([
      { model: "WidgetAudit", reason: "now enrolled", owner: "o", expiry: "2099-01-01" },
      { model: "GoneEvent", reason: "model deleted", owner: "o", expiry: "2099-01-01" },
    ]),
    today: "2026-08-16",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.staleAllowlist, ["GoneEvent", "WidgetAudit"]);
});
