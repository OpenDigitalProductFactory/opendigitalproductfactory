// scripts/pr-health.test.mjs
// node --test (no vitest). Covers the pure evaluatePrHealth() verdict — the three
// blocker classes that were missed in practice (non-required failing guards,
// mid-CI pending, unresolved review threads) plus conflict/draft/state handling.

import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluatePrHealth, selectLocalCiStateRecord } from "./pr-health.mjs";

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
