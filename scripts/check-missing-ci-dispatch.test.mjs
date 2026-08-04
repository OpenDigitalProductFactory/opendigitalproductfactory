// Tests for the missing-CI-dispatch watch.
//
// The bar matches the other guard tests: prove the watch FIRES on the failure it
// exists for, and — just as important here — prove it STAYS QUIET on the four
// look-alikes. A watch that cries wolf on drafts or fresh pushes gets muted, and
// a muted watch is worse than none, because the silent stall it was built for
// then looks exactly like its own noise.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findMissingDispatch, headCommitTime, commentBody } from "./check-missing-ci-dispatch.mjs";

const NOW = Date.parse("2026-08-04T20:00:00.000Z");
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString();

const pr = (over = {}) => ({
  number: 1,
  isDraft: false,
  headRefOid: "abcdef1234567890",
  statusCheckRollup: [],
  commits: [{ committedDate: minsAgo(60) }],
  ...over,
});

test("fires on an open PR whose head has zero checks — the whole point", () => {
  const found = findMissingDispatch([pr()], { now: NOW });
  assert.equal(found.length, 1);
  assert.equal(found[0].pr, 1);
  assert.equal(found[0].headSha, "abcdef12");
  assert.equal(found[0].ageMinutes, 60);
});

test("stays quiet when ANY check exists — a red check is a different problem", () => {
  // Dispatch worked. Whether those checks passed is not this watch's business;
  // failures already alert loudly on their own.
  const found = findMissingDispatch([pr({ statusCheckRollup: [{ name: "DCO", conclusion: "FAILURE" }] })], {
    now: NOW,
  });
  assert.deepEqual(found, []);
});

test("stays quiet on a freshly pushed head — dispatch may be in flight", () => {
  const found = findMissingDispatch([pr({ commits: [{ committedDate: minsAgo(3) }] })], { now: NOW });
  assert.deepEqual(found, []);
});

test("stays quiet on drafts", () => {
  const found = findMissingDispatch([pr({ isDraft: true })], { now: NOW });
  assert.deepEqual(found, []);
});

test("ages on the head COMMIT, not on PR updatedAt", () => {
  // Regression guard for the tempting shortcut. A PR pushed days ago but
  // commented on a minute ago must still be flagged — using updatedAt would
  // make it look freshly pushed and let a genuinely stalled PR escape.
  const old = pr({ commits: [{ committedDate: minsAgo(4320) }], updatedAt: minsAgo(1) });
  const found = findMissingDispatch([old], { now: NOW });
  assert.equal(found.length, 1);
  assert.equal(found[0].ageMinutes, 4320);
});

test("uses the NEWEST commit when a PR has several", () => {
  const multi = pr({
    commits: [{ committedDate: minsAgo(500) }, { committedDate: minsAgo(30) }, { committedDate: minsAgo(200) }],
  });
  assert.equal(headCommitTime(multi), NOW - 30 * 60000);
  assert.equal(findMissingDispatch([multi], { now: NOW })[0].ageMinutes, 30);
});

test("does not guess when the head timestamp is unknowable", () => {
  // A missing or unparseable date is not evidence of a missing run. Flagging
  // here would be inventing a failure out of absent metadata.
  for (const commits of [[], [{}], [{ committedDate: "not-a-date" }], undefined]) {
    assert.deepEqual(findMissingDispatch([pr({ commits })], { now: NOW }), [], JSON.stringify(commits));
  }
});

test("threshold is configurable and is a strict floor", () => {
  const p = pr({ commits: [{ committedDate: minsAgo(20) }] });
  assert.equal(findMissingDispatch([p], { now: NOW, minAgeMinutes: 20 }).length, 1, "20m meets a 20m floor");
  assert.deepEqual(findMissingDispatch([p], { now: NOW, minAgeMinutes: 21 }), [], "20m is under a 21m floor");
});

test("survives malformed input without throwing", () => {
  // The scheduled job must never fail on odd API output — a crashed watch is a
  // silent watch, which is the exact failure it is meant to prevent.
  assert.deepEqual(findMissingDispatch(null), []);
  assert.deepEqual(findMissingDispatch(undefined), []);
  assert.deepEqual(findMissingDispatch([null, {}, { number: "x" }], { now: NOW }), []);
});

test("only the flagged PRs come back from a mixed set", () => {
  const found = findMissingDispatch(
    [
      pr({ number: 10 }),
      pr({ number: 11, statusCheckRollup: [{ name: "CI" }] }),
      pr({ number: 12, isDraft: true }),
      pr({ number: 13, commits: [{ committedDate: minsAgo(1) }] }),
      pr({ number: 14 }),
    ],
    { now: NOW },
  );
  assert.deepEqual(
    found.map((f) => f.pr),
    [10, 14],
  );
});

test("the comment names the recovery that actually works", () => {
  // "Re-run failed jobs" is the reflex and it is useless here: there are no jobs
  // to re-run. The comment must say so or it sends the reader down a dead end.
  const body = commentBody({ pr: 1, headSha: "abcdef12", ageMinutes: 60 });
  assert.match(body, /re-trigger the `pull_request` event/);
  assert.match(body, /will not help/);
  assert.match(body, /<!-- missing-ci-dispatch-watch -->/, "marker enables comment-once");
});
