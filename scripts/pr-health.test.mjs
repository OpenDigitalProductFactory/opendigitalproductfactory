// scripts/pr-health.test.mjs
// node --test (no vitest). Covers the pure evaluatePrHealth() verdict — the three
// blocker classes that were missed in practice (non-required failing guards,
// mid-CI pending, unresolved review threads) plus conflict/draft/state handling.

import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluatePrHealth } from "./pr-health.mjs";

const okMeta = { number: 1, title: "x", state: "OPEN", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", isDraft: false };
const pass = (name) => ({ name, bucket: "pass" });

test("READY when all checks pass, mergeable, no unresolved threads", () => {
  const r = evaluatePrHealth({ meta: okMeta, checks: [pass("Typecheck"), pass("Production Build")], threads: [] });
  assert.equal(r.ready, true);
  assert.deepEqual(r.blockers, []);
});

test("blocks on a failing check (incl. a non-'required' guard like Module Size)", () => {
  const r = evaluatePrHealth({
    meta: okMeta,
    checks: [pass("Typecheck"), { name: "Module Size Guard", bucket: "fail" }],
    threads: [],
  });
  assert.equal(r.ready, false);
  assert.equal(r.counts.failing, 1);
  assert.match(r.blockers.join("\n"), /Module Size Guard/);
});

test("blocks on a cancelled check", () => {
  const r = evaluatePrHealth({ meta: okMeta, checks: [{ name: "CodeQL", bucket: "cancel" }], threads: [] });
  assert.equal(r.ready, false);
  assert.match(r.blockers.join("\n"), /CodeQL/);
});

test("blocks while a check is still pending (mid-CI is not green)", () => {
  const r = evaluatePrHealth({
    meta: okMeta,
    checks: [pass("Typecheck"), { name: "Production Build", bucket: "pending" }],
    threads: [],
  });
  assert.equal(r.ready, false);
  assert.equal(r.counts.pending, 1);
  assert.match(r.blockers.join("\n"), /not yet terminal/);
});

test("skipping checks do not block", () => {
  const r = evaluatePrHealth({
    meta: okMeta,
    checks: [pass("Typecheck"), { name: "signoff", bucket: "skipping" }],
    threads: [],
  });
  assert.equal(r.ready, true);
});

test("blocks on an unresolved review thread (gh pr checks misses these)", () => {
  const r = evaluatePrHealth({
    meta: okMeta,
    checks: [pass("Typecheck")],
    threads: [{ isResolved: false, path: "a/b.ts", line: 20 }],
  });
  assert.equal(r.ready, false);
  assert.equal(r.counts.unresolvedThreads, 1);
  assert.match(r.blockers.join("\n"), /a\/b\.ts:20/);
});

test("resolved threads do not block", () => {
  const r = evaluatePrHealth({
    meta: okMeta,
    checks: [pass("Typecheck")],
    threads: [{ isResolved: true, path: "a/b.ts", line: 20 }],
  });
  assert.equal(r.ready, true);
});

test("blocks on CONFLICTING mergeable", () => {
  const r = evaluatePrHealth({ meta: { ...okMeta, mergeable: "CONFLICTING" }, checks: [pass("Typecheck")], threads: [] });
  assert.equal(r.ready, false);
  assert.match(r.blockers.join("\n"), /CONFLICTING/);
});

test("UNKNOWN mergeable is a note, not a hard blocker", () => {
  const r = evaluatePrHealth({ meta: { ...okMeta, mergeable: "UNKNOWN" }, checks: [pass("Typecheck")], threads: [] });
  assert.equal(r.ready, true);
  assert.match(r.notes.join("\n"), /still computing/);
});

test("draft and non-OPEN state block", () => {
  assert.equal(evaluatePrHealth({ meta: { ...okMeta, isDraft: true }, checks: [], threads: [] }).ready, false);
  assert.equal(evaluatePrHealth({ meta: { ...okMeta, state: "MERGED" }, checks: [], threads: [] }).ready, false);
});

test("BLOCKED mergeStateStatus with no concrete blocker is a note (queue-waiting), still ready", () => {
  const r = evaluatePrHealth({
    meta: { ...okMeta, mergeStateStatus: "BLOCKED" },
    checks: [pass("Typecheck")],
    threads: [],
  });
  assert.equal(r.ready, true);
  assert.match(r.notes.join("\n"), /queue-waiting/);
});

test("enumerates ALL blockers at once (no early-out)", () => {
  const r = evaluatePrHealth({
    meta: { ...okMeta, mergeable: "CONFLICTING" },
    checks: [{ name: "CodeQL", bucket: "fail" }, { name: "Build", bucket: "pending" }],
    threads: [{ isResolved: false, path: "x.ts", line: 1 }],
  });
  assert.equal(r.ready, false);
  assert.equal(r.blockers.length, 4); // conflict + failing + pending + unresolved
});
