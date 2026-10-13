// Self-test for the landing orchestrator and the obligation banner (BI-4CE4F52F).
//
// What matters here is NOT that the happy path works — it is that the two
// mechanisms which replace remembered prose actually carry their payload:
//
//   1. gate:context must surface the GENERATE COMMAND for a stale derived
//      artifact, not just its path. Without the command, a reader still has to
//      know the repo, which is the gap that made the old pointer useless.
//   2. `land` must refuse to invent a PR-body attestation. A tool that silently
//      wrote "Seed-Fit-Decision: global-default" would be worse than the manual
//      process it replaces.
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildGateContext } from "./lib/gate-context.mjs";
import { STEPS, bodyRequiredTrailers, missingBodyAttestations, parseContext, syncAction, parseGateStatus, gateFailureSite, recordedPassAction, publish } from "./land-branch.mjs";
import { parseArgs as gateLocalArgs } from "./gate-local.mjs";
import { obligationLines } from "./pregate-preflight.mjs";

test("a stale derived artifact carries the command that regenerates it", () => {
  // agent_registry.json is a source of the capability-completeness measure.
  const context = buildGateContext({
    changedFiles: ["packages/db/data/agent_registry.json"],
    repoRoot: process.cwd(),
  });
  const entry = (context.derivedArtifacts ?? []).find((d) => d.id === "capability-completeness");
  assert.ok(entry, "expected the capability-completeness group to be affected");
  assert.ok(Array.isArray(entry.generate) && entry.generate.length > 0,
    "generate command must be surfaced, not just the artifact paths");
  assert.match(entry.generate.join(" "), /measure-capability-completeness/);
  // The paths are still there — this adds to the contract, it does not replace it.
  assert.ok(entry.artifacts.some((a) => a.endsWith(".generated.json")));
});

test("the obligation banner names the attestation AND where it goes", () => {
  const context = buildGateContext({
    changedFiles: ["packages/db/data/agent_registry.json"],
    repoRoot: process.cwd(),
  });
  const seedFit = (context.trailers ?? []).find((t) => /Seed-Fit/.test(t.trailer ?? ""));
  assert.ok(seedFit, "a canonical seed change must require Seed-Fit-Decision");
  // The distinction that is easy to get wrong and expensive to miss: this gate
  // reads the push-event body, so the same text in a commit trailer does not
  // satisfy it.
  assert.match(seedFit.note ?? "", /PR BODY/i);
});

test("the banner renders without throwing, and stays silent when there is nothing to say", () => {
  const lines = obligationLines(process.cwd());
  assert.ok(Array.isArray(lines));
  // A refusal banner that throws would mask the guard failure it explains.
  assert.doesNotThrow(() => obligationLines("/nonexistent-path-for-this-test"));
  assert.deepEqual(obligationLines("/nonexistent-path-for-this-test"), []);
});

test("land refuses to invent a PR-body attestation", () => {
  const context = {
    trailers: [
      { trailer: "Seed-Fit-Decision:", level: "required", because: "seed changed",
        note: "this one goes in the PR BODY" },
      { trailer: "Data-Impact:", level: "required", because: "schema changed", note: "" },
    ],
  };
  assert.deepEqual(bodyRequiredTrailers(context).map((t) => t.trailer), ["Seed-Fit-Decision:"]);
  // Absent from the body → named as missing, never synthesised.
  assert.deepEqual(missingBodyAttestations(context, "some body"), ["Seed-Fit-Decision: (seed changed)"]);
  // Present → satisfied. Only PR-BODY ones are policed here; commit trailers are
  // judged by the gates that read the commit.
  assert.deepEqual(missingBodyAttestations(context, "Seed-Fit-Decision: global-default"), []);
});

test("the landing sequence gates BEFORE it pushes or opens anything", () => {
  // Ordering is the safety property: a PR that exists before its gate passed
  // contradicts "PR creation means ready to merge".
  const i = (s) => STEPS.indexOf(s);
  assert.ok(i("local-gates") < i("commit"), "local gates run against the working tree, pre-commit");
  assert.ok(i("gate") < i("push"), "the gate decides before anything leaves the machine");
  assert.ok(i("push") < i("pull-request"), "push precedes the PR");
  assert.ok(i("pull-request") < i("auto-merge"));
  assert.equal(i("preconditions"), 0, "branch and readiness are checked first");
});

test("drift is merged forward before anything is derived from the tree", () => {
  assert.ok(STEPS.indexOf("sync") < STEPS.indexOf("context"),
    "context and regeneration must see the merged tree, or the gate re-runs on a stale one");
  assert.equal(syncAction({ base: "main", behind: 0 }), "current");
  assert.equal(syncAction({ base: "main", behind: 7 }), "merge");
  // Unknowable drift is a refusal, never read as "current".
  assert.equal(syncAction({ base: "main", behind: null }), "unknown");
  assert.equal(syncAction({ base: "main", behind: Number.NaN }), "unknown");
  assert.equal(syncAction({ base: "release", behind: 3 }), "unsupported-base");
});

test("gate:context output below the floor is unreadable, not empty", () => {
  const ok = { changedFileCount: 2, trailers: [], derivedArtifacts: [] };
  assert.deepEqual(parseContext(`> dpf@ gate:context\n${JSON.stringify(ok)}`), ok);
  // Parses, but lacks the fields: a contract change must not read as "no obligations".
  assert.equal(parseContext(JSON.stringify({ changedFileCount: 2 })), null);
  assert.equal(parseContext("ELIFECYCLE  Command failed"), null);
  assert.equal(parseContext("{ not json"), null);
});

test("a `--` forwarded by pnpm does not swallow the flag after it", () => {
  // pnpm 10 passes `pnpm gate:local -- --message-file m` through as
  // ["--", "--message-file", "m"]; util.parseArgs would read that as positionals.
  assert.equal(gateLocalArgs(["--", "--message-file", "m"]).messageFile, "m");
  assert.equal(gateLocalArgs(["--message-file", "m"]).messageFile, "m");
});

test("a refusal before the lease is not reported as a verdict on this SHA", () => {
  // Observed on this branch's first landing: preflight refused, the record was
  // still bound to an older SHA, and the old message sent the reader to it.
  const stale = parseGateStatus(JSON.stringify({ verdict: "STALE", headSha: "b", boundSha: "a" }));
  assert.equal(gateFailureSite(stale, "b"), "preflight");
  const bound = parseGateStatus(JSON.stringify({ verdict: "FAIL", headSha: "b", boundSha: "b" }));
  assert.equal(gateFailureSite(bound, "b"), "verdict");
  assert.equal(gateFailureSite(parseGateStatus("ELIFECYCLE"), "b"), "unknown");
  assert.equal(parseGateStatus(JSON.stringify({ verdict: "PASS" })), null, "below the floor");
});

test("a PASS already recorded for HEAD is landed, not merged forward and re-gated", () => {
  // Observed on PR #6029: gate:wait hit its deadline, the durable resumer later
  // recorded PASS on HEAD, and re-running land would have merged main, minted a
  // new SHA and queued another gate — the merge queue re-tests against main anyway.
  const pass = (boundSha, extra = {}) => parseGateStatus(JSON.stringify(
    { verdict: "PASS", headSha: "head", boundSha, ...extra }));
  const decide = (status, more = {}) =>
    recordedPassAction({ status, headSha: "head", dirty: false, mergeable: "MERGEABLE", ...more }).action;

  // PASS + current: straight to push and PR. No PR yet, or GitHub not done computing, is not a conflict.
  assert.equal(decide(pass("head")), "land-recorded-pass");
  assert.equal(decide(pass("head"), { mergeable: null }), "land-recorded-pass");
  assert.equal(decide(pass("head"), { mergeable: "UNKNOWN" }), "land-recorded-pass");
  // PASS + conflicting: the queue cannot test what does not merge, so merge forward.
  assert.equal(decide(pass("head"), { mergeable: "CONFLICTING" }), "gate");
  // No PASS: the gate has not decided, or decided against.
  assert.equal(decide(parseGateStatus(JSON.stringify({ verdict: "FAIL", headSha: "head", boundSha: "head" }))), "gate");
  assert.equal(decide(parseGateStatus("ELIFECYCLE")), "gate", "unreadable status is never a PASS");
  // A PASS bound to an older SHA says nothing about these bytes.
  assert.equal(decide(pass("older")), "gate");
  assert.equal(decide(pass("")), "gate");
  // Nor does a PASS cover uncommitted changes, or a test stub cover anything.
  assert.equal(decide(pass("head"), { dirty: true }), "gate");
  assert.equal(decide(pass("head", { testStub: true })), "gate");
});

test("publish pushes exactly once, and a refused push is reported, never retried", () => {
  // Plan 2026-10-02 item 9: every `git push` can claim a new gate lease, so a
  // second push "just to read the refusal" can overwrite a recorded PASS.
  const calls = [];
  const exec = (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    return { ok: cmd !== "git", status: cmd === "git" ? 1 : 0, out: "" };
  };
  const refusal = publish({ branch: "b", base: "main", title: "t", body: "", dry: false, log: () => {}, runner: exec });
  assert.equal(refusal?.step, "push");
  assert.deepEqual(calls, ["git push -u origin b"], "one push, and nothing after a refusal");

  calls.length = 0;
  const okExec = (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    return { ok: true, status: 0, out: args.includes(".number") ? "" : "url" };
  };
  assert.equal(publish({ branch: "b", base: "main", title: "t", body: "x", dry: false, log: () => {}, runner: okExec }), null);
  assert.equal(calls.filter((c) => c.startsWith("git push")).length, 1);
});
