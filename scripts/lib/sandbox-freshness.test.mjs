// Unit tests for the sandbox freshness decision core (BI-ECDF9520).
// node --test scripts/lib/sandbox-freshness.test.mjs — no docker/daemon needed.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  fallbackStatusForUnknown,
  isLocalIntegrationStatus,
} from "./local-integration-status.mjs";
import {
  CRITICAL_PACKAGES,
  EXIT_CHILD_SIGNAL_DEATH,
  EXIT_VITEST_RUNNER_TERMINATION,
  EXIT_CONTROL_PLANE_STARVATION,
  EXIT_BUILDER_RESOURCE_EXHAUSTED,
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
  parseLsofCwd,
  readProcessCwd,
  resolveInstallWaitConfig,
  stalePackagePathsForRelink,
  waitForSandboxInstalls,
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

// BI-8DC6F267: the duplicate-install guard protects ONE node_modules. An
// install in another worktree does not touch this sandbox, so only installs
// whose working directory is the sandbox root (or inside it) count.
const SCOPE_PS = [
  "  101 01:46 pnpm install",
  "  102 00:30 pnpm install --frozen-lockfile",
  "  103 00:12 pnpm --filter web install",
  "  104 00:05 pnpm install",
  "  105 00:05 pnpm install",
].join("\n");
const SCOPE_CWDS = {
  101: "/work/worktrees/other-session",
  102: "/work/sandbox",
  103: "/work/sandbox/apps/web",
  104: "/work/sandbox-2",
  // 105: cwd unreadable
};
const fakeReadCwd = (pid) => SCOPE_CWDS[pid] ?? null;

test("AC-1: an install running in another directory is not counted against the sandbox", () => {
  const found = detectInstallProcesses(SCOPE_PS, { rootDir: "/work/sandbox", readCwd: fakeReadCwd });
  const pids = found.map((p) => p.pid);
  assert.equal(pids.includes(101), false, "another worktree's install must not block this sandbox");
  // A sibling whose path merely starts with the sandbox path is still another directory.
  assert.equal(pids.includes(104), false, "/work/sandbox-2 is not inside /work/sandbox");
});

test("AC-2: an install running in the sandbox root or a package inside it still counts", () => {
  const found = detectInstallProcesses(SCOPE_PS, { rootDir: "/work/sandbox", readCwd: fakeReadCwd });
  const byPid = new Map(found.map((p) => [p.pid, p]));
  assert.ok(byPid.has(102), "install at the sandbox root must count");
  assert.ok(byPid.has(103), "install in a workspace package of the sandbox must count");
  assert.equal(byPid.get(102).cwd, "/work/sandbox");
});

test("AC-4: an install whose cwd cannot be read is counted (never risk a duplicate install)", () => {
  const found = detectInstallProcesses(SCOPE_PS, { rootDir: "/work/sandbox", readCwd: fakeReadCwd });
  const unknown = found.find((p) => p.pid === 105);
  assert.ok(unknown, "unreadable cwd must fall back to blocking");
  assert.equal(unknown.cwd, null);
  assert.equal(unknown.cwdUnknown, true);
  const throwing = detectInstallProcesses("  7 00:01 pnpm install", {
    rootDir: "/work/sandbox",
    readCwd: () => {
      throw new Error("EPERM");
    },
  });
  assert.deepEqual(throwing.map((p) => p.pid), [7]);
});

test("detectInstallProcesses matches the sandbox through any of its path spellings", () => {
  // macOS: the sandbox is addressed as /var/... while lsof reports /private/var/...
  const found = detectInstallProcesses("  8 00:01 pnpm install", {
    rootDir: ["/var/folders/x/sandbox", "/private/var/folders/x/sandbox"],
    readCwd: () => "/private/var/folders/x/sandbox",
  });
  assert.deepEqual(found.map((p) => p.pid), [8]);
});

test("detectInstallProcesses without a rootDir keeps the host-wide behaviour", () => {
  const found = detectInstallProcesses(SCOPE_PS);
  assert.deepEqual(found.map((p) => p.pid), [101, 102, 103, 104, 105]);
});

test("parseLsofCwd reads the name field of `lsof -a -p PID -d cwd -Fn`", () => {
  assert.equal(parseLsofCwd("p4242\nfcwd\nn/Users/me/dpf/.local-ci-runner-slot-1\n"), "/Users/me/dpf/.local-ci-runner-slot-1");
  assert.equal(parseLsofCwd("n/path with spaces/x\n"), "/path with spaces/x");
  assert.equal(parseLsofCwd(""), null);
  assert.equal(parseLsofCwd("p4242\n"), null);
});

test("readProcessCwd uses lsof on macOS", () => {
  const calls = [];
  const cwd = readProcessCwd(4242, {
    platform: "darwin",
    spawn: (cmd, args) => {
      calls.push([cmd, ...args]);
      return { status: 0, stdout: "p4242\nfcwd\nn/work/sandbox\n" };
    },
    readlink: () => {
      throw new Error("must not read /proc on macOS");
    },
  });
  assert.equal(cwd, "/work/sandbox");
  assert.deepEqual(calls, [["lsof", "-a", "-p", "4242", "-d", "cwd", "-Fn"]]);
});

test("readProcessCwd reads /proc/PID/cwd on Linux, falling back to lsof", () => {
  assert.equal(
    readProcessCwd(77, {
      platform: "linux",
      readlink: (p) => {
        assert.equal(p, "/proc/77/cwd");
        return "/work/sandbox";
      },
      spawn: () => {
        throw new Error("lsof not needed when /proc answers");
      },
    }),
    "/work/sandbox",
  );
  assert.equal(
    readProcessCwd(77, {
      platform: "linux",
      readlink: () => {
        throw new Error("ENOENT");
      },
      spawn: () => ({ status: 0, stdout: "p77\nfcwd\nn/elsewhere\n" }),
    }),
    "/elsewhere",
  );
});

test("readProcessCwd returns null when the cwd cannot be read", () => {
  assert.equal(readProcessCwd(5, { platform: "darwin", spawn: () => ({ status: 1, stdout: "" }) }), null);
  assert.equal(readProcessCwd(5, { platform: "darwin", spawn: () => ({ error: new Error("ENOENT"), status: null }) }), null);
  assert.equal(
    readProcessCwd(5, {
      platform: "linux",
      readlink: () => {
        throw new Error("EACCES");
      },
      spawn: () => ({ status: 1, stdout: "" }),
    }),
    null,
  );
  assert.equal(readProcessCwd(5, { platform: "win32" }), null);
});

function fakeClock() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  };
}

test("AC-3: waitForSandboxInstalls waits for a same-sandbox install that finishes within the bound", async () => {
  const clock = fakeClock();
  let scans = 0;
  const running = [{ pid: 102, etime: "00:30", etimeMinutes: 0, command: "pnpm install", cwd: "/work/sandbox" }];
  const result = await waitForSandboxInstalls({
    scan: () => (++scans <= 3 ? running : []),
    timeoutMs: 600_000,
    pollMs: 5_000,
    ...clock,
  });
  assert.equal(result.timedOut, false);
  assert.equal(result.waited, true);
  assert.deepEqual(result.processes, []);
  assert.equal(result.waitedMs, 15_000);
  assert.deepEqual(result.observedPids, [102]);
});

test("waitForSandboxInstalls does not wait when nothing is running", async () => {
  const clock = fakeClock();
  const result = await waitForSandboxInstalls({ scan: () => [], timeoutMs: 600_000, pollMs: 5_000, ...clock });
  assert.equal(result.waited, false);
  assert.equal(result.timedOut, false);
  assert.equal(result.waitedMs, 0);
});

test("waitForSandboxInstalls reports a timeout when the install outlives the bound", async () => {
  const clock = fakeClock();
  const running = [{ pid: 102, etime: "45:00", etimeMinutes: 45, command: "pnpm install", cwd: "/work/sandbox" }];
  let scans = 0;
  const result = await waitForSandboxInstalls({
    scan: () => {
      scans += 1;
      return running;
    },
    timeoutMs: 20_000,
    pollMs: 5_000,
    ...clock,
  });
  assert.equal(result.timedOut, true);
  assert.deepEqual(result.processes.map((p) => p.pid), [102]);
  assert.ok(clock.now() <= 20_000, `wait must stay within its bound, slept ${clock.now()}ms`);
  assert.ok(scans <= 6, `polling must be bounded, saw ${scans} scans`);
});

test("resolveInstallWaitConfig defaults to a 10 minute bound and honours env overrides", () => {
  assert.deepEqual(resolveInstallWaitConfig({}), { timeoutMs: 600_000, pollMs: 5_000 });
  assert.deepEqual(
    resolveInstallWaitConfig({ DPF_LOCAL_CI_FRESHNESS_INSTALL_WAIT_MS: "120000", DPF_LOCAL_CI_FRESHNESS_INSTALL_POLL_MS: "250" }),
    { timeoutMs: 120_000, pollMs: 250 },
  );
  // 0 disables the wait (report not-ready immediately); junk falls back to the default.
  assert.equal(resolveInstallWaitConfig({ DPF_LOCAL_CI_FRESHNESS_INSTALL_WAIT_MS: "0" }).timeoutMs, 0);
  assert.equal(resolveInstallWaitConfig({ DPF_LOCAL_CI_FRESHNESS_INSTALL_WAIT_MS: "soon" }).timeoutMs, 600_000);
  assert.equal(resolveInstallWaitConfig({ DPF_LOCAL_CI_FRESHNESS_INSTALL_POLL_MS: "-5" }).pollMs, 5_000);
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

test("a parent SIGTERM (exit 130) is blocked, not a product FAIL (BI-8392DA16)", () => {
  const outcome = classifyGateOutcome({ freshnessVerdict: "green", gateExitCode: 130 });
  assert.equal(outcome.status, "blocked_child_signal_death");
  assert.equal(outcome.productEvidence, false);
});

test("a fenced lease (exit 75) is blocked, not a product FAIL (BI-465B3D60)", () => {
  const outcome = classifyGateOutcome({ freshnessVerdict: "green", gateExitCode: 75 });
  assert.equal(outcome.status, "blocked_control_plane_starvation");
  assert.equal(outcome.productEvidence, false);
  assert.match(outcome.summary, /fenced/i);
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

// BI-C59AC8AF. The producer and the recorder are one closed set or they drift:
// #4703 added blocked_child_signal_death to classifyGateOutcome alone, the
// recorder rejected it as invalid_status, the write was dropped, and the tree it
// ran on could never be gated again. This asserts the direction that actually
// bricks things — every status the gate can PRODUCE must be recordable.
test("every status classifyGateOutcome can emit is one the recorder accepts", () => {
  const exitCodes = [
    0,
    1,
    EXIT_SANDBOX_DRIFT,
    EXIT_SANDBOX_NOT_READY,
    EXIT_CONTROL_PLANE_STARVATION,
    EXIT_VITEST_RUNNER_TERMINATION,
    EXIT_CHILD_SIGNAL_DEATH,
    75,
    130,
    143,
  ];
  const verdicts = [null, "green", "drifted", "sandbox_not_ready"];

  const produced = new Set();
  for (const gateExitCode of exitCodes) {
    for (const freshnessVerdict of verdicts) {
      produced.add(classifyGateOutcome({ freshnessVerdict, gateExitCode }).status);
    }
  }

  assert.ok(produced.size > 0, "expected classifyGateOutcome to produce statuses");
  for (const status of produced) {
    assert.ok(
      isLocalIntegrationStatus(status),
      `classifyGateOutcome emits "${status}", which record_local_integration_result rejects. `
      + "Add it to LOCAL_INTEGRATION_STATUSES in scripts/lib/local-integration-status.mjs.",
    );
  }
});

test("a status the recorder does not know still records rather than dropping the write", () => {
  const fallback = fallbackStatusForUnknown("blocked_something_new");

  assert.equal(fallback.status, "failed");
  assert.ok(isLocalIntegrationStatus(fallback.status));
  assert.match(fallback.summaryPrefix, /BLOCKED_SOMETHING_NEW/);
  assert.match(fallback.summaryPrefix, /not product evidence/);
});

// BI-5A1FBCA6. Three different failures record blocked_control_plane_starvation:
// the watchdog seeing the shared services degrade, the builder exhausting its
// own memory cap, and a fenced lease. They have three different remedies, so
// they must not share the sentence an operator reads. The STATUS stays shared
// for now so an already-deployed portal keeps accepting the evidence write.
test("a builder that exhausted its own cap does not send the reader to Docker", () => {
  const outcome = classifyGateOutcome({
    freshnessVerdict: null,
    gateExitCode: EXIT_BUILDER_RESOURCE_EXHAUSTED,
  });
  assert.equal(outcome.status, "blocked_control_plane_starvation");
  assert.equal(outcome.gatePassed, false);
  assert.equal(outcome.productEvidence, false);
  assert.match(outcome.summary, /BUILDER's own cap/);
  assert.match(outcome.summary, /control plane was healthy/);
  assert.match(outcome.summary, /build capacity/);
});

test("a real control-plane failure still names the control plane", () => {
  const outcome = classifyGateOutcome({
    freshnessVerdict: null,
    gateExitCode: EXIT_CONTROL_PLANE_STARVATION,
  });
  assert.match(outcome.summary, /portal\/MCP\/Docker\/PostgreSQL/);
  assert.equal(outcome.productEvidence, false);
});

test("the two causes are told apart by their summaries, not by their status", () => {
  const builder = classifyGateOutcome({ freshnessVerdict: null, gateExitCode: EXIT_BUILDER_RESOURCE_EXHAUSTED });
  const plane = classifyGateOutcome({ freshnessVerdict: null, gateExitCode: EXIT_CONTROL_PLANE_STARVATION });
  assert.equal(builder.status, plane.status);
  assert.notEqual(builder.summary, plane.summary);
});
