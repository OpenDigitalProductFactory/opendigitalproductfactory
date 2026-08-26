// Unit tests for the sandbox freshness decision core (BI-ECDF9520).
// node --test scripts/lib/sandbox-freshness.test.mjs — no docker/daemon needed.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  CRITICAL_PACKAGES,
  EXIT_CHILD_SIGNAL_DEATH,
  EXIT_GREEN,
  EXIT_SANDBOX_DRIFT,
  EXIT_SANDBOX_NOT_READY,
  baseVersion,
  classifyGateOutcome,
  detectInstallProcesses,
  evaluateFreshness,
  exitCodeForVerdict,
  isPnpmInstallCommand,
  parseEtimeMinutes,
  parseLockedVersion,
  parseWorkspacePackageGlobs,
  shouldEscalateConvergence,
  shouldForceConvergenceAfterInstall,
  stalePackagePathsForRelink,
} from "./sandbox-freshness.mjs";

const LOCKFILE = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    devDependencies:
      typescript:
        specifier: ^5.9.3
        version: 5.9.3

  apps/web:
    dependencies:
      next:
        specifier: ^16.2.9
        version: 16.2.9(@babel/core@7.29.7)(@opentelemetry/api@1.9.1)(react-dom@19.2.7(react@19.2.7))(react@19.2.7)
      react:
        specifier: 19.2.7
        version: 19.2.7
      react-dom:
        specifier: 19.2.7
        version: 19.2.7(react@19.2.7)
      vitest:
        specifier: ^4.1.10
        version: 4.1.10(@types/node@26.1.1)(vite@8.1.4)

  packages/db:
    devDependencies:
      prisma:
        specifier: ^6.19.1
        version: 6.19.1(typescript@5.9.3)

packages:

  next@16.2.9:
    resolution: {integrity: sha512-x}
`;

test("baseVersion strips pnpm peer suffixes", () => {
  assert.equal(baseVersion("16.2.9(@babel/core@7.29.7)(react@19.2.7)"), "16.2.9");
  assert.equal(baseVersion("5.9.3"), "5.9.3");
  assert.equal(baseVersion(undefined), "");
});

test("parseLockedVersion reads importer-scoped resolved versions", () => {
  assert.equal(parseLockedVersion(LOCKFILE, "apps/web", "next"), "16.2.9");
  assert.equal(parseLockedVersion(LOCKFILE, "apps/web", "react"), "19.2.7");
  assert.equal(parseLockedVersion(LOCKFILE, "apps/web", "react-dom"), "19.2.7");
  assert.equal(parseLockedVersion(LOCKFILE, "apps/web", "vitest"), "4.1.10");
  assert.equal(parseLockedVersion(LOCKFILE, ".", "typescript"), "5.9.3");
  assert.equal(parseLockedVersion(LOCKFILE, "packages/db", "prisma"), "6.19.1");
  // Not in that importer / not in the file at all.
  assert.equal(parseLockedVersion(LOCKFILE, "apps/web", "typescript"), "");
  assert.equal(parseLockedVersion(LOCKFILE, "apps/web", "left-pad"), "");
  // Must not leak into the top-level packages: section.
  assert.equal(parseLockedVersion(LOCKFILE, "packages", "next"), "");
});

test("critical package sentinels include the unit-test runner used by local-CI", () => {
  const vitest = CRITICAL_PACKAGES.find((pkg) => pkg.name === "vitest");
  assert.ok(vitest, "vitest must be checked before recording local-CI test evidence");
  assert.ok(vitest.importers.includes("apps/web"));
});

test("isPnpmInstallCommand is token-exact", () => {
  assert.equal(isPnpmInstallCommand("node /usr/lib/node_modules/pnpm/bin/pnpm.cjs install --frozen-lockfile"), true);
  assert.equal(isPnpmInstallCommand("pnpm i"), true);
  assert.equal(isPnpmInstallCommand("pnpm --filter web install"), true);
  assert.equal(isPnpmInstallCommand("pnpm --filter web exec vitest run -i"), false);
  assert.equal(isPnpmInstallCommand("pnpm run install:hooks"), false);
  assert.equal(isPnpmInstallCommand("pnpm exec next build"), false);
  assert.equal(isPnpmInstallCommand("/bin/sh -c ./installer.sh"), false);
});

test("detectInstallProcesses parses ps output and excludes self", () => {
  const ps = [
    "  123 01:02:03 node /usr/lib/node_modules/pnpm/bin/pnpm.cjs install --frozen-lockfile",
    "  456 05:00 pnpm --filter web exec next build",
    "  789 2-03:04:05 pnpm install",
    "  999 00:10 pnpm i --prod",
  ].join("\n");
  const found = detectInstallProcesses(ps, { selfPids: [999] });
  assert.deepEqual(found.map((p) => p.pid), [123, 789]);
  assert.equal(found[0].etimeMinutes, 62);
  assert.equal(found[1].etimeMinutes, 2 * 24 * 60 + 3 * 60 + 4);
});

test("parseEtimeMinutes handles mm:ss, hh:mm:ss and dd-hh:mm:ss", () => {
  assert.equal(parseEtimeMinutes("00:42"), 0);
  assert.equal(parseEtimeMinutes("12:00"), 12);
  assert.equal(parseEtimeMinutes("01:30:00"), 90);
  assert.equal(parseEtimeMinutes("1-00:05:00"), 1445);
  assert.equal(parseEtimeMinutes("garbage"), 0);
});

function baseState(overrides = {}) {
  return {
    requestedBranch: "local-integration/feat-x",
    actualBranch: "local-integration/feat-x",
    requestedSha: "",
    actualSha: "abc123",
    nodeModulesPresent: true,
    installedLockPresent: true,
    packages: [
      { name: "next", importer: "apps/web", lockedVersion: "16.2.9", installedLockVersion: "16.2.9", resolvedVersion: "16.2.9", linkTarget: "", missing: false },
      { name: "react", importer: "apps/web", lockedVersion: "19.2.7", installedLockVersion: "19.2.7", resolvedVersion: "19.2.7", linkTarget: "", missing: false },
    ],
    installProcesses: [],
    ...overrides,
  };
}

test("evaluateFreshness is green when links match the lockfile", () => {
  const { verdict, failures } = evaluateFreshness(baseState());
  assert.equal(verdict, "green");
  assert.deepEqual(failures, []);
});

test("evaluateFreshness flags the incident shape: stale next link vs newer lockfile", () => {
  const state = baseState();
  state.packages[0] = {
    name: "next",
    importer: "apps/web",
    lockedVersion: "16.2.9",
    installedLockVersion: "16.2.9",
    resolvedVersion: "16.2.7",
    linkTarget: "../../../node_modules/.pnpm/next@16.2.7_hash/node_modules/next",
    missing: false,
  };
  const { verdict, failures } = evaluateFreshness(state);
  assert.equal(verdict, "sandbox_drift");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].kind, "version_drift");
  assert.match(failures[0].message, /16\.2\.7/);
  assert.match(failures[0].message, /16\.2\.9/);
  assert.match(failures[0].message, /next@16\.2\.7/);
});

test("evaluateFreshness flags stale vitest before a missing CLI chunk becomes product evidence", () => {
  const state = baseState();
  state.packages.push({
    name: "vitest",
    importer: "apps/web",
    lockedVersion: "4.1.10",
    installedLockVersion: "4.1.10",
    resolvedVersion: "4.1.9",
    linkTarget: "../../../node_modules/.pnpm/vitest@4.1.9_hash/node_modules/vitest",
    resolvedFrom: "/sandbox/node_modules/vitest",
    missing: false,
  });
  const { verdict, failures } = evaluateFreshness(state);
  assert.equal(verdict, "sandbox_drift");
  assert.ok(failures.some((failure) => failure.kind === "version_drift" && failure.package === "vitest"));
});

test("evaluateFreshness flags broken package entrypoints as sandbox drift", () => {
  const state = baseState();
  state.packages.push({
    name: "vitest",
    importer: "apps/web",
    lockedVersion: "4.1.10",
    installedLockVersion: "4.1.10",
    resolvedVersion: "4.1.10",
    missingEntrypointImports: ["dist/chunks/cac.missing.js"],
    missing: false,
  });
  const { verdict, failures } = evaluateFreshness(state);
  assert.equal(verdict, "sandbox_drift");
  assert.ok(failures.some((failure) => failure.kind === "package_broken" && failure.package === "vitest"));
});


test("stalePackagePathsForRelink returns only stale package links inside sandbox node_modules", () => {
  const root = path.resolve("tmp", "dpf-local-ci");
  const insideVitest = path.join(root, "node_modules", "vitest");
  const outsideNext = path.resolve(root, "..", "outside", "node_modules", "next");
  const state = baseState({
    packages: [
      {
        name: "vitest",
        importer: "apps/web",
        lockedVersion: "4.1.10",
        resolvedVersion: "4.1.9",
        resolvedFrom: insideVitest,
      },
      {
        name: "next",
        importer: "apps/web",
        lockedVersion: "16.2.9",
        resolvedVersion: "16.2.7",
        resolvedFrom: outsideNext,
      },
      {
        name: "react",
        importer: "apps/web",
        lockedVersion: "19.2.7",
        resolvedVersion: "19.2.7",
        resolvedFrom: path.join(root, "node_modules", "react"),
      },
    ],
  });
  assert.deepEqual(stalePackagePathsForRelink(state, root), [insideVitest]);
});

test("shouldForceConvergenceAfterInstall is limited to dependency drift after install", () => {
  assert.equal(shouldForceConvergenceAfterInstall({ verdict: "green", failures: [] }), false);
  assert.equal(shouldForceConvergenceAfterInstall({
    verdict: "sandbox_drift",
    failures: [{ kind: "version_drift", package: "vitest" }],
  }), true);
  assert.equal(shouldForceConvergenceAfterInstall({
    verdict: "sandbox_not_ready",
    failures: [{ kind: "install_in_progress" }],
  }), false);
});

test("shouldEscalateConvergence also escalates on a failed install with a green re-check (stale bin, BI-675D9085)", () => {
  // The old gate only saw tracked drift; a stale .bin fails the install while
  // every link resolves to the locked version, so the re-check is green.
  const green = { verdict: "green", failures: [] };
  assert.equal(shouldEscalateConvergence(green, { attempted: true, exitCode: 1 }), true);
  // A clean install (exit 0) that reached green must NOT escalate — the ladder stops.
  assert.equal(shouldEscalateConvergence(green, { attempted: true, exitCode: 0 }), false);
  // Tracked drift still escalates regardless of the install's exit code.
  const drift = { verdict: "sandbox_drift", failures: [{ kind: "version_drift", package: "prisma" }] };
  assert.equal(shouldEscalateConvergence(drift, { attempted: true, exitCode: 0 }), true);
  // A skipped/absent attempt on a green re-check is not an escalation signal.
  assert.equal(shouldEscalateConvergence(green, { attempted: false, exitCode: 1 }), false);
  assert.equal(shouldEscalateConvergence(green, null), false);
  assert.equal(shouldEscalateConvergence(green, undefined), false);
});

test("parseWorkspacePackageGlobs reads the pnpm-workspace.yaml package list", () => {
  const yaml = `packages:\n  - "apps/*"\n  - "packages/*"\n  - services/adp\n  - '!**/__fixtures__/**'\noverrides:\n  react: 19.2.3\n`;
  assert.deepEqual(parseWorkspacePackageGlobs(yaml), ["apps/*", "packages/*", "services/adp"]);
  assert.deepEqual(parseWorkspacePackageGlobs(""), []);
  assert.deepEqual(parseWorkspacePackageGlobs("overrides:\n  react: 19.2.3\n"), []);
  // A column-0 comment or a blank line inside the block must NOT drop the
  // entries after it, and an inline trailing comment on an entry is stripped —
  // otherwise those packages' node_modules would go un-reset (partial drift).
  const withComments = `packages:\n  - "apps/*"\n# a comment at column 0\n\n  - packages/* # inline note\n  - services/adp\noverrides:\n  react: 19.2.3\n`;
  assert.deepEqual(parseWorkspacePackageGlobs(withComments), ["apps/*", "packages/*", "services/adp"]);
});

test("evaluateFreshness flags a whole-lockfile mismatch the sentinels can't see (new dep added)", () => {
  // A branch that ADDS a dependency leaves every sentinel package green while
  // the installed graph predates the lockfile — the undici/integration-shared
  // incident shape (BI-9DED0CE8 gate runs).
  const { verdict, failures } = evaluateFreshness(baseState({ lockfilesDiffer: true }));
  assert.equal(verdict, "sandbox_drift");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].kind, "installed_lock_stale");
  assert.match(failures[0].message, /older lockfile/);
});

test("evaluateFreshness flags a missing workspace link", () => {
  const state = baseState();
  state.packages[0] = { name: "next", importer: "apps/web", lockedVersion: "16.2.9", installedLockVersion: "", resolvedVersion: "", linkTarget: "", missing: true };
  const { verdict, failures } = evaluateFreshness(state);
  assert.equal(verdict, "sandbox_drift");
  assert.equal(failures[0].kind, "package_missing");
});

test("evaluateFreshness flags an install that ran against an older lockfile", () => {
  const state = baseState();
  state.packages[0].installedLockVersion = "16.2.7";
  state.packages[0].resolvedVersion = "16.2.9";
  const { verdict, failures } = evaluateFreshness(state);
  assert.equal(verdict, "sandbox_drift");
  assert.equal(failures[0].kind, "installed_lock_stale");
});

test("evaluateFreshness classifies a running install as not-ready, not drift", () => {
  const state = baseState({ installProcesses: [{ pid: 42, etime: "45:00", etimeMinutes: 45, command: "pnpm install" }] });
  const { verdict, failures } = evaluateFreshness(state);
  assert.equal(verdict, "sandbox_not_ready");
  assert.equal(failures[0].kind, "install_in_progress");
});

test("evaluateFreshness classifies missing node_modules as not-ready", () => {
  const state = baseState({ nodeModulesPresent: false });
  assert.equal(evaluateFreshness(state).verdict, "sandbox_not_ready");
});

test("evaluateFreshness flags checkout mismatch", () => {
  const state = baseState({ actualBranch: "some-other-branch" });
  const { verdict, failures } = evaluateFreshness(state);
  assert.equal(verdict, "sandbox_drift");
  assert.equal(failures[0].kind, "checkout_mismatch");
});

test("exitCodeForVerdict maps verdicts to reserved exit codes", () => {
  assert.equal(exitCodeForVerdict("green"), EXIT_GREEN);
  assert.equal(exitCodeForVerdict("sandbox_drift"), EXIT_SANDBOX_DRIFT);
  assert.equal(exitCodeForVerdict("sandbox_not_ready"), EXIT_SANDBOX_NOT_READY);
});

test("classifyGateOutcome refuses to record a product failure on a red sandbox", () => {
  const outcome = classifyGateOutcome({ freshnessVerdict: "sandbox_drift", gateExitCode: 1 });
  assert.equal(outcome.status, "blocked_sandbox_drift");
  assert.equal(outcome.gatePassed, false);
  assert.equal(outcome.productEvidence, false);
  assert.match(outcome.summary, /NOT product build evidence/);
});

test("classifyGateOutcome blocks on preflight drift exit codes even without a report", () => {
  for (const code of [EXIT_SANDBOX_DRIFT, EXIT_SANDBOX_NOT_READY]) {
    const outcome = classifyGateOutcome({ freshnessVerdict: "", gateExitCode: code });
    assert.equal(outcome.status, "blocked_sandbox_drift");
    assert.equal(outcome.productEvidence, false);
  }
});

test("classifyGateOutcome passes/fails normally when the sandbox is green", () => {
  assert.deepEqual(classifyGateOutcome({ freshnessVerdict: "green", gateExitCode: 0 }).status, "passed");
  const failed = classifyGateOutcome({ freshnessVerdict: "green", gateExitCode: 1 });
  assert.equal(failed.status, "failed");
  assert.equal(failed.productEvidence, true);
});

test("classifyGateOutcome treats pnpm lifecycle exit 3 as product evidence when freshness is green", () => {
  const failed = classifyGateOutcome({ freshnessVerdict: "green", gateExitCode: EXIT_SANDBOX_DRIFT });
  assert.equal(failed.status, "failed");
  assert.equal(failed.productEvidence, true);
});

test("classifyGateOutcome reserves exit 5 for control-plane starvation", () => {
  const outcome = classifyGateOutcome({ freshnessVerdict: "green", gateExitCode: 5 });
  assert.equal(outcome.status, "blocked_control_plane_starvation");
  assert.equal(outcome.gatePassed, false);
  assert.equal(outcome.productEvidence, false);
  assert.match(outcome.summary, /control-plane/i);
});

test("classifyGateOutcome distinguishes repeated Vitest runner termination from a product failure", () => {
  const outcome = classifyGateOutcome({ freshnessVerdict: "green", gateExitCode: 86 });
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.gatePassed, false);
  assert.equal(outcome.productEvidence, false);
  assert.match(outcome.summary, /runner evidence, NOT a product test failure/);
});

// BI-F22B4EEE. A child killed by a signal is infrastructure evidence, not a
// product build failure. Before this, `result.status ?? 1` collapsed SIGKILL
// into exit 1 and the gate recorded "local-CI lease gate failed." — a product
// verdict for a host that ran out of memory.
test("a signal-killed child is blocked, not failed", () => {
  const outcome = classifyGateOutcome({ freshnessVerdict: "green", gateExitCode: EXIT_CHILD_SIGNAL_DEATH });

  assert.equal(outcome.status, "blocked_child_signal_death");
  assert.equal(outcome.gatePassed, false);
  assert.equal(outcome.productEvidence, false, "a signal death must never count as product evidence");
  assert.match(outcome.summary, /NOT a product build failure/);
});

test("the signal-death code does not collide with the other blocked codes", () => {
  const codes = new Set([
    EXIT_GREEN,
    EXIT_SANDBOX_DRIFT,
    EXIT_SANDBOX_NOT_READY,
    EXIT_CHILD_SIGNAL_DEATH,
  ]);
  assert.equal(codes.size, 4, "each outcome needs its own exit code to stay distinguishable");
});

test("an ordinary non-zero exit is still a product failure", () => {
  // The point of the change is to separate the two, not to make every failure
  // look like infrastructure.
  const outcome = classifyGateOutcome({ freshnessVerdict: "green", gateExitCode: 1 });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.productEvidence, true);
});
