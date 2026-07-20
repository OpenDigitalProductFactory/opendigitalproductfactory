import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildGatePlan,
  evaluateReadiness,
  formatReadinessReport,
  parsePrBodyTrailers,
  validatePrBodyTrailers,
} from "./pr-readiness/core.mjs";

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
      body: "feat: add example\n\nSigned-off-by: Mark Bodman <markdbodman@gmail.com>",
    },
  ],
};

test("buildGatePlan mirrors pre-PR governance gates that CI owns", () => {
  const plan = buildGatePlan({ prBody: "UX-Fit-Decision: no-ui-change", prLabelsJson: "[]" });
  assert.deepEqual(
    plan.map((gate) => gate.name),
    [
      "Spec/Plan/Doc Gate",
      "Plan Backlog Coverage Gate",
      "Seed Contribution Fit Gate",
      "UX-Fit Gate",
      "Design Grounding Gate",
      "Data-Impact Gate",
      "Docs Impact Gate",
      "Doc Link Integrity",
      "Doc Reference Integrity",
      "Retired Superpowers Skill Guard",
    ],
  );
  assert.equal(plan[0].env.BASE_SHA, "origin/main");
  assert.equal(plan[2].env.GITHUB_EVENT_NAME, "pull_request");
  assert.equal(plan[2].env.PR_LABELS_JSON, "[]");
});

test("parsePrBodyTrailers extracts supported trailers with line numbers", () => {
  const trailers = parsePrBodyTrailers("Intro\n\nUX-Fit-Decision: compact-controls\nLocal-CI-Override: docs only");
  assert.deepEqual(trailers.map((trailer) => [trailer.name, trailer.value, trailer.line]), [
    ["UX-Fit-Decision", "compact-controls", 3],
    ["Local-CI-Override", "docs only", 4],
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
  assert.match(result.blockers.join("\n"), /missing DCO sign-off/);
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

test("formatReadinessReport uses plain-language headings and changed-file summary", () => {
  const result = evaluateReadiness({
    repo: { ...cleanRepo, changedFiles: ["a.ts", "b.ts"] },
    gateResults: [],
    prBody: "",
  });
  const report = formatReadinessReport(result);
  assert.match(report, /PR readiness: READY/);
  assert.match(report, /Changed files: 2/);
  assert.match(report, /What passed/);
  assert.match(report, /Safe to open or queue the PR/);
});
