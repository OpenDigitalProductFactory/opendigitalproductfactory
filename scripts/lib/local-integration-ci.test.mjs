// node --test (was vitest, which no CI job executed for scripts/ — converted
// alongside BI-B5011ACE so the plan contract actually gates in the bare-runner
// CI test job).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLocalIntegrationPlan, createToolchainFingerprint } from "./local-integration-ci.mjs";

describe("createLocalIntegrationPlan", () => {
  it("creates a stable toolchain fingerprint for local-CI evidence (BI-76551B2D)", () => {
    const evidence = createToolchainFingerprint({
      buildStrategy: "host-next",
      nodeVersion: "v24.0.0",
      pnpmVersion: "10.14.0",
      gitVersion: "git version 2.50.1",
      platform: "linux",
      arch: "arm64",
      lockfileSha256: "lock-sha",
      nodeOptions: "NODE_OPTIONS=--max-old-space-size=8192",
    });

    assert.equal(evidence.toolchainFingerprint.length, 64);
    assert.deepEqual(evidence.toolchain, {
      buildStrategy: "host-next",
      nodeVersion: "v24.0.0",
      pnpmVersion: "10.14.0",
      gitVersion: "git version 2.50.1",
      platform: "linux",
      arch: "arm64",
      lockfileSha256: "lock-sha",
      nodeOptions: "NODE_OPTIONS=--max-old-space-size=8192",
    });
    assert.equal(evidence.toolchainFingerprint, createToolchainFingerprint({
      arch: "arm64",
      buildStrategy: "host-next",
      gitVersion: "git version 2.50.1",
      lockfileSha256: "lock-sha",
      nodeOptions: "NODE_OPTIONS=--max-old-space-size=8192",
      nodeVersion: "v24.0.0",
      platform: "linux",
      pnpmVersion: "10.14.0",
    }).toolchainFingerprint);
  });

  it("plans a single-branch local integration run", () => {
    const plan = createLocalIntegrationPlan({
      candidateBranch: "doc/build-studio-decision-skill-packs",
      mode: "single-branch",
      siblingBranches: [],
      hostPlatform: "linux",
    });

    assert.deepEqual(plan.commands.map((command) => command.join(" ")), [
      "git checkout -B local-integration/doc-build-studio-decision-skill-packs origin/main",
      "git merge --no-ff --no-edit doc/build-studio-decision-skill-packs",
      "node scripts/sandbox-freshness-preflight.mjs --converge --branch local-integration/doc-build-studio-decision-skill-packs",
      "pnpm --filter @dpf/db exec prisma generate",
      "pnpm --filter web exec vitest run",
      "env NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter web typecheck",
      "env NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter web exec next build",
    ]);
  });

  it("uses a locally available accepted-base ref without fetching by default (BI-76551B2D)", () => {
    const plan = createLocalIntegrationPlan({
      candidateBranch: "feat/local-ci-content-evidence",
      mode: "single-branch",
      siblingBranches: [],
      baseRef: "refs/dpf/integration/main",
      hostPlatform: "linux",
    });

    assert.deepEqual(plan.commands.slice(0, 2).map((command) => command.join(" ")), [
      "git checkout -B local-integration/feat-local-ci-content-evidence refs/dpf/integration/main",
      "git merge --no-ff --no-edit feat/local-ci-content-evidence",
    ]);
    assert.ok(!plan.commands.map((command) => command.join(" ")).some((command) => command.startsWith("git fetch ")));
    assert.equal(plan.baseRef, "refs/dpf/integration/main");
  });

  it("can still opt into fetching the accepted base before local integration", () => {
    const plan = createLocalIntegrationPlan({
      candidateBranch: "feat/local-ci-content-evidence",
      mode: "single-branch",
      siblingBranches: [],
      baseRef: "origin/main",
      fetchBase: true,
      hostPlatform: "linux",
    });

    assert.equal(plan.commands[0].join(" "), "git fetch origin main");
    assert.equal(plan.commands[1].join(" "), "git checkout -B local-integration/feat-local-ci-content-evidence origin/main");
  });

  it("runs the sandbox freshness preflight after every merge and before any gate", () => {
    const plan = createLocalIntegrationPlan({
      candidateBranch: "feat/x",
      mode: "sibling-set",
      siblingBranches: ["feat/y"],
      hostPlatform: "linux",
    });
    const commands = plan.commands.map((command) => command.join(" "));
    const preflightIndex = commands.findIndex((c) => c.includes("sandbox-freshness-preflight.mjs"));
    const lastMergeIndex = commands.map((c, i) => (c.startsWith("git merge") ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    const firstGateIndex = commands.findIndex((c) => c.includes("vitest run"));
    assert.ok(preflightIndex > lastMergeIndex);
    assert.ok(preflightIndex < firstGateIndex);
  });

  it("adds sibling branches in order for concurrent development", () => {
    const plan = createLocalIntegrationPlan({
      candidateBranch: "feat/build-studio-decision-skills-slice-1",
      mode: "sibling-set",
      siblingBranches: ["feat/environment-broker", "fix/build-studio-copy"],
    });

    assert.equal(plan.integrationBranch, "local-integration/feat-build-studio-decision-skills-slice-1");
    assert.ok(plan.commands.map((command) => command.join(" ")).includes(
      "git merge --no-ff --no-edit feat/environment-broker",
    ));
    assert.ok(plan.commands.map((command) => command.join(" ")).includes(
      "git merge --no-ff --no-edit fix/build-studio-copy",
    ));
  });

  it("uses a Docker production build on Windows hosts", () => {
    const plan = createLocalIntegrationPlan({
      candidateBranch: "feat/build-studio-decision-skills-slice-1",
      mode: "single-branch",
      siblingBranches: [],
      hostPlatform: "win32",
    });

    assert.ok(plan.commands.map((command) => command.join(" ")).includes(
      "docker build --target build -t dpf-local-integration-feat-build-studio-decision-skills-slice-1-build .",
    ));
    assert.ok(!plan.commands.map((command) => command.join(" ")).join("\n").includes(
      "exec next build",
    ));
  });

  it("gives Windows web typecheck the same V8 heap headroom as host-next", () => {
    const plan = createLocalIntegrationPlan({
      candidateBranch: "fix/windows-typecheck-heap",
      mode: "single-branch",
      siblingBranches: [],
      hostPlatform: "win32",
    });

    assert.ok(plan.commands.map((command) => command.join(" ")).includes(
      "node scripts/run-with-node-options.mjs --max-old-space-size=8192 -- pnpm --filter web typecheck",
    ));
    assert.ok(!plan.commands.map((command) => command.join(" ")).includes(
      "pnpm --filter web typecheck",
    ));
  });
});

describe("createLocalIntegrationPlan migrate-deploy opt-in (BI-157DC9B2)", () => {
  it("inserts prisma migrate deploy after freshness and before vitest when includeMigrateDeploy is set", () => {
    const plan = createLocalIntegrationPlan({
      candidateBranch: "feat/x",
      mode: "single-branch",
      siblingBranches: [],
      hostPlatform: "linux",
      includeMigrateDeploy: true,
    });
    const commands = plan.commands.map((command) => command.join(" "));
    const migrateIndex = commands.indexOf("pnpm --filter @dpf/db exec prisma migrate deploy");
    const freshnessIndex = commands.findIndex((c) => c.includes("sandbox-freshness-preflight.mjs"));
    const vitestIndex = commands.findIndex((c) => c.includes("vitest run"));
    assert.ok(migrateIndex > freshnessIndex, "migrate deploy must run after deps convergence");
    assert.ok(migrateIndex < vitestIndex, "migrate deploy must run before the suite");
  });

  it("omits migrate deploy by default (no DB resolved)", () => {
    const plan = createLocalIntegrationPlan({
      candidateBranch: "feat/x",
      mode: "single-branch",
      siblingBranches: [],
      hostPlatform: "linux",
    });
    assert.ok(!plan.commands.map((command) => command.join(" ")).some((c) => c.includes("migrate deploy")));
  });
});
