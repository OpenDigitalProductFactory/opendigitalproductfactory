import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  buildGatePlan,
  evaluateReadiness,
  formatReadinessReport,
  parsePrBodyTrailers,
  SUPPORTED_TRAILERS,
  validatePrBodyTrailers,
} from "./pr-readiness/core.mjs";
import { PR_TRAILER_NAMES } from "./lib/pr-trailer-contract.mjs";
import { runGate, readPublicationGateRecords, verifyCurrentPublication } from "./pr-readiness.mjs";
import { buildPublishedReadinessCommand } from "../apps/web/lib/build/build-studio-pr-readiness.ts";

test("PR readiness supplies a working shell to nested fixtures", async () => {
  const result = await runGate({ name: "nested shell", env: {}, command: [process.execPath,
    ["-e", "const {spawnSync}=require('node:child_process'); const r=spawnSync('sh',['-c','exit 0']); process.exit(r.status ?? 1);"]],
  });
  assert.equal(result.ok, true, result.output);
});

test("PR readiness blocks an executed guard violation that explains a module error", async () => {
  const gate = await runGate({ name: "Fixture Script Imports", env: {}, command: [process.execPath,
    ["-e", "console.error('[fixture-script-imports] FAILED: That test dies with ERR_MODULE_NOT_FOUND before its assertion.');process.exit(1)"]],
  });
  assert.equal(gate.exitCode, 1);
  assert.equal(gate.outcome, null);
  assert.equal(gate.ok, false);
  assert.equal(gate.skippedEnvironment, false);
  const readiness = evaluateReadiness({ repo: cleanRepo, gateResults: [gate], prBody: "" });
  assert.equal(readiness.ready, false);
  assert.match(readiness.blockers.join("\n"), /Fixture Script Imports failed locally/);
});

const cleanRepo = {
  headSha: "a".repeat(40),
  branch: "feat/example",
  isDetached: false,
  isShallow: false,
  mergeBases: ["abc123"],
  changedFiles: ["apps/web/lib/example.ts"],
  statusPorcelain: "",
  upstream: "origin/feat/example",
  ahead: 0,
  behind: 0,
  commits: [
    {
      sha: "1111111",
      subject: "feat: add example",
      authorName: "Mark Bodman",
      authorEmail: "markdbodman@gmail.com",
      body: "feat: add example\n\nSigned-off-by: Mark Bodman <markdbodman@gmail.com>",
    },
  ],
};

test("historical PRs leave new publication on its ordinary guarded attestation path", async () => {
  for (const state of ["MERGED", "CLOSED"]) {
    let checks = 0;
    await verifyCurrentPublication({
      contextReader: () => ({ pullRequest: { state } }),
      verify: async () => { checks++; throw new Error("Matching published PR and active protected checks/merge queue are required."); },
    });
    assert.equal(checks, 0, state);
    const plan = buildGatePlan({ changeScope: "runtime", publishedCorrection: false });
    assert.ok(plan.length > 10, "initial publication still requires its broad guard plan");
    const verdict = evaluateReadiness({ repo: cleanRepo });
    assert.equal(verdict.ready, false);
    assert.match(verdict.blockers.join("\n"), /Local-CI-Evidence.*Local-CI-Override/);
  }
});

test("OPEN correction verification gets the initial context then fresh protection and PR state", async () => {
  const initial = { pullRequest: { state: "OPEN", headRefOid: "a" } };
  const changed = { pullRequest: { state: "CLOSED", headRefOid: "b" } };
  let reads = 0, calls = 0;
  await assert.rejects(verifyCurrentPublication({
    contextReader: () => (++reads === 1 ? initial : changed),
    verify: async ({ contextReader }) => {
      calls++;
      assert.equal(contextReader(), initial);
      assert.equal(contextReader(), changed);
      throw new Error("Published PR or protection changed during correction verification.");
    },
  }), /protection changed/);
  assert.equal(reads, 2);
  assert.equal(calls, 1);
});

test("missing PR lookup retains initial publication but malformed returned state stays unproven", async () => {
  let calls = 0;
  await verifyCurrentPublication({ contextReader: () => { throw new Error("no PR"); }, verify: async () => { calls++; } });
  assert.equal(calls, 0);
  for (const context of [{}, { pullRequest: {} }, { pullRequest: { state: "UNKNOWN" } }]) {
    await assert.rejects(verifyCurrentPublication({ contextReader: () => context, verify: async () => { calls++; } }), /state.*unproven/i);
  }
  assert.equal(calls, 0, "malformed data cannot start correction checks");
});

test("runtime publication cannot report READY without local-CI attestation", () => {
  const result = evaluateReadiness({ repo: cleanRepo, prBody: "Actual passing gate omitted from body" });
  assert.equal(result.ready, false);
  assert.match(result.blockers.join("\n"), /Local-CI-Evidence.*Local-CI-Override/);
});

const proofNow = Date.parse("2026-10-12T22:00:00Z");
const proofBody = "Local-CI-Evidence: EXT-VALID (feat/example@" + cleanRepo.headSha + ")";
function publicationProof(stateChanges = {}, metadataChanges = {}) {
  return [{ state: {
    branch: cleanRepo.branch, sha: cleanRepo.headSha, status: "passed", gatePassed: true,
    evidenceRecordId: "EXT-VALID", leaseId: "NPEL-1", expiresAt: "2026-10-13T00:00:00Z",
    ...stateChanges,
  }, metadata: { candidateSha: cleanRepo.headSha, runLeaseId: "NPEL-1", execution: { status: "passed" }, ...metadataChanges } }];
}
test("publication requires a qualified exact-head proof, not a pasted identifier", () => {
  const check = records => evaluateReadiness({ repo: cleanRepo, prBody: proofBody, localCiRecords: records, now: proofNow });
  assert.equal(check(publicationProof()).ready, true);
  for (const patch of [
    { gatePassed: false, status: "failed" }, { status: "admitted" }, { skipped: true },
    { evidencePending: true }, { testStub: true }, { sha: "b".repeat(40) },
    { branch: "feat/foreign" }, { expiresAt: "2026-10-12T21:00:00Z" },
    { expiresAt: "invalid" }, { evidenceRecordId: "EXT-OTHER" },
  ]) assert.equal(check(publicationProof(patch)).ready, false, JSON.stringify(patch));
  for (const patch of [{ candidateSha: "b".repeat(40) }, { runLeaseId: "NPEL-OTHER" }, { execution: { status: "failed" } }]) {
    assert.equal(check(publicationProof({}, patch)).ready, false, JSON.stringify(patch));
  }
  assert.equal(check([]).ready, false);
  assert.equal(evaluateReadiness({ repo: { ...cleanRepo, publicationIdentityChanged: true }, prBody: proofBody, localCiRecords: publicationProof(), now: proofNow }).ready, false);
  assert.equal(evaluateReadiness({ repo: cleanRepo, prBody: "<!-- " + proofBody + " -->", localCiRecords: publicationProof(), now: proofNow }).ready, false);
  assert.equal(check([{ state: null, metadata: null }, ...publicationProof()]).ready, true);
});
test("publication preserves truthful allowed overrides and docs exemption", () => {
  const allowed = evaluateReadiness({ repo: cleanRepo, prBody: "Local-CI-Override: operator-emergency: authorized DEV correction" });
  assert.equal(allowed.ready, true);
  assert.match(allowed.notes.join("\n"), /UNRUN/);
  assert.equal(evaluateReadiness({ repo: cleanRepo, prBody: "Local-CI-Override: tests look fine" }).ready, false);
  assert.equal(evaluateReadiness({ repo: cleanRepo, prBody: "Local-CI-Override: gate-infrastructure-unavailable: prose only" }).ready, false);
  assert.equal(evaluateReadiness({ repo: { ...cleanRepo, changedFiles: ["docs/testing/pr-health.md"] } }).ready, true);
});

test("publication scans existing slot records without executing the gate", () => {
  const paths = [];
  const records = readPublicationGateRecords({ rootClone: "D:/repo", gitCommonDir: "D:/repo/.git", candidateGitDir: "D:/repo/.git/worktrees/example" }, path => {
    paths.push(path);
    return path.includes("metadata") ? publicationProof()[0].metadata : publicationProof()[0].state;
  }, () => ({ ok: false }));
  assert.ok(records.length > 0);
  assert.equal(paths.length, records.length * 2);
  assert.ok(paths.some(path => path.includes("worktrees")));
  assert.equal(evaluateReadiness({ repo: cleanRepo, prBody: proofBody, localCiRecords: records, now: proofNow }).ready, true);
  assert.deepEqual(readPublicationGateRecords(null), []);
});

test("Build Studio published-tree mechanics retain server-owned proof without inventing local PASS", () => {
  const command = buildPublishedReadinessCommand({
    branchName: "build/FB-123", commitSha: cleanRepo.headSha, restoreBranch: "build/FB-123",
    prBodyBase64: Buffer.from("Verified by Build Studio server").toString("base64"),
    repositoryOwner: "OpenDigitalProductFactory", repositoryName: "opendigitalproductfactory",
  });
  const publishedRef = command.match(/--published-ref '([^']+)'/)?.[1];
  assert.equal(publishedRef, "refs/remotes/origin/build/FB-123");
  const repo = { ...cleanRepo, branch: "HEAD", isDetached: true, publishedRef, publishedRefMatchesHead: true };
  const result = evaluateReadiness({ repo });
  assert.equal(result.ready, true);
  assert.match(result.notes.join("\n"), /local proof UNPROVEN.*server-owned/);
  assert.equal(evaluateReadiness({ repo: { ...repo, publishedRefMatchesHead: false } }).ready, false);
  assert.equal(evaluateReadiness({ repo: { ...repo, publicationIdentityChanged: true } }).ready, false);
  for (const prBody of ["Local-CI-Evidence:", proofBody, "Local-CI-Override: unapproved-text"]) {
    assert.equal(evaluateReadiness({ repo, prBody }).ready, false, prBody);
  }
  for (const state of [{ gatePassed: false }, { sha: "b".repeat(40) }, { expiresAt: "2026-10-12T21:00:00Z" }]) {
    assert.equal(evaluateReadiness({ repo, prBody: proofBody, localCiRecords: publicationProof(state), now: proofNow }).ready, false);
  }
  // Keep the actual caller's server check before publication; the CLI flag is
  // mechanics, not authority and not a substitute for this existing contract.
  const caller = readFileSync(new URL("../apps/web/lib/mcp/build-ship-handlers.ts", import.meta.url), "utf8");
  const prerequisite = caller.indexOf("const preflightRequirement = await requireInPlatformPreflightRecord(");
  const publish = caller.indexOf("const published = await publishBranchCommit(");
  assert.ok(prerequisite > 0 && prerequisite < publish);
  assert.match(caller.slice(prerequisite, publish), /\.\.\.preflightRequirement\.blockers/);
  assert.match(caller.slice(prerequisite, publish), /if \(prePublishBlockers\.length > 0\)[\s\S]*return \{/);
  assert.match(caller, /const result = evaluatePreflightRequirement\(\{[\s\S]*treeSha: identity\.treeSha,[\s\S]*records,/);
});

test("buildGatePlan derives runnable checks from the canonical policy profiles", () => {
  const profiles = {
    source: [
      {
        id: "source-a",
        name: "Source A",
        commands: [
          ["node", ["--test", "source-a.test.mjs"]],
          ["node", ["scripts/source-a.mjs"]],
        ],
      },
    ],
    workspace: [
      {
        id: "workspace-a",
        name: "Workspace A",
        commands: [
          ["pnpm", ["run", "workspace-a:test"]],
          ["pnpm", ["run", "workspace-a"]],
        ],
      },
    ],
    "pull-request": [
      {
        id: "pr-a",
        name: "PR A",
        commands: [["node", ["scripts/pr-a.mjs"]]],
      },
      {
        id: "mutating",
        name: "Mutating",
        commands: [
          ["git", ["merge", "origin/main"]],
          ["node", ["scripts/after-merge.mjs"]],
        ],
      },
    ],
  };
  const plan = buildGatePlan({
    prBody: "Seed-Fit-Decision: global-default",
    prLabelsJson: "[]",
    profiles,
  });
  assert.deepEqual(
    plan.map((gate) => [gate.name, gate.command]),
    [
      ["Source A", ["node", ["scripts/source-a.mjs"]]],
      ["Workspace A", ["pnpm", ["run", "workspace-a"]]],
      ["PR A", ["node", ["scripts/pr-a.mjs"]]],
    ],
  );
  assert.equal(plan[0].env.BASE_SHA, "origin/main");
  assert.equal(plan[2].env.GITHUB_EVENT_NAME, "pull_request");
  assert.equal(plan[2].env.PR_LABELS_JSON, "[]");
});

test("buildGatePlan changes when the canonical profile changes", () => {
  const guard = {
    id: "only-guard",
    name: "Only Guard",
    commands: [["node", ["scripts/only-guard.mjs"]]],
  };
  const populated = buildGatePlan({
    profiles: { source: [guard], "pull-request": [] },
  });
  const deleted = buildGatePlan({
    profiles: { source: [], "pull-request": [] },
  });
  assert.deepEqual(populated.map((entry) => entry.name), ["Only Guard"]);
  assert.deepEqual(deleted, []);
});

test("parsePrBodyTrailers extracts supported trailers with line numbers", () => {
  const trailers = parsePrBodyTrailers("Intro\n\nUX-Fit-Decision: compact-controls\nLocal-CI-Override: docs only");
  assert.deepEqual(trailers.map((trailer) => [trailer.name, trailer.value, trailer.line]), [
    ["UX-Fit-Decision", "compact-controls", 3],
    ["Local-CI-Override", "docs only", 4],
  ]);
});

test("parsePrBodyTrailers ignores commented template examples", () => {
  const trailers = parsePrBodyTrailers(
    [
      "Intro",
      "<!-- Add exactly one:",
      "Local-CI-Evidence: <record>",
      "Local-CI-Override: <reason>",
      "-->",
      "UX-Fit-Decision: no-ui-impact",
    ].join("\n"),
  );
  assert.deepEqual(trailers, [
    { name: "UX-Fit-Decision", value: "no-ui-impact", line: 6 },
  ]);
});

test("validatePrBodyTrailers accepts the mechanism suffix a scoped seed-fit decision requires (BI-5C66AC6C)", () => {
  const result = validatePrBodyTrailers(
    "Seed-Fit-Decision: archetype-scoped mechanism=read-scope symbol=resolveMailroomProfile\n",
  );
  assert.equal(result.blockers.some((b) => /Invalid Seed-Fit-Decision/.test(b)), false);
});

test("validatePrBodyTrailers catches duplicate trailers and invalid seed-fit decisions", () => {
  const result = validatePrBodyTrailers(
    [
      "Seed-Fit-Decision: install-local",
      "Seed-Fit-Decision: global-default",
      "Local-CI-Evidence: RV-1",
      "Local-CI-Override: operator skipped",
    ].join("\n"),
  );
  assert.equal(result.ok, false);
  assert.match(result.blockers.join("\n"), /Seed-Fit-Decision appears 2 times/);
  assert.match(result.blockers.join("\n"), /Invalid Seed-Fit-Decision/);
  assert.match(result.blockers.join("\n"), /Use either Local-CI-Evidence or Local-CI-Override/);
});

test("evaluateReadiness blocks unsafe or queue-hostile repository state", () => {
  const result = evaluateReadiness({
    repo: {
      ...cleanRepo,
      isShallow: true,
      mergeBases: ["a", "b"],
      statusPorcelain: " M scripts/x.mjs",
      ahead: 2,
      branch: "main",
      commits: [{ sha: "2222222", subject: "fix: unsigned", body: "fix: unsigned" }],
    },
    gateResults: [],
    prBody: "",
  });
  assert.equal(result.ready, false);
  assert.match(result.blockers.join("\n"), /shallow Git repository/);
  assert.match(result.blockers.join("\n"), /ambiguous merge-base/);
  assert.match(result.blockers.join("\n"), /working tree has uncommitted changes/);
  assert.match(result.blockers.join("\n"), /2 local commit\(s\) are not pushed/);
  assert.match(result.blockers.join("\n"), /branch is main/);
  assert.match(result.blockers.join("\n"), /missing its author-matching DCO sign-off/);
});

test("evaluateReadiness accepts a detached exact published ref but no other detached head", () => {
  const exact = evaluateReadiness({
    repo: {
      ...cleanRepo,
      branch: "HEAD",
      isDetached: true,
      upstream: null,
      ahead: 1,
      publishedRef: "refs/remotes/origin/build/example",
      publishedRefMatchesHead: true,
    },
    gateResults: [],
    prBody: "Local-CI-Override: external-contribution-no-install: detached source-only checkout",
  });
  assert.equal(exact.ready, true);
  assert.equal(exact.branch, "refs/remotes/origin/build/example");

  const mismatch = evaluateReadiness({
    repo: {
      ...cleanRepo,
      branch: "HEAD",
      isDetached: true,
      upstream: null,
      ahead: 1,
      publishedRef: "refs/remotes/origin/build/example",
      publishedRefMatchesHead: false,
    },
    gateResults: [],
    prBody: "",
  });
  assert.equal(mismatch.ready, false);
  assert.match(mismatch.blockers.join("\n"), /does not equal published ref/);
});

test("evaluateReadiness folds failed local gates into one pre-PR verdict", () => {
  const result = evaluateReadiness({
    repo: cleanRepo,
    gateResults: [
      { name: "UX-Fit Gate", ok: false, exitCode: 1, output: "[ux-fit-gate] FAILED" },
      { name: "Docs Impact Gate", ok: true, exitCode: 0, output: "[docs-impact-gate] OK" },
    ],
    prBody: "UX-Fit-Decision: compact-controls",
  });
  assert.equal(result.ready, false);
  assert.match(result.blockers.join("\n"), /UX-Fit Gate failed locally/);
  assert.match(result.warnings.join("\n"), /editing the PR body after a workflow run has started/);
});

test("evaluateReadiness reports a missing host runtime honestly without treating it as a product failure", () => {
  const result = evaluateReadiness({
    repo: cleanRepo,
    gateResults: [
      {
        name: "Repo Guard Loop",
        ok: false,
        skippedEnvironment: true,
        exitCode: 1,
        output: "GuardRuntimeEnvironmentError: pinned TypeScript missing",
      },
    ],
    prBody: "Local-CI-Override: external-contribution-no-install: source-only checkout",
  });
  assert.equal(result.ready, true);
  assert.equal(result.blockers.length, 0);
  assert.match(result.warnings.join("\n"), /source-only host/);
  assert.match(result.warnings.join("\n"), /CI still enforces it/);
});

test("formatReadinessReport uses plain-language headings and changed-file summary", () => {
  const result = evaluateReadiness({
    repo: { ...cleanRepo, changedFiles: ["a.ts", "b.ts"] },
    gateResults: [],
    prBody: "Local-CI-Override: operator-emergency: authorized DEV correction",
    gateContext: {
      trailers: [
        {
          gate: "Design Grounding",
          trailer: `${PR_TRAILER_NAMES.designGrounding}:`,
          level: "required",
          because: "design-sensitive file changed",
        },
      ],
      moduleSize: [],
      ratchets: [],
      derivedArtifacts: [],
      routes: [],
      migrations: [],
      guardObligations: [],
      testImpact: [],
      verification: ["run the readiness command"],
    },
  });
  const report = formatReadinessReport(result);
  assert.ok(
    report.indexOf("# Gate context") < report.indexOf("PR readiness: READY"),
    "the prospective checklist must lead the pass/fail verdict",
  );
  assert.match(report, /Design-Grounding-Decision:/);
  assert.match(report, /PR readiness: READY/);
  assert.match(report, /Changed files: 2/);
  assert.match(report, /What passed/);
  assert.match(report, /Safe to open or queue the PR/);
});

test("one trailer contract feeds readiness parsing and gate-context names", () => {
  assert.ok(SUPPORTED_TRAILERS.has(PR_TRAILER_NAMES.processSpine));
  assert.ok(SUPPORTED_TRAILERS.has(PR_TRAILER_NAMES.designGrounding));
  assert.ok(SUPPORTED_TRAILERS.has(PR_TRAILER_NAMES.seedFit));
  assert.ok(SUPPORTED_TRAILERS.has(PR_TRAILER_NAMES.docsImpact));
  assert.ok(SUPPORTED_TRAILERS.has(PR_TRAILER_NAMES.convergenceImpact));
  assert.ok(SUPPORTED_TRAILERS.has(PR_TRAILER_NAMES.localCiEvidence));
  assert.ok(SUPPORTED_TRAILERS.has(PR_TRAILER_NAMES.localCiOverride));
});

test("shared PR skill and GitHub template require the mechanical readiness checklist", () => {
  const skill = readFileSync(
    new URL("../packages/dpf-skill-pack/skills/dpf-pr-with-dco/SKILL.md", import.meta.url),
    "utf8",
  );
  const template = readFileSync(
    new URL("../.github/PULL_REQUEST_TEMPLATE.md", import.meta.url),
    "utf8",
  );
  assert.match(skill, /pnpm pr:ready -- --pr-body-file/);
  assert.match(skill, /review_semantic_change/);
  assert.ok(
    skill.indexOf("review_semantic_change") < skill.indexOf("pnpm run pregate"),
    "semantic review must occur on the stable local commit before pregate/first publication",
  );
  assert.match(template, /## Pre-PR readiness/);
  assert.match(template, /pnpm pr:ready -- --pr-body-file/);
});

// BI-D967DEE0: the UX-Fit trailer is retired. pr-readiness still PARSES it so the author
// is told it is inert — silently ignoring it would let people keep adding a dead trailer
// and believe it satisfied the gate.
test("a retired UX-Fit-Decision trailer warns instead of passing silently", () => {
  const result = validatePrBodyTrailers("UX-Fit-Decision: progressive-disclosure\n");
  assert.equal(result.ok, true, "retirement is a warning, not a blocker");
  assert.ok(
    result.warnings.some((w) => /UX-Fit-Decision.*retired by BI-D967DEE0/.test(w)),
    `expected a retirement warning, got: ${result.warnings.join(" | ")}`,
  );
  assert.ok(
    result.warnings.some((w) => /docs\/ux-fit\/.*ux-fit\.json/.test(w)),
    "the warning must name the replacement",
  );
});
