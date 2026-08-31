// Sandbox dependency-freshness detector (BI-ECDF9520).
//
// The shared local-integration-ci sandbox runs `git checkout/merge` and then
// builds — but nothing guaranteed that node_modules matched the merged
// pnpm-lock.yaml. A stale workspace link (apps/web/node_modules/next ->
// .pnpm/next@16.2.7/... while the lockfile required 16.2.9) produced a false
// "main is red" production-build failure and blocked unrelated branches.
//
// This module is the pure decision core: parse locked versions out of a pnpm
// lockfile, compare them against what the workspace links actually resolve to
// on disk, detect concurrent/hung installs, and classify the gate outcome so
// a red sandbox is reported as SANDBOX_DRIFT — never as product evidence.
// Filesystem/process collection lives in scripts/sandbox-freshness-preflight.mjs.

import path from "node:path";

/**
 * Packages whose on-disk resolution must match the lockfile before any build
 * evidence is trustworthy. `importers` lists the workspace dirs (relative to
 * repo root) whose node_modules link is checked, in priority order; the locked
 * version comes from the same importer section of pnpm-lock.yaml. "." is the
 * repo root importer.
 */
export const CRITICAL_PACKAGES = [
  { name: "next", importers: ["apps/web"] },
  { name: "react", importers: ["apps/web"] },
  { name: "react-dom", importers: ["apps/web"] },
  { name: "typescript", importers: ["apps/web", "."] },
  { name: "prisma", importers: ["packages/db", "."] },
  {
    name: "vitest",
    importers: ["apps/web", "packages/db", "packages/dpf-bootstrap", "."],
    entrypointImportChecks: ["dist/cli.js"],
  },
];

/** Strip a pnpm peer-dependency suffix: "16.2.9(@babel/core@7.29.7)(...)" -> "16.2.9". */
export function baseVersion(lockVersion) {
  if (typeof lockVersion !== "string") return "";
  const parenIndex = lockVersion.indexOf("(");
  return (parenIndex >= 0 ? lockVersion.slice(0, parenIndex) : lockVersion).trim();
}

/**
 * Parse the resolved version of `packageName` for one importer out of a pnpm
 * v9 lockfile's `importers:` section. Returns "" when not found. Pure text
 * parsing on purpose: no YAML dependency, and the two lockfiles we compare
 * (checked-in pnpm-lock.yaml and node_modules/.pnpm/lock.yaml) share this shape.
 */
export function parseLockedVersion(lockfileText, importerPath, packageName) {
  if (!lockfileText) return "";
  const lines = lockfileText.split("\n");
  let inImporters = false;
  let inTargetImporter = false;
  let packageIndent = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^importers:\s*$/.test(line)) {
      inImporters = true;
      continue;
    }
    if (inImporters && /^\S/.test(line)) {
      // Left the importers block (e.g. hit top-level `packages:`).
      break;
    }
    if (!inImporters) continue;
    const importerMatch = line.match(/^  (\S[^:]*):\s*$/);
    if (importerMatch) {
      inTargetImporter = importerMatch[1] === importerPath;
      continue;
    }
    if (!inTargetImporter) continue;
    // Package entries sit under dependencies:/devDependencies: at a deeper
    // indent than the importer header; match by name then read `version:`.
    const packageMatch = line.match(/^(\s+)(\S[^:]*):\s*$/);
    if (packageMatch && packageMatch[2] === packageName && packageMatch[1].length >= 4) {
      packageIndent = packageMatch[1].length;
      continue;
    }
    if (packageIndent >= 0) {
      const versionMatch = line.match(/^(\s+)version:\s*(.+?)\s*$/);
      if (versionMatch && versionMatch[1].length > packageIndent) {
        return baseVersion(versionMatch[2].replace(/^['"]|['"]$/g, ""));
      }
      // Any line at or above the package's indent means we left its block.
      const indent = (line.match(/^(\s*)/)[1] || "").length;
      if (line.trim() && indent <= packageIndent) packageIndent = -1;
    }
  }
  return "";
}

/**
 * Parse `ps -axo pid=,etime=,command=` style lines and return pnpm install
 * processes. `selfPids` excludes this process tree (a preflight-owned
 * convergence install must not flag itself).
 */
export function detectInstallProcesses(psText, { selfPids = [] } = {}) {
  const excluded = new Set(selfPids.map(Number));
  const processes = [];
  for (const raw of String(psText ?? "").split("\n")) {
    const line = raw.trim();
    const match = line.match(/^(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) continue;
    const [, pidText, etime, command] = match;
    const pid = Number(pidText);
    if (excluded.has(pid)) continue;
    if (!isPnpmInstallCommand(command)) continue;
    processes.push({ pid, etime, etimeMinutes: parseEtimeMinutes(etime), command });
  }
  return processes;
}

/**
 * True when a ps command line is a pnpm install (or `pnpm i` alias). Matching
 * is token-based so `pnpm exec vitest run -i` or paths containing "install"
 * do not false-positive.
 */
export function isPnpmInstallCommand(command) {
  const tokens = String(command ?? "").split(/\s+/).filter(Boolean);
  const pnpmIndex = tokens.findIndex((token) => /(^|\/)pnpm(\.c?js)?$/.test(token));
  if (pnpmIndex < 0) return false;
  const rest = tokens.slice(pnpmIndex + 1);
  if (rest[0] === "i") return true;
  // `install` as its own token anywhere after pnpm covers `pnpm install`,
  // `pnpm --filter web install`, `pnpm -r install` — but not `run install:x`
  // or `exec something install` (subcommand context changes at exec/run/dlx).
  for (const token of rest) {
    if (token === "exec" || token === "run" || token === "dlx") return false;
    if (token === "install") return true;
  }
  return false;
}

/** "[[dd-]hh:]mm:ss" -> whole minutes (best effort; unknown -> 0). */
export function parseEtimeMinutes(etime) {
  if (typeof etime !== "string") return 0;
  const dayMatch = etime.match(/^(\d+)-(.+)$/);
  let days = 0;
  let rest = etime;
  if (dayMatch) {
    days = Number(dayMatch[1]);
    rest = dayMatch[2];
  }
  const parts = rest.split(":").map(Number);
  if (parts.some(Number.isNaN)) return 0;
  let minutes = 0;
  if (parts.length === 3) minutes = parts[0] * 60 + parts[1];
  else if (parts.length === 2) minutes = parts[0];
  return days * 24 * 60 + minutes;
}

/**
 * Evaluate a collected sandbox state into a freshness verdict.
 *
 * state = {
 *   requestedBranch?, actualBranch?, requestedSha?, actualSha?,
 *   nodeModulesPresent: boolean,
 *   installedLockPresent: boolean,
 *   lockfilesDiffer?: boolean,
 *   packages: [{ name, importer, lockedVersion, installedLockVersion, resolvedVersion, linkTarget, missing, missingEntrypointImports }],
 *   installProcesses: [{ pid, etime, etimeMinutes, command }],
 * }
 *
 * Verdicts:
 *  - "green": build evidence from this sandbox is trustworthy.
 *  - "sandbox_drift": on-disk dependency state contradicts the lockfile.
 *  - "sandbox_not_ready": no install yet / an install is still running —
 *    the sandbox cannot produce evidence either way.
 */
export function evaluateFreshness(state) {
  const failures = [];

  if (state.requestedBranch && state.actualBranch && state.actualBranch !== state.requestedBranch) {
    failures.push({
      kind: "checkout_mismatch",
      message: `checkout is on '${state.actualBranch}' but the gate requested '${state.requestedBranch}'`,
    });
  }
  if (state.requestedSha && state.actualSha && !state.actualSha.startsWith(state.requestedSha) && !state.requestedSha.startsWith(state.actualSha)) {
    failures.push({
      kind: "checkout_mismatch",
      message: `checkout is at ${state.actualSha} but the gate requested ${state.requestedSha}`,
    });
  }

  if (Array.isArray(state.installProcesses) && state.installProcesses.length > 0) {
    for (const proc of state.installProcesses) {
      failures.push({
        kind: "install_in_progress",
        message: `pnpm install already running (pid ${proc.pid}, elapsed ${proc.etime}); refusing to build or start a duplicate install`,
      });
    }
  }

  if (!state.nodeModulesPresent) {
    failures.push({ kind: "not_installed", message: "node_modules is missing; sandbox has no installed dependency graph" });
  } else if (!state.installedLockPresent) {
    failures.push({ kind: "not_installed", message: "node_modules/.pnpm/lock.yaml is missing; cannot prove the installed graph matches pnpm-lock.yaml" });
  } else if (state.lockfilesDiffer) {
    // The sentinel packages below catch version drift on the load-bearing
    // deps, but a branch that ADDS a dependency (new package in an importer)
    // leaves every sentinel green while the installed graph predates the
    // lockfile — the merged branch then fails typecheck/build on the missing
    // module, which reads as product evidence when it is sandbox staleness.
    // pnpm writes the exact lockfile it installed to node_modules/.pnpm/lock.yaml;
    // any difference from the checked-in pnpm-lock.yaml means the install is
    // stale. Convergence is a cheap frozen-lockfile no-op when spurious.
    failures.push({
      kind: "installed_lock_stale",
      message: "node_modules/.pnpm/lock.yaml differs from pnpm-lock.yaml (install ran against an older lockfile)",
    });
  }

  for (const pkg of state.packages ?? []) {
    if (!pkg.lockedVersion) {
      failures.push({ kind: "lockfile_unparseable", package: pkg.name, message: `could not determine locked version for ${pkg.name} (importer ${pkg.importer}) from pnpm-lock.yaml` });
      continue;
    }
    if (pkg.missing) {
      failures.push({ kind: "package_missing", package: pkg.name, message: `${pkg.importer}/node_modules/${pkg.name} does not resolve; lockfile requires ${pkg.lockedVersion}` });
      continue;
    }
    if (pkg.installedLockVersion && pkg.installedLockVersion !== pkg.lockedVersion) {
      failures.push({
        kind: "installed_lock_stale",
        package: pkg.name,
        message: `node_modules/.pnpm/lock.yaml resolved ${pkg.name}@${pkg.installedLockVersion} but pnpm-lock.yaml requires ${pkg.lockedVersion} (install ran against an older lockfile)`,
      });
    }
    if (pkg.resolvedVersion && pkg.resolvedVersion !== pkg.lockedVersion) {
      failures.push({
        kind: "version_drift",
        package: pkg.name,
        message: `${pkg.importer}/node_modules/${pkg.name} resolves to ${pkg.resolvedVersion}${pkg.linkTarget ? ` (link -> ${pkg.linkTarget})` : ""} but pnpm-lock.yaml requires ${pkg.lockedVersion}`,
      });
    }
    if (Array.isArray(pkg.missingEntrypointImports) && pkg.missingEntrypointImports.length > 0) {
      failures.push({
        kind: "package_broken",
        package: pkg.name,
        message: `${pkg.importer}/node_modules/${pkg.name} is incomplete: ${pkg.missingEntrypointImports.join(", ")} missing`,
      });
    }
  }

  let verdict = "green";
  if (failures.some((f) => f.kind === "install_in_progress" || f.kind === "not_installed")) {
    verdict = "sandbox_not_ready";
  } else if (failures.length > 0) {
    verdict = "sandbox_drift";
  }
  return { verdict, failures };
}

function isInsidePath(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function isNodeModulesPath(rootDir, candidate) {
  const relative = path.relative(path.resolve(rootDir), path.resolve(candidate));
  return relative.split(path.sep).includes("node_modules");
}

/**
 * Return package link/dir paths that are safe for the preflight to remove
 * before its single governed `pnpm install` convergence pass. This is only for
 * stale resolved packages inside the sandbox's own node_modules tree; outside
 * paths and unresolved/missing packages are intentionally ignored.
 */
export function stalePackagePathsForRelink(state, rootDir) {
  const seen = new Set();
  const paths = [];
  for (const pkg of state.packages ?? []) {
    const versionDrift = pkg.lockedVersion && pkg.resolvedVersion && pkg.resolvedVersion !== pkg.lockedVersion;
    if (!versionDrift || !pkg.resolvedFrom) continue;
    const candidate = path.resolve(rootDir, pkg.resolvedFrom);
    if (!isInsidePath(rootDir, candidate) || !isNodeModulesPath(rootDir, candidate)) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    paths.push(candidate);
  }
  return paths;
}

export function shouldForceConvergenceAfterInstall(evaluation) {
  if (!evaluation || evaluation.verdict === "green") return false;
  return (evaluation.failures ?? []).some((failure) => [
    "installed_lock_stale",
    "package_broken",
    "package_missing",
    "version_drift",
  ].includes(failure.kind));
}

/**
 * Decide whether the convergence ladder should escalate to a heavier repair
 * (force install -> node_modules reset -> fresh store). Two independent signals:
 *
 *  1. the freshness re-check still shows tracked dependency drift
 *     (shouldForceConvergenceAfterInstall), OR
 *  2. the convergence install itself FAILED (non-zero exit). A frozen-lockfile
 *     install that exits non-zero after a dependency-version bump is the
 *     stale-bin / broken-postinstall signature (BI-675D9085): e.g. a
 *     node_modules/.bin/prisma symlink left pointing at a removed 7.9.0 build
 *     after a 7.9.0->7.9.1 bump. The critical-package links can ALL resolve to
 *     the locked version (so signal 1 is silent and the re-check is green) while
 *     the install can't complete — the exact gap that stranded the old ladder at
 *     sandbox_drift and demanded a manual `rm -rf node_modules`. Escalating on a
 *     failed install lets the clean reset self-heal it. This subsumes the
 *     optional "MODULE_NOT_FOUND on a *.bin target" signature without parsing
 *     installer stderr, which the inherited-stdio install does not capture.
 */
export function shouldEscalateConvergence(evaluation, lastAttempt) {
  if (shouldForceConvergenceAfterInstall(evaluation)) return true;
  return Boolean(lastAttempt) && lastAttempt.attempted === true && (lastAttempt.exitCode ?? 0) !== 0;
}

/**
 * Parse the `packages:` list out of a pnpm-workspace.yaml. Returns the raw
 * glob/literal entries (e.g. "apps/*", "packages/*", "services/adp"). Pure text
 * parsing — no YAML dependency — matching the rest of this module. The preflight
 * expands these against the filesystem to find each workspace package's
 * node_modules for the clean-reset escalation (root + package node_modules).
 */
export function parseWorkspacePackageGlobs(workspaceYamlText) {
  if (!workspaceYamlText) return [];
  const lines = workspaceYamlText.split("\n");
  const globs = [];
  let inPackages = false;
  for (const line of lines) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    // Blank lines and full-line comments are not the end of the block — a
    // comment at column 0 between two entries must NOT drop the rest of the
    // list (that would leave those packages' node_modules un-reset — a partial
    // recurrence of the very drift this repairs).
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;
    // Any other non-indented line is a new top-level key: end of the block.
    if (/^\S/.test(line)) break;
    const entry = line.match(/^\s+-\s+(.+?)\s*$/);
    if (!entry) continue;
    let raw = entry[1].trim();
    // Strip an inline trailing comment on an unquoted entry ("apps/* # note").
    if (!/^['"]/.test(raw)) raw = raw.replace(/\s+#.*$/, "").trim();
    const value = raw.replace(/^['"]|['"]$/g, "").trim();
    if (value && !value.startsWith("!")) globs.push(value);
  }
  return globs;
}

/** Exit codes for the preflight CLI — deliberately distinct from a product build failure (1). */
export const EXIT_GREEN = 0;
export const EXIT_USAGE = 2;
export const EXIT_SANDBOX_DRIFT = 3;
export const EXIT_SANDBOX_NOT_READY = 4;
export const EXIT_CONTROL_PLANE_STARVATION = 5;
export const EXIT_VITEST_RUNNER_TERMINATION = 86;
/**
 * The local-CI child was killed by a SIGNAL rather than exiting (BI-F22B4EEE).
 *
 * `spawnSync` reports a signal death as `status: null`, and the runner used to
 * collapse that with `result.status ?? 1` — producing exit 1, which is
 * indistinguishable from a genuine product failure. Observed live: the child
 * died at the vitest -> production-build boundary after 25,447 tests passed,
 * leaving no build receipt, no error text, and a gate record that said
 * "local-CI lease gate failed." with no reason. The box was carrying one active
 * and nine queued gate claims at the time, and the build stage runs with a
 * 16 GB heap allowance — an OOM kill, reported as a product verdict.
 *
 * 87 rather than the conventional 128+signal: the runner is reporting THAT a
 * signal occurred, and the signal name travels in the evidence, so a single
 * code keeps the classifier's shape.
 */
export const EXIT_CHILD_SIGNAL_DEATH = 87;

export function exitCodeForVerdict(verdict) {
  if (verdict === "green") return EXIT_GREEN;
  if (verdict === "sandbox_not_ready") return EXIT_SANDBOX_NOT_READY;
  return EXIT_SANDBOX_DRIFT;
}

/**
 * Classify a gate run so a red sandbox can never be recorded as product
 * evidence. `freshnessVerdict` is the verdict that applied when the product
 * command ran (or the preflight verdict when the product command never ran).
 */
export function classifyGateOutcome({ freshnessVerdict, gateExitCode }) {
  if (freshnessVerdict && freshnessVerdict !== "green") {
    return {
      status: "blocked_sandbox_drift",
      gatePassed: false,
      productEvidence: false,
      summary: "local-CI gate blocked: sandbox dependency state is stale or not ready. This is a sandbox defect, NOT product build evidence. Run the governed convergence path and re-gate.",
    };
  }
  if (!freshnessVerdict && (gateExitCode === EXIT_SANDBOX_DRIFT || gateExitCode === EXIT_SANDBOX_NOT_READY)) {
    return {
      status: "blocked_sandbox_drift",
      gatePassed: false,
      productEvidence: false,
      summary: "local-CI gate blocked: freshness preflight reported sandbox drift. This is a sandbox defect, NOT product build evidence.",
    };
  }
  if (gateExitCode === EXIT_CONTROL_PLANE_STARVATION) {
    return {
      status: "blocked_control_plane_starvation",
      gatePassed: false,
      productEvidence: false,
      summary: "local-CI gate blocked: the shared portal/MCP/Docker/PostgreSQL control-plane degraded during the build. This is infrastructure evidence, NOT a product build failure.",
    };
  }
  if (gateExitCode === EXIT_CHILD_SIGNAL_DEATH || gateExitCode === 130 || gateExitCode === 143) {
    // 130/143 are the conventional 128+SIGINT/SIGTERM codes the wrapper used
    // to stamp when the PARENT received the signal (BI-8392DA16). Those are
    // the same infrastructure death as EXIT_CHILD_SIGNAL_DEATH — not a
    // product failure.
    return {
      status: "blocked_child_signal_death",
      gatePassed: false,
      productEvidence: false,
      summary: "local-CI gate could not produce a verdict: the build child was killed by a signal rather than exiting. This is infrastructure evidence, NOT a product build failure — most often the host running out of memory under concurrent gate load. Re-run when the box is quieter; check the recorded signal and host pressure before treating any of it as a code defect.",
    };
  }
  if (gateExitCode === 75) {
    // BI-465B3D60: lease fencing (expiry / quiescence) used to fall through
    // to product `failed` with no reason.
    return {
      status: "blocked_control_plane_starvation",
      gatePassed: false,
      productEvidence: false,
      summary: "local-CI gate blocked: the lease was fenced (expired or quiesced) before the run finished. This is infrastructure evidence, NOT a product build failure. Re-run when the slot is free.",
    };
  }
  if (gateExitCode === EXIT_VITEST_RUNNER_TERMINATION) {
    return {
      status: "failed",
      gatePassed: false,
      productEvidence: false,
      summary: "local-CI gate could not produce a test verdict: the exhaustive Vitest runner terminated twice without a failed-test summary. This is runner evidence, NOT a product test failure; inspect the attached attempt diagnostics before retrying.",
    };
  }
  if (gateExitCode === 0) {
    return { status: "passed", gatePassed: true, productEvidence: true, summary: "local-CI lease gate passed." };
  }
  return { status: "failed", gatePassed: false, productEvidence: true, summary: "local-CI lease gate failed." };
}
