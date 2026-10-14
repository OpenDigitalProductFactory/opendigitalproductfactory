// Local guard acceleration only: never canonical integration evidence.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, openSync, fstatSync, closeSync, constants } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { gitText } from "./git.mjs";
import { createStageReceiptWriter, readStageReceipt, reusablePassedStage, stageIdentityMatches } from "./local-ci-stage-receipt.mjs";
import { acquireLocalConvergenceLock, releaseLocalConvergenceLock } from "./local-convergence-lock.mjs";

const TTL_MS = 60 * 60 * 1000;
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function readGuardInputStamp(input, fs = { realpathSync, openSync, fstatSync, readFileSync, closeSync }) {
  let path;
  try { path = fs.realpathSync(input); } catch (error) {
    if (error.code === "ENOENT") return null; // Optional input absent before inspection.
    throw error;
  }
  // Follow legitimate shared-dependency symlinks, but inspect and read the same
  // descriptor. Nonblocking open lets fstat reject a FIFO without waiting on it.
  const fd = fs.openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile()) throw new Error("guard dependency must be a regular file");
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd, { bigint: true });
    const sameFile = stat => stat.isFile() && ["dev", "ino", "size", "mtimeNs", "ctimeNs", "mtimeMs", "ctimeMs"].every(key => stat[key] === before[key]);
    if (!sameFile(after) || BigInt(bytes.length) !== BigInt(before.size) || fs.realpathSync(input) !== path) throw new Error("guard dependency changed during inspection");
    // A replacement at the same pathname must not inherit the old descriptor's
    // content. Verify the current target through a second, reliably closed fd.
    const current = fs.openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      if (!sameFile(fs.fstatSync(current, { bigint: true }))) throw new Error("guard dependency changed during inspection");
    } finally { fs.closeSync(current); }
    return { path, fileId: `${before.dev}:${before.ino}`, size: String(before.size), modified: String(before.mtimeNs ?? before.mtimeMs), digest: digest(bytes.toString("base64")) };
  } finally { fs.closeSync(fd); }
}

// Include incidental changes conservatively, but not the pnpm wrapper's name:
// standalone preflight and the identical preflight invoked by pregate must match.
const WRAPPER_ENV = /^(?:npm_lifecycle_event|npm_lifecycle_script|npm_command|npm_execpath|npm_node_execpath|npm_config_user_agent|INIT_CWD|SHLVL|_)$/i;

export function identifyGuardExecution({ cwd = process.cwd(), plan, env = process.env } = {}) {
  try {
    const git = args => gitText(args, { cwd, timeout: 10000 });
    if (git(["status", "--porcelain", "--untracked-files=normal"])) return null;
    const windows = process.platform === "win32";
    const pnpm = spawnSync(windows ? "pnpm --version" : "pnpm", windows ? [] : ["--version"], { cwd, env, encoding: "utf8", shell: windows, timeout: 10000, windowsHide: true });
    if (pnpm.status !== 0 || !pnpm.stdout.trim()) return null;
    const fileStamp = relative => readGuardInputStamp(join(cwd, relative));
    return {
      policy: "host-guards-v2",
      repository: realpathSync(cwd),
      head: git(["rev-parse", "HEAD"]),
      tree: git(["rev-parse", "HEAD^{tree}"]),
      base: git(["rev-parse", "origin/main"]),
      plan: digest(plan),
      toolchain: { node: process.version, executable: process.execPath, pnpm: pnpm.stdout.trim(), git: git(["--version"]), platform: process.platform, arch: process.arch },
      dependencies: ["pnpm-lock.yaml", "node_modules/.modules.yaml", "node_modules/.pnpm/lock.yaml", "packages/db/generated/client/client.ts"].map(fileStamp),
      environment: digest(Object.entries(env).filter(([key]) => !WRAPPER_ENV.test(key)).sort(([a], [b]) => a.localeCompare(b))),
    };
  } catch {
    // Missing identity is a cache miss, never permission to omit execution.
    return null;
  }
}

export function guardReceiptDirectory(cwd = process.cwd()) {
  return join(gitText(["rev-parse", "--absolute-git-dir"], { cwd }), "dpf-host-guard-receipts");
}

export async function runWithGuardReceipt({ directory, stage, identify, execute, passed, now = Date.now, lockOptions = {} }) {
  const identity = identify();
  if (!identity) return { result: await execute({ progress: () => {} }), reused: false, executedAt: null, identityVerified: false };
  mkdirSync(directory, { recursive: true });
  // Bound disk use to one receipt/claim per stage in this worktree. Different
  // identities cannot share PASS, even though they replace the same local slot.
  const key = digest(stage);
  const path = join(directory, `${key}.json`);
  const reusable = () => {
    const prior = readStageReceipt(path);
    const age = now() - Date.parse(prior?.completedAt);
    try {
      if (age >= 0 && age < TTL_MS && reusablePassedStage({ receipt: prior, stage, identity }) && prior.result && passed(prior.result)
        && stageIdentityMatches(identity, identify())) {
        return { result: prior.result, reused: true, executedAt: prior.completedAt, identityVerified: true };
      }
    } catch { /* Malformed result payloads are misses, not cached passes. */ }
    return null;
  };
  const cached = reusable();
  if (cached) return cached;
  const lock = join(directory, `${key}.lock`);
  const claim = acquireLocalConvergenceLock({ ...lockOptions, path: lock });
  if (claim.status !== "acquired") throw new Error(`Equivalent host guard execution already running or ownership unmeasurable; receipt claim: ${lock}. Observe the original execution instead of starting another full gate.`);
  const writer = createStageReceiptWriter({ path, stage, identity, now: () => new Date(now()) });
  try {
    // Another executor may have finished between our read and claim acquisition.
    const completed = reusable();
    if (completed) return completed;
    writer.start();
    const result = await execute({ progress: observation => writer.heartbeat(observation) });
    const eligible = passed(result) && stageIdentityMatches(identity, identify());
    writer.complete(eligible ? "passed" : "inconclusive", { result });
    return { result, reused: false, executedAt: writer.snapshot().completedAt, identityVerified: eligible };
  } catch (error) {
    if (writer.snapshot()?.status === "running") {
      writer.complete("inconclusive", { error: { name: error.name ?? "Error",
        code: error.code ?? null, message: String(error.message ?? error).slice(0, 1000) } });
    }
    throw error;
  } finally {
    releaseLocalConvergenceLock({ path: lock, token: claim.owner.token });
  }
}
