import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  POLICY_GUARD_PROFILES,
  resolvePolicyGuardInvocation,
  runPolicyProfile,
} from "./lib/ci-policy-guards.mjs";

const EXPECTED_LEGACY_JOBS = [
  "archetype-completeness-guard",
  "build-studio-namespace-guard",
  "bundle-boundary-guard",
  "capability-consumer-guard",
  "compose-env-contract-guard",
  "context-economy-guard",
  "data-impact-gate",
  "decision-baseline",
  "derived-artifact-registry",
  "design-grounding-gate",
  "diagram-dependency-pin-guard",
  "doc-reference-integrity",
  "docs-impact-gate",
  "docs-link-integrity",
  "docs-staleness-detector",
  "finding-substrate-guard",
  "instruction-plane-guard",
  "instruction-plane-rule-coverage",
  "janitor-tests",
  "mcp-tool-pack-guard",
  "mobile-jest-pin-guard",
  "module-size-guard",
  "n-minus-one-caller-honesty",
  "new-dependency-gate",
  "override-provenance-guard",
  "package-boundary-guard",
  "pr-health-test",
  "prose-lint-guard",
  "repo-guard-loop",
  "reporting-composition-guard",
  "retired-substrate-guard",
  "sbom-divergence-guard",
  "seed-fit-gate",
  "singleton-safety-guard",
  "spec-plan-doc-gate",
  "stewardship-scope-guard",
  "style-drift-guard",
  "tool-surface-guard",
  "ux-fit-gate",
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

  it("accounts for every migrated legacy job exactly once", () => {
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
