#!/usr/bin/env node
import { cpSync, mkdtempSync, mkdirSync, realpathSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
// Pure policy decisions and real candidate-repository binding regressions.

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
import { scrubGitRepoLocationEnv } from "./lib/git-hook-env.mjs";

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
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dpf-derived-pnpm-")));
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

function candidateRepository(t, files) {
  const root = mkdtempSync(join(tmpdir(), "dpf-admission-candidate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = args => execFileSync("git", args, {
    cwd: root, encoding: "utf8", env: scrubGitRepoLocationEnv(),
  }).trim();
  git(["init", "-q", "-b", "candidate"]);
  git(["config", "user.name", "DPF Test"]);
  git(["config", "user.email", "test@example.invalid"]);
  git(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(root, "README.md"), "base\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "base"]);
  git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  git(["add", "."]);
  git(["commit", "-q", "-m", "candidate"]);
  return { root, sha: git(["rev-parse", "HEAD"]), git };
}

function classifyCandidate(candidate, invoking, extra = {}) {
  // Load the actual production module from the other repository. Its default
  // REPO_ROOT must genuinely disagree with the selected candidate in this test.
  const scripts = join(invoking.root, "scripts");
  mkdirSync(scripts, { recursive: true });
  for (const filename of ["derived-artifacts-gate.mjs", "check-guards.mjs"]) {
    cpSync(new URL(`./${filename}`, import.meta.url), join(scripts, filename));
  }
  cpSync(new URL("./lib", import.meta.url), join(scripts, "lib"), { recursive: true });
  const moduleUrl = pathToFileURL(join(scripts, "derived-artifacts-gate.mjs")).href;
  const options = { cwd: candidate.root, expectedSha: candidate.sha, registry: [], ...extra };
  const output = execFileSync(process.execPath, ["--input-type=module", "-e",
    `import { sandboxDecisionForHead } from ${JSON.stringify(moduleUrl)};
console.log(JSON.stringify(sandboxDecisionForHead(JSON.parse(process.argv[1]))));`,
    JSON.stringify(options),
  ], { cwd: invoking.root, encoding: "utf8", env: scrubGitRepoLocationEnv() });
  return JSON.parse(output);
}

test("sandbox admission requires a code candidate despite a documentation invoking checkout", t => {
  const docs = candidateRepository(t, { "docs/brief.md": "documentation\n" });
  const code = candidateRepository(t, { "code.ts": "export const changed = true;\n" });
  assert.equal(classifyCandidate(code, docs)?.claim, true, "code candidate must not borrow a docs exemption");
});

test("sandbox admission exempts a docs candidate despite a code invoking checkout", t => {
  const docs = candidateRepository(t, { "docs/brief.md": "documentation\n" });
  const code = candidateRepository(t, { "code.ts": "export const changed = true;\n" });
  assert.equal(classifyCandidate(docs, code)?.claim, false, "unrelated code must not consume the docs candidate's sandbox slot");
});

test("sandbox admission checks derived freshness in the selected candidate", t => {
  const fresh = candidateRepository(t, { "docs/spec.md": "spec\n", "docs/artifact.txt": "fresh" });
  const stale = candidateRepository(t, { "docs/spec.md": "spec\n", "docs/artifact.txt": "stale" });
  const registry = [{
    id: "candidate-artifact", sourceGlobs: ["docs/spec.md"], artifactPaths: ["docs/artifact.txt"],
    check: [process.execPath, "-e", "process.exit(require('node:fs').readFileSync('docs/artifact.txt','utf8')==='fresh'?0:1)"],
  }];
  assert.equal(classifyCandidate(fresh, stale, { registry })?.claim, false, "another checkout cannot make the fresh candidate stale");
  assert.equal(classifyCandidate(stale, fresh, { registry })?.claim, true, "another checkout cannot make the stale candidate fresh");
});

test("sandbox admission cannot exempt a different requested SHA", t => {
  const docs = candidateRepository(t, { "docs/brief.md": "documentation\n" });
  assert.equal(classifyCandidate(docs, docs, { expectedSha: "a".repeat(40) }), null);
});

test("sandbox admission keeps an unreadable candidate merge base or diff inconclusive", t => {
  const docs = candidateRepository(t, { "docs/brief.md": "documentation\n" });
  docs.git(["update-ref", "-d", "refs/remotes/origin/main"]);
  assert.equal(classifyCandidate(docs, docs), null);
  assert.equal(sandboxDecisionForHead({ git: args => args[0] === "merge-base" ? "base" : null }), null);
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
