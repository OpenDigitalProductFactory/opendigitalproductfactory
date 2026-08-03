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
} from "./lib/local-ci-slot-manifest.mjs";
import {
  isRecoverableInterruptedGateState,
  readLocalCiGateState,
  writeLocalCiGateState,
} from "./lib/local-ci-gate-state.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(THIS_FILE);

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
    rootClone: dirname(gitCommonDir),
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

  const leaseEvents = [
    ...(Array.isArray(state.leaseEvents) ? state.leaseEvents : []),
    recoveryEvent,
  ];
  writeStateImpl(stateFile, {
    branch,
    sha,
    gatePassed: false,
    leaseId: state.leaseId,
    evidenceId: "",
    status: "failed",
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
    },
  });
  return {
    recovered: true,
    releaseSucceeded,
    releaseError,
    leaseId: state.leaseId,
  };
}

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

async function main() {
  const args = process.argv.slice(2);

  const diskCheck = checkHostDiskSpace();
  if (!diskCheck.ok) {
    process.stderr.write(`pregate: ${diskCheck.message}\n`);
    process.exit(1);
  }

  if (shouldRunPreflight(args)) {
    const preflight = spawnSync(
      process.execPath,
      [join(SCRIPT_DIR, "pregate-preflight.mjs")],
      { stdio: "inherit" },
    );
    if (preflight.error || (preflight.status ?? 1) !== 0) {
      process.stderr.write(
        "pregate: guard parity preflight failed — fix the deterministic guard failures above before the sandbox gate runs (no lease was claimed).\n",
      );
      process.exit(preflight.status ?? 1);
    }
  } else if (process.env.DPF_SKIP_PREGATE_PREFLIGHT_REASON) {
    process.stderr.write(
      `pregate: guard parity preflight SKIPPED — DPF_SKIP_PREGATE_PREFLIGHT_REASON=${process.env.DPF_SKIP_PREGATE_PREFLIGHT_REASON}\n`,
    );
  }

  const useShell = shouldUseShell();

  let result;
  if (useShell) {
    process.stderr.write("pregate: DPF_PREGATE_FORCE_SH=1 set — routing through compatibility shell entry point.\n");
    result = spawnSync("sh", [join(SCRIPT_DIR, "gate-worktree.sh"), ...args], { stdio: "inherit" });
  } else {
    process.stderr.write("pregate: routing through the Node-native gate (scripts/gate-worktree.mjs).\n");
    result = spawnSync(process.execPath, [join(SCRIPT_DIR, "gate-worktree.mjs"), ...args], { stdio: "inherit" });
  }

  if (result.error) {
    process.stderr.write(`pregate: failed to launch gate: ${result.error.message}\n`);
    process.exit(1);
  }
  const status = result.status ?? 1;
  if (status !== 0) {
    await recoverInterruptedGate({ args, result });
  }
  process.exit(status);
}

// Guard against side effects on import (e.g. from tests importing routing
// helpers) — only run when this file is the process entry point.
if (process.argv[1] === THIS_FILE) {
  main().catch((error) => {
    process.stderr.write(`pregate: ${error?.stack || String(error)}\n`);
    process.exit(1);
  });
}
