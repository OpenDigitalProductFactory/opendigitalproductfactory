#!/usr/bin/env node
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
// Registry decisions use injected fakes. Candidate-scope regressions also use
// isolated Git repositories and local checker commands, never runtime services.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  planRegenerate,
  evaluatePushExemption,
  evaluateCheckAll,
  isMergeQueueContext,
  resolveDerivedArtifactInvocation,
  classifyDerivedArtifactCheck,
  decideSandboxAdmission,
  sandboxDecisionForHead,
} from "./derived-artifacts-gate.mjs";

const DOC_INDEX = {
  id: "doc-index",
  sourceGlobs: ["docs/**/*.md"],
  artifactPaths: ["apps/web/lib/docs/doc-index.generated.json"],
  generate: ["node", "scripts/gen-doc-index.mjs"],
  check: ["node", "scripts/gen-doc-index.mjs", "--check"],
};

const DIAGRAMS = {
  id: "doc-diagrams",
  sourceGlobs: ["docs/user-guide/**/*.md"],
  artifactPaths: ["docs/user-guide/assets/diagrams/**"],
  generate: ["node", "scripts/render-doc-diagrams.mjs"],
  check: ["node", "scripts/render-doc-diagrams.mjs", "--check"],
  requiresBinary: "mmdc",
};

const COUNTS = {
  id: "architecture-counts",
  sourceGlobs: ["packages/db/prisma/migrations/**"],
  artifactPaths: ["docs/architecture/architecture-counts.generated.md"],
  generate: ["node", "scripts/gen-architecture-counts.mjs"],
  check: ["node", "scripts/gen-architecture-counts.mjs", "--check"],
  mergeQueueRaceTolerant: true,
};

const SBOM = {
  id: "sbom-baseline",
  sourceGlobs: ["pnpm-lock.yaml"],
  artifactPaths: ["sbom/baseline.json"],
  generate: ["node", "scripts/sbom/check-sbom-drift.mjs", "--update-baseline"],
  check: ["node", "scripts/sbom/check-sbom-drift.mjs"],
  autoStage: false,
};

test("derived-artifact commands keep pnpm arguments outside a shell on Windows", t => {
  const root = mkdtempSync(join(tmpdir(), "dpf-derived-pnpm-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "pnpm.cmd"), "");
  const script = join(root, "pnpm.cjs");
  writeFileSync(script, "");
  assert.deepEqual(
    resolveDerivedArtifactInvocation(["pnpm", "--filter", "web", "run", "check:route-manifest"], {
      platform: "win32",
      env: { PATH: root },
    }),
    {
      command: process.execPath,
      args: [script, "--filter", "web", "run", "check:route-manifest"],
    },
  );
});

// ── planRegenerate ───────────────────────────────────────────────────────────

test("planRegenerate is empty when nothing staged touches a registered source", () => {
  const plan = planRegenerate(["src/unrelated.ts"], [DOC_INDEX]);
  assert.deepEqual(plan, []);
});

test("planRegenerate regenerates when a source is staged and no special-casing applies", () => {
  const plan = planRegenerate(["docs/foo.md"], [DOC_INDEX]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].entry.id, "doc-index");
  assert.equal(plan[0].action, "regenerate");
});

test("planRegenerate skips (without failing) when requiresBinary is unavailable", () => {
  const plan = planRegenerate(["docs/user-guide/foo.md"], [DIAGRAMS], () => false);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].action, "skip-missing-binary");
});

test("planRegenerate regenerates when requiresBinary IS available", () => {
  const plan = planRegenerate(["docs/user-guide/foo.md"], [DIAGRAMS], () => true);
  assert.equal(plan[0].action, "regenerate");
});

test("planRegenerate marks autoStage:false entries as advisory, never auto-regenerated", () => {
  const plan = planRegenerate(["pnpm-lock.yaml"], [SBOM]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].action, "advisory");
});

test("planRegenerate handles multiple affected entries independently", () => {
  const plan = planRegenerate(["docs/foo.md", "pnpm-lock.yaml"], [DOC_INDEX, SBOM]);
  const byId = Object.fromEntries(plan.map((p) => [p.entry.id, p.action]));
  assert.equal(byId["doc-index"], "regenerate");
  assert.equal(byId["sbom-baseline"], "advisory");
});

// ── evaluatePushExemption ───────────────────────────────────────────────────

test("evaluatePushExemption: non-docs runtime change is never exempt", () => {
  const result = evaluatePushExemption(["apps/web/app/page.tsx"], [DOC_INDEX], () => true);
  assert.equal(result.exempt, false);
  assert.equal(result.reason, "non-docs runtime changes present");
});

test("evaluatePushExemption: docs-only diff touching no registered artifact is exempt", () => {
  const result = evaluatePushExemption(["README.md"], [DOC_INDEX], () => true);
  assert.equal(result.exempt, true);
});

test("evaluatePushExemption: docs diff touching a registered artifact is exempt IFF the check passes", () => {
  const fresh = evaluatePushExemption(["docs/foo.md"], [DOC_INDEX], () => true);
  assert.equal(fresh.exempt, true);

  const stale = evaluatePushExemption(["docs/foo.md"], [DOC_INDEX], () => false);
  assert.equal(stale.exempt, false);
  assert.deepEqual(stale.staleArtifacts, ["doc-index"]);
});

test("evaluatePushExemption: this is the exact #3284 regression scenario, now caught", () => {
  // #3284 added a docs page without regenerating doc-index.generated.json.
  // Under the OLD path-regex rule this was unconditionally exempt (docs-only
  // diff). The registry-driven rule requires the artifact's check to pass.
  const result = evaluatePushExemption(
    ["docs/marketing/dpf-market-vision.md"],
    [DOC_INDEX],
    () => false, // doc-index.generated.json was NOT regenerated — check fails
  );
  assert.equal(result.exempt, false);
});

test("evaluatePushExemption: a non-docs file change still gates even if a doc artifact is also touched", () => {
  const result = evaluatePushExemption(["docs/foo.md", "packages/db/schema.prisma"], [DOC_INDEX], () => true);
  assert.equal(result.exempt, false);
  assert.equal(result.reason, "non-docs runtime changes present");
});

// BI-AC48D79F: pre-commit auto-stages registered artifact JSON next to the
// docs source. Those outputs used to trip "non-docs runtime changes present"
// and made the freshness branch unreachable.
test("evaluatePushExemption: a docs diff plus its fresh registered artifact is exempt (BI-AC48D79F)", () => {
  const result = evaluatePushExemption(
    ["docs/foo.md", "apps/web/lib/docs/doc-index.generated.json"],
    [DOC_INDEX],
    () => true,
  );
  assert.equal(result.exempt, true);
  assert.match(result.reason, /fresh|docs diff/i);
});

test("evaluatePushExemption: a docs diff plus a STALE registered artifact is not exempt (BI-AC48D79F)", () => {
  const result = evaluatePushExemption(
    ["docs/foo.md", "apps/web/lib/docs/doc-index.generated.json"],
    [DOC_INDEX],
    () => false,
  );
  assert.equal(result.exempt, false);
  assert.deepEqual(result.staleArtifacts, ["doc-index"]);
});

test("evaluatePushExemption: a checker that could not run is not a staleness verdict (BI-BD7E0319)", () => {
  const result = evaluatePushExemption(["docs/foo.md"], [DOC_INDEX], () => "unrun");
  assert.equal(result.exempt, true);
  assert.equal(result.staleArtifacts, undefined);
  assert.deepEqual(result.unrunArtifacts, ["doc-index"]);
});

test("classifyDerivedArtifactCheck separates a spawn failure and a missing toolchain from a real stale check (BI-20B40955, BI-BD7E0319)", () => {
  assert.equal(classifyDerivedArtifactCheck(null), "fresh");
  assert.equal(classifyDerivedArtifactCheck({ code: "ENOENT", message: "spawn tsx ENOENT" }), "unrun");
  assert.equal(
    classifyDerivedArtifactCheck({ status: 127, stderr: "sh: tsx: command not found" }),
    "unrun",
  );
  assert.equal(
    classifyDerivedArtifactCheck({ status: 1, stderr: "doc-index.generated.json is stale" }),
    "stale",
  );
});

test("decideSandboxAdmission names the code files that cost a docs-only exemption (BI-A254A94C)", () => {
  const exempt = decideSandboxAdmission({ exempt: true, reason: "docs-only diff, no registered artifact touched" });
  assert.equal(exempt.claim, false);
  assert.match(exempt.message, /sandbox not claimed/);

  const mixed = decideSandboxAdmission({
    exempt: false,
    reason: "non-docs runtime changes present",
    files: ["apps/web/app/page.tsx"],
  });
  assert.equal(mixed.claim, true);
  assert.match(mixed.message, /apps\/web\/app\/page\.tsx/);
});

function candidateRepository(t, file) {
  const dir = mkdtempSync(join(tmpdir(), "dpf-candidate-scope-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  git("init", "-q");
  git("config", "user.name", "DPF Test");
  git("config", "user.email", "dpf-test@example.invalid");
  writeFileSync(join(dir, "README.md"), "base\n");
  git("add", "."); git("commit", "-qm", "base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  writeFileSync(join(dir, file), "candidate\n");
  git("add", "."); git("commit", "-qm", "candidate");
  return dir;
}

test("sandbox admission reads the requested code candidate, not the module checkout", t => {
  const cwd = candidateRepository(t, "runtime.mjs");
  const result = sandboxDecisionForHead({ cwd, registry: [] });
  assert.equal(result?.claim, true);
  assert.match(result.message, /runtime\.mjs/);
});

test("sandbox admission preserves the requested docs candidate exemption", t => {
  const cwd = candidateRepository(t, "README.md");
  assert.equal(sandboxDecisionForHead({ cwd, registry: [] })?.claim, false);
});

test("sandbox admission does not classify an unavailable candidate as exempt", t => {
  const cwd = mkdtempSync(join(tmpdir(), "dpf-no-candidate-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  assert.equal(sandboxDecisionForHead({ cwd, registry: [] }), null);
});

test("sandbox admission runs derived artifact checks in the requested candidate", t => {
  const cwd = candidateRepository(t, "README.md");
  const registry = [{ ...DOC_INDEX, sourceGlobs: ["README.md"],
    check: [process.execPath, "-e", "process.exit(require('node:fs').readFileSync('README.md','utf8') === 'candidate\\n' ? 0 : 1)"] }];
  assert.equal(sandboxDecisionForHead({ cwd, registry })?.claim, false);
  registry[0].check = [process.execPath, "-e", "process.exit(1)"];
  assert.equal(sandboxDecisionForHead({ cwd, registry })?.claim, true);
});

// ── evaluateCheckAll ─────────────────────────────────────────────────────────

test("evaluateCheckAll reports every entry's check result", () => {
  const results = evaluateCheckAll([DOC_INDEX, SBOM], (entry) => entry.id === "doc-index");
  assert.deepEqual(
    results.map((r) => [r.entry.id, r.ok]),
    [
      ["doc-index", true],
      ["sbom-baseline", false],
    ],
  );
});

// ── merge-queue race tolerance ───────────────────────────────────────────────
//
// PR #5175 was ejected from the merge queue six times over twelve hours with
// zero code failures: it added a migration, so did main, and the generated
// migration COUNT in the merged tree matched neither. The author cannot fix
// that from the queue. Tolerance is narrow on purpose: the flagged entry only,
// the queue only, and never a substitute for the PR-head check.

test("a race-tolerant entry that is stale in the MERGE QUEUE is tolerated, not failed", () => {
  const results = evaluateCheckAll([COUNTS], () => false, { mergeQueue: true });
  assert.deepEqual(results.map((r) => [r.entry.id, r.ok, r.tolerated]), [
    ["architecture-counts", false, true],
  ]);
});

test("the same stale entry on a PR head (not the queue) still FAILS — author error stays caught", () => {
  const results = evaluateCheckAll([COUNTS], () => false, { mergeQueue: false });
  assert.deepEqual(results.map((r) => [r.entry.id, r.ok, r.tolerated]), [
    ["architecture-counts", false, false],
  ]);
});

test("an entry WITHOUT the flag is never tolerated, even in the merge queue", () => {
  const results = evaluateCheckAll([DOC_INDEX, COUNTS], () => false, { mergeQueue: true });
  assert.deepEqual(results.map((r) => [r.entry.id, r.tolerated]), [
    ["doc-index", false],
    ["architecture-counts", true],
  ]);
});

test("a fresh race-tolerant entry is simply fresh — tolerance never fires on ok", () => {
  const [result] = evaluateCheckAll([COUNTS], () => true, { mergeQueue: true });
  assert.equal(result.ok, true);
  assert.equal(result.tolerated, false);
});

test("evaluateCheckAll default (no options) is the strict pre-existing behaviour", () => {
  const [result] = evaluateCheckAll([COUNTS], () => false);
  assert.equal(result.ok, false);
  assert.equal(result.tolerated, false);
});

test("isMergeQueueContext recognises the merge_group event and the readonly-queue ref, nothing else", () => {
  assert.equal(isMergeQueueContext({ GITHUB_EVENT_NAME: "merge_group" }), true);
  assert.equal(
    isMergeQueueContext({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/gh-readonly-queue/main/pr-5175-9afc62cf" }),
    true,
  );
  assert.equal(isMergeQueueContext({ GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/pull/5175/merge" }), false);
  assert.equal(isMergeQueueContext({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" }), false);
  assert.equal(isMergeQueueContext({}), false);
});
