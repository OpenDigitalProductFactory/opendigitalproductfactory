// BI-78176241. A docs-only change on a claimed Workroom branch must reach a
// PR with no override: one predicate decides "docs-only" for the gate, the
// pre-push exemption and the documentation evidence lane, and the docs-only
// path ends in a SHA-bound PASS record that pregate:status and the publish
// guard both read. A code diff keeps its full local-CI gate.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluatePushExemption } from "./derived-artifacts-gate.mjs";
import { DERIVED_ARTIFACTS } from "./lib/derived-artifacts-registry.mjs";
import { couldBeDocumentationFiles } from "./lib/documentation-evidence-lane.mjs";
import * as evidencePlan from "./lib/ci-evidence-plan.mjs";
import { writeLocalCiGateState } from "./lib/local-ci-gate-state.mjs";
import { evaluateGateVerdict } from "../packages/dpf-skill-pack/hooks/pregate-evidence-guard.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const READER = resolve(SCRIPT_DIR, "pregate-status.mjs");
const DOC_INDEX = "apps/web/lib/docs/doc-index.generated.json";

const DIFFS = [
  { files: ["docs/superpowers/specs/2026-10-27-work-atlas.md"], docsOnly: true },
  { files: ["README.md"], docsOnly: true },
  { files: ["packages/dpf-skill-pack/skills/x/SKILL.md"], docsOnly: true },
  // AC-4: the regenerated index rides with its docs source.
  { files: ["docs/user-guide/a.md", DOC_INDEX], docsOnly: true },
  // The index alone is not a docs change: nothing it is derived from moved.
  { files: [DOC_INDEX], docsOnly: false },
  // Executable standards are read by the workspace build.
  { files: ["docs/architecture/four-portfolio-archetype-standard-profile-catalog.md"], docsOnly: false },
  { files: ["memory/notes.json"], docsOnly: false },
  // AC-2: one code file costs the exemption.
  { files: ["docs/user-guide/a.md", "scripts/pregate.mjs"], docsOnly: false },
  { files: ["apps/web/app/page.tsx"], docsOnly: false },
];

test("AC-3: the push exemption, the documentation lane and the evidence planner give one answer", () => {
  assert.equal(typeof evidencePlan.classifyDocsOnlyDiff, "function", "ci-evidence-plan exports the one docs-only classifier");
  for (const { files, docsOnly } of DIFFS) {
    const label = files.join(", ");
    assert.equal(evidencePlan.classifyDocsOnlyDiff(files).docsOnly, docsOnly, `classifier: ${label}`);
    assert.equal(couldBeDocumentationFiles(files), docsOnly, `documentation lane: ${label}`);
    assert.equal(evaluatePushExemption(files, DERIVED_ARTIFACTS, () => true).exempt, docsOnly, `push exemption: ${label}`);
  }
  assert.equal(evidencePlan.classifyDocsOnlyDiff([]).docsOnly, false, "an empty diff is not docs-only");
});

test("AC-2: the classifier names every file that costs the exemption", () => {
  const verdict = evidencePlan.classifyDocsOnlyDiff(["docs/a.md", "scripts/pregate.mjs", "packages/db/schema.prisma"]);
  assert.equal(verdict.docsOnly, false);
  assert.deepEqual(verdict.nonDocFiles, ["packages/db/schema.prisma", "scripts/pregate.mjs"]);
});

test("AC-1: pregate does not end a docs-only run before the gate records its verdict", () => {
  // The BI-A254A94C short-circuit exited 0 here, before gate-worktree's
  // documentation lane could write the SHA-bound record, so every docs-only
  // publish was refused for want of evidence the gate never wrote.
  const source = readFileSync(join(SCRIPT_DIR, "pregate.mjs"), "utf8");
  assert.doesNotMatch(source, /sandboxDecisionForHead/);
  assert.doesNotMatch(source, /exit-0: docs-only diff/);
});

function tempRepo(t, changedFile) {
  const dir = mkdtempSync(join(tmpdir(), "dpf-docs-only-guard-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.name", "docs-only contract");
  git("config", "user.email", "docs-only@localhost");
  writeFileSync(join(dir, "README.md"), "base\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "docs/work-atlas");
  writeFileSync(join(dir, changedFile), "change\n");
  git("add", ".");
  git("commit", "-q", "-m", "change");
  const sha = git("rev-parse", "HEAD");
  const statePath = resolve(dir, git("rev-parse", "--git-path", "dpf-local-ci-gate.json"));
  return { dir, sha, statePath, head: { branch: "docs/work-atlas", sha, statePath, topLevel: dir } };
}

function writeDocumentationLanePass(statePath, sha) {
  const evidenceId = "LIR-DOCS-0001";
  writeLocalCiGateState(statePath, {
    branch: "docs/work-atlas",
    sha,
    gatePassed: true,
    leaseId: "",
    evidenceId,
    status: "passed",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    resilience: null,
    executionLane: "documentation",
    leaseEvents: [{ type: "documentation-lane", at: new Date().toISOString() }],
    producerEvidence: {
      schemaVersion: 1,
      producer: "documentation-evidence-lane",
      candidateSha: sha,
      candidateBranch: "docs/work-atlas",
      headTreeSha: "c".repeat(40),
      integrationTreeSha: "d".repeat(40),
      evidencePlanDigest: "e".repeat(64),
      evidenceRecordId: evidenceId,
    },
  });
}

test("AC-5: the publish guard accepts the documentation lane's SHA-bound PASS with no override", (t) => {
  const repo = tempRepo(t, "guide.md");
  writeDocumentationLanePass(repo.statePath, repo.sha);
  const verdict = evaluateGateVerdict(repo.head, { cwd: repo.dir, readerPath: READER });
  assert.deepEqual(verdict, { ok: true });
});

test("AC-2: the publish guard refuses a code diff that carries no local-CI evidence", (t) => {
  const repo = tempRepo(t, "server.mjs");
  const verdict = evaluateGateVerdict(repo.head, { cwd: repo.dir, readerPath: READER });
  assert.equal(verdict.ok, false);
});

test("AC-1: a documentation PASS bound to an older commit is not evidence for HEAD", (t) => {
  const repo = tempRepo(t, "guide.md");
  writeDocumentationLanePass(repo.statePath, "f".repeat(40));
  const verdict = evaluateGateVerdict(repo.head, { cwd: repo.dir, readerPath: READER });
  assert.equal(verdict.ok, false);
});
