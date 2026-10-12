// Local guard acceleration only: never canonical integration evidence.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { gitText } from "./git.mjs";
import { createStageReceiptWriter, readStageReceipt, reusablePassedStage, stageIdentityMatches } from "./local-ci-stage-receipt.mjs";
import { acquireLocalConvergenceLock, releaseLocalConvergenceLock } from "./local-convergence-lock.mjs";

const TTL_MS = 60 * 60 * 1000;
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

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
    const fileStamp = relative => {
      try {
        const path = realpathSync(join(cwd, relative));
        const stat = statSync(path);
        return { path, size: stat.size, modified: stat.mtimeMs, digest: stat.isFile() ? digest(readFileSync(path).toString("base64")) : null };
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    };
    return {
      policy: "host-guards-v1",
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
  if (!identity) return { result: await execute(), reused: false, executedAt: null };
  mkdirSync(directory, { recursive: true });
  // Bound disk use to one receipt/claim per stage in this worktree. Different
  // identities cannot share PASS, even though they replace the same local slot.
  const key = digest(stage);
  const path = join(directory, `${key}.json`);
  const reusable = () => {
    const prior = readStageReceipt(path);
    const age = now() - Date.parse(prior?.completedAt);
    try {
      if (age >= 0 && age < TTL_MS && reusablePassedStage({ receipt: prior, stage, identity }) && prior.result && passed(prior.result)) {
        return { result: prior.result, reused: true, executedAt: prior.completedAt };
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
    const result = await execute();
    const eligible = passed(result) && stageIdentityMatches(identity, identify());
    writer.complete(eligible ? "passed" : "inconclusive", { result });
    return { result, reused: false, executedAt: writer.snapshot().completedAt };
  } finally {
    releaseLocalConvergenceLock({ path: lock, token: claim.owner.token });
  }
}
