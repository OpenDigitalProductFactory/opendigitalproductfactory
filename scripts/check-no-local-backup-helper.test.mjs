/**
 * BI-B72328D5 — tests for the backup-helper duplication ratchet.
 * Run: node --test scripts/check-no-local-backup-helper.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWLIST,
  CANONICAL_HELPER_FILES,
  CANONICAL_METRICS_FILE,
  HEARTBEAT_PATTERN,
  METRIC_NAME_PATTERN,
  findBodyPatternLines,
  findHelperDefinitionLines,
  scanRepo,
} from "./check-no-local-backup-helper.mjs";

// ── Rule 1: local helper definitions ────────────────────────────────────────

test("flags a function declaration form of every canonical helper name", () => {
  for (const name of [
    "isoTsForDirectory",
    "nextDailyRunAt",
    "applyRetention",
    "summarizeFailure",
    "summarizeScriptFailure",
    "recordJobHeartbeat",
  ]) {
    assert.equal(
      findHelperDefinitionLines(`function ${name}(x) { return x; }`).length,
      1,
      name,
    );
    assert.equal(
      findHelperDefinitionLines(`export async function ${name}(d: Date): Promise<void> {`).length,
      1,
      `async ${name}`,
    );
  }
});

test("flags a const arrow form", () => {
  assert.equal(
    findHelperDefinitionLines("const nextDailyRunAt = (from: Date) => from;").length,
    1,
  );
  assert.equal(
    findHelperDefinitionLines("export const summarizeFailure: Fn = (o) => o.stderr;").length,
    1,
  );
});

test("does NOT flag an import of the shared helpers", () => {
  assert.equal(
    findHelperDefinitionLines(
      'import { nextDailyRunAt, recordJobHeartbeat } from "@/lib/operate/backups/managed-backup";',
    ).length,
    0,
  );
});

test("does NOT flag call sites or comments", () => {
  assert.equal(
    findHelperDefinitionLines("const next = nextDailyRunAt(new Date());").length,
    0,
  );
  assert.equal(
    findHelperDefinitionLines(" * applyRetention used to live in every runner").length,
    0,
  );
  assert.equal(findHelperDefinitionLines("// function summarizeFailure(o) {").length, 0);
});

// ── Rule 2: inline scheduledJob heartbeat blocks ────────────────────────────

test("flags a single-line scheduledJob.update call", () => {
  assert.equal(
    findBodyPatternLines(
      "await prisma.scheduledJob.update({ where: { jobId }, data });",
      HEARTBEAT_PATTERN,
    ).length,
    1,
  );
});

test("flags the multi-line runner idiom (scheduledJob\\n  .update)", () => {
  const body = "await prisma.scheduledJob\n    .update({\n      where: { jobId: JOB },\n    })\n    .catch(() => {});";
  assert.equal(findBodyPatternLines(body, HEARTBEAT_PATTERN).length, 1);
});

test("does NOT flag other scheduledJob operations", () => {
  assert.equal(
    findBodyPatternLines("await prisma.scheduledJob.upsert({ where, create, update: {} });", HEARTBEAT_PATTERN).length,
    0,
  );
  assert.equal(
    findBodyPatternLines("const row = await prisma.scheduledJob.findUnique({ where });", HEARTBEAT_PATTERN).length,
    0,
  );
});

// ── Rule 3: stray backup/restore Prometheus registrations ───────────────────

test("flags a dpf_*_backup_* / dpf_*_restore_* registration", () => {
  assert.equal(
    findBodyPatternLines('name: "dpf_postgres_backup_runs_total",', METRIC_NAME_PATTERN).length,
    1,
  );
  assert.equal(
    findBodyPatternLines('name: "dpf_qdrant_restore_duration_seconds",', METRIC_NAME_PATTERN).length,
    1,
  );
});

test("does NOT flag unrelated dpf_ metric names", () => {
  assert.equal(
    findBodyPatternLines('name: "dpf_http_request_duration_seconds",', METRIC_NAME_PATTERN).length,
    0,
  );
});

// ── Live repo + configuration invariants ────────────────────────────────────

test("the live repo passes the guard — the migration left no copies behind", () => {
  assert.deepEqual(scanRepo(), []);
});

test("the allowlist is EMPTY by design (migration completed in one PR)", () => {
  assert.equal(ALLOWLIST.size, 0);
});

test("the canonical homes are configured and disjoint from the metrics home", () => {
  assert.equal(CANONICAL_HELPER_FILES.size, 2);
  assert.equal(CANONICAL_HELPER_FILES.has(CANONICAL_METRICS_FILE), false);
});
