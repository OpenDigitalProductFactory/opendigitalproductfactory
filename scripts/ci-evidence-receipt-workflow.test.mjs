import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

describe("exact-tree CI receipt foundation workflow", () => {
  it("publishes a merge-group receipt only after aggregate policy acceptance", () => {
    const aggregate = workflow.slice(workflow.indexOf("  merge-readiness:"));
    const evaluateAt = aggregate.indexOf("node scripts/merge-readiness-policy.mjs evaluate-needs");
    const createAt = aggregate.indexOf("node scripts/ci-evidence-receipt.mjs create");
    const uploadAt = aggregate.indexOf("name: Upload exact-tree CI evidence receipt");

    assert.ok(evaluateAt >= 0, "aggregate must evaluate all dependencies");
    assert.ok(createAt > evaluateAt, "receipt creation must follow aggregate acceptance");
    assert.ok(uploadAt > createAt, "only a created receipt may be uploaded");
    assert.match(
      aggregate,
      /if: github\.event_name == 'merge_group'/,
      "pull-request and push runs must not mint merge-group receipts",
    );
    assert.match(aggregate, /NEEDS_JSON: \$\{\{ toJSON\(needs\) \}\}/);
    assert.match(aggregate, /DPF_CI_PLANNER_DIGEST: \$\{\{ needs\.changes\.outputs\.evidence_plan_digest \}\}/);
    assert.match(aggregate, /name: \$\{\{ steps\.create-ci-evidence\.outputs\.artifact_name \}\}/);
  });

  it("observes exact-tree evidence on push without suppressing any gate", () => {
    const start = workflow.indexOf("  exact-tree-evidence-shadow:");
    const end = workflow.indexOf("\n  typecheck:", start);
    const shadow = workflow.slice(start, end);

    assert.ok(start >= 0, "shadow job must exist");
    assert.match(shadow, /if: github\.event_name == 'push'/);
    assert.match(shadow, /node scripts\/ci-evidence-receipt\.mjs locate/);
    assert.match(shadow, /uses: actions\/download-artifact@v8/);
    assert.match(shadow, /github-token: \$\{\{ github\.token \}\}/);
    assert.match(shadow, /run-id: \$\{\{ steps\.locate-ci-evidence\.outputs\.source_run_id \}\}/);
    assert.match(shadow, /node scripts\/ci-evidence-receipt\.mjs validate/);

    assert.doesNotMatch(
      workflow,
      /needs\.exact-tree-evidence-shadow\.outputs\.(?:reusable|reuse)/,
      "foundation shadow verdict must not control job allocation",
    );
    for (const job of ["typecheck", "test-web", "test-packages", "build", "ux-route-sweep-runtime"]) {
      const blockStart = workflow.indexOf(`  ${job}:`);
      assert.ok(blockStart >= 0, `missing ${job}`);
      const nextJob = workflow.slice(blockStart + 2).search(/\n  [a-z0-9-]+:\s*\n/);
      const block = workflow.slice(
        blockStart,
        nextJob < 0 ? workflow.length : blockStart + 2 + nextJob,
      );
      assert.doesNotMatch(block, /exact-tree-evidence-shadow/, `${job} must remain exhaustive`);
    }
  });

  it("keeps the shadow job inside the stable merge-readiness aggregate", () => {
    assert.match(
      workflow,
      /merge-readiness:\s*\n\s+name: Merge Readiness[\s\S]*?needs:[\s\S]*?- exact-tree-evidence-shadow/,
    );
    assert.match(workflow, /name: UX Route Budget Sweep/);
    assert.match(workflow, /merge_group:/);
    assert.match(workflow, /permissions:\s*\n\s+actions: read\s*\n\s+checks: read\s*\n\s+contents: read/);
  });
});
