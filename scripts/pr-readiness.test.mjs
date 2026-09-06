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

const cleanRepo = {
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
    prBody: "",
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
    prBody: "",
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
    prBody: "",
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
