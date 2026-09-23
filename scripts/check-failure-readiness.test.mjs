import assert from "node:assert/strict";
import test from "node:test";
import { reviewHeads, validateFailureStatus, checkFailureReadiness, failureReadinessConfigured } from "./check-failure-readiness.mjs";
const sha = "a".repeat(40), other = "b".repeat(40);
const now = Date.parse("2026-09-08T12:00:00Z");
const status = { context: "dpf/failure-readiness", state: "success", creator: { login: "platform-publisher" }, created_at: "2026-09-08T11:50:00Z" };
test("requires the trusted publisher and a fresh passing final-change verdict", () => {
  assert.equal(validateFailureStatus([status], "platform-publisher", now).valid, true);
  for (const [rows, publisher] of [[[], "platform-publisher"], [[status], ""], [[status], "unrelated"],
    [[{ ...status, state: "pending" }], "platform-publisher"], [[{ ...status, state: "failure" }], "platform-publisher"],
    [[{ ...status, created_at: "2026-09-08T10:00:00Z" }], "platform-publisher"]]) {
    assert.equal(validateFailureStatus(rows, publisher, now).valid, false);
  }
});
test("a newer refusal wins over an older passing status", () => {
  assert.equal(validateFailureStatus([status, { ...status, state: "failure", created_at: "2026-09-08T11:55:00Z" }], "platform-publisher", now).valid, false);
});
test("merge-group checks cover all earlier queued source changes", () => {
  assert.deepEqual(reviewHeads({ merge_group: { head_sha: "group-2" } }, [
    { position: 1, headCommit: { oid: "group-1" }, pullRequest: { headRefOid: sha } },
    { position: 2, headCommit: { oid: "group-2" }, pullRequest: { headRefOid: other } },
    { position: 3, headCommit: { oid: "group-3" }, pullRequest: { headRefOid: "c".repeat(40) } },
  ]), [sha, other]);
  assert.throws(() => reviewHeads({ merge_group: { head_sha: "missing" } }, []), /snapshot/);
});
test("PR checks bind to the source commit rather than the synthetic merge commit", () => {
  assert.deepEqual(reviewHeads({ pull_request: { head: { sha } } }), [sha]);
});
test("provider outage never becomes approval", async () => {
  await assert.rejects(checkFailureReadiness({ event: { pull_request: { head: { sha } } }, repository: "owner/repo", token: "test", publisher: "platform-publisher",
    fetchImpl: async () => ({ ok: false, status: 503 }) }), /no approval inferred/);
});

// BI-82DCD601 sibling finding: this gate failed on 30 of the last 30 merged
// PRs (measured 2026-09-09) because DPF_REVIEW_STATUS_PUBLISHER is unset.
// Every one merged anyway. A gate that is always red spends the signal a real
// failure needs, so an unconfigured gate must report "cannot run", not "fail".
test("an unconfigured publisher is reported as unconfigured, not as a failed verdict", () => {
  const verdict = validateFailureStatus([], "");
  assert.equal(verdict.valid, false);
  assert.equal(verdict.unconfigured, true, "the caller must be able to tell refusal from failure");
});

test("a configured publisher with failing evidence is a real verdict, never 'unconfigured'", () => {
  const statuses = [{
    context: "dpf/failure-readiness",
    state: "failure",
    created_at: new Date().toISOString(),
    creator: { login: "dpf-bot" },
  }];
  const verdict = validateFailureStatus(statuses, "dpf-bot");
  assert.equal(verdict.valid, false);
  assert.notEqual(verdict.unconfigured, true);
});

test("failureReadinessConfigured treats absent, empty and whitespace publishers alike", () => {
  for (const value of [undefined, null, "", "   ", 0]) {
    assert.equal(failureReadinessConfigured(value), false, String(value));
  }
  assert.equal(failureReadinessConfigured("dpf-bot"), true);
});

// BI-8B6A67BD: the gate was unpassable by construction. It read GitHub's
// COMBINED status endpoint (`/commits/{sha}/status`), whose rows omit
// `creator` entirely, so `creator?.login` was undefined for every row and a
// genuine passing status published by the platform was rejected as "not
// issued by the configured platform publisher". Measured on
// 9640f133190bc0ed82893f619695a4efe362632c (2026-09-22): the combined endpoint
// returned exactly the keys below and no creator, while the LIST endpoint
// returned the same status WITH a creator.login. The publisher name here is a
// placeholder; the real one is whatever the install's credential authenticates as.
//
// Every fixture above hand-builds `creator: { login }`, which is why no test
// caught this: the mocked shape never matched what GitHub actually returns.
const COMBINED_ENDPOINT_ROW = Object.freeze({
  avatar_url: "https://avatars.githubusercontent.com/u/0?v=4",
  context: "dpf/failure-readiness",
  created_at: "2026-09-22T00:41:44Z",
  description: "Current failure analysis and executed evidence were independently reviewed.",
  id: 1, node_id: "SC_x", state: "success", target_url: null,
  updated_at: "2026-09-22T00:41:44Z", url: "https://api.github.com/repos/o/r/statuses/x",
});

test("a status with no creator is reported as unidentified, not as the wrong publisher", () => {
  const verdict = validateFailureStatus([COMBINED_ENDPOINT_ROW], "platform-publisher", Date.parse("2026-09-22T00:50:00Z"));
  assert.equal(verdict.valid, false);
  assert.equal(verdict.unidentified, true,
    "a creator-less row means the wrong endpoint was read; it must not read as an impostor");
  assert.match(verdict.reason, /\/statuses/, "the reason must name the endpoint that carries creator");
  assert.notEqual(verdict.unconfigured, true, "the publisher IS configured here");
});

test("the real list-endpoint shape passes once the publisher matches", () => {
  const listRow = { ...COMBINED_ENDPOINT_ROW, creator: { login: "platform-publisher" } };
  assert.equal(validateFailureStatus([listRow], "platform-publisher", Date.parse("2026-09-22T00:50:00Z")).valid, true);
  assert.equal(validateFailureStatus([listRow], "someone-else", Date.parse("2026-09-22T00:50:00Z")).valid, false);
});

test("evidence is read from the creator-bearing LIST endpoint, never the combined one", async () => {
  const requested = [];
  const listRow = { ...COMBINED_ENDPOINT_ROW, creator: { login: "platform-publisher" }, created_at: new Date().toISOString() };
  await checkFailureReadiness({
    event: { pull_request: { head: { sha } } }, repository: "owner/repo", token: "test", publisher: "platform-publisher",
    fetchImpl: async (url) => { requested.push(url); return { ok: true, json: async () => [listRow] }; },
  });
  assert.equal(requested.length, 1);
  assert.match(requested[0], /\/commits\/[0-9a-f]{40}\/statuses\?/, "must call /statuses (list), which returns creator");
  assert.doesNotMatch(requested[0], /\/status\?/, "must not call /status (combined), which omits creator");
});
