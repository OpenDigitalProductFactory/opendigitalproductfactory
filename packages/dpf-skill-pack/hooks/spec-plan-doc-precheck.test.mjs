import assert from "node:assert/strict";
import { test } from "node:test";

import { decide } from "./spec-plan-doc-precheck.mjs";

// ── reminds when a substantial new source module/route is created ─────────────

test("reminds when a Write creates a new apps/web/lib module", () => {
  const v = decide("Write", { file_path: "apps/web/lib/tak/execution-plan.ts", content: "export const x = 1;" });
  assert.equal(v.remind, true);
});

test("reminds on a new route.ts under apps/web/app", () => {
  const v = decide("Write", { file_path: "apps/web/app/api/foo/route.ts", content: "export function GET() {}" });
  assert.equal(v.remind, true);
});

test("reminds on a new page.tsx route", () => {
  const v = decide("Write", { file_path: "apps/web/app/(shell)/foo/page.tsx", content: "export default function P() {}" });
  assert.equal(v.remind, true);
});

test("reminds on a new package src module", () => {
  const v = decide("Write", { file_path: "packages/db/src/thing.ts", content: "export const t = 1;" });
  assert.equal(v.remind, true);
});

test("handles an absolute path by normalizing to repo-relative", () => {
  const v = decide("Write", {
    file_path: "/Users/x/dpf-worktrees/topic/apps/web/lib/foo.ts",
    content: "export const a = 1;",
  });
  assert.equal(v.remind, true);
});

// ── stays quiet where it should ──────────────────────────────────────────────

test("does NOT remind on Edit (existing-file change is the gate's line-threshold path)", () => {
  assert.equal(decide("Edit", { file_path: "apps/web/lib/foo.ts", new_string: "x" }).remind, false);
});

test("does NOT remind for test / spec / generated files", () => {
  assert.equal(decide("Write", { file_path: "apps/web/lib/foo.test.ts", content: "x" }).remind, false);
  assert.equal(decide("Write", { file_path: "packages/db/generated/client/index.ts", content: "x" }).remind, false);
});

test("does NOT remind for non-source files (docs, scripts, config)", () => {
  assert.equal(decide("Write", { file_path: "docs/superpowers/specs/foo.md", content: "x" }).remind, false);
  assert.equal(decide("Write", { file_path: "scripts/foo.mjs", content: "x" }).remind, false);
  assert.equal(decide("Write", { file_path: "apps/web/components/Foo.tsx", content: "x" }).remind, false);
});

test("ignores non-Write tools", () => {
  assert.equal(decide("Bash", { command: "ls" }).remind, false);
  assert.equal(decide("Read", { file_path: "apps/web/lib/foo.ts" }).remind, false);
});
