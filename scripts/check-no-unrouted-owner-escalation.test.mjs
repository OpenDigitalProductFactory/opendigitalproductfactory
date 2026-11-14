/**
 * BI-5E067004 — tests for the unrouted owner-escalation guard.
 * Run: node --test scripts/check-no-unrouted-owner-escalation.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SANCTIONED, findViolations, isExcludedFile, scanRepo } from "./check-no-unrouted-owner-escalation.mjs";

function withTree(files, fn) {
  const root = mkdtempSync(join(tmpdir(), "owner-escalation-guard-"));
  try {
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), body);
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("flags a producer that sets the needs-human self-fix class", () => {
  const hits = findViolations(`await raise({ title, selfFixClass: "needs-human" });`);
  assert.deepEqual(hits.map((h) => h.rule), ["self-fix-class"]);
});

test("flags a SELF_FIX_CLASS member passed as a value", () => {
  assert.equal(findViolations(`escalate({ selfFixClass: SELF_FIX_CLASS.NEEDS_HUMAN })`).length, 1);
});

test("flags an owner-attention report written outside the seam", () => {
  const body = `await createPlatformIssueReport({\n  type: "build-stall-escalation",\n  source: "x",\n});`;
  assert.deepEqual(findViolations(body).map((h) => [h.line, h.rule]), [[2, "owner-report"]]);
});

test("flags an owner notification outside the seam", () => {
  const body = `await notifyAttentionLive({\n  source: "escalation",\n  itemKey,\n});`;
  assert.deepEqual(findViolations(body).map((h) => h.rule), ["owner-notice"]);
});

test("leaves reads alone: a query on the stall type with no report write", () => {
  const body = `prisma.platformIssueReport.findMany({ where: { OR: [{ type: "build-stall-escalation" }, { selfFixClass: { not: null } }] } });`;
  assert.deepEqual(findViolations(body), []);
});

test("leaves an attention source registry alone when it never notifies", () => {
  assert.deepEqual(findViolations(`const sources = [{ source: "escalation", load }];`), []);
});

test("leaves unrelated needs-human vocabulary alone", () => {
  assert.deepEqual(findViolations(`return { status: "needs-human", reason };`), []);
});

test("ignores comments", () => {
  assert.deepEqual(findViolations(`// selfFixClass: "needs-human" used to be set here`), []);
});

test("excludes tests and declarations", () => {
  assert.equal(isExcludedFile("x.test.ts"), true);
  assert.equal(isExcludedFile("x.d.ts"), true);
  assert.equal(isExcludedFile("x.ts"), false);
});

test("scanRepo skips the sanctioned seam and reports the bypass", () => {
  withTree({
    "apps/web/lib/govern/authority/route-to-human.ts": `createPlatformIssueReport({ type: "build-stall-escalation", selfFixClass: "needs-human" });`,
    "apps/web/lib/build/bypass.ts": `createPlatformIssueReport({ type: "build-stall-escalation" });`,
    "apps/web/lib/build/bypass.test.ts": `createPlatformIssueReport({ type: "build-stall-escalation" });`,
  }, (root) => {
    assert.deepEqual(scanRepo(root).map((v) => v.file), ["apps/web/lib/build/bypass.ts"]);
  });
});

test("the sanctioned list names only the seam and the writer", () => {
  assert.deepEqual([...SANCTIONED.keys()].sort(), [
    "apps/web/lib/govern/authority/route-to-human.ts",
    "apps/web/lib/quality/platform-issue-reports.ts",
  ]);
});

test("the repository has no unrouted owner escalation", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  assert.deepEqual(scanRepo(root), []);
});
