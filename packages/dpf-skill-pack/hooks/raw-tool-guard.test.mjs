import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "./raw-tool-guard.mjs";

const ROOT = "/Users/dev/dpf-worktrees/topic";
const WEB = "/Users/dev/dpf-worktrees/topic/apps/web";

// ── the incident: raw tsc ────────────────────────────────────────────────────
test("refuses the exact raw tsc that ran out of heap, naming the wrapper", () => {
  const v = decide({ command: "pnpm --filter web exec tsc --noEmit -p tsconfig.json", cwd: ROOT });
  assert.equal(v.block, true);
  assert.match(v.reason, /pnpm --filter <pkg> typecheck/);
  assert.match(v.reason, /BI-CD7706B5/);
});
test("refuses bare, npx and pnpm-run forms of tsc", () => {
  for (const c of ["tsc --noEmit", "npx tsc -p .", "pnpm tsc --noEmit", "cd apps/web && pnpm exec tsc --noEmit"]) {
    assert.equal(decide({ command: c, cwd: WEB }).block, true, c);
  }
});
test("allows the memory-aware routes", () => {
  for (const c of ["pnpm --filter web typecheck", "pnpm --filter web typecheck:tests", "node scripts/run-tsc.mjs --noEmit", "node ../../scripts/run-tsc.mjs --noEmit -p tsconfig.test.json"]) {
    assert.equal(decide({ command: c, cwd: ROOT }).block, false, c);
  }
});

// ── root-level vitest ────────────────────────────────────────────────────────
test("refuses vitest from the workspace root without a package filter", () => {
  const v = decide({ command: "pnpm vitest run scripts/foo.test.ts", cwd: ROOT });
  assert.equal(v.block, true);
  assert.match(v.reason, /pnpm --filter <pkg> exec vitest run/);
});
test("allows vitest with --filter, from inside a package directory, or via -C", () => {
  assert.equal(decide({ command: "pnpm --filter web exec vitest run lib/x.test.ts", cwd: ROOT }).block, false);
  assert.equal(decide({ command: "pnpm exec vitest run lib/x.test.ts", cwd: WEB }).block, false);
  assert.equal(decide({ command: "pnpm -C apps/web exec vitest run lib/x.test.ts", cwd: ROOT }).block, false);
  assert.equal(decide({ command: "pnpm exec vitest run src/a.test.ts", cwd: "/Users/dev/dpf-worktrees/topic/packages/db" }).block, false);
});

// ── npx ──────────────────────────────────────────────────────────────────────
test("refuses npx and points at the pnpm form", () => {
  const v = decide({ command: "npx prisma generate", cwd: ROOT });
  assert.equal(v.block, true);
  assert.match(v.reason, /pnpm --filter <pkg> exec <tool>/);
});

// ── bypass and non-matches ───────────────────────────────────────────────────
test("the bypass allows the raw form when it is the point", () => {
  assert.equal(decide({ command: "DPF_ALLOW_RAW_TOOL=1 pnpm exec tsc --noEmit", cwd: ROOT }).block, false);
  assert.equal(decide({ command: "pnpm exec tsc --noEmit", cwd: ROOT, env: { DPF_ALLOW_RAW_TOOL: "1" } }).block, false);
});
test("ordinary commands pass through", () => {
  for (const c of ["git status", "pnpm --filter web build", "node scripts/check-guards.mjs", "ls -la", "pnpm run pregate", "echo tsc"]) {
    assert.equal(decide({ command: c, cwd: ROOT }).block, false, c);
  }
});
test("an empty or non-string command is allowed (fail open)", () => {
  assert.equal(decide({ command: "", cwd: ROOT }).block, false);
  assert.equal(decide({ command: undefined, cwd: ROOT }).block, false);
});
