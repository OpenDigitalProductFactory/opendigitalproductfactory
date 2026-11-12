// scripts/pr-health.test.mjs
// node --test (no vitest). Covers the pure verdict and real CLI observations:
// failing/pending checks, unreadable evidence, complete review-thread history,
// conflict/draft/state handling and bounded waits.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import {
  evaluatePrHealth,
  parsePrHealthArgs,
  PR_HEALTH_EXIT,
  selectLocalCiStateRecord,
  waitForPrHealth,
} from "./pr-health.mjs";

// Run the actual CLI with child-only gh responses. No GitHub request or credential.
function runObservationFixture(fixture, args = []) {
  const dir = mkdtempSync(join(tmpdir(), "dpf-pr-health-observation-"));
  try {
    const preload = join(dir, "observations.mjs");
    writeFileSync(preload, `
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const original = cp.execFileSync;
const fixture = ${JSON.stringify(fixture)};
const meta = { number: 42, title: "Labelled fixture", state: "OPEN", mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN", isDraft: false, baseRefName: "main", headRefName: "fixture/readability",
  headRefOid: "a".repeat(40), body: "", files: [{path:"docs/README.md"}], commits: [],
  author: {login:"fixture"}, ...fixture.meta };
const page = {data:{repository:{pullRequest:{reviewThreads:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}}}};
function response(value) {
  const output = value.raw ?? JSON.stringify(value.data);
  if (value.exit) throw Object.assign(new Error("Labelled unavailable observation"), {status:value.exit,stdout:output});
  return output;
}
cp.execFileSync = function(command, args, options) {
  if (command !== "gh") return Reflect.apply(original, this, [command,args,options]);
  if (args[0] === "pr" && args[1] === "view") return JSON.stringify(meta);
  if (args[0] === "pr" && args[1] === "checks") return response(fixture.checks ?? {data:[]});
  if (args[0] === "repo") return JSON.stringify({owner:{login:"fixture"},name:"repository"});
  if (args[0] === "api") return response(fixture.threads ?? {data:args.includes("--slurp") ? [page] : page});
  if (args[0] === "run") return "[]";
  throw new Error("Unexpected fixture gh operation");
};
syncBuiltinESMExports();
`);
    return spawnSync(process.execPath, ["--import", pathToFileURL(preload).href,
      fileURLToPath(new URL("./pr-health.mjs", import.meta.url)), "42", ...args],
    { cwd: dir, encoding: "utf8", timeout: 10_000 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const threadPage = (nodes = [], hasNextPage = false, endCursor = null) =>
  ({ data: { repository: { pullRequest: { reviewThreads: { nodes, pageInfo: { hasNextPage, endCursor } } } } } });
const observationCases = [
  ["valid empty observations", {}, 0],
  ["failed checks JSON on exit1", {checks:{exit:1,data:[{name:"Failed",bucket:"fail"}]}}, 1],
  ["pending checks JSON on exit8", {checks:{exit:8,data:[{name:"Pending",bucket:"pending"}]}}, 75],
  ["merged PR with valid observations", {meta:{state:"MERGED"}}, 0],
  ["check transport failure", {checks:{exit:1,raw:""}}, 3],
  ["malformed check JSON", {checks:{raw:"{broken"}}, 3],
  ["missing check output", {checks:{raw:""}}, 3],
  ["check object instead of array", {checks:{data:{}}}, 3],
  ["null check row", {checks:{data:[null]}}, 3],
  ["unknown check bucket", {checks:{data:[{name:"Unknown",bucket:"unknown"}]}}, 3],
  ["check missing its name", {checks:{data:[{bucket:"pass"}]}}, 3],
  ["nonzero empty check result", {checks:{exit:1,data:[]}}, 3],
  ["unexpected exit carrying passing JSON", {checks:{exit:2,data:[{name:"Pass",bucket:"pass"}]}}, 3],
  ["thread transport failure", {threads:{exit:1,raw:""}}, 3],
  ["GraphQL errors with partial data", {threads:{data:[{...threadPage(),errors:[{message:"Unavailable"}]}]}}, 3],
  ["malformed thread JSON", {threads:{raw:"{broken"}}, 3],
  ["null pull request", {threads:{data:[{data:{repository:{pullRequest:null}}}]}}, 3],
  ["incomplete thread pagination", {threads:{data:[threadPage([],true,"next")]}}, 3],
  ["missing pagination evidence", {threads:{data:[{data:{repository:{pullRequest:{reviewThreads:{nodes:[]}}}}}]}}, 3],
  ["thread without resolution state", {threads:{data:[threadPage([{}])]}}, 3],
  ["absent thread pages", {threads:{data:[]}}, 3],
  ["null thread page", {threads:{data:[null]}}, 3],
  ["cursor absent before another page", {threads:{data:[threadPage([],true),threadPage()]}}, 3],
  ["repeated pagination cursor", {threads:{data:[threadPage([],true,"next"),threadPage([],true,"next"),threadPage()]}}, 3],
  ["extra page after terminal page", {threads:{data:[threadPage(),threadPage()]}}, 3],
  ["unresolved thread on the second page", {threads:{data:[threadPage([],true,"next"),threadPage([{isResolved:false,path:"fixture.ts",line:1}])]}}, 2],
  ["complete two-page resolved history", {threads:{data:[threadPage([{isResolved:true}],true,"next"),threadPage([{isResolved:true}])]}}, 0],
];
for (const [name, fixture, expected] of observationCases) {
  test(`CLI observation: ${name}`, () => {
    const run = runObservationFixture(fixture);
    assert.equal(run.error, undefined);
    assert.equal(run.status, expected, `${run.stdout}\n${run.stderr}`);
    if (expected === 3) {
      assert.doesNotMatch(run.stdout, /^READY/m);
      assert.match(run.stderr, /^UNREADABLE/m);
    }
  });
}
test("CLI wait stops unreadable observations instead of reporting ready", () => {
  const run = runObservationFixture({checks:{exit:1,raw:""}}, ["--wait","--timeout","0.001","--interval","0.1"]);
  assert.equal(run.status, 3, `${run.stdout}\n${run.stderr}`);
});
test("CLI wait retains pending exit75 at its bounded timeout", () => {
  const run = runObservationFixture({checks:{exit:8,data:[{name:"Pending",bucket:"pending"}]}}, ["--wait","--timeout","0.001","--interval","0.1"]);
  assert.equal(run.status, 75, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /timed out/);
});

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

// ── Local-CI sandbox evidence guard (BI-C74F4DE9 + BI-563F6AB6 P1) ───────────

import {
  evaluatePrHealth as evalPr,
  parseLocalCiAttestation,
  isDocsOnlyFileSet,
  classifyLocalCiOverride,
  LOCAL_CI_OVERRIDE_REASON_CODES,
} from "./pr-health.mjs";

const HEAD = "abc123def456abc123def456abc123def456abc1";

test("parseLocalCiAttestation matches Evidence and Override trailers", () => {
  assert.deepEqual(parseLocalCiAttestation("Body\n\nLocal-CI-Evidence: EXT-42 (feat/x@abc)"), {
    kind: "evidence",
    value: "EXT-42 (feat/x@abc)",
  });
  assert.deepEqual(parseLocalCiAttestation("Local-CI-Override: docs-adjacent: config only"), {
    kind: "override",
    value: "docs-adjacent: config only",
  });
  assert.equal(parseLocalCiAttestation("No trailer here"), null);
  assert.equal(parseLocalCiAttestation(""), null);
  assert.equal(parseLocalCiAttestation(null), null);
});

test("parseLocalCiAttestation prefers durable commit trailers over the PR body", () => {
  assert.deepEqual(
    parseLocalCiAttestation(
      "PR prose with no gate answer",
      ["chore: evidence\n\nLocal-CI-Override: external-contribution-no-install: source-only worktree"],
    ),
    {
      kind: "override",
      value: "external-contribution-no-install: source-only worktree",
    },
  );
});

test("classifyLocalCiOverride accepts closed codes and rejects free text (BI-563F6AB6)", () => {
  assert.deepEqual(classifyLocalCiOverride("operator-emergency"), {
    ok: true,
    code: "operator-emergency",
    detail: "",
  });
  assert.deepEqual(classifyLocalCiOverride("docs-adjacent: prose under apps/"), {
    ok: true,
    code: "docs-adjacent",
    detail: "prose under apps/",
  });
  assert.equal(classifyLocalCiOverride("unit tests only").ok, false);
  assert.match(classifyLocalCiOverride("unit tests only").reason, /not allowlisted|must start with/);
  assert.equal(classifyLocalCiOverride("vitest green, skip sandbox").ok, false);
  assert.equal(classifyLocalCiOverride("").ok, false);
  assert.ok(LOCAL_CI_OVERRIDE_REASON_CODES.includes("operator-emergency"));
});

test("isDocsOnlyFileSet — docs/memory/*.md only counts, empty set does not", () => {
  assert.equal(isDocsOnlyFileSet([{ path: "docs/a.md" }, { path: "AGENTS.md" }, { path: "memory/x.md" }]), true);
  assert.equal(isDocsOnlyFileSet([
    { path: "docs/architecture/a.md" },
    { path: "apps/web/lib/docs/doc-index.generated.json" },
  ]), true);
  assert.equal(isDocsOnlyFileSet([{ path: "apps/web/lib/docs/doc-index.generated.json" }]), false);
  assert.equal(isDocsOnlyFileSet([{ path: "apps/web/lib/docs/doc-link-resolver.mjs" }]), false);
  assert.equal(isDocsOnlyFileSet([{ path: "docs/a.md" }, { path: "apps/web/lib/x.ts" }]), false);
  assert.equal(isDocsOnlyFileSet([]), false);
  assert.equal(isDocsOnlyFileSet(undefined), false);
});

test("localCi: passing gate record for the head SHA is a note, ready", () => {
  const r = evalPr({
    meta: okMeta,
    checks: [pass("Typecheck")],
    threads: [],
    localCi: { headSha: HEAD, docsOnly: false, attestation: null, stateRecord: { branch: "feat/x", sha: HEAD, gatePassed: true } },
  });
  assert.equal(r.ready, true);
  assert.match(r.notes.join("\n"), /local-CI sandbox gate passed/);
});

test("localCi: no evidence and no attestation blocks", () => {
  const r = evalPr({
    meta: okMeta,
    checks: [pass("Typecheck")],
    threads: [],
    localCi: { headSha: HEAD, docsOnly: false, attestation: null, stateRecord: null },
  });
  assert.equal(r.ready, false);
  assert.match(r.blockers.join("\n"), /no local-CI sandbox evidence/);
});

test("localCi: stale gate record (different SHA) without attestation blocks", () => {
  const r = evalPr({
    meta: okMeta,
    checks: [pass("Typecheck")],
    threads: [],
    localCi: { headSha: HEAD, docsOnly: false, attestation: null, stateRecord: { branch: "feat/x", sha: "older000", gatePassed: true } },
  });
  assert.equal(r.ready, false);
  assert.match(r.blockers.join("\n"), /no local-CI sandbox evidence/);
});

test("localCi: recorded push-time override with allowlisted code is ready", () => {
  const r = evalPr({
    meta: okMeta,
    checks: [pass("Typecheck")],
    threads: [],
    localCi: {
      headSha: HEAD,
      docsOnly: false,
      attestation: null,
      stateRecord: {
        branch: "feat/x",
        sha: HEAD,
        gatePassed: false,
        skipped: true,
        skipReason: "operator-emergency: verified-clean revert",
      },
    },
  });
  assert.equal(r.ready, true);
  assert.match(r.notes.join("\n"), /overridden at push time.*operator-emergency/);
});

test("localCi: free-text push-time skipReason is NOT READY (BI-563F6AB6)", () => {
  const r = evalPr({
    meta: okMeta,
    checks: [pass("Typecheck")],
    threads: [],
    localCi: {
      headSha: HEAD,
      docsOnly: false,
      attestation: null,
      stateRecord: {
        branch: "feat/x",
        sha: HEAD,
        gatePassed: false,
        skipped: true,
        skipReason: "unit tests only",
      },
    },
  });
  assert.equal(r.ready, false);
  assert.match(r.blockers.join("\n"), /push-time override rejected|not allowlisted|must start with/);
});

test("localCi: allowlisted PR-body override is ready", () => {
  const r = evalPr({
    meta: okMeta,
    checks: [pass("Typecheck")],
    threads: [],
    localCi: {
      headSha: HEAD,
      docsOnly: false,
      attestation: { kind: "override", value: "operator-emergency: hotfix, human go" },
      stateRecord: null,
    },
  });
  assert.equal(r.ready, true);
  assert.match(r.notes.join("\n"), /override attestation.*operator-emergency/);
});

test("localCi: free-text PR-body override is NOT READY (BI-563F6AB6)", () => {
  const r = evalPr({
    meta: okMeta,
    checks: [pass("Typecheck")],
    threads: [],
    localCi: {
      headSha: HEAD,
      docsOnly: false,
      attestation: { kind: "override", value: "unit tests only" },
      stateRecord: null,
    },
  });
  assert.equal(r.ready, false);
  assert.match(r.blockers.join("\n"), /PR-body override rejected|not allowlisted|must start with/);
});

test("localCi: Evidence trailer still ready without closed code", () => {
  const r = evalPr({
    meta: okMeta,
    checks: [pass("Typecheck")],
    threads: [],
    localCi: {
      headSha: HEAD,
      docsOnly: false,
      attestation: { kind: "evidence", value: "EXT-42 (feat/x@abc)" },
      stateRecord: null,
    },
  });
  assert.equal(r.ready, true);
  assert.match(r.notes.join("\n"), /evidence attestation/);
});

test("localCi: docs-only PR needs no gate, ready", () => {
  const r = evalPr({
    meta: okMeta,
    checks: [pass("Typecheck")],
    threads: [],
    localCi: { headSha: HEAD, docsOnly: true, attestation: null, stateRecord: null },
  });
  assert.equal(r.ready, true);
  assert.match(r.notes.join("\n"), /docs-only/);
});

test("localCi omitted (null) leaves legacy behavior untouched", () => {
  const r = evalPr({ meta: okMeta, checks: [pass("Typecheck")], threads: [], localCi: null });
  assert.equal(r.ready, true);
});

// AGENTS.md §3 — PRs land against main. ci.yml is `pull_request: branches: [main]`,
// so a feature-branch base silently skips the whole heavy suite while still
// reporting CLEAN. #4483 sat like that with 4 checks instead of ~34.
test("blocks a PR whose base is not main, even when every check it ran passed", () => {
  const r = evaluatePrHealth({
    meta: { ...okMeta, baseRefName: "feat/some-other-branch" },
    checks: [pass("DCO"), pass("classify"), pass("acceptance")],
    threads: [],
  });
  assert.equal(r.ready, false);
  const text = r.blockers.join(" | ");
  assert.match(text, /base is feat\/some-other-branch, not main/);
  assert.match(text, /Green here does NOT mean verified/);
});

test("a main-based PR is not blocked by the base check", () => {
  const r = evaluatePrHealth({
    meta: { ...okMeta, baseRefName: "main" },
    checks: [pass("Typecheck"), pass("Production Build")],
    threads: [],
  });
  assert.equal(r.ready, true);
  assert.deepEqual(r.blockers, []);
});

test("absent baseRefName does not invent a blocker", () => {
  // Older callers and fixtures omit the field; missing evidence is not a failure.
  const r = evaluatePrHealth({ meta: okMeta, checks: [pass("Typecheck")], threads: [] });
  assert.equal(r.ready, true);
});

// BI-5529B5AC: pr:health used to read ONE hard-coded state file (slot-0). Gate
// state is written per slot, so it now chooses across every slot record for
// the worktree: a PASS bound to HEAD on any slot wins; failing that, a recorded
// override for HEAD; failing that, whatever slot-0 says (legacy behaviour).
const HEAD_SHA = "abc123def456abc123def456abc123def456abc1";
const future = new Date(Date.now() + 3600_000).toISOString();

test("selectLocalCiStateRecord: a slot-1 PASS for HEAD beats a stale slot-0 override", () => {
  const picked = selectLocalCiStateRecord({
    headSha: HEAD_SHA,
    records: [
      { slotKey: "slot-0", state: { branch: "feat/x", sha: HEAD_SHA, gatePassed: false, skipped: true, skipReason: "operator-emergency: hook could not see slot-1" } },
      { slotKey: "slot-1", state: { branch: "feat/x", sha: HEAD_SHA, gatePassed: true, status: "passed", expiresAt: future } },
    ],
  });
  assert.equal(picked.slotKey, "slot-1");
  assert.equal(picked.state.gatePassed, true);
});

test("selectLocalCiStateRecord: an expired PASS does not win; the recorded override for HEAD is next", () => {
  const picked = selectLocalCiStateRecord({
    headSha: HEAD_SHA,
    records: [
      { slotKey: "slot-0", state: { branch: "feat/x", sha: HEAD_SHA, gatePassed: false, skipped: true, skipReason: "docs-adjacent: only" } },
      { slotKey: "slot-1", state: { branch: "feat/x", sha: HEAD_SHA, gatePassed: true, status: "passed", expiresAt: "2020-01-01T00:00:00.000Z" } },
    ],
  });
  assert.equal(picked.slotKey, "slot-0");
  assert.equal(picked.state.skipped, true);
});

test("selectLocalCiStateRecord: with nothing bound to HEAD, slot-0 is reported as before", () => {
  const picked = selectLocalCiStateRecord({
    headSha: HEAD_SHA,
    records: [
      { slotKey: "slot-0", state: { branch: "feat/x", sha: "older000", gatePassed: true } },
      { slotKey: "slot-1", state: { branch: "feat/x", sha: "older111", gatePassed: false } },
    ],
  });
  assert.equal(picked.slotKey, "slot-0");
  assert.equal(selectLocalCiStateRecord({ headSha: HEAD_SHA, records: [] }), null);
});

test("evaluatePrHealth: a slot-1 PASS for head is a note and READY (end to end through selection)", () => {
  const stateRecord = selectLocalCiStateRecord({
    headSha: HEAD_SHA,
    records: [
      { slotKey: "slot-0", state: { branch: "feat/x", sha: HEAD_SHA, gatePassed: false, status: "queued" } },
      { slotKey: "slot-1", state: { branch: "feat/x", sha: HEAD_SHA, gatePassed: true, status: "passed", expiresAt: future } },
    ],
  }).state;
  const r = evaluatePrHealth({
    meta: okMeta,
    checks: [pass("Typecheck")],
    threads: [],
    localCi: { headSha: HEAD_SHA, docsOnly: false, attestation: null, stateRecord },
  });
  assert.equal(r.ready, true);
  assert.match(r.notes.join("\n"), /local-CI sandbox gate passed/);
});

// BI-02E5F2A1: gate-infrastructure-unavailable is evidence-gated and reads as gate-UNRUN.
const INFRA_EVIDENCE = {
  code: "gate-infrastructure-unavailable",
  tool: "claim_nonprod_environment_lease",
  kind: "credential-rejected",
  message: "unauthorized: invalid or expired token",
  statusCode: 401,
  probedAt: "2026-09-18T00:00:00.000Z",
  durationMs: 12,
};

test("localCi: gate-infrastructure-unavailable WITH captured evidence is ready but reported gate-UNRUN, never passed", () => {
  const r = evalPr({
    meta: okMeta,
    checks: [pass("Typecheck")],
    threads: [],
    localCi: {
      headSha: HEAD,
      docsOnly: false,
      attestation: null,
      stateRecord: {
        branch: "feat/x", sha: HEAD, gatePassed: false, skipped: true, gateUnrun: true, status: "gate-unrun",
        skipReason: "gate-infrastructure-unavailable: contributor token dead",
        infrastructureEvidence: INFRA_EVIDENCE,
      },
    },
  });
  assert.equal(r.ready, true);
  const notes = r.notes.join("\n");
  assert.match(notes, /gate UNRUN/);
  assert.match(notes, /credential-rejected: unauthorized: invalid or expired token/);
  assert.match(notes, /NOT a pass/);
  assert.doesNotMatch(notes, /gate passed/);
});

test("localCi: gate-infrastructure-unavailable WITHOUT captured evidence is a blocker (prose is not evidence)", () => {
  const r = evalPr({
    meta: okMeta,
    checks: [pass("Typecheck")],
    threads: [],
    localCi: {
      headSha: HEAD,
      docsOnly: false,
      attestation: null,
      stateRecord: {
        branch: "feat/x", sha: HEAD, gatePassed: false, skipped: true,
        skipReason: "gate-infrastructure-unavailable: I promise the portal was down",
      },
    },
  });
  assert.equal(r.ready, false);
  assert.match(r.blockers.join("\n"), /requires machine-captured evidence/);
});

test("localCi: gate-infrastructure-unavailable as a PR-body trailer is a blocker", () => {
  const r = evalPr({
    meta: okMeta,
    checks: [pass("Typecheck")],
    threads: [],
    localCi: {
      headSha: HEAD, docsOnly: false, stateRecord: null,
      attestation: { kind: "override", value: "gate-infrastructure-unavailable: portal down" },
    },
  });
  assert.equal(r.ready, false);
  assert.match(r.blockers.join("\n"), /a trailer is prose, not evidence/);
});

// BI-53B189C8. A DPF_ALLOW_LOCAL_CI_STUB run records gatePassed:true without
// building anything. It is marked testStub, and it must never clear the
// local-CI requirement for a PR.
test("selectLocalCiStateRecord: a test-stub PASS for HEAD is not the live pass", () => {
  const picked = selectLocalCiStateRecord({
    headSha: HEAD_SHA,
    records: [
      { slotKey: "slot-0", state: { branch: "fix/admitted-owner-recovery", sha: HEAD_SHA, gatePassed: true, status: "passed", testStub: true, expiresAt: future } },
      { slotKey: "slot-1", state: { branch: "feat/x", sha: HEAD_SHA, gatePassed: false, skipped: true, skipReason: "docs-adjacent: only" } },
    ],
  });
  assert.equal(picked.slotKey, "slot-1");
});

test("localCi: a test-stub record for the head SHA is a blocker, not a pass", () => {
  const r = evaluatePrHealth({
    meta: okMeta,
    checks: [pass("Typecheck")],
    threads: [],
    localCi: {
      headSha: HEAD_SHA,
      docsOnly: false,
      attestation: null,
      stateRecord: { branch: "fix/admitted-owner-recovery", sha: HEAD_SHA, gatePassed: true, status: "passed", testStub: true },
    },
  });
  assert.equal(r.ready, false);
  assert.doesNotMatch(r.notes.join("\n"), /local-CI sandbox gate passed/);
  assert.match(r.blockers.join("\n"), /DPF_ALLOW_LOCAL_CI_STUB/);
});

// ── BI-F197C997: the exit code alone tells waiting from failed from blocked ──

test("verdict: pending checks with mergeStateStatus BLOCKED is WAITING (75), not a failure", () => {
  const r = evaluatePrHealth({
    meta: { ...okMeta, mergeStateStatus: "BLOCKED" },
    checks: [pass("Typecheck"), { name: "Unit Tests", bucket: "pending" }],
    threads: [],
  });
  assert.equal(r.verdict, "WAITING");
  assert.equal(r.exitCode, 75);
  assert.equal(r.ready, false);
  assert.deepEqual(r.waitingOn, ["Unit Tests"]);
});

test("verdict: a failed check is FAILED (1) and names the check, even while others are pending", () => {
  const r = evaluatePrHealth({
    meta: okMeta,
    checks: [{ name: "Module Size Guard", bucket: "fail" }, { name: "Unit Tests", bucket: "pending" }],
    threads: [],
  });
  assert.equal(r.verdict, "FAILED");
  assert.equal(r.exitCode, 1);
  assert.deepEqual(r.failingChecks, ["Module Size Guard"]);
});

test("verdict: an unresolved thread is BLOCKED-ACTION (2) and names who must act", () => {
  const r = evaluatePrHealth({
    meta: { ...okMeta, author: { login: "codex-bot" } },
    checks: [pass("Typecheck"), { name: "Unit Tests", bucket: "pending" }],
    threads: [{ isResolved: false, path: "a.ts", line: 3 }],
  });
  assert.equal(r.verdict, "BLOCKED-ACTION");
  assert.equal(r.exitCode, 2);
  assert.match(r.actions[0].actor, /PR author \(@codex-bot\)/);
});

test("verdict: CONFLICTING and draft are BLOCKED-ACTION for the author", () => {
  assert.equal(evaluatePrHealth({ meta: { ...okMeta, mergeable: "CONFLICTING" }, checks: [], threads: [] }).verdict, "BLOCKED-ACTION");
  assert.equal(evaluatePrHealth({ meta: { ...okMeta, isDraft: true }, checks: [], threads: [] }).exitCode, 2);
});

test("verdict: MERGED exits 0 as MERGED; READY exits 0 as READY", () => {
  const merged = evaluatePrHealth({ meta: { ...okMeta, state: "MERGED" }, checks: [], threads: [] });
  assert.equal(merged.verdict, "MERGED");
  assert.equal(merged.exitCode, 0);
  const ready = evaluatePrHealth({ meta: okMeta, checks: [pass("Typecheck")], threads: [] });
  assert.equal(ready.verdict, "READY");
  assert.equal(ready.exitCode, 0);
});

test("verdict: a closed, unmerged PR needs its owner to act", () => {
  const r = evaluatePrHealth({ meta: { ...okMeta, state: "CLOSED" }, checks: [], threads: [] });
  assert.equal(r.verdict, "BLOCKED-ACTION");
  assert.match(r.actions[0].actor, /owner/i);
});

test("WAITING carries an ETA when the pending check's workflow has a typical duration", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  const r = evaluatePrHealth({
    meta: okMeta,
    checks: [{ name: "Unit Tests", bucket: "pending", workflow: "CI", startedAt: "2026-10-28T11:50:00Z" }],
    threads: [],
    typicalDurationsMs: { CI: 25 * 60_000 },
    now,
  });
  assert.equal(r.verdict, "WAITING");
  assert.equal(r.etaMs, 15 * 60_000);
  const unknown = evaluatePrHealth({ meta: okMeta, checks: [{ name: "Unit Tests", bucket: "pending" }], threads: [], now });
  assert.equal(unknown.etaMs, null);
});

test("--wait polls until the verdict is terminal and returns it", async () => {
  const verdicts = ["WAITING", "WAITING", "READY"];
  let reads = 0;
  const slept = [];
  const r = await waitForPrHealth({
    read: async () => ({ verdict: verdicts[reads++], exitCode: verdicts[reads - 1] === "READY" ? 0 : 75 }),
    sleep: async (ms) => { slept.push(ms); },
    now: () => 0,
    timeoutMs: 60_000,
    intervalMs: 1_000,
  });
  assert.equal(r.verdict, "READY");
  assert.equal(r.exitCode, 0);
  assert.equal(reads, 3);
  assert.deepEqual(slept, [1_000, 1_000]);
});

test("--wait stops at a FAILED or BLOCKED-ACTION verdict immediately", async () => {
  let reads = 0;
  const r = await waitForPrHealth({
    read: async () => { reads++; return { verdict: "FAILED", exitCode: 1 }; },
    sleep: async () => assert.fail("must not sleep on a terminal verdict"),
    now: () => 0,
    timeoutMs: 60_000,
    intervalMs: 1_000,
  });
  assert.equal(r.exitCode, 1);
  assert.equal(reads, 1);
});

test("--wait --timeout returns WAITING (75) with timedOut when checks never finish", async () => {
  let clock = 0;
  const r = await waitForPrHealth({
    read: async () => ({ verdict: "WAITING", exitCode: 75 }),
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
    timeoutMs: 5_000,
    intervalMs: 2_000,
  });
  assert.equal(r.verdict, "WAITING");
  assert.equal(r.exitCode, 75);
  assert.equal(r.timedOut, true);
});

test("argument parsing: PR number, --wait, --timeout minutes, and pnpm's literal --", () => {
  assert.deepEqual(parsePrHealthArgs(["6718"]), { pr: "6718", wait: false, timeoutMinutes: 30, intervalSeconds: 30 });
  assert.deepEqual(parsePrHealthArgs(["--", "6718", "--wait", "--timeout", "10"]),
    { pr: "6718", wait: true, timeoutMinutes: 10, intervalSeconds: 30 });
  assert.deepEqual(parsePrHealthArgs([]), { pr: "", wait: false, timeoutMinutes: 30, intervalSeconds: 30 });
  assert.throws(() => parsePrHealthArgs(["--timeout", "soon"]), /--timeout/);
});

test("exit-code table is the documented contract", () => {
  assert.deepEqual({ ...PR_HEALTH_EXIT }, { READY: 0, MERGED: 0, FAILED: 1, "BLOCKED-ACTION": 2, UNREADABLE: 3, WAITING: 75 });
});
