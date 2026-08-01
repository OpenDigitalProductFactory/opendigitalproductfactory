// node --test (was vitest, which no CI job executed for scripts/ — converted
// alongside BI-B5011ACE so the plan contract actually gates in the bare-runner
// CI test job).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createLocalIntegrationPlan,
  createProductionArtifactIdentity,
  createToolchainFingerprint,
  createCommandFailureDiagnostics,
  executeLocalIntegrationPlan,
  resolveGitRevision,
  resolveCommandInvocation,
} from "./local-integration-ci.mjs";

describe("createLocalIntegrationPlan", () => {
  it("binds the production artifact to the exact integration tree", () => {
    assert.deepEqual(createProductionArtifactIdentity({
      buildStrategy: "docker-build",
      integrationTreeSha: "tree-abc",
      dockerImageTag: "dpf-local-integration-slot-1-feat-safe-build",
      dockerImageId: "sha256:image-123",
    }), {
      kind: "docker-image",
      integrationTreeSha: "tree-abc",
      identity: "sha256:image-123",
      locator: "dpf-local-integration-slot-1-feat-safe-build",
    });
    assert.deepEqual(createProductionArtifactIdentity({
      buildStrategy: "host-next",
      integrationTreeSha: "tree-def",
      nextBuildId: "next-build-456",
    }), {
      kind: "next-build",
      integrationTreeSha: "tree-def",
      identity: "next-build-456",
      locator: "apps/web/.next",
    });
  });

  it("creates a stable toolchain fingerprint for local-CI evidence (BI-76551B2D)", () => {
    const evidence = createToolchainFingerprint({
      buildStrategy: "host-next",
      nodeVersion: "v24.0.0",
      pnpmVersion: "10.14.0",
      gitVersion: "git version 2.50.1",
      platform: "linux",
      arch: "arm64",
      lockfileSha256: "lock-sha",
      nodeEnv: "NODE_ENV=production",
      nodeOptions: "NODE_OPTIONS=--max-old-space-size=8192",
      testNodeOptions: "NODE_OPTIONS=--no-experimental-webstorage",
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
      nodeEnv: "NODE_ENV=production",
      nodeOptions: "NODE_OPTIONS=--max-old-space-size=8192",
      testNodeOptions: "NODE_OPTIONS=--no-experimental-webstorage",
    });
    assert.equal(evidence.toolchainFingerprint, createToolchainFingerprint({
      arch: "arm64",
      buildStrategy: "host-next",
      gitVersion: "git version 2.50.1",
      lockfileSha256: "lock-sha",
      nodeEnv: "NODE_ENV=production",
      nodeOptions: "NODE_OPTIONS=--max-old-space-size=8192",
      testNodeOptions: "NODE_OPTIONS=--no-experimental-webstorage",
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
      "node scripts/ci-evidence-plan.mjs --event local-ci --base origin/main --head HEAD",
      "node scripts/sandbox-freshness-preflight.mjs --converge --branch local-integration/doc-build-studio-decision-skill-packs",
      "pnpm --filter @dpf/db exec prisma generate",
      "node scripts/gen-doc-index.mjs --check",
      "node scripts/check-doc-links.mjs",
      "pnpm install --frozen-lockfile --ignore-scripts --filter @dpf/repo-guard-runtime --config.confirmModulesPurge=false",
      "node scripts/check-guards.mjs",
      "env NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter web typecheck",
      "env NODE_OPTIONS=--no-experimental-webstorage pnpm --filter web exec vitest run --maxWorkers=4",
      "env NODE_ENV=production NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter web exec next build",
    ]);
  });

  it("routes Windows production builds through the bounded watchdog wrapper", () => {
    const plan = createLocalIntegrationPlan({
      candidateBranch: "fix/control-plane",
      mode: "single-branch",
      siblingBranches: [],
      hostPlatform: "win32",
      slotKey: "slot-0",
    });
    assert.equal(plan.commands.at(-1).join(" "),
      "node scripts/local-ci-bounded-build.mjs --tag dpf-local-integration-slot-0-fix-control-plane-build --slot-key slot-0 --candidate fix/control-plane");
  });

  it("scopes integration refs and freshness to the admitted slot", () => {
    const plan = createLocalIntegrationPlan({
      candidateBranch: "feat/slot-safe-gate",
      mode: "single-branch",
      siblingBranches: [],
      hostPlatform: "linux",
      slotKey: "slot-1",
    });

    assert.equal(
      plan.integrationBranch,
      "local-integration/slot-1/feat-slot-safe-gate",
    );
    assert.ok(plan.commands.map((command) => command.join(" ")).includes(
      "node scripts/sandbox-freshness-preflight.mjs --converge --branch local-integration/slot-1/feat-slot-safe-gate --slot-key slot-1",
    ));
  });

  it("disables Node host web-storage before Vitest starts jsdom workers (BI-3E989BEA)", () => {
    const plan = createLocalIntegrationPlan({
      candidateBranch: "fix/node-26-webstorage",
      mode: "single-branch",
      siblingBranches: [],
      hostPlatform: "linux",
    });

    assert.ok(plan.commands.map((command) => command.join(" ")).includes(
      "env NODE_OPTIONS=--no-experimental-webstorage pnpm --filter web exec vitest run --maxWorkers=4",
    ));
  });

  it("caps Vitest workers in local-CI for repeatable sandbox evidence", () => {
    const plan = createLocalIntegrationPlan({
      candidateBranch: "feat/stabilize-sandbox-vitest",
      mode: "single-branch",
      siblingBranches: [],
      hostPlatform: "linux",
    });

    const vitestCommand = plan.commands.map((command) => command.join(" ")).find((command) => (
      command.includes("pnpm --filter web exec vitest run")
    ));
    assert.equal(
      vitestCommand,
      "env NODE_OPTIONS=--no-experimental-webstorage pnpm --filter web exec vitest run --maxWorkers=4",
    );
  });

  it("uses the runner-resolved accepted base without fetching a second time", () => {
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
    const evidencePlanIndex = commands.findIndex((c) => c.includes("ci-evidence-plan.mjs"));
    const lastMergeIndex = commands.map((c, i) => (c.startsWith("git merge") ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    const firstGateIndex = commands.findIndex((c) => c.includes("vitest run"));
    assert.ok(evidencePlanIndex > lastMergeIndex);
    assert.ok(evidencePlanIndex < preflightIndex);
    assert.ok(preflightIndex > lastMergeIndex);
    assert.ok(preflightIndex < firstGateIndex);
  });

  it("writes the shadow plan beside governed local-CI metadata when requested", () => {
    const plan = createLocalIntegrationPlan({
      candidateBranch: "feat/x",
      mode: "single-branch",
      siblingBranches: [],
      hostPlatform: "linux",
      evidencePlanOutput: "artifacts/dpf-ci-evidence-plan.json",
    });

    assert.ok(plan.commands.map((command) => command.join(" ")).includes(
      "node scripts/ci-evidence-plan.mjs --event local-ci --base origin/main --head HEAD --output artifacts/dpf-ci-evidence-plan.json",
    ));
  });

  it("installs the pinned repo-guard runtime before the guard loop", () => {
    const plan = createLocalIntegrationPlan({
      candidateBranch: "feat/x",
      mode: "single-branch",
      siblingBranches: [],
      hostPlatform: "linux",
    });
    const commands = plan.commands.map((command) => command.join(" "));
    const runtimeInstallIndex = commands.indexOf(
      "pnpm install --frozen-lockfile --ignore-scripts --filter @dpf/repo-guard-runtime --config.confirmModulesPurge=false",
    );
    const repoGuardIndex = commands.indexOf("node scripts/check-guards.mjs");
    assert.ok(runtimeInstallIndex > -1, "local-CI must converge the isolated repo-guard runtime");
    assert.ok(runtimeInstallIndex < repoGuardIndex, "repo-guard runtime must be ready before check-guards runs");
  });

  it("runs fast PR guard parity before the expensive test/build gates", () => {
    const plan = createLocalIntegrationPlan({
      candidateBranch: "feat/x",
      mode: "single-branch",
      siblingBranches: [],
      hostPlatform: "linux",
    });
    const commands = plan.commands.map((command) => command.join(" "));
    const docIndexIndex = commands.indexOf("node scripts/gen-doc-index.mjs --check");
    const docsLinkIndex = commands.indexOf("node scripts/check-doc-links.mjs");
    const runtimeInstallIndex = commands.indexOf(
      "pnpm install --frozen-lockfile --ignore-scripts --filter @dpf/repo-guard-runtime --config.confirmModulesPurge=false",
    );
    const repoGuardIndex = commands.indexOf("node scripts/check-guards.mjs");
    const vitestIndex = commands.findIndex((c) => c.includes("vitest run"));
    assert.ok(docIndexIndex > -1);
    assert.ok(docsLinkIndex > docIndexIndex);
    assert.ok(runtimeInstallIndex > docsLinkIndex);
    assert.ok(repoGuardIndex > runtimeInstallIndex);
    assert.ok(repoGuardIndex < vitestIndex);
  });

  it("fails fast on typecheck before spending the sandbox on exhaustive tests", () => {
    const plan = createLocalIntegrationPlan({
      candidateBranch: "feat/x",
      mode: "single-branch",
      siblingBranches: [],
      hostPlatform: "linux",
    });
    const commands = plan.commands.map((command) => command.join(" "));
    const typecheckIndex = commands.indexOf(
      "env NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter web typecheck",
    );
    const vitestIndex = commands.findIndex((command) => command.includes("vitest run"));
    const buildIndex = commands.findIndex((command) => command.includes("next build"));

    assert.ok(typecheckIndex > -1, "typecheck must remain in the local-CI plan");
    assert.ok(vitestIndex > -1, "exhaustive Vitest must remain in the local-CI plan");
    assert.ok(buildIndex > -1, "the production build must remain in the local-CI plan");
    assert.ok(typecheckIndex < vitestIndex, "typecheck must fail before exhaustive Vitest starts");
    assert.ok(vitestIndex < buildIndex, "exhaustive Vitest must still precede the production build");
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

  it("uses a bounded Docker production build on Windows hosts", () => {
    const plan = createLocalIntegrationPlan({
      candidateBranch: "feat/build-studio-decision-skills-slice-1",
      mode: "single-branch",
      siblingBranches: [],
      hostPlatform: "win32",
    });

    assert.ok(plan.commands.map((command) => command.join(" ")).includes(
      "node scripts/local-ci-bounded-build.mjs --tag dpf-local-integration-feat-build-studio-decision-skills-slice-1-build --slot-key slot-0 --candidate feat/build-studio-decision-skills-slice-1",
    ));
    assert.ok(!plan.commands.map((command) => command.join(" ")).join("\n").includes(
      "exec next build",
    ));
    assert.ok(plan.commands.map((command) => command.join(" ")).includes(
      "env NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter web typecheck",
    ));
  });

  it("resolves environment-prefixed commands without relying on a host env binary", () => {
    const invocation = resolveCommandInvocation(
      ["env", "NODE_OPTIONS=--max-old-space-size=8192", "pnpm", "--filter", "web", "typecheck"],
      { PATH: "test-path", NODE_OPTIONS: "--trace-warnings" },
    );

    assert.equal(invocation.command, "pnpm");
    assert.deepEqual(invocation.args, ["--filter", "web", "typecheck"]);
    assert.deepEqual(invocation.env, {
      PATH: "test-path",
      NODE_OPTIONS: "--max-old-space-size=8192",
    });
  });

  it("preserves plain commands and their base environment", () => {
    const baseEnv = { PATH: "test-path" };
    assert.deepEqual(resolveCommandInvocation(["pnpm", "test"], baseEnv), {
      command: "pnpm",
      args: ["test"],
      env: baseEnv,
    });
  });

  it("supports multiple, empty, and embedded-equals environment values", () => {
    assert.deepEqual(resolveCommandInvocation([
      "env",
      "EMPTY=",
      "TOKEN=left=right",
      "pnpm",
      "test",
    ], { PATH: "test-path" }), {
      command: "pnpm",
      args: ["test"],
      env: { PATH: "test-path", EMPTY: "", TOKEN: "left=right" },
    });
  });

  it("rejects missing executables and malformed environment assignments", () => {
    assert.throws(
      () => resolveCommandInvocation(["env", "NODE_OPTIONS=--trace-warnings"]),
      /missing an executable/,
    );
    assert.throws(
      () => resolveCommandInvocation(["env", "1BAD=value", "pnpm", "test"]),
      /invalid environment assignment/,
    );
  });

  it("reports secret-safe child-process failure diagnostics", () => {
    assert.deepEqual(createCommandFailureDiagnostics({
      invocation: {
        command: "pnpm",
        args: ["--token", "sensitive", "--filter", "web", "exec", "vitest", "run"],
      },
      result: {
        status: 1,
        signal: null,
        error: null,
      },
      elapsedMs: 1180,
    }), {
      command: "pnpm",
      args: ["--token", "[REDACTED]", "--filter", "web", "exec", "vitest", "run"],
      elapsedMs: 1180,
      status: 1,
      signal: null,
      error: null,
    });
  });
});

describe("executeLocalIntegrationPlan", () => {
  it("does not launch exhaustive tests or a production build after typecheck fails", () => {
    const launched = [];
    const errors = [];
    const plan = createLocalIntegrationPlan({
      candidateBranch: "fix/controlled-typecheck-red",
      mode: "single-branch",
      siblingBranches: [],
      hostPlatform: "win32",
    });

    const result = executeLocalIntegrationPlan(plan, {
      baseEnv: {},
      platform: "win32",
      now: () => 100,
      log: () => {},
      error: (message) => errors.push(message),
      spawnSyncImpl(command, args) {
        launched.push([command, ...args]);
        return {
          status: command === "pnpm" && args.includes("typecheck") ? 2 : 0,
          signal: null,
        };
      },
    });

    assert.equal(result.status, 2);
    assert.deepEqual(
      launched.at(-1),
      ["pnpm", "--filter", "web", "typecheck"],
      "typecheck must be the terminal launched command",
    );
    assert.equal(
      launched.some((command) => command.includes("vitest")),
      false,
      "Vitest must not launch after a red typecheck",
    );
    assert.equal(
      launched.some((command) => command[0] === "docker" || command.includes("next")),
      false,
      "the production build must not launch after a red typecheck",
    );
    assert.match(errors.join("\n"), /command-failure/);
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

describe("resolveGitRevision", () => {
  it("passes revision expressions directly to Git without a Windows shell", () => {
    const calls = [];
    const revision = resolveGitRevision("HEAD^{tree}", {
      spawnSyncImpl(command, args, options) {
        calls.push({ command, args, options });
        return { status: 0, stdout: "tree-sha\n", stderr: "" };
      },
    });

    assert.equal(revision, "tree-sha");
    assert.equal(calls[0].command, "git");
    assert.deepEqual(calls[0].args, ["rev-parse", "--verify", "HEAD^{tree}"]);
    assert.equal(calls[0].options.shell, false);
  });

  it("reports the rejected revision when Git fails", () => {
    assert.throws(() => resolveGitRevision("missing", {
      spawnSyncImpl: () => ({ status: 128, stdout: "", stderr: "fatal: bad revision\n" }),
    }), /failed to resolve missing: fatal: bad revision/);
  });
});
