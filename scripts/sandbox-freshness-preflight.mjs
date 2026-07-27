#!/usr/bin/env node
// Sandbox freshness preflight (BI-ECDF9520) — the step-zero gate that runs in
// the shared local-integration-ci sandbox BEFORE any build/test gate command.
//
// Asserts, deterministically:
//   1. the checkout matches the requested branch/SHA,
//   2. node_modules/.pnpm/lock.yaml matches the checked-in pnpm-lock.yaml for
//      the critical packages (next, react, react-dom, typescript, prisma, vitest),
//   3. the workspace links (e.g. apps/web/node_modules/next) resolve on disk
//      to the locked versions — this is the check that catches a stale
//      next@16.2.7 store link while the lockfile requires 16.2.9,
//   4. no other pnpm install is running (duplicate/hung installs poison state).
//
// With --converge, drift triggers ONE sandbox-owned `pnpm install
// --frozen-lockfile` (guarded by a lock directory so two gates can never race
// an install), then re-checks. If convergence cannot reach green the exit code
// is 3 (SANDBOX_DRIFT) / 4 (SANDBOX_NOT_READY) — deliberately distinct from a
// product build failure — and a JSON report is written for the gate runner to
// attach to evidence.
//
// Usage:
//   node scripts/sandbox-freshness-preflight.mjs [--dir PATH] [--branch NAME]
//     [--sha SHA] [--converge] [--report PATH] [--quiet]

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  CRITICAL_PACKAGES,
  EXIT_SANDBOX_NOT_READY,
  EXIT_USAGE,
  detectInstallProcesses,
  evaluateFreshness,
  exitCodeForVerdict,
  parseLockedVersion,
  shouldForceConvergenceAfterInstall,
  stalePackagePathsForRelink,
} from "./lib/sandbox-freshness.mjs";

const CONVERGE_LOCK_STALE_MS = 30 * 60_000;

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : "";
}
const hasFlag = (flag) => process.argv.includes(flag);

const requestedBranch = valueAfter("--branch");
const requestedSha = valueAfter("--sha");
const converge = hasFlag("--converge");
const quiet = hasFlag("--quiet");
// Hermetic-test escape hatch: skip the host-wide ps scan so an unrelated
// install elsewhere on the machine cannot change a fixture verdict.
const skipInstallScan = hasFlag("--skip-install-scan");

function log(message) {
  if (!quiet) console.log(`[sandbox-freshness] ${message}`);
}

function git(dir, args) {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

let rootDir = valueAfter("--dir");
if (!rootDir) rootDir = git(process.cwd(), ["rev-parse", "--show-toplevel"]) || process.cwd();
rootDir = path.resolve(rootDir);
if (!fs.existsSync(path.join(rootDir, "pnpm-lock.yaml"))) {
  console.error(`[sandbox-freshness] no pnpm-lock.yaml under ${rootDir}; pass --dir pointing at the sandbox checkout`);
  process.exit(EXIT_USAGE);
}

let reportPath = valueAfter("--report");
if (!reportPath) reportPath = process.env.DPF_LOCAL_CI_FRESHNESS_REPORT_FILE || "";
if (!reportPath) {
  const gitPath = git(rootDir, ["rev-parse", "--git-path", "dpf-sandbox-freshness.json"]);
  reportPath = gitPath ? path.resolve(rootDir, gitPath) : path.join(rootDir, ".dpf-sandbox-freshness.json");
}

function readFileIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function resolvePackageOnDisk(importerDir, name) {
  // Mirror Node's resolution: walk node_modules upward from the importer to
  // the repo root. pnpm's isolated linker puts a per-workspace link at the
  // importer; `node-linker=hoisted` installs land flat at the root — both are
  // what the runtime would actually load, so both count.
  let dir = importerDir;
  let lastLinkTarget = "";
  for (;;) {
    const linkPath = path.join(dir, "node_modules", ...name.split("/"));
    let linkTarget = "";
    try {
      linkTarget = fs.readlinkSync(linkPath);
    } catch {
      // not a symlink (or missing) — realpath below decides.
    }
    try {
      const realDir = fs.realpathSync(linkPath);
      const manifest = JSON.parse(fs.readFileSync(path.join(realDir, "package.json"), "utf8"));
      return { missing: false, resolvedVersion: manifest.version ?? "", linkTarget, realPath: realDir, resolvedFrom: linkPath };
    } catch {
      lastLinkTarget = lastLinkTarget || linkTarget;
    }
    if (path.resolve(dir) === rootDir || !path.resolve(dir).startsWith(rootDir)) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { missing: true, resolvedVersion: "", linkTarget: lastLinkTarget, realPath: "", resolvedFrom: "" };
}

function missingEntrypointImports(packageDir, entrypoints = []) {
  const missing = [];
  for (const entrypoint of entrypoints) {
    const entryPath = path.join(packageDir, entrypoint);
    const source = readFileIfExists(entryPath);
    if (!source) {
      missing.push(entrypoint);
      continue;
    }
    for (const match of source.matchAll(/(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["'](\.[^"']+)["']/g)) {
      const specifier = match[1];
      const candidate = path.resolve(path.dirname(entryPath), specifier);
      if (!fs.existsSync(candidate)) missing.push(path.relative(packageDir, candidate));
    }
  }
  return [...new Set(missing)];
}

function collectState() {
  const lockfileText = readFileIfExists(path.join(rootDir, "pnpm-lock.yaml"));
  const installedLockPath = path.join(rootDir, "node_modules", ".pnpm", "lock.yaml");
  const installedLockText = readFileIfExists(installedLockPath);

  const packages = [];
  for (const spec of CRITICAL_PACKAGES) {
    let importer = "";
    let lockedVersion = "";
    for (const candidate of spec.importers) {
      const version = parseLockedVersion(lockfileText, candidate, spec.name);
      if (version) {
        importer = candidate;
        lockedVersion = version;
        break;
      }
    }
    if (!importer) importer = spec.importers[0];
    const importerDir = importer === "." ? rootDir : path.join(rootDir, importer);
    const onDisk = resolvePackageOnDisk(importerDir, spec.name);
    packages.push({
      name: spec.name,
      importer,
      lockedVersion,
      installedLockVersion: installedLockText ? parseLockedVersion(installedLockText, importer, spec.name) : "",
      resolvedVersion: onDisk.resolvedVersion,
      linkTarget: onDisk.linkTarget,
      resolvedFrom: onDisk.resolvedFrom,
      missingEntrypointImports: onDisk.missing ? [] : missingEntrypointImports(onDisk.realPath, spec.entrypointImportChecks),
      missing: onDisk.missing,
    });
  }

  let installProcesses = [];
  if (!skipInstallScan) {
    const ps = spawnSync("ps", ["-axo", "pid=,etime=,command="], { encoding: "utf8" });
    installProcesses = detectInstallProcesses(ps.status === 0 ? ps.stdout : "", { selfPids: [process.pid] });
  }

  return {
    requestedBranch,
    requestedSha,
    actualBranch: git(rootDir, ["rev-parse", "--abbrev-ref", "HEAD"]),
    actualSha: git(rootDir, ["rev-parse", "HEAD"]),
    nodeModulesPresent: fs.existsSync(path.join(rootDir, "node_modules")),
    installedLockPresent: fs.existsSync(installedLockPath),
    lockfilesDiffer: Boolean(installedLockText) && installedLockText !== lockfileText,
    packages,
    installProcesses,
  };
}

function writeReport(state, evaluation, convergence) {
  const report = {
    schema: "dpf-sandbox-freshness/v1",
    generatedAt: new Date().toISOString(),
    dir: rootDir,
    requestedBranch: state.requestedBranch || null,
    actualBranch: state.actualBranch || null,
    requestedSha: state.requestedSha || null,
    actualSha: state.actualSha || null,
    verdict: evaluation.verdict,
    failures: evaluation.failures,
    packages: state.packages,
    installProcesses: state.installProcesses,
    convergence,
  };
  try {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    console.error(`[sandbox-freshness] failed to write report ${reportPath}: ${error.message}`);
  }
  return report;
}

function finish(state, evaluation, convergence) {
  writeReport(state, evaluation, convergence);
  for (const failure of evaluation.failures) {
    console.error(`[sandbox-freshness] ${evaluation.verdict.toUpperCase()}: ${failure.message}`);
  }
  const versions = state.packages.map((pkg) => `${pkg.name}@${pkg.resolvedVersion || "MISSING"} (locked ${pkg.lockedVersion || "?"})`).join(", ");
  log(`verdict=${evaluation.verdict} ${versions}`);
  log(`report: ${reportPath}`);
  process.exit(exitCodeForVerdict(evaluation.verdict));
}

let state = collectState();
let evaluation = evaluateFreshness(state);
let convergence = null;

if (evaluation.verdict === "green" || !converge) {
  finish(state, evaluation, convergence);
}

// --- governed convergence path (single install, never a duplicate) ---------
if (state.installProcesses.length > 0) {
  // Another install is already running; starting a second would corrupt the
  // store. Report not-ready and let the holder finish (or be reaped).
  finish(state, evaluation, { attempted: false, reason: "install_already_running" });
}

const gitLockPath = git(rootDir, ["rev-parse", "--git-path", "dpf-freshness-converge.lock"]);
const lockDir = gitLockPath ? path.resolve(rootDir, gitLockPath) : path.join(rootDir, ".dpf-freshness-converge.lock");
try {
  fs.mkdirSync(lockDir, { recursive: false });
} catch {
  let stale = false;
  try {
    stale = Date.now() - fs.statSync(lockDir).mtimeMs > CONVERGE_LOCK_STALE_MS;
  } catch {
    stale = true; // vanished between mkdir and stat — retake below.
  }
  if (!stale) {
    console.error("[sandbox-freshness] another convergence holds the lock; not starting a duplicate install");
    writeReport(state, evaluation, { attempted: false, reason: "convergence_lock_held" });
    process.exit(EXIT_SANDBOX_NOT_READY);
  }
  fs.rmSync(lockDir, { recursive: true, force: true });
  fs.mkdirSync(lockDir, { recursive: true });
}

// Defeat pnpm's up-to-date fast path: when node_modules/.pnpm/lock.yaml (and
// .modules.yaml) already match the lockfile, `pnpm install --frozen-lockfile`
// exits 0 WITHOUT relinking — even when the workspace links are stale or gone.
// That is exactly the "install appeared to succeed but next stayed at 16.2.7"
// incident shape (verified live on 2026-07-05: install exited 0 in ~5s while
// apps/web/node_modules/next remained unresolvable). Removing pnpm's private
// state forces a real link-reconciliation pass; the store stays warm, so this
// costs seconds, not a re-download.
function clearPnpmInstallState() {
  for (const staleState of [
    path.join(rootDir, "node_modules", ".pnpm", "lock.yaml"),
    path.join(rootDir, "node_modules", ".modules.yaml"),
  ]) {
    try {
      fs.rmSync(staleState, { force: true });
    } catch (error) {
      console.error(`[sandbox-freshness] could not clear ${staleState}: ${error.message}`);
    }
  }
}

function clearStalePackageLinks(packageState) {
  for (const stalePackagePath of stalePackagePathsForRelink(packageState, rootDir)) {
    try {
      fs.rmSync(stalePackagePath, { recursive: true, force: true });
      log(`removed stale package link before relink: ${path.relative(rootDir, stalePackagePath)}`);
    } catch (error) {
      console.error(`[sandbox-freshness] could not clear stale package link ${stalePackagePath}: ${error.message}`);
    }
  }
}

function canResetNodeModules() {
  return path.basename(rootDir).toLowerCase() === ".local-ci-runner"
    || process.env.DPF_ALLOW_SANDBOX_NODE_MODULES_RESET === "1";
}

function resetSandboxNodeModules() {
  if (!canResetNodeModules()) return false;
  const target = path.join(rootDir, "node_modules");
  const resolved = path.resolve(target);
  if (path.relative(rootDir, resolved) !== "node_modules") return false;
  try {
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink()) {
      console.error(`[sandbox-freshness] refusing full node_modules reset because ${resolved} is a symlink/junction`);
      return false;
    }
  } catch {
    return true;
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  log("reset scratch sandbox node_modules after package-level convergence could not repair dependency drift");
  return true;
}

function freshPnpmStoreDir() {
  const target = path.join(rootDir, ".pnpm-fresh-store");
  const resolved = path.resolve(target);
  if (path.relative(rootDir, resolved) !== ".pnpm-fresh-store") return "";
  return resolved;
}

function clearFreshPnpmStore(storeDir) {
  if (!storeDir) return;
  const resolved = path.resolve(storeDir);
  if (path.relative(rootDir, resolved) !== ".pnpm-fresh-store") {
    console.error(`[sandbox-freshness] refusing to clear unsafe fresh pnpm store path ${resolved}`);
    return;
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function runConvergenceAttempt(packageState, { force = false, resetNodeModules = false, freshStore = false } = {}) {
  if (resetNodeModules) resetSandboxNodeModules();
  clearPnpmInstallState();
  clearStalePackageLinks(packageState);
  const convergeCommand = ["pnpm", "install"];
  if (force) convergeCommand.push("--force");
  convergeCommand.push("--frozen-lockfile", "--config.confirmModulesPurge=false");
  if (freshStore) {
    const storeDir = freshPnpmStoreDir();
    clearFreshPnpmStore(storeDir);
    if (storeDir) convergeCommand.push("--store-dir", storeDir);
  }
  log(`drift detected; converging with: ${convergeCommand.join(" ")}`);
  const startedAt = Date.now();
  const install = spawnSync(convergeCommand[0], convergeCommand.slice(1), {
    cwd: rootDir,
    stdio: quiet ? "ignore" : "inherit",
    shell: process.platform === "win32",
  });
  return {
    attempted: true,
    command: convergeCommand.join(" "),
    exitCode: install.status ?? 1,
    durationMs: Date.now() - startedAt,
    resetNodeModules,
    freshStore,
  };
}

const attempts = [];
try {
  attempts.push(runConvergenceAttempt(state));
  convergence = { ...attempts[attempts.length - 1], attempts };
  state = collectState();
  evaluation = evaluateFreshness(state);

  if (shouldForceConvergenceAfterInstall(evaluation)) {
    log("first convergence left dependency drift; retrying once with --force to refresh the sandbox store/link graph");
    attempts.push(runConvergenceAttempt(state, { force: true }));
    convergence = { ...attempts[attempts.length - 1], attempts };
    state = collectState();
    evaluation = evaluateFreshness(state);
  }

  if (shouldForceConvergenceAfterInstall(evaluation) && canResetNodeModules()) {
    log("forced convergence left dependency drift; resetting scratch node_modules once and reinstalling from the lockfile");
    attempts.push(runConvergenceAttempt(state, { resetNodeModules: true }));
    convergence = { ...attempts[attempts.length - 1], attempts };
    state = collectState();
    evaluation = evaluateFreshness(state);
  }

  if (shouldForceConvergenceAfterInstall(evaluation) && canResetNodeModules()) {
    log("scratch node_modules reset still left dependency drift; retrying once with a scratch-local pnpm store");
    attempts.push(runConvergenceAttempt(state, { freshStore: true }));
    convergence = { ...attempts[attempts.length - 1], attempts };
    state = collectState();
    evaluation = evaluateFreshness(state);
  }
} finally {
  fs.rmSync(lockDir, { recursive: true, force: true });
}

if (convergence.exitCode !== 0 && evaluation.verdict === "green") {
  // Trust the re-check, but surface the installer's own failure.
  evaluation = {
    verdict: "sandbox_drift",
    failures: [
      ...evaluation.failures,
      { kind: "convergence_failed", message: `pnpm install --frozen-lockfile exited ${convergence.exitCode}; sandbox state unproven` },
    ],
  };
}
finish(state, evaluation, convergence);
