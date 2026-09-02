#!/usr/bin/env node
// pregate.mjs — host-native/Node-first entry point for `pnpm run pregate`
// (BI-2272D840).
//
// Context: BI-C22152E7 hit a Codex Windows worktree where the automatic
// `pnpm run pregate` path (`sh scripts/gate-worktree.sh`) could not run —
// native POSIX `sh` was unavailable and WSL could not cleanly read the
// Windows worktree's `.git` indirection. That is harness friction, not a
// product blocker (docs/testing/pre-pr-gate.md), but the process depended on
// the agent recognizing that doctrine and hand-driving the sandbox lease
// steps manually instead of it just working.
//
// The canonical route is now the Node-native gate on every host; the shell
// entry point remains a compatibility wrapper and can be forced only for
// focused debugging. This keeps lease/fence safety in one implementation.

import { spawnSync } from "node:child_process";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { mcpCall } from "./lib/mcp-client.mjs";
import { checkHostDiskSpace } from "./lib/disk-space-preflight.mjs";
import {
  createLocalCiSlotManifest,
  LOCAL_CI_SLOT_KEYS,
  resolveLocalCiRootClone,
} from "./lib/local-ci-slot-manifest.mjs";
import {
  isRecoverableInterruptedGateState,
  readLocalCiGateState,
  writeLocalCiGateState,
} from "./lib/local-ci-gate-state.mjs";
import {
  releaseDeadLocalQueueObserversForGate,
  releaseLocalQueueObserver,
} from "./lib/local-queue-observer.mjs";
import {
  installBrokenPipeTolerance,
  isVerboseGateConsole,
} from "./lib/pregate-console.mjs";
import { collectSlotVerdicts, resolveWorktreeContext } from "./pregate-status.mjs";
import { reconcileSlots } from "./lib/pregate-status.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(THIS_FILE);
export const WINDOWS_WRAPPER_TERMINATED_STATUS = 4294967295;

// BI-A9CF0D69 (plan §3 M5): the wrapper's exit 0 must MEAN "gated and passed".
// Historically a run that gave up while queued could surface exit 0 having
// gated nothing (BI-2C7F51BA), and pregate:status existed to compensate. The
// compensation stays (a SHA-bound record beats any exit code), but the wrapper
// no longer tells the lie: an abandoned admission window, or a zero exit the
// slot records cannot corroborate as PASS-at-HEAD, exits this distinct code.
export const ABANDONED_OR_UNRECORDED_EXIT_CODE = 7;

// Invocations that legitimately exit 0 without writing a PASS record: routing
// probes and evidence replays change nothing about the tree and are exempt
// from record corroboration — the same closed set shouldRunPreflight() exempts.
export function isRecordExemptInvocation(args) {
  return (
    args.includes("--dry-run")
    || args.includes("--finalize-evidence")
    || args.includes("--help")
    || args.includes("-h")
  );
}

// Pure exit-code policy so the honesty rules are unit-testable without a gate:
// timedOut (admission window elapsed, nothing gated) and status-0-without-a-
// corroborating-PASS both map to ABANDONED_OR_UNRECORDED_EXIT_CODE; a genuine
// failure keeps its own status; exempt invocations pass a zero through.
export function resolveWrapperExitCode({ status, timedOut, recordExempt, verdictAtHead }) {
  if (timedOut) return ABANDONED_OR_UNRECORDED_EXIT_CODE;
  if (status !== 0) return status ?? 1;
  if (recordExempt) return 0;
  return verdictAtHead === "PASS" ? 0 : ABANDONED_OR_UNRECORDED_EXIT_CODE;
}
const DEFAULT_LEASE_WAIT_SECONDS = 7200;

// Host-side guard parity preflight (BI-D35433FB): run the deterministic CI
// policy guards before lease admission so a doomed gate never occupies a
// contended local-integration-ci sandbox slot. Routing probes (--dry-run) and
// evidence replays (--finalize-evidence) change nothing about the tree and
// skip it; DPF_SKIP_PREGATE_PREFLIGHT_REASON is the recorded emergency skip.
export function shouldRunPreflight(args, env = process.env) {
  if (args.includes("--dry-run") || args.includes("--finalize-evidence")) return false;
  if (env.DPF_SKIP_PREGATE_PREFLIGHT_REASON) return false;
  return true;
}

export function detectWorkingShell({ cwd = process.cwd(), spawnSyncImpl = spawnSync, env = process.env } = {}) {
  if (env.DPF_PREGATE_FORCE_NODE === "1") return false;
  try {
    const result = spawnSyncImpl("sh", ["-c", "git rev-parse --show-toplevel"], { cwd, encoding: "utf8" });
    return result.status === 0 && !result.error && Boolean(result.stdout && result.stdout.trim());
  } catch {
    return false;
  }
}

export function shouldUseShell({ env = process.env, cwd = process.cwd(), spawnSyncImpl = spawnSync } = {}) {
  if (env.DPF_PREGATE_FORCE_NODE === "1") return false;
  if (env.DPF_PREGATE_FORCE_SH === "1") {
    return detectWorkingShell({ cwd, spawnSyncImpl });
  }
  return false;
}

function argValue(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) return "";
  return args[index + 1] || "";
}

function leaseWaitSeconds(args, env) {
  const configured = argValue(args, "--lease-wait-seconds")
    || env.DPF_GATE_LEASE_WAIT_SECONDS
    || String(DEFAULT_LEASE_WAIT_SECONDS);
  const seconds = Number(configured);
  return Number.isFinite(seconds) && seconds >= 0
    ? seconds
    : DEFAULT_LEASE_WAIT_SECONDS;
}

export function createQueuedGateRevivalWindow({
  args = [],
  env = process.env,
  nowMs = Date.now(),
} = {}) {
  return {
    startedAtMs: nowMs,
    deadlineMs: nowMs + leaseWaitSeconds(args, env) * 1000,
  };
}

export function gateArgsForQueuedRevivalWindow({
  args = [],
  window,
  nowMs = Date.now(),
} = {}) {
  const remainingMs = window?.deadlineMs - nowMs;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;

  const remainingSeconds = String(Math.ceil(remainingMs / 1000));
  const nextArgs = [...args];
  const flagIndex = nextArgs.indexOf("--lease-wait-seconds");
  if (flagIndex >= 0) {
    nextArgs[flagIndex + 1] = remainingSeconds;
  } else {
    nextArgs.push("--lease-wait-seconds", remainingSeconds);
  }
  return nextArgs;
}

function gitText(gitArgs, { cwd, spawnSyncImpl = spawnSync } = {}) {
  const result = spawnSyncImpl("git", gitArgs, { cwd, encoding: "utf8" });
  if (result.error || result.status !== 0) return "";
  return String(result.stdout || "").trim();
}

export function resolvePregateGateContext({
  args = [],
  cwd = process.cwd(),
  spawnSyncImpl = spawnSync,
} = {}) {
  const worktreePath = argValue(args, "--worktree")
    || gitText(["rev-parse", "--show-toplevel"], { cwd, spawnSyncImpl });
  if (!worktreePath) throw new Error("could not resolve worktree path");
  const branch = argValue(args, "--branch")
    || gitText(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: worktreePath, spawnSyncImpl });
  const sha = argValue(args, "--sha")
    || gitText(["rev-parse", "HEAD"], { cwd: worktreePath, spawnSyncImpl });
  const gitCommonDirRaw = gitText(["rev-parse", "--git-common-dir"], { cwd: worktreePath, spawnSyncImpl });
  const statePathRaw = gitText(["rev-parse", "--git-path", "dpf-local-ci-gate.json"], { cwd: worktreePath, spawnSyncImpl });
  if (!branch || branch === "HEAD" || !sha || !gitCommonDirRaw || !statePathRaw) {
    throw new Error("could not resolve local-CI gate git context");
  }
  const gitCommonDir = resolvePath(worktreePath, gitCommonDirRaw);
  const candidateGitDir = dirname(resolvePath(worktreePath, statePathRaw));
  return {
    branch,
    sha,
    worktreePath,
    gitCommonDir,
    rootClone: resolveLocalCiRootClone(gitCommonDir),
    candidateGitDir,
  };
}

export function findRecoverableInterruptedGateStates({
  context,
  readStateImpl = readLocalCiGateState,
} = {}) {
  const found = [];
  for (const slotKey of LOCAL_CI_SLOT_KEYS) {
    const manifest = createLocalCiSlotManifest({
      slotKey,
      rootClone: context.rootClone,
      gitCommonDir: context.gitCommonDir,
      candidateGitDir: context.candidateGitDir,
    });
    const state = readStateImpl(manifest.evidence.state);
    if (isRecoverableInterruptedGateState(state, {
      branch: context.branch,
      sha: context.sha,
    })) {
      found.push({ manifest, state, stateFile: manifest.evidence.state });
    }
  }
  return found;
}

export async function recoverInterruptedGateState({
  stateFile,
  state,
  branch,
  sha,
  childStatus = null,
  childSignal = "",
  mcpUrl = process.env.DPF_MCP_URL || "http://127.0.0.1:3000/api/mcp/v1",
  bearerToken = process.env.DPF_MCP_BEARER_TOKEN,
  mcpCallImpl = mcpCall,
  releaseLocalQueueObserverImpl = releaseLocalQueueObserver,
  releaseDeadLocalQueueObserversForGateImpl = releaseDeadLocalQueueObserversForGate,
  queueObserverFallbackDirectory = "",
  writeStateImpl = writeLocalCiGateState,
  now = () => new Date().toISOString(),
} = {}) {
  if (!isRecoverableInterruptedGateState(state, { branch, sha })) {
    return { recovered: false, reason: "state-not-recoverable" };
  }

  let releaseSucceeded = false;
  let releaseError = "";
  if (!bearerToken) {
    releaseError = "missing DPF_MCP_BEARER_TOKEN";
  } else {
    try {
      const response = await mcpCallImpl(
        "release_nonprod_environment_lease",
        { leaseId: state.leaseId },
        { mcpUrl, bearerToken },
      );
      releaseSucceeded = response?.success === true;
      if (!releaseSucceeded) releaseError = JSON.stringify(response);
    } catch (error) {
      releaseError = error instanceof Error ? error.message : String(error);
    }
  }

  const recoveryEvent = {
    type: "pregate_interrupted_gate_recovery",
    at: now(),
    childStatus,
    childSignal: childSignal || "",
    releaseAttempted: Boolean(bearerToken),
    releaseSucceeded,
  };
  if (releaseError) recoveryEvent.releaseError = releaseError;

  let queueObserverReleaseAttempted = false;
  let queueObserverReleaseStatus = "";
  let queueObserverReleaseError = "";
  let queueObserverFallbackReleases = [];
  const queueObserver = state.queueObserver;
  if (
    queueObserver
    && typeof queueObserver.path === "string"
    && typeof queueObserver.token === "string"
  ) {
    queueObserverReleaseAttempted = true;
    try {
      const released = releaseLocalQueueObserverImpl({
        path: queueObserver.path,
        token: queueObserver.token,
      });
      queueObserverReleaseStatus = released?.status || "unknown";
    } catch (error) {
      queueObserverReleaseError = error instanceof Error ? error.message : String(error);
    }
  }
  if (!queueObserverReleaseAttempted && queueObserverFallbackDirectory) {
    try {
      queueObserverFallbackReleases = releaseDeadLocalQueueObserversForGateImpl({
        directory: queueObserverFallbackDirectory,
        branch,
        sha,
      });
      if (queueObserverFallbackReleases.length > 0) {
        queueObserverReleaseAttempted = true;
        queueObserverReleaseStatus = `fallback-released:${queueObserverFallbackReleases.length}`;
      }
    } catch (error) {
      queueObserverReleaseAttempted = true;
      queueObserverReleaseError = error instanceof Error ? error.message : String(error);
    }
  }
  if (queueObserverReleaseAttempted) {
    recoveryEvent.queueObserverReleaseStatus = queueObserverReleaseStatus;
    if (queueObserverFallbackReleases.length > 0) {
      recoveryEvent.queueObserverFallbackReleases = queueObserverFallbackReleases;
    }
    if (queueObserverReleaseError) {
      recoveryEvent.queueObserverReleaseError = queueObserverReleaseError;
    }
  }

  const leaseEvents = [
    ...(Array.isArray(state.leaseEvents) ? state.leaseEvents : []),
    recoveryEvent,
  ];
  // BI-D088D06D: the wrapper exiting before a terminal state is infrastructure
  // — a killed process, a host under pressure, a lost control plane. It is NOT
  // a grade on the diff, and it never graded the diff: the run died before it
  // could. Writing "failed" here made pregate:status report FAIL, which reads as
  // "your code is bad", permanently consumed that SHA's verdict, and forced an
  // amend to a fresh SHA. Measured 2026-09-02: 4 of 5 gated branches needed more
  // than one lease attempt.
  //
  // The queued path already recovers (it rewrites status "queued" and preserves
  // the lease). The running path cannot preserve the lease — the slot must be
  // freed for the next claimant — but it must still tell the truth about cause.
  // `blocked_*` is the vocabulary pregate-status already classifies as
  // INCONCLUSIVE, so this needs no reader change and inherits the honest
  // headline the blocked statuses already earn.
  writeStateImpl(stateFile, {
    branch,
    sha,
    gatePassed: false,
    leaseId: state.leaseId,
    evidenceId: "",
    status: "blocked_wrapper_exited",
    expiresAt: state.expiresAt || "",
    resilience: state.resilience ?? null,
    leaseEvents,
    evidencePending: false,
    recovery: {
      reason: "gate-wrapper-exited-before-terminal-state",
      childStatus,
      childSignal: childSignal || "",
      releaseSucceeded,
      releaseError,
      queueObserverReleaseAttempted,
      queueObserverReleaseStatus,
      queueObserverReleaseError,
      queueObserverFallbackReleases,
    },
  });
  return {
    recovered: true,
    releaseSucceeded,
    releaseError,
    leaseId: state.leaseId,
  };
}

export async function reviveInterruptedQueuedGateState({
  stateFile,
  state,
  branch,
  sha,
  childStatus = null,
  childSignal = "",
  releaseLocalQueueObserverImpl = releaseLocalQueueObserver,
  releaseDeadLocalQueueObserversForGateImpl = releaseDeadLocalQueueObserversForGate,
  queueObserverFallbackDirectory = "",
  writeStateImpl = writeLocalCiGateState,
  now = () => new Date().toISOString(),
} = {}) {
  if (!isRecoverableInterruptedGateState(state, { branch, sha }) || state.status !== "queued") {
    return { revived: false, reason: "state-not-queued-revivable" };
  }
  if (childStatus !== WINDOWS_WRAPPER_TERMINATED_STATUS) {
    return { revived: false, reason: "status-not-wrapper-termination" };
  }

  let queueObserverReleaseAttempted = false;
  let queueObserverReleaseStatus = "";
  let queueObserverReleaseError = "";
  let queueObserverFallbackReleases = [];
  const queueObserver = state.queueObserver;
  if (
    queueObserver
    && typeof queueObserver.path === "string"
    && typeof queueObserver.token === "string"
  ) {
    queueObserverReleaseAttempted = true;
    try {
      const released = releaseLocalQueueObserverImpl({
        path: queueObserver.path,
        token: queueObserver.token,
      });
      queueObserverReleaseStatus = released?.status || "unknown";
    } catch (error) {
      queueObserverReleaseError = error instanceof Error ? error.message : String(error);
    }
  }
  if (!queueObserverReleaseAttempted && queueObserverFallbackDirectory) {
    try {
      queueObserverFallbackReleases = releaseDeadLocalQueueObserversForGateImpl({
        directory: queueObserverFallbackDirectory,
        branch,
        sha,
      });
      if (queueObserverFallbackReleases.length > 0) {
        queueObserverReleaseAttempted = true;
        queueObserverReleaseStatus = `fallback-released:${queueObserverFallbackReleases.length}`;
      }
    } catch (error) {
      queueObserverReleaseAttempted = true;
      queueObserverReleaseError = error instanceof Error ? error.message : String(error);
    }
  }

  const revivalEvent = {
    type: "pregate_interrupted_queue_revival",
    at: now(),
    childStatus,
    childSignal: childSignal || "",
    leasePreserved: true,
    queueObserverReleaseAttempted,
    queueObserverReleaseStatus,
  };
  if (queueObserverFallbackReleases.length > 0) {
    revivalEvent.queueObserverFallbackReleases = queueObserverFallbackReleases;
  }
  if (queueObserverReleaseError) revivalEvent.queueObserverReleaseError = queueObserverReleaseError;

  const leaseEvents = [
    ...(Array.isArray(state.leaseEvents) ? state.leaseEvents : []),
    revivalEvent,
  ];
  writeStateImpl(stateFile, {
    branch,
    sha,
    gatePassed: false,
    leaseId: state.leaseId,
    evidenceId: "",
    status: "queued",
    expiresAt: state.expiresAt || "",
    resilience: state.resilience ?? null,
    leaseEvents,
    evidencePending: false,
    recovery: {
      reason: "queued-gate-wrapper-exited-resuming",
      childStatus,
      childSignal: childSignal || "",
      leasePreserved: true,
      queueObserverReleaseAttempted,
      queueObserverReleaseStatus,
      queueObserverReleaseError,
      queueObserverFallbackReleases,
    },
  });
  return {
    revived: true,
    leaseId: state.leaseId,
    queueObserverReleaseStatus,
    queueObserverReleaseError,
  };
}

export async function reviveInterruptedQueuedGate({
  args = [],
  result,
  cwd = process.cwd(),
  spawnSyncImpl = spawnSync,
  releaseLocalQueueObserverImpl = releaseLocalQueueObserver,
  releaseDeadLocalQueueObserversForGateImpl = releaseDeadLocalQueueObserversForGate,
  writeStateImpl = writeLocalCiGateState,
  stderr = process.stderr,
} = {}) {
  const status = result?.status ?? 1;
  if (
    status !== WINDOWS_WRAPPER_TERMINATED_STATUS
    || args.includes("--dry-run")
    || args.includes("--finalize-evidence")
  ) {
    return { revived: false, reason: "not-a-queued-revival-invocation" };
  }
  let context;
  try {
    context = resolvePregateGateContext({ args, cwd, spawnSyncImpl });
  } catch (error) {
    stderr.write(`pregate: queued gate revival skipped (${error.message}).\n`);
    return { revived: false, reason: "context-unavailable" };
  }

  const candidates = findRecoverableInterruptedGateStates({ context })
    .filter((candidate) => candidate.state.status === "queued");
  for (const candidate of candidates) {
    const revived = await reviveInterruptedQueuedGateState({
      stateFile: candidate.stateFile,
      state: candidate.state,
      branch: context.branch,
      sha: context.sha,
      childStatus: result?.status ?? null,
      childSignal: result?.signal || "",
      releaseLocalQueueObserverImpl,
      releaseDeadLocalQueueObserversForGateImpl,
      queueObserverFallbackDirectory: process.env.DPF_LOCAL_QUEUE_OBSERVER_DIR
        || resolvePath(context.gitCommonDir, "dpf-local-ci-queue-observers"),
      writeStateImpl,
    });
    if (revived.revived) {
      stderr.write(
        `pregate: revived interrupted queued local-CI gate for ${context.branch} @ ${context.sha}; preserved lease ${revived.leaseId}; restarting gate observer.\n`,
      );
      return revived;
    }
  }
  return { revived: false, reason: "no-queued-state" };
}

/**
 * `gate-worktree.mjs` exits with this when the lease became a durable queue task.
 * A queued run is not a failed run and must never be recovered as one.
 */
export const EXIT_DURABLE_QUEUE_WAIT = 75;

export async function recoverInterruptedGate({
  args = [],
  result,
  cwd = process.cwd(),
  env = process.env,
  spawnSyncImpl = spawnSync,
  mcpCallImpl = mcpCall,
  stderr = process.stderr,
} = {}) {
  const status = result?.status ?? 1;
  if (status === 0 || args.includes("--dry-run") || args.includes("--finalize-evidence")) {
    return { recovered: false, reason: "not-a-recoverable-invocation" };
  }
  // BI-465B3D60. Exit 75 is the gate telling us it QUEUED, not that it broke:
  // gate-worktree.mjs exits 75 after printing {status:"queued", code:
  // "local_ci_durable_wait", resumeMode:"durable-task"} because the lease is a
  // durable task that outlives this process and resumes on the next invocation.
  //
  // Recovery fired on any non-zero status, so it treated that as an interrupted
  // run, tried to release a lease this process does not own
  // (nonprod_lease_not_owner, retryable:false), and stamped the state `failed`.
  // `pregate:status` then reported "status failed with NO recorded reason" for a
  // lease that was queued, healthy and heartbeating — the exact category error
  // this item was filed for ("losing a slot is not the same verdict as failing a
  // gate"), reintroduced downstream of the classifier that already handles 75.
  //
  // Reproduced on a five-deep queue, unpiped and with no concurrent reader, on
  // three consecutive invocations while the position advanced 3 -> 2.
  if (status === EXIT_DURABLE_QUEUE_WAIT) {
    return { recovered: false, reason: "queued-durable-task" };
  }
  let context;
  try {
    context = resolvePregateGateContext({ args, cwd, spawnSyncImpl });
  } catch (error) {
    stderr.write(`pregate: interrupted gate recovery skipped (${error.message}).\n`);
    return { recovered: false, reason: "context-unavailable" };
  }

  const candidates = findRecoverableInterruptedGateStates({ context });
  for (const candidate of candidates) {
    const recovered = await recoverInterruptedGateState({
      stateFile: candidate.stateFile,
      state: candidate.state,
      branch: context.branch,
      sha: context.sha,
      childStatus: result?.status ?? null,
      childSignal: result?.signal || "",
      mcpUrl: env.DPF_MCP_URL || "http://127.0.0.1:3000/api/mcp/v1",
      bearerToken: env.DPF_MCP_BEARER_TOKEN,
      mcpCallImpl,
      queueObserverFallbackDirectory: env.DPF_LOCAL_QUEUE_OBSERVER_DIR
        || resolvePath(context.gitCommonDir, "dpf-local-ci-queue-observers"),
    });
    if (recovered.recovered) {
      const releaseText = recovered.releaseSucceeded
        ? "released the lease"
        : `could not release the lease (${recovered.releaseError || "unknown error"})`;
      stderr.write(
        `pregate: recovered interrupted local-CI gate for ${context.branch} @ ${context.sha}; ${releaseText}; marked the local gate state failed.\n`,
      );
      return recovered;
    }
  }
  return { recovered: false, reason: "no-running-state" };
}

export async function runGateWithQueuedRevival({
  args = [],
  useShell = false,
  env = process.env,
  now = () => Date.now(),
  spawnSyncImpl = spawnSync,
  reviveInterruptedQueuedGateImpl = reviveInterruptedQueuedGate,
  recoverInterruptedGateImpl = recoverInterruptedGate,
  stderr = process.stderr,
} = {}) {
  let result;
  let queuedRevivals = 0;
  const queueRevivalWindow = createQueuedGateRevivalWindow({
    args,
    env,
    nowMs: now(),
  });

  for (;;) {
    const invocationArgs = queuedRevivals === 0
      ? args
      : gateArgsForQueuedRevivalWindow({
        args,
        window: queueRevivalWindow,
        nowMs: now(),
      });
    if (!invocationArgs) {
      await recoverInterruptedGateImpl({ args, result });
      stderr.write("pregate: original bounded local-CI admission window elapsed; no further queued gate revival will be started.\n");
      return { result, queuedRevivals, timedOut: true };
    }

    if (useShell) {
      stderr.write("pregate: DPF_PREGATE_FORCE_SH=1 set — routing through compatibility shell entry point.\n");
      result = spawnSyncImpl("sh", [join(SCRIPT_DIR, "gate-worktree.sh"), ...invocationArgs], { stdio: "inherit" });
    } else {
      stderr.write("pregate: routing through the Node-native gate (scripts/gate-worktree.mjs).\n");
      result = spawnSyncImpl(process.execPath, [join(SCRIPT_DIR, "gate-worktree.mjs"), ...invocationArgs], { stdio: "inherit" });
    }

    if (result.error || (result.status ?? 1) === 0) {
      return { result, queuedRevivals, timedOut: false };
    }
    if (now() < queueRevivalWindow.deadlineMs) {
      const revived = await reviveInterruptedQueuedGateImpl({ args, result });
      if (revived.revived) {
        queuedRevivals += 1;
        stderr.write(`pregate: queued gate revival ${queuedRevivals}; continuing within the original bounded admission window without losing FIFO position.\n`);
        continue;
      }
    }
    await recoverInterruptedGateImpl({ args, result });
    return { result, queuedRevivals, timedOut: false };
  }
}

async function main() {
  // BI-B1065D41: `pnpm run pregate | head -5` must survive head exiting. Both
  // this wrapper and the gate it spawns need the tolerance — the gate inherits
  // these very file descriptors.
  installBrokenPipeTolerance();
  const args = process.argv.slice(2);

  const diskCheck = checkHostDiskSpace();
  if (!diskCheck.ok) {
    process.stderr.write(`pregate: ${diskCheck.message}\n`);
    process.exit(1);
  }

  if (shouldRunPreflight(args)) {
    // BI-B1065D41: the guard-parity preflight is loud and, on a passing run,
    // uninteresting — including a TOLERATED GuardRuntimeEnvironmentError that
    // prints `Error:` and a red cross on runs that PASS, which is exactly the
    // text a log-tail reader mistakes for a failure. Capture it and replay it
    // only when it actually fails.
    const verbose = isVerboseGateConsole();
    const preflight = spawnSync(
      process.execPath,
      [join(SCRIPT_DIR, "pregate-preflight.mjs")],
      verbose ? { stdio: "inherit" } : { encoding: "utf8" },
    );
    if (preflight.error || (preflight.status ?? 1) !== 0) {
      if (!verbose) {
        process.stderr.write(String(preflight.stdout || ""));
        process.stderr.write(String(preflight.stderr || ""));
      }
      // BI-AA2EE621: the preflight process itself being killed or failing to
      // spawn (taskkill /T during an eviction leaves status === null) is a
      // runner failure, not a deterministic guard violation — say so, or the
      // reader audits an innocent guard the loop never even reported on.
      const preflightKilled = Boolean(preflight.error) || preflight.status === null;
      process.stderr.write(
        preflightKilled
          ? "pregate: guard parity preflight could not RUN on this host (killed or failed to spawn — host under pressure, not a guard violation) — retry on a quieter host (no lease was claimed).\n"
          : "pregate: guard parity preflight failed — fix the deterministic guard failures above before the sandbox gate runs (no lease was claimed).\n",
      );
      process.exit(preflight.status ?? 1);
    }
    if (!verbose) {
      process.stdout.write("pregate: guard parity preflight passed.\n");
    }
  } else if (process.env.DPF_SKIP_PREGATE_PREFLIGHT_REASON) {
    process.stderr.write(
      `pregate: guard parity preflight SKIPPED — DPF_SKIP_PREGATE_PREFLIGHT_REASON=${process.env.DPF_SKIP_PREGATE_PREFLIGHT_REASON}\n`,
    );
  }

  const useShell = shouldUseShell();
  const { result, timedOut } = await runGateWithQueuedRevival({ args, useShell });
  if (result?.error) {
    process.stderr.write(`pregate: failed to launch gate: ${result.error.message}\n`);
    process.exit(1);
  }
  const recordExempt = isRecordExemptInvocation(args);
  const exitCode = resolveWrapperExitCode({
    status: result?.status ?? 1,
    timedOut: Boolean(timedOut),
    recordExempt,
    verdictAtHead: (result?.status ?? 1) === 0 && !recordExempt && !timedOut
      ? readReconciledVerdictAtHead()
      : "",
  });
  if (exitCode === ABANDONED_OR_UNRECORDED_EXIT_CODE) {
    process.stderr.write(
      timedOut
        ? `pregate: admission window elapsed without gating — exiting ${ABANDONED_OR_UNRECORDED_EXIT_CODE}, not 0; nothing was verified (BI-A9CF0D69).\n`
        : `pregate: gate reported 0 but no PASS record exists for current HEAD — treating as did-not-run and exiting ${ABANDONED_OR_UNRECORDED_EXIT_CODE} (BI-A9CF0D69). Read the verdict with: pnpm run pregate:status\n`,
    );
  }
  process.exit(exitCode);
}

// Read the same SHA-bound slot records pregate:status reads, reduced to the
// reconciled verdict for current HEAD. Failure to read is "", never "PASS" —
// corroboration must fail closed or the honesty rule re-opens the exit-0 hole.
export function readReconciledVerdictAtHead({
  resolveContextImpl = resolveWorktreeContext,
  collectVerdictsImpl = collectSlotVerdicts,
  reconcileImpl = reconcileSlots,
} = {}) {
  try {
    const context = resolveContextImpl();
    if (!context) return "";
    const slots = collectVerdictsImpl(context);
    if (slots.length === 0) return "";
    return reconcileImpl(slots)?.verdict ?? "";
  } catch {
    return "";
  }
}

// Guard against side effects on import (e.g. from tests importing routing
// helpers) — only run when this file is the process entry point. Entry-path
// comparison must survive symlinked invocation spellings (macOS /var tmpdir),
// or the guard silently skips main() and exits 0 (BI-745658D7).
if (isEntryModule(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`pregate: ${error?.stack || String(error)}\n`);
    process.exit(1);
  });
}
