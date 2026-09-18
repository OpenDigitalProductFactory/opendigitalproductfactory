// scripts/check-stuck-auto-merge.test.mjs
// node --test (no vitest). Covers the pure findStuckPullRequests() — the
// auto-merge + merge-state + failing-check predicate, the pending-check
// transient rule, the threshold clock — and shouldComment() idempotency.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyCheck,
  commentBody,
  findStuckPullRequests,
  markerFor,
  shouldComment,
} from "./check-stuck-auto-merge.mjs";

const NOW = Date.parse("2026-09-18T12:00:00Z");
const ago = (h) => new Date(NOW - h * 3600 * 1000).toISOString();
const SHA = "00635db841371af0b8599f70e81815e6a27fffe9";

const failingCheck = (at, name = "Typecheck") => ({
  __typename: "CheckRun", name, workflowName: "CI", status: "COMPLETED",
  conclusion: "FAILURE", completedAt: at, detailsUrl: "https://example.test/run/1",
});
const passingCheck = (at) => ({ __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "SUCCESS", completedAt: at });

function pr(overrides = {}) {
  return {
    number: 5333,
    url: "https://github.com/o/r/pull/5333",
    title: "fix: something",
    isDraft: false,
    state: "OPEN",
    headRefOid: SHA,
    autoMergeRequest: { enabledAt: ago(30), mergeMethod: "SQUASH" },
    mergeStateStatus: "BLOCKED",
    statusCheckRollup: [failingCheck(ago(29)), passingCheck(ago(29))],
    commits: [{ committedDate: ago(31) }],
    ...overrides,
  };
}

test("flags a BLOCKED PR with auto-merge armed and a failing check past the threshold", () => {
  const stuck = findStuckPullRequests([pr()], { now: NOW });
  assert.equal(stuck.length, 1);
  assert.equal(stuck[0].number, 5333);
  assert.equal(stuck[0].mergeStateStatus, "BLOCKED");
  assert.equal(stuck[0].stuckHours, 29); // clock starts at the newest signal: the failing check
  assert.deepEqual(stuck[0].failingChecks.map((c) => c.name), ["CI / Typecheck"]);
});

test("does not flag a PR without auto-merge, a draft, or a closed PR", () => {
  assert.equal(findStuckPullRequests([pr({ autoMergeRequest: null })], { now: NOW }).length, 0);
  assert.equal(findStuckPullRequests([pr({ isDraft: true })], { now: NOW }).length, 0);
  assert.equal(findStuckPullRequests([pr({ state: "MERGED" })], { now: NOW }).length, 0);
});

test("does not flag inside the threshold, and honours a custom threshold", () => {
  const recent = pr({
    autoMergeRequest: { enabledAt: ago(3) },
    statusCheckRollup: [failingCheck(ago(2))],
    commits: [{ committedDate: ago(3) }],
  });
  assert.equal(findStuckPullRequests([recent], { now: NOW }).length, 0); // 2h < 4h default
  assert.equal(findStuckPullRequests([recent], { now: NOW, thresholdHours: 1 }).length, 1);
});

test("a fresh push restarts the clock even when auto-merge was armed long ago", () => {
  const pushed = pr({ commits: [{ committedDate: ago(1) }], statusCheckRollup: [failingCheck(ago(0.5))] });
  assert.equal(findStuckPullRequests([pushed], { now: NOW }).length, 0);
});

test("a pending check is a transient, never a stuck PR", () => {
  const midCi = pr({
    statusCheckRollup: [failingCheck(ago(10)), { __typename: "CheckRun", name: "build", status: "IN_PROGRESS", conclusion: null }],
  });
  assert.equal(findStuckPullRequests([midCi], { now: NOW }).length, 0);
});

test("a check hung IN_PROGRESS past the threshold is stuck, and is named", () => {
  const hung = pr({
    statusCheckRollup: [
      passingCheck(ago(10)),
      { __typename: "CheckRun", name: "Production Build", workflowName: "CI", status: "IN_PROGRESS", conclusion: null, startedAt: ago(9), completedAt: "0001-01-01T00:00:00Z" },
    ],
  });
  const [f] = findStuckPullRequests([hung], { now: NOW });
  assert.ok(f);
  assert.deepEqual(f.failingChecks.map((c) => c.name), ["CI / Production Build (still running after 9h)"]);
  // ...but not while another check is genuinely fresh.
  hung.statusCheckRollup.push({ __typename: "CheckRun", name: "lint2", status: "QUEUED", startedAt: ago(0.1) });
  assert.equal(findStuckPullRequests([hung], { now: NOW }).length, 0);
});

test("BLOCKED with all checks green (e.g. unresolved threads) is still stuck; CLEAN with green checks is not", () => {
  const blockedNoFail = pr({ statusCheckRollup: [passingCheck(ago(20))] });
  const flagged = findStuckPullRequests([blockedNoFail], { now: NOW });
  assert.equal(flagged.length, 1);
  assert.deepEqual(flagged[0].failingChecks, []);
  assert.equal(findStuckPullRequests([pr({ mergeStateStatus: "CLEAN", statusCheckRollup: [passingCheck(ago(20))] })], { now: NOW }).length, 0);
});

test("DIRTY and BEHIND count as stuck; a failing check makes UNSTABLE stuck too", () => {
  for (const s of ["DIRTY", "BEHIND", "dirty"]) {
    assert.equal(findStuckPullRequests([pr({ mergeStateStatus: s, statusCheckRollup: [] })], { now: NOW }).length, 1, s);
  }
  assert.equal(findStuckPullRequests([pr({ mergeStateStatus: "UNSTABLE" })], { now: NOW }).length, 1);
});

test("a PR with no usable timestamp is never flagged (no fabricated age)", () => {
  const noTime = pr({ autoMergeRequest: { enabledAt: "not-a-date" }, commits: [], statusCheckRollup: [] });
  assert.equal(findStuckPullRequests([noTime], { now: NOW }).length, 0);
});

test("classifyCheck handles StatusContext rows and non-blocking conclusions", () => {
  assert.equal(classifyCheck({ __typename: "StatusContext", context: "dco", state: "FAILURE" }).verdict, "failing");
  assert.equal(classifyCheck({ __typename: "StatusContext", context: "dco", state: "PENDING" }).verdict, "pending");
  assert.equal(classifyCheck({ __typename: "CheckRun", name: "x", status: "COMPLETED", conclusion: "SKIPPED" }).verdict, "passing");
  assert.equal(classifyCheck({ __typename: "CheckRun", name: "x", status: "COMPLETED", conclusion: "TIMED_OUT" }).verdict, "failing");
});

test("shouldComment is idempotent per head SHA and re-arms on a new head", () => {
  assert.equal(shouldComment([], SHA), true);
  assert.equal(shouldComment([{ body: "unrelated" }], SHA), true);
  assert.equal(shouldComment([{ body: `${markerFor(SHA)}\nstuck` }], SHA), false);
  assert.equal(shouldComment([{ body: `${markerFor("ffff")}\nstuck` }], SHA), true);
});

test("commentBody carries the marker, the failing checks and the runbook link", () => {
  const [f] = findStuckPullRequests([pr()], { now: NOW });
  const body = commentBody(f, { repo: "o/r" });
  assert.ok(body.startsWith(markerFor(SHA)));
  assert.match(body, /CI \/ Typecheck/);
  assert.match(body, /https:\/\/github\.com\/o\/r\/blob\/main\/docs\/architecture\/build-gate-runbook\.md/);
  assert.match(body, /pnpm pr:health 5333/);
});
