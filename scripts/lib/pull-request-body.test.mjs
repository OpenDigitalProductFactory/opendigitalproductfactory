import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePullRequestView, readPullRequestBody } from "./pull-request-body.mjs";

test("an open pull request body is included", () => {
  const parsed = parsePullRequestView({
    status: 0,
    stdout: JSON.stringify({ state: "OPEN", body: "Convergence-Impact-Decision: no\n" }),
  });
  assert.equal(parsed.included, true);
  assert.match(parsed.body, /Convergence-Impact-Decision: no/);
});

test("gh failure, a closed pull request, and a missing body are skips", () => {
  assert.deepEqual(parsePullRequestView({ status: 1, stdout: "" }), { included: false, reason: "gh-failed" });
  assert.equal(parsePullRequestView({
    status: 0,
    stdout: JSON.stringify({ state: "MERGED", body: "still here" }),
  }).included, false);
  assert.equal(parsePullRequestView({
    status: 0,
    stdout: JSON.stringify({ state: "OPEN", body: null }),
  }).reason, "no-body");
  assert.equal(parsePullRequestView({ status: 0, stdout: "not-json" }).reason, "unparseable");
});

test("readPullRequestBody asks gh for the branch and does not throw when gh fails", () => {
  const calls = [];
  const skipped = readPullRequestBody({
    branch: "fix/local-gate-delivery-batch",
    spawnSyncImpl: (bin, args) => {
      calls.push([bin, args]);
      return { status: 1, stdout: "", stderr: "no pulls" };
    },
  });
  assert.equal(skipped.included, false);
  assert.equal(skipped.reason, "gh-failed");
  assert.equal(calls[0][0], "gh");
  assert.deepEqual(calls[0][1].slice(0, 3), ["pr", "view", "fix/local-gate-delivery-batch"]);
});
