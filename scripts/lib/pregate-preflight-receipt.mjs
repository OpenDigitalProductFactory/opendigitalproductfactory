// Local guard acceleration only: never canonical integration evidence.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, openSync, fstatSync, closeSync, constants } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { gitText } from "./git.mjs";
import { atomicWriteJson, createStageReceiptWriter, readStageReceipt, reusablePassedStage, stageIdentityMatches } from "./local-ci-stage-receipt.mjs";
import { acquireLocalConvergenceLock, readLocalConvergenceOwner, releaseLocalConvergenceLock, validLocalConvergenceOwner } from "./local-convergence-lock.mjs";
import { inspectProcessIdentity } from "./local-sandbox-fence.mjs";

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

// Receipt identity is the executed guard contract, not the host process.  A
// publish hook necessarily has a different session, tracing and provider
// environment from the shell that recorded a correction proof.  Keep only
// inputs that select an executable or can change Node/CI guard behaviour.
const GUARD_RESULT_ENV = /^(?:CI|NODE_ENV|NODE_OPTIONS|PATHEXT|COMSPEC|SYSTEMROOT|WINDIR|TZ|LANG|LC_ALL|LC_CTYPE|FORCE_COLOR|NO_COLOR|NPM_CONFIG_[A-Z0-9_]+|PNPM_[A-Z0-9_]+|GIT_CONFIG(?:_COUNT|_KEY_\d+|_VALUE_\d+)?|DPF_(?:SKIP_COMPILE_READY_GATE|PREFLIGHT_SKIP|GATE_POLICY))$/i;

export function guardResultEnvironment(env = process.env) {
  return Object.entries(env)
    .filter(([key]) => GUARD_RESULT_ENV.test(key))
    .sort(([left], [right]) => left.localeCompare(right));
}

export function identifyGuardExecution({ cwd = process.cwd(), plan, env = process.env, source = null } = {}) {
  try {
    const git = args => gitText(args, { cwd, timeout: 10000 });
    if (git(["status", "--porcelain", "--untracked-files=normal"])) return null;
    const head = git(["rev-parse", "HEAD"]);
    // Initial readiness pins both endpoints before classifying its scope. Re-read
    // the candidate, never substitute a newer commit into that admitted plan.
    if (source && (!/^[a-f0-9]{40}$/i.test(source.baseSha ?? "")
      || !/^[a-f0-9]{40}$/i.test(source.headSha ?? "") || head !== source.headSha)) return null;
    const base = git(["rev-parse", source ? source.baseSha + "^{commit}" : "origin/main"]);
    if (source && base !== source.baseSha) return null;
    const windows = process.platform === "win32";
    const pnpm = spawnSync(windows ? "pnpm --version" : "pnpm", windows ? [] : ["--version"], { cwd, env, encoding: "utf8", shell: windows, timeout: 10000, windowsHide: true });
    if (pnpm.status !== 0 || !pnpm.stdout.trim()) return null;
    const fileStamp = relative => readGuardInputStamp(join(cwd, relative));
    return {
      policy: "host-guards-v3",
      repository: realpathSync(cwd),
      head,
      tree: git(["rev-parse", `${head}^{tree}`]),
      base,
      plan: digest(plan),
      toolchain: { node: process.version, executable: process.execPath, pnpm: pnpm.stdout.trim(), git: git(["--version"]), platform: process.platform, arch: process.arch },
      dependencies: ["pnpm-lock.yaml", "node_modules/.modules.yaml", "node_modules/.pnpm/lock.yaml", "packages/db/generated/client/client.ts"].map(fileStamp),
      environment: digest(guardResultEnvironment(env)),
    };
  } catch {
    // Missing identity is a cache miss, never permission to omit execution.
    return null;
  }
}

export function guardReceiptDirectory(cwd = process.cwd()) {
  return join(gitText(["rev-parse", "--absolute-git-dir"], { cwd }), "dpf-host-guard-receipts");
}

function guardPaths(directory, stage) {
  const key = digest(stage);
  return { path: join(directory, `${key}.json`), lock: join(directory, `${key}.lock`), mutationLock: join(directory, `${key}.write.lock`) };
}

const sameOwner = (left, right) => Boolean(validLocalConvergenceOwner(left) && validLocalConvergenceOwner(right) && left.token === right.token
  && left.pid === right.pid && left.processIdentity && left.processIdentity === right.processIdentity);

// Start, progress, completion and observer reconciliation share this lock.
// An abandoned mutation lock stays unknown: an observer never removes it.
function mutateGuardReceipt(paths, lockOptions, mutate) {
  const claim = acquireLocalConvergenceLock({ ...lockOptions, path: paths.mutationLock, reconcileStale: false });
  if (claim.status !== "acquired") throw new Error("Host receipt mutation ownership unknown; observe the original receipt writer.");
  try {
    return mutate(() => sameOwner(readLocalConvergenceOwner(paths.mutationLock), claim.owner), claim.owner);
  } finally { releaseLocalConvergenceLock({ path: paths.mutationLock, token: claim.owner.token }); }
}

export function observeGuardReceipt({ directory, stage, probe = inspectProcessIdentity }) {
  const paths = guardPaths(directory, stage);
  const receipt = readStageReceipt(paths.path);
  const common = { receipt, receiptPath: paths.path, attemptId: receipt?.owner?.token ?? null,
    accountableOwner: receipt?.owner ?? { pid: receipt?.hostPid ?? null }, newAttemptAllowed: false };
  if (!receipt) return existsSync(paths.path)
    ? { ...common, status: "unknown", missingProof: ["readable-original-receipt"], nextAction: "Ask the accountable executor to establish the retained receipt; preserve its bytes and ownership." }
    : { ...common, status: "absent", missingProof: [], nextAction: "Use normal preflight admission; this observation grants no execution." };
  if (receipt.status !== "running") return { ...common, status: receipt.status,
    missingProof: receipt.recovery ? ["original-child-outcome-and-descendant-ownership"] : [],
    nextAction: receipt.recovery ? "Resolve original child outcome and descendant ownership through the accountable executor before seeking new admission."
      : "Use normal preflight admission; a terminal receipt is not a new execution grant." };
  const owner = readLocalConvergenceOwner(paths.lock);
  if (receipt.schemaVersion !== 1 || receipt.stage !== stage || receipt.hostPid !== receipt.owner?.pid
    || !sameOwner(receipt.owner, owner)) return { ...common, status: "unknown", missingProof: ["matching-original-receipt-and-lock-owner"], nextAction: "Ask the accountable executor to establish original receipt and lock ownership; preserve both records." };
  let controller;
  try { controller = probe(owner); } catch { controller = { status: "unknown", reason: "probe-threw" }; }
  return { ...common, status: controller.status === "live" ? "running" : controller.status === "absent" ? "abandoned" : "unknown", controller,
    missingProof: controller.status === "absent" ? ["original-child-outcome-and-descendant-ownership"] : controller.status === "live" ? [] : ["authoritative-controller-identity-or-absence"],
    nextAction: controller.status === "absent" ? "Run pregate:status --reconcile-host-receipt to retain an inconclusive disposition; child outcome remains unknown."
      : controller.status === "live" ? "Observe the original executor; do not start another preflight."
        : "Ask the accountable executor to establish controller identity or absence; preserve the original receipt." };
}

export function reconcileGuardReceipt({ directory, stage, probe = inspectProcessIdentity, now = () => new Date(), lockOptions = {} }) {
  const before = observeGuardReceipt({ directory, stage, probe });
  if (before.status !== "abandoned") return before;
  const paths = guardPaths(directory, stage);
  try {
    return mutateGuardReceipt(paths, lockOptions, (ownsMutation, observer) => {
      const current = observeGuardReceipt({ directory, stage, probe });
      if (current.status !== "abandoned" || !stageIdentityMatches(before.receipt, current.receipt)) return current;
      const owner = readLocalConvergenceOwner(paths.lock);
      // Revalidate after probing: a replaced owner/receipt is never overwritten.
      if (!ownsMutation() || !sameOwner(current.receipt.owner, owner)
        || !stageIdentityMatches(current.receipt, readStageReceipt(paths.path))) {
        return { ...current, status: "unknown", nextAction: "Observe the replacement receipt or changed owner; reconciliation made no write." };
      }
      const receipt = { ...current.receipt, status: "inconclusive", completedAt: now().toISOString(),
        recovery: { reason: "controller-absent-child-outcome-unknown", observedAt: now().toISOString(),
          observer, controller: current.controller } };
      atomicWriteJson(paths.path, receipt);
      return observeGuardReceipt({ directory, stage, probe });
    });
  } catch (error) {
    return { ...before, status: "unknown", missingProof: ["exclusive-receipt-mutation-ownership"], nextAction: "Observe the original receipt writer; no lock was reclaimed and no receipt was changed.", error: String(error.message ?? error) };
  }
}

export async function runWithGuardReceipt({ directory, stage, identify, execute, passed, now = Date.now, lockOptions = {} }) {
  const priorPath = guardPaths(directory, stage).path;
  const prior = readStageReceipt(priorPath);
  if (!prior && existsSync(priorPath)) throw new Error(`Original host receipt unreadable; preserve ${priorPath} and establish ownership before execution.`);
  if (prior?.status === "running" || prior?.recovery) {
    const observed = reconcileGuardReceipt({ directory, stage, now: () => new Date(now()), lockOptions });
    throw new Error(`Equivalent host guard execution already running or original outcome unknown; receipt ${observed.receiptPath}; owner ${observed.attemptId ?? "unknown"}; ${observed.nextAction}`);
  }
  const identity = identify();
  if (!identity) return { result: await execute({ progress: () => {} }), reused: false, executedAt: null, identityVerified: false };
  mkdirSync(directory, { recursive: true });
  // Bound disk use to one receipt/claim per stage in this worktree. Different
  // identities cannot share PASS, even though they replace the same local slot.
  const paths = guardPaths(directory, stage);
  const { path, lock } = paths;
  const reusable = () => {
    const prior = readStageReceipt(path);
    const age = now() - Date.parse(prior?.completedAt);
    try {
      if (age >= 0 && age < TTL_MS && validLocalConvergenceOwner(prior?.owner) && prior.hostPid === prior.owner.pid
        && !prior.recovery && reusablePassedStage({ receipt: prior, stage, identity }) && prior.result && passed(prior.result)
        && stageIdentityMatches(identity, identify())) {
        return { result: prior.result, reused: true, executedAt: prior.completedAt, identityVerified: true };
      }
    } catch { /* Malformed result payloads are misses, not cached passes. */ }
    return null;
  };
  const cached = reusable();
  if (cached) return cached;
  const claim = acquireLocalConvergenceLock({ ...lockOptions, path: lock, reconcileStale: false });
  if (claim.status !== "acquired") throw new Error(`Equivalent host guard execution already running or ownership unmeasurable; receipt claim: ${lock}. Observe the original execution instead of starting another full gate.`);
  const writer = createStageReceiptWriter({ path, stage, identity, now: () => new Date(now()),
    persistImpl: (receiptPath, next, previous) => mutateGuardReceipt(paths, lockOptions, ownsMutation => {
      if (!ownsMutation() || !sameOwner(readLocalConvergenceOwner(lock), claim.owner)
        || (previous && !stageIdentityMatches(previous, readStageReceipt(receiptPath)))) {
        throw new Error("Original host receipt ownership changed; refusing late writer.");
      }
      atomicWriteJson(receiptPath, next);
    }) });
  try {
    // Another executor may have finished between our read and claim acquisition.
    const completed = reusable();
    if (completed) return completed;
    writer.start({ owner: claim.owner });
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
