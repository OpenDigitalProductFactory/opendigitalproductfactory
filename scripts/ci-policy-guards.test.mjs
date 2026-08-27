import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  POLICY_GUARD_PROFILES,
  formatRunSummary,
  resolvePolicyGuardInvocation,
  runPolicyProfile,
} from "./lib/ci-policy-guards.mjs";

const EXPECTED_LEGACY_JOBS = [
  "application-boundary-guard",
  "archetype-completeness-guard",
  "build-studio-namespace-guard",
  "build-studio-surface-guard",
  "bundle-boundary-guard",
  "capability-consumer-guard",
  "compose-env-contract-guard",
  "compose-resource-budgets-guard",
  "context-economy-guard",
  "data-impact-gate",
  "db-commandment-coverage",
  "decision-baseline",
  "derived-artifact-registry",
  "design-grounding-gate",
  "diagram-dependency-pin-guard",
  "doc-anchor-existence",
  "doc-reference-integrity",
  "docs-impact-gate",
  "docs-link-integrity",
  "docs-staleness-detector",
  "endpoint-classification-guard",
  "finding-substrate-guard",
  "fk-index-coverage-guard",
  "fpaw-standard-guard",
  "fresh-install-reliability",
  "governed-teardown-guard",
  "host-port-range-guard",
  "installer-help-contract",
  "installer-skip-visibility",
  "installer-state-contract",
  "instruction-plane-guard",
  "instruction-plane-rule-coverage",
  "janitor-tests",
  "label-association-guard",
  "live-blocker-references",
  "mcp-tool-pack-guard",
  "mobile-jest-pin-guard",
  "module-size-guard",
  "n-minus-one-caller-honesty",
  "new-dependency-gate",
  "override-provenance-guard",
  "owned-patch-regression",
  "package-boundary-guard",
  "platform-composition-single-home",
  "pr-health-test",
  "prose-lint-guard",
  "published-image-freshness",
  "release-asset-contract",
  "release-compose-pins",
  "repo-guard-loop",
  "reporting-composition-guard",
  "retention-enrollment-guard",
  "retired-substrate-guard",
  "sbom-divergence-guard",
  "seed-fit-gate",
  "shell-guard-shim-contract",
  "singleton-safety-guard",
  "spec-plan-doc-gate",
  "spec-status-frontmatter",
  "stewardship-scope-guard",
  "style-drift-guard",
  "test-clock-bomb-guard",
  "test-cwd-independence-guard",
  "tool-surface-guard",
  "ux-fit-gate",
  "ux-primitive-adoption-guard",
  "work-unit-conformance-guard",
];

function workflowJobBlock(workflow, jobId) {
  const start = workflow.indexOf(`  ${jobId}:\n`);
  assert.notEqual(start, -1, `${jobId} must exist`);
  const next = workflow.slice(start + 1).search(/^  [a-z0-9-]+:\s*$/m);
  return next < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
}

describe("CI policy guard registry", () => {
  it("launches pnpm through cmd on Windows without enabling shell mode globally", () => {
    assert.deepEqual(
      resolvePolicyGuardInvocation("pnpm", ["run", "check:prose-lint"], {
        platform: "win32",
        env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      }),
      {
        command: "C:\\Windows\\System32\\cmd.exe",
        args: ["/d", "/s", "/c", "pnpm run check:prose-lint"],
      },
    );
    assert.deepEqual(
      resolvePolicyGuardInvocation("pnpm", ["run", "check:prose-lint"], {
        platform: "linux",
      }),
      { command: "pnpm", args: ["run", "check:prose-lint"] },
    );
  });

  it("accounts for every registered guard exactly once", () => {
    const entries = Object.values(POLICY_GUARD_PROFILES).flat();
    const legacyJobs = entries.map((entry) => entry.legacyJobId).sort();

    assert.deepEqual(legacyJobs, EXPECTED_LEGACY_JOBS);
    assert.equal(new Set(legacyJobs).size, legacyJobs.length);
    assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);
    for (const entry of entries) {
      assert.ok(entry.name);
      assert.ok(entry.commands.length > 0);
    }
  });

  it("runs the FPAW checker and its adversarial suite in the workspace profile", () => {
    const fpaw = POLICY_GUARD_PROFILES.workspace.find(
      (entry) => entry.id === "fpaw-standard-guard",
    );
    assert.ok(fpaw);
    assert.deepEqual(fpaw.commands, [
      ["pnpm", ["run", "check:fpaw-standard:test"]],
      ["pnpm", ["run", "check:fpaw-standard"]],
    ]);
  });

  it("evaluates the decision baseline without mutating the caller's Git state", () => {
    const baseline = POLICY_GUARD_PROFILES["pull-request"].find(
      (entry) => entry.id === "decision-baseline",
    );
    assert.ok(baseline);
    assert.deepEqual(baseline.commands, [
      ["git", ["fetch", "--no-tags", "--quiet", "origin", "main"]],
      ["node", ["scripts/check-golden-decisions.mjs", "--merge-with", "origin/main"]],
      ["node", ["--test", "scripts/check-golden-decisions.test.mjs"]],
    ]);
    assert.equal(
      baseline.commands.some(([command, args]) =>
        command === "git" && ["config", "merge", "commit", "checkout", "switch"].includes(args[0])),
      false,
    );
  });

  it("runs every named guard and retains all failures", async () => {
    const calls = [];
    const result = await runPolicyProfile({
      entries: [
        {
          id: "first",
          legacyJobId: "first-job",
          name: "First",
          commands: [["node", ["first.mjs"]]],
        },
        {
          id: "second",
          legacyJobId: "second-job",
          name: "Second",
          commands: [["node", ["second.mjs"]]],
        },
      ],
      execute(command, args) {
        calls.push([command, args]);
        return command === "node" && args[0] === "first.mjs" ? 1 : 0;
      },
      now: (() => {
        let value = 0;
        return () => (value += 10);
      })(),
    });

    assert.deepEqual(calls, [
      ["node", ["first.mjs"]],
      ["node", ["second.mjs"]],
    ]);
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.entries.map(({ id, status }) => ({ id, status })),
      [
        { id: "first", status: "failed" },
        { id: "second", status: "passed" },
      ],
    );
  });

  it("names every failed guard and its command in the tail summary", () => {
    const result = {
      ok: false,
      entries: [
        { name: "Module Size Guard", status: "failed", failedCommand: "node scripts/check-module-size.mjs" },
        { name: "Janitor Tests", status: "passed", failedCommand: null },
        { name: "Doc Reference Integrity", status: "failed", failedCommand: "node scripts/check-doc-reference-integrity.mjs" },
      ],
    };
    const summary = formatRunSummary("source", result);
    // The failing guards — not the last (passing) guard — must be surfaced.
    assert.match(summary.text, /2 of 3 guard\(s\) FAILED \(1 passed\)/);
    assert.match(summary.text, /✗ Module Size Guard — node scripts\/check-module-size\.mjs/);
    assert.match(summary.text, /✗ Doc Reference Integrity — node scripts\/check-doc-reference-integrity\.mjs/);
    assert.doesNotMatch(summary.text, /Janitor Tests/);
    assert.equal(
      summary.annotation,
      "::error title=Policy Guards (source)::2 guard(s) failed: Module Size Guard, Doc Reference Integrity",
    );
  });

  it("emits a clean pass line and no annotation when every guard passes", () => {
    const summary = formatRunSummary("source", {
      ok: true,
      entries: [
        { name: "Repo Guard Loop", status: "passed", failedCommand: null },
        { name: "Janitor Tests", status: "passed", failedCommand: null },
      ],
    });
    assert.equal(summary.text, "Policy guards (source): all 2 guard(s) passed.");
    assert.equal(summary.annotation, null);
  });

  it("wires blocking source, workspace, and pull-request profiles in CI", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    assert.match(workflow, /^  policy-guards-source:$/m);
    assert.match(workflow, /node scripts\/ci-policy-guards\.mjs --profile source/);
    assert.match(workflow, /^  policy-guards-workspace:$/m);
    assert.match(workflow, /node scripts\/ci-policy-guards\.mjs --profile workspace/);
    assert.match(workflow, /^  policy-guards-pr:$/m);
    assert.match(workflow, /node scripts\/ci-policy-guards\.mjs --profile pull-request/);
    const policyJobs = [
      workflowJobBlock(workflow, "policy-guards-source"),
      workflowJobBlock(workflow, "policy-guards-workspace"),
      workflowJobBlock(workflow, "policy-guards-pr"),
    ].join("\n");
    assert.equal(
      (policyJobs.match(/continue-on-error:\s*true/g) ?? []).length,
      0,
    );
  });

  it("does not retain migrated legacy job definitions or aggregate dependencies", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

    for (const legacyJobId of EXPECTED_LEGACY_JOBS) {
      const escapedJobId = legacyJobId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.doesNotMatch(
        workflow,
        new RegExp(`^  ${escapedJobId}:$`, "m"),
        `${legacyJobId} must not allocate a standalone runner`,
      );
      assert.doesNotMatch(
        workflow,
        new RegExp(`^      - ${escapedJobId}$`, "m"),
        `${legacyJobId} must not remain in Merge Readiness dependencies`,
      );
    }
  });
});
