import assert from "node:assert/strict";
import test from "node:test";
import { reviewHeads, validateFailureStatus, checkFailureReadiness } from "./check-failure-readiness.mjs";
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
