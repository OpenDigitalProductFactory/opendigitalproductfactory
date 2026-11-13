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

const deniedRead = (response, token = "diagnostic-token") => checkFailureReadiness({
  event: { pull_request: { head: { sha } } }, repository: "owner/repo", token, publisher: "platform-publisher",
  fetchImpl: async () => response,
});

test("HTTP refusal preserves permission message and request ID without inferring approval", async () => {
  let calls = 0;
  await assert.rejects(checkFailureReadiness({
    event: { pull_request: { head: { sha } } }, repository: "owner/repo", token: "diagnostic-token", publisher: "platform-publisher",
    fetchImpl: async () => { calls++; return new Response(JSON.stringify({ message: "Resource not accessible by integration" }), {
      status: 403, headers: { "x-github-request-id": "request-403" },
    }); },
  }), error => {
    assert.match(error.message, /failed \(403\); no approval inferred/);
    assert.match(error.message, /Resource not accessible by integration/);
    assert.match(error.message, /x-github-request-id=request-403/);
    return true;
  });
  assert.equal(calls, 1, "diagnostics must not retry or make another request");
});

test("HTTP rate refusal preserves the observed rate and retry metadata", async () => {
  await assert.rejects(deniedRead(new Response(JSON.stringify({ message: "API rate limit exceeded for installation" }), {
    status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1794440000", "retry-after": "60" },
  })), error => {
    assert.match(error.message, /API rate limit exceeded for installation/);
    for (const value of ["x-ratelimit-remaining=0", "x-ratelimit-reset=1794440000", "retry-after=60"]) assert.ok(error.message.includes(value));
    return true;
  });
});

test("HTTP diagnostics redact credentials before clipping, sanitize lines and ignore extra fields", async () => {
  const token = "fixture-secret-token";
  const message = `${"x".repeat(490)}${token} Bearer other-credential token=labelled-secret\nforged-line`;
  await assert.rejects(deniedRead(new Response(JSON.stringify({ message, private: "ignored-body-secret" }), {
    status: 403, headers: { "x-github-request-id": `${token}\trequest`, "set-cookie": "ignored-cookie-secret" },
  }), token), error => {
    for (const secret of [token, "fixture-se", "other-credential", "labelled-secret", "ignored-body-secret", "ignored-cookie-secret"]) {
      assert.ok(!error.message.includes(secret), secret);
    }
    assert.doesNotMatch(error.message, /[\r\n\t\u2028\u2029]/);
    assert.ok(error.message.length < 1100, "output must remain bounded");
    return true;
  });
});

test("short HTTP diagnostics redact recognized credentials in both message and allowed metadata", async () => {
  await assert.rejects(deniedRead(new Response(JSON.stringify({ message: "Bearer other-credential token=labelled-secret\nnext" }), {
    status: 403, headers: { "retry-after": "Basic c2VjcmV0" },
  })), error => {
    assert.doesNotMatch(error.message, /other-credential|labelled-secret|c2VjcmV0|[\r\n]/);
    assert.match(error.message, /REDACTED/);
    return true;
  });
});

test("missing, malformed, oversized and unreadable HTTP bodies still fail closed", async () => {
  const unreadable = new ReadableStream({ start(controller) { controller.error(new Error("private-read-error")); } });
  for (const response of [{ ok: false, status: 503 }, new Response("not-json", { status: 403 }),
    new Response(JSON.stringify({ message: "x".repeat(9000) }), { status: 403 }), new Response(unreadable, { status: 403 })]) {
    await assert.rejects(deniedRead(response), error => {
      assert.match(error.message, /no approval inferred/);
      assert.doesNotMatch(error.message, /private-read-error|not-json|x{500}/);
      return true;
    });
  }
});

test("a stalled HTTP diagnostic body is cancelled within a bounded wait", { timeout: 2500 }, async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 403 });
  await assert.rejects(deniedRead(response), /failed \(403\); no approval inferred/);
  assert.equal(cancelled, true);
});

test("oversized streamed diagnostics cancel capture and retain safe headers", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(`{"message":"${"private".repeat(1500)}`)); },
    cancel() { cancelled = true; },
  }), { status: 403, headers: { "x-github-request-id": "oversized-request" } });
  await assert.rejects(deniedRead(response), error => {
    assert.match(error.message, /x-github-request-id=oversized-request/);
    assert.doesNotMatch(error.message, /private/);
    return true;
  });
  assert.equal(cancelled, true);
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
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

test("the actual workflow cannot turn missing publisher configuration into success", () => {
  const source = readFileSync(new URL("../.github/workflows/failure-readiness.yml", import.meta.url), "utf8");
  const step = source.replace(/\r\n/g, "\n").split("- name: Verify platform failure evidence for every source change")[1];
  const block = step?.split("        run: |\n")[1]?.split(/\n      - /)[0];
  assert.ok(block, "workflow must have an executable verification step");
  const command = block.split("\n").map(line => line.replace(/^          /, "")).join("\n");
  const result = spawnSync(process.env.DPF_TEST_BASH ?? "bash", ["-e", "-c", command], {
    cwd: new URL("..", import.meta.url), encoding: "utf8",
    env: { ...process.env, DPF_REVIEW_STATUS_PUBLISHER: "", GH_TOKEN: "" },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 2, `unconfigured must remain inconclusive/nonzero: ${result.stdout} ${result.stderr}`);
});
