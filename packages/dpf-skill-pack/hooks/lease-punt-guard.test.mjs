import assert from "node:assert/strict";
import { test } from "node:test";

import { decide } from "./lease-punt-guard.mjs";

// ── hard-denies runtime-bound DB gates in a no-DATABASE_URL worktree ──────────

test("denies prisma migrate dev/deploy/reset when DATABASE_URL is absent", () => {
  assert.equal(decide("pnpm prisma migrate dev").action, "deny");
  assert.equal(decide("prisma migrate deploy").action, "deny");
  assert.equal(decide("npx prisma migrate reset -f").action, "deny");
  assert.equal(decide("pnpm prisma db push").action, "deny");
});

test("a denied verdict carries lease-redirect guidance", () => {
  const v = decide("prisma migrate dev");
  assert.equal(v.action, "deny");
  assert.match(v.reason, /local-integration-ci|claim_nonprod_environment_lease/);
  assert.match(v.reason, /worktree|source control/i);
});

// ── warns (non-blocking) on next build ───────────────────────────────────────

test("warns on next build in a no-DATABASE_URL worktree, does not block", () => {
  const v = decide("pnpm next build");
  assert.equal(v.action, "warn");
  assert.match(v.reason, /lease|canonical/i);
});

// ── allows when a runtime IS available (DATABASE_URL set) ─────────────────────

test("allows the gate when DATABASE_URL is set (canonical install / leased env)", () => {
  assert.equal(decide("prisma migrate dev", { DATABASE_URL: "postgresql://x" }).action, "allow");
  assert.equal(decide("next build", { DATABASE_URL: "postgresql://x" }).action, "allow");
});

// ── allows governed lease paths + bypass ─────────────────────────────────────

test("allows commands already on the governed lease path", () => {
  assert.equal(decide("prisma migrate deploy # via claim_nonprod_environment_lease").action, "allow");
  assert.equal(decide("bash scripts/dev-portal-lease.sh && prisma migrate dev").action, "allow");
});

test("honors the emergency bypass marker", () => {
  assert.equal(decide("DPF_ALLOW_UNLEASED_GATE=1 prisma migrate dev").action, "allow");
});

// ── does not over-block ──────────────────────────────────────────────────────

test("does not touch unrelated commands", () => {
  assert.equal(decide("prisma generate").action, "allow");
  assert.equal(decide("prisma studio").action, "allow");
  assert.equal(decide("pnpm test").action, "allow");
  assert.equal(decide("git status").action, "allow");
  assert.equal(decide("").action, "allow");
  assert.equal(decide(undefined).action, "allow");
});
