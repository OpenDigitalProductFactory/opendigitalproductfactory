import assert from "node:assert/strict";
import { test } from "node:test";

import { decide } from "./lease-guard.mjs";

// ── blocks ungoverned dev-server launchers ───────────────────────────────────

test("blocks pnpm dev / run dev", () => {
  assert.equal(decide("pnpm dev").block, true);
  assert.equal(decide("pnpm run dev").block, true);
  assert.equal(decide("pnpm --filter web dev").block, true);
});

test("blocks npm/yarn dev, next dev, turbo dev, dev-portal-start", () => {
  assert.equal(decide("npm run dev").block, true);
  assert.equal(decide("yarn dev").block, true);
  assert.equal(decide("next dev -p 3001").block, true);
  assert.equal(decide("turbo run dev").block, true);
  assert.equal(decide("bash scripts/dev-portal-start.sh").block, true);
});

test("a blocked verdict carries actionable guidance", () => {
  const v = decide("pnpm dev");
  assert.equal(v.block, true);
  assert.match(v.reason, /governed|lease|bypass/i);
});

// ── allows governed paths + bypass ───────────────────────────────────────────

test("allows the governed lease wrappers", () => {
  assert.equal(decide("bash scripts/dev-portal-lease.sh up").block, false);
  assert.equal(decide("bash scripts/gate-worktree.sh").block, false);
  assert.equal(decide("pnpm dev # via claim_nonprod_environment_lease").block, false);
});

test("honors the inline and env emergency bypass", () => {
  assert.equal(decide("DPF_ALLOW_UNGATED_SERVER=1 pnpm dev").block, false);
  assert.equal(decide("pnpm dev", { DPF_ALLOW_UNGATED_SERVER: "1" }).block, false);
});

// ── does not over-block ──────────────────────────────────────────────────────

test("does not block unrelated or read-only commands", () => {
  assert.equal(decide("pnpm install").block, false);
  assert.equal(decide("pnpm test").block, false);
  assert.equal(decide("pnpm run build").block, false);
  assert.equal(decide("docker compose up -d").block, false); // infra, intentionally out of scope
  assert.equal(decide("git status").block, false);
  assert.equal(decide("").block, false);
  assert.equal(decide(undefined).block, false);
});

test("does not match 'dev' inside an unrelated word (devDependencies, devops)", () => {
  assert.equal(decide("pnpm add -D devDependencies-thing").block, false);
  assert.equal(decide("echo devops").block, false);
});
