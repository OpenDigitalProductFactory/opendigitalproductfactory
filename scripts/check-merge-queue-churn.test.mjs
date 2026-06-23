// scripts/check-merge-queue-churn.test.mjs
// node --test (no vitest). Covers the pure analyzeChurn() — grouping by PR,
// distinct-failed-attempt counting, window + threshold, and noise rejection.

import assert from "node:assert/strict";
import { test } from "node:test";

import { analyzeChurn } from "./check-merge-queue-churn.mjs";

const NOW = Date.parse("2026-06-20T12:00:00Z");
const ago = (h) => new Date(NOW - h * 3600 * 1000).toISOString();

test("flags a PR with >= 2 distinct failed queue attempts in window", () => {
  const runs = [
    { headBranch: "gh-readonly-queue/main/pr-2157-aaaa111", conclusion: "failure", createdAt: ago(1) },
    { headBranch: "gh-readonly-queue/main/pr-2157-bbbb222", conclusion: "failure", createdAt: ago(2) },
    // same sha as a failure, but a DCO success — still one attempt, not two:
    { headBranch: "gh-readonly-queue/main/pr-2157-bbbb222", conclusion: "success", createdAt: ago(2) },
  ];
  const flagged = analyzeChurn(runs, { now: NOW });
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].pr, 2157);
  assert.equal(flagged[0].failedAttempts, 2);
  assert.equal(flagged[0].latestSha, "aaaa111"); // most-recent failed attempt
});

test("does NOT flag a single failed attempt (below threshold)", () => {
  const runs = [{ headBranch: "gh-readonly-queue/main/pr-99-deadbee", conclusion: "failure", createdAt: ago(1) }];
  assert.equal(analyzeChurn(runs, { now: NOW }).length, 0);
});

test("ignores failures outside the window", () => {
  const runs = [
    { headBranch: "gh-readonly-queue/main/pr-5-aaa", conclusion: "failure", createdAt: ago(30) },
    { headBranch: "gh-readonly-queue/main/pr-5-bbb", conclusion: "failure", createdAt: ago(40) },
  ];
  assert.equal(analyzeChurn(runs, { now: NOW, windowHours: 24 }).length, 0);
});

test("ignores non-merge_group branches and all-success PRs", () => {
  const runs = [
    { headBranch: "feature/foo", conclusion: "failure", createdAt: ago(1) },
    { headBranch: "gh-readonly-queue/main/pr-7-aaa", conclusion: "success", createdAt: ago(1) },
    { headBranch: "gh-readonly-queue/main/pr-7-bbb", conclusion: "success", createdAt: ago(1) },
  ];
  assert.equal(analyzeChurn(runs, { now: NOW }).length, 0);
});

test("sorts most-churned PRs first", () => {
  const runs = [
    { headBranch: "gh-readonly-queue/main/pr-1-a1", conclusion: "failure", createdAt: ago(1) },
    { headBranch: "gh-readonly-queue/main/pr-1-b2", conclusion: "failure", createdAt: ago(2) },
    { headBranch: "gh-readonly-queue/main/pr-2-c3", conclusion: "failure", createdAt: ago(1) },
    { headBranch: "gh-readonly-queue/main/pr-2-d4", conclusion: "failure", createdAt: ago(2) },
    { headBranch: "gh-readonly-queue/main/pr-2-e5", conclusion: "failure", createdAt: ago(3) },
  ];
  const flagged = analyzeChurn(runs, { now: NOW });
  assert.equal(flagged.length, 2);
  assert.equal(flagged[0].pr, 2); // 3 attempts
  assert.equal(flagged[0].failedAttempts, 3);
  assert.equal(flagged[1].pr, 1); // 2 attempts
});
