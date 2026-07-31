import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

function jobBlock(job) {
  const start = workflow.indexOf(`  ${job}:`);
  assert.ok(start >= 0, `missing ${job}`);
  const next = workflow.slice(start + 2).search(/\n  [a-z0-9-]+:\s*\n/);
  return workflow.slice(start, next < 0 ? workflow.length : start + 2 + next);
}

describe("exact-tree CI receipt reuse workflow", () => {
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

  it("exports a push-only, fail-closed reuse verdict", () => {
    const reuse = jobBlock("exact-tree-evidence-shadow");

    assert.match(reuse, /if: github\.event_name == 'push'/);
    assert.match(reuse, /outputs:\s*\n\s+reusable: \$\{\{ steps\.validate-ci-evidence\.outputs\.reusable \}\}/);
    assert.match(reuse, /node scripts\/ci-evidence-receipt\.mjs locate/);
    assert.match(reuse, /uses: actions\/download-artifact@v8/);
    assert.match(reuse, /github-token: \$\{\{ github\.token \}\}/);
    assert.match(reuse, /run-id: \$\{\{ steps\.locate-ci-evidence\.outputs\.source_run_id \}\}/);
    assert.match(reuse, /node scripts\/ci-evidence-receipt\.mjs validate/);
    assert.match(reuse, /steps\.validate-ci-evidence\.outputs\.reusable != 'true'/);
  });

  it("suppresses only duplicated heavy push jobs after exact-tree acceptance", () => {
    const heavyJobs = [
      "typecheck",
      "policy-guards-workspace",
      "routing-contract",
      "test-web",
      "test-packages",
      "build",
      "ux-route-sweep-runtime",
      "adp-integration-tests",
    ];
    for (const job of heavyJobs) {
      const block = jobBlock(job);
      assert.match(block, /exact-tree-evidence-shadow/, `${job} must depend on the reuse verdict`);
      assert.match(
        block,
        /if: >-\s+always\(\) &&/,
        `${job} must run its condition even when the push-only reuse job is skipped`,
      );
      assert.match(
        block,
        /github\.event_name != 'push' \|\|\s+needs\.exact-tree-evidence-shadow\.outputs\.reusable != 'true'/,
        `${job} must fail closed to exhaustive execution`,
      );
    }

    for (const job of [
      "policy-guards-source",
      "policy-guards-pr",
      "dockerfile-node-version",
      "compose-image-pins",
    ]) {
      assert.doesNotMatch(
        jobBlock(job),
        /needs\.exact-tree-evidence-shadow\.outputs\.reusable/,
        `${job} must remain independently executable`,
      );
    }
  });

  it("keeps stable aggregate checks authoritative during reuse", () => {
    const unitTests = jobBlock("unit-tests");
    assert.match(unitTests, /needs: \[changes, exact-tree-evidence-shadow, test-web, test-packages\]/);
    assert.match(unitTests, /REUSE_EXACT_TREE: \$\{\{ needs\.exact-tree-evidence-shadow\.outputs\.reusable \}\}/);
    assert.match(unitTests, /Exact-tree merge-group unit-test evidence reused/);

    const uxSweep = jobBlock("ux-route-sweep");
    assert.match(uxSweep, /needs: \[changes, exact-tree-evidence-shadow, ux-route-sweep-runtime\]/);
    assert.match(uxSweep, /REUSE_EXACT_TREE: \$\{\{ needs\.exact-tree-evidence-shadow\.outputs\.reusable \}\}/);
    assert.match(uxSweep, /Exact-tree merge-group UX evidence reused/);
  });

  it("keeps the reuse job inside the stable merge-readiness aggregate", () => {
    assert.match(
      workflow,
      /merge-readiness:\s*\n\s+name: Merge Readiness[\s\S]*?needs:[\s\S]*?- exact-tree-evidence-shadow/,
    );
    assert.match(workflow, /name: UX Route Budget Sweep/);
    assert.match(workflow, /merge_group:/);
    assert.match(workflow, /permissions:\s*\n\s+actions: read\s*\n\s+checks: read\s*\n\s+contents: read/);
  });
});
