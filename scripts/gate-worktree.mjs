#!/usr/bin/env node
// gate-worktree.mjs — Node-native port of scripts/gate-worktree.sh
// (BI-2272D840). Same local-CI lease/evidence contract, implemented without a
// dependency on a working native `sh`: git info via spawnSync, MCP calls via
// fetch (scripts/lib/mcp-client.mjs), freshness classification via the shared
// scripts/lib/sandbox-freshness.mjs decision core.
//
// This is the canonical implementation on every host. gate-worktree.sh is a
// compatibility entry point that execs this file so lease safety cannot drift
// between POSIX and Windows contributor surfaces.

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { mcpCall } from "./lib/mcp-client.mjs";

// BI-46B03CAE — the lease-queue MCP calls cost more than mcpCall's 10s default.
//
// Their latency tracks the number of waiters, not the size of the response: with
// four branches queued on this box, `list_nonprod_environment_leases` measured
// 10166ms and SUCCEEDED — 166ms past the client's deadline. The portal was
// healthy throughout (/api/health ~85ms, 4.5% CPU), so nothing was broken; the
// gate simply stopped listening to an answer that was on its way.
//
// The cost of abandoning it is not one retry. A claim that times out client-side
// after the server created the queued row leaves a gate that does not own the
// lease it just made, so its own cleanup refuses with `nonprod_lease_not_owner`
// (explicitly non-retryable) and the row stays queued. Each failure adds a
// waiter to a single-slot pool, which makes the next listing slower, which
// strands the next row. Left alone it converges on a box where no gate can ever
// claim and every contributor is told the portal timed out.
//
// So these calls get real headroom, tunable without patching source. The global
// default stays at 10s: a health probe should still fail fast.
const LEASE_QUEUE_TIMEOUT_MS = (() => {
  const raw = Number(process.env.DPF_GATE_MCP_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000;
})();

/** Transport options for a queue call whose latency grows with the queue. */
export function leaseQueueCallOptions(mcpUrl, bearerToken) {
  return { mcpUrl, bearerToken, timeoutMs: LEASE_QUEUE_TIMEOUT_MS };
}

/**
 * Describe a failed lease-queue call in the terms the operator has to act on.
 *
 * "timed out after 60000ms" reads as an unreachable portal and sends people to
 * check whether the install is up. When a queue call is what timed out, the
 * portal is usually fine and the queue is merely deep — a different problem
 * with a different response, so say which one it is (BI-46B03CAE).
 */
export function describeLeaseCallFailure(error) {
  const message = error?.message ?? String(error);
  if (!/timed out after/.test(message)) return message;
  return `${message} — the portal may be reachable and merely contended; `
    + "lease-queue calls slow down as waiters accumulate. Raise DPF_GATE_MCP_TIMEOUT_MS "
    + "if this box regularly runs several gates at once";
}
import { summarizeLocalCiOutput } from "./lib/local-ci-failure-summary.mjs";
import { classifyGateOutcome } from "./lib/sandbox-freshness.mjs";
import { fallbackStatusForUnknown } from "./lib/local-integration-status.mjs";
import {
  authoritySafetyMarginMs,
  superviseLeaseRun,
} from "./lib/lease-supervisor.mjs";
import {
  acquireLocalSandboxFence,
  heartbeatLocalSandboxFence,
  inspectLocalSandboxFence,
  releaseLocalSandboxFence,
} from "./lib/local-sandbox-fence.mjs";
import {
  createGateObserverIdentity,
  findDeadLocalQueueObservers,
  registerLocalQueueObserver,
  releaseDeadLocalQueueObserversForGate,
  releaseLocalQueueObserver,
} from "./lib/local-queue-observer.mjs";
import {
  LOCAL_CI_SLOT_KEYS,
  createLocalCiSlotManifest,
  localCiSlotEnvironment,
  resolveLocalCiRootClone,
} from "./lib/local-ci-slot-manifest.mjs";
import { classifyBaseResilience } from "./lib/local-ci-base-freshness.mjs";
import { runPreAdmissionDocumentationLane } from "./lib/documentation-evidence-lane.mjs";
import {
  createLocalCiPassEvidenceValidity,
  readLocalCiGateState,
  writeLocalCiGateState,
} from "./lib/local-ci-gate-state.mjs";
import {
  sampleLocalCiHostPressure,
  summarizeLocalCiPressureSamples,
} from "./lib/local-ci-host-pressure.mjs";
import { buildAttributionEvidence, resolveAgentIdentity } from "./lib/agent-identity.mjs";
import {
  createGateOutputRelay,
  createRepeatNotice,
  formatGateSummary,
  installBrokenPipeTolerance,
  isVerboseGateConsole,
} from "./lib/pregate-console.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(THIS_FILE);
const LOCAL_CI_ACTIVE_LEASE_TTL_MS = 2 * 60_000;
const DEAD_QUEUE_RECONCILIATION_INTERVAL_MS = 60_000;

const HARD_EXECUTION_PRESSURE_REASONS = new Set([
  "host-memory-low",
  "host-memory-unmeasurable",
  "host-disk-low",
  "host-disk-unmeasurable",
  "docker-unhealthy",
  "slot-fence-unhealthy",
  "evidence-isolation-unproven",
]);

export function executionPressureFenceReason(poolPolicy) {
  const reason = poolPolicy?.rollbackReason;
  return HARD_EXECUTION_PRESSURE_REASONS.has(reason)
    ? `host-capacity-lost:${reason}`
    : null;
}

function die(message) {
  process.stderr.write(`gate-worktree: ${message}\n`);
  process.exit(1);
}

// BI-B1065D41: every "still waiting" line goes through ONE repeat notice. A
// queued run polled admission ~40 times and printed 40 near-identical lines,
// which is a large slice of a readable budget for a single bit of information.
// The notice prints when the shape changes (the queue position moved, a
// different blocker appeared) and otherwise re-prints periodically so a long
// wait still proves liveness.
const waitNotice = createRepeatNotice({ write: (text) => process.stdout.write(text) });
function waiting(text) {
  waitNotice.notice(text);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function observeLocalCiHostPressure(input) {
  if (
    process.env.NODE_ENV === "test"
    && process.env.DPF_LOCAL_CI_HOST_PRESSURE_JSON
  ) {
    return JSON.parse(process.env.DPF_LOCAL_CI_HOST_PRESSURE_JSON);
  }
  const manifests = LOCAL_CI_SLOT_KEYS.map((slotKey) =>
    createLocalCiSlotManifest({ ...input, slotKey }));
  return sampleLocalCiHostPressure({
    rootPath: input.rootClone,
    convergenceLockPaths: manifests.map(
      (manifest) => manifest.dependencies.convergenceLock,
    ),
    fencePaths: manifests.map((manifest) => manifest.fence.path),
    // Phase 2's manifest/cleanup/evidence contract is mechanically tested.
    // A later schema version must earn this assertion again.
    evidenceIsolationHealthy: manifests.every(
      (manifest) => manifest.schemaVersion === 1,
    ),
  });
}

function retryDelayMs({ attempt, pollSeconds, retryAfterSeconds = 0 }) {
  const floorMs = Math.max(10, pollSeconds * 1000);
  const requestedMs = Math.max(0, Number(retryAfterSeconds) * 1000);
  const exponentialMs = Math.min(15_000, floorMs * (2 ** Math.min(attempt, 6)));
  const baseMs = Math.max(requestedMs, exponentialMs);
  const jitterRatio = process.env.DPF_GATE_RETRY_JITTER === "0"
    ? 0
    : (Math.random() * 0.4) - 0.2;
  return Math.max(10, Math.round(baseMs * (1 + jitterRatio)));
}

function isTransientMcpError(error) {
  const text = error instanceof Error ? error.message : String(error);
  return /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|socket hang up|invalid JSON response|fetch failed/i.test(text);
}

function numberOrDefault(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function defaultProcessScanMs(platform = process.platform) {
  return platform === "win32" ? 5000 : 250;
}

export function defaultDescendantPollMs(platform = process.platform) {
  return platform === "win32" ? 1000 : 250;
}

function git(gitBin, args, cwd) {
  if (
    process.platform === "win32"
    && process.env.DPF_GATE_GIT_BIN
    && !/\.(?:exe|cmd|bat)$/i.test(gitBin)
  ) {
    return spawnSync("sh", [gitBin, ...args], { cwd, encoding: "utf8" });
  }
  return spawnSync(gitBin, args, { cwd, encoding: "utf8" });
}

function gitOrEmpty(gitBin, args, cwd) {
  const result = git(gitBin, args, cwd);
  return result.status === 0 ? result.stdout.trim() : "";
}

// `git rev-parse --git-path` prints a path relative to the invocation's own
// cwd (not necessarily the process's cwd — we always pass `cwd` explicitly
// so this works when --worktree differs from where node was launched).
// Resolve it to absolute immediately so every later fs call is unambiguous
// regardless of the *process's* cwd.
function gitPath(gitBin, cwd, name) {
  const result = gitOrEmpty(gitBin, ["rev-parse", "--git-path", name], cwd);
  if (!result) die(`could not resolve git-path ${name}`);
  return resolvePath(cwd, result);
}

function usage() {
  return `Usage: node scripts/gate-worktree.mjs [options]

Options:
  --branch NAME              Branch to gate (default: current branch)
  --sha SHA                  Commit SHA to gate (default: HEAD)
  --worktree PATH            Worktree path (default: git rev-parse --show-toplevel)
  --remote NAME               Remote used only with --push (default: origin)
  --owner-provider NAME       build-studio|claude|codex|grok|antigravity|coworker
                              (default: detected from the client environment)
  --owner-session-id ID       Client THREAD id, so repeated gates from one
                              thread roll up (default: detected from the client
                              environment)
  --mcp-url URL                MCP endpoint (default: DPF_MCP_URL or local portal)
  --lease-wait-seconds N       Max time to wait for admission (default: 7200)
  --poll-seconds N             Initial queue-observation backoff (default: 10)
  --expires-minutes N          Lease expiry window (default: 2; local-CI cap: 2)
  --push                       Push before claiming the lease (legacy/explicit publication mode)
  --no-push                    Do not push before claiming the lease (default)
  --dry-run                    Print planned actions; skip git push and MCP calls
  --finalize-evidence          Publish pending evidence or attest an exact legacy PASS without rerunning
  --help                       Show this help

Environment:
  DPF_LOCAL_CI_COMMAND        Command to run while holding the local-CI lease.
                              Default: node scripts/local-ci-runner.mjs --candidate <branch>
  DPF_ALLOW_LOCAL_CI_STUB=1   Test-only escape hatch for the Phase 1 stub.
`;
}

function parseArgs(argv) {
  const options = {
    branch: "",
    sha: "",
    worktree: "",
    remote: "origin",
    // BI-3A34D7A9: no provider default. Defaulting to "codex" made every
    // client of every kind record itself as Codex; the identity is resolved
    // from the calling client's own environment below (resolveIdentity), and
    // an unresolvable one is recorded as unattributed rather than guessed.
    ownerProvider: process.env.DPF_GATE_OWNER_PROVIDER || "",
    ownerSessionId: process.env.DPF_GATE_OWNER_SESSION_ID || "",
    mcpUrl: process.env.DPF_MCP_URL || "http://127.0.0.1:3000/api/mcp/v1",
    leaseWaitSeconds: Number(process.env.DPF_GATE_LEASE_WAIT_SECONDS || 7200),
    pollSeconds: Number(process.env.DPF_GATE_POLL_SECONDS || 10),
    expiresMinutes: Number(process.env.DPF_GATE_EXPIRES_MINUTES || 2),
    pushBranch: false,
    dryRun: false,
    finalizeEvidence: false,
  };
  const args = [...argv];
  while (args.length > 0) {
    const flag = args.shift();
    switch (flag) {
      case "--branch": options.branch = args.shift() ?? ""; break;
      case "--sha": options.sha = args.shift() ?? ""; break;
      case "--worktree": options.worktree = args.shift() ?? ""; break;
      case "--remote": options.remote = args.shift() ?? ""; break;
      case "--owner-provider": options.ownerProvider = args.shift() ?? ""; break;
      case "--owner-session-id": options.ownerSessionId = args.shift() ?? ""; break;
      case "--mcp-url": options.mcpUrl = args.shift() ?? ""; break;
      case "--lease-wait-seconds": options.leaseWaitSeconds = Number(args.shift()); break;
      case "--poll-seconds": options.pollSeconds = Number(args.shift()); break;
      case "--expires-minutes": options.expiresMinutes = Number(args.shift()); break;
      case "--push": options.pushBranch = true; break;
      case "--no-push": options.pushBranch = false; break;
      case "--dry-run": options.dryRun = true; break;
      case "--finalize-evidence": options.finalizeEvidence = true; break;
      case "--help":
      case "-h":
        process.stdout.write(usage());
        process.exit(0); // exit-0: --help prints usage; nothing gated and nothing claimed
        break;
      case "--":
        break;
      default:
        die(`unknown option: ${flag}`);
    }
  }
  return options;
}

function resolveGateCommand({ branch, allowStub, gitBin }) {
  const explicit = process.env.DPF_LOCAL_CI_COMMAND;
  if (explicit) return { kind: "shell", value: explicit, label: explicit };
  if (!allowStub) {
    const runnerPath = `${SCRIPT_DIR}/local-ci-runner.mjs`;
    if (existsSync(runnerPath)) {
      const value = [process.execPath, runnerPath, "--candidate", branch];
      return { kind: "argv", value, label: `"${process.execPath}" "${runnerPath}" --candidate "${branch}"` };
    }
  }
  return null;
}

export function collectDescendantPids(rootPid, processRows) {
  const root = Number(rootPid);
  if (!Number.isInteger(root) || root <= 0) return [];
  const childrenByParent = new Map();
  for (const row of processRows || []) {
    const pid = Number(row?.pid);
    const parentPid = Number(row?.parentPid);
    if (!Number.isInteger(pid) || !Number.isInteger(parentPid) || pid <= 0) continue;
    const children = childrenByParent.get(parentPid) || [];
    children.push(pid);
    childrenByParent.set(parentPid, children);
  }
  const descendants = [];
  const queue = [...(childrenByParent.get(root) || [])];
  const seen = new Set([root]);
  while (queue.length > 0) {
    const pid = queue.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    descendants.push(pid);
    queue.push(...(childrenByParent.get(pid) || []));
  }
  return descendants;
}

const LOCAL_CI_MUTATOR_COMMANDS = [
  /(?:^|[\\/])local-ci-runner\.mjs(?:\s|$)/i,
  /(?:^|[\\/])local-integration-ci\.mjs(?:\s|$)/i,
  /(?:^|[\\/])\.local-ci-runner(?:-[^\\/\s"]+)?(?:[\\/\s"]|$)/i,
];

export function findLiveLocalCiMutatorPids(processRows, { excludePids = [] } = {}) {
  const rows = Array.isArray(processRows) ? processRows : [];
  const excluded = new Set(
    excludePids
      .map(Number)
      .filter((pid) => Number.isInteger(pid) && pid > 0),
  );
  const mutatorPids = new Set();

  for (const row of rows) {
    const pid = Number(row?.pid);
    const commandLine = typeof row?.commandLine === "string" ? row.commandLine : "";
    if (
      !Number.isInteger(pid)
      || pid <= 0
      || excluded.has(pid)
      || !LOCAL_CI_MUTATOR_COMMANDS.some((pattern) => pattern.test(commandLine))
    ) {
      continue;
    }
    mutatorPids.add(pid);
    for (const descendantPid of collectDescendantPids(pid, rows)) {
      if (!excluded.has(descendantPid)) mutatorPids.add(descendantPid);
    }
  }

  return [...mutatorPids].sort((left, right) => left - right);
}

function commandUsesWorkspace(commandLine, workspace) {
  const command = String(commandLine ?? "").replaceAll("\\", "/").toLowerCase();
  const target = String(workspace ?? "").replaceAll("\\", "/").toLowerCase();
  if (!target) return false;
  const start = command.indexOf(target);
  if (start < 0) return false;
  const next = command[start + target.length] ?? "";
  return next === "" || /[\/\s"']/.test(next);
}

export function findConflictingLocalCiMutatorPids(
  processRows,
  { currentPid, peerOwners = [] } = {},
) {
  const rows = Array.isArray(processRows) ? processRows : [];
  const peerPids = new Set();
  for (const peer of peerOwners) {
    const pid = Number(peer?.pid);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    peerPids.add(pid);
    for (const descendant of collectDescendantPids(pid, rows)) {
      peerPids.add(descendant);
    }
  }
  const liveMutators = findLiveLocalCiMutatorPids(rows, {
    excludePids: [currentPid, ...peerPids],
  });
  const rowByPid = new Map(rows.map((row) => [Number(row?.pid), row]));
  return liveMutators.filter((pid) => {
    const commandLine = rowByPid.get(pid)?.commandLine ?? "";
    return !peerOwners.some((peer) =>
      commandUsesWorkspace(commandLine, peer.workspace));
  });
}

function readLivePeerSlotOwners({
  currentSlotKey,
  rootClone,
  gitCommonDir,
  candidateGitDir,
}) {
  return LOCAL_CI_SLOT_KEYS.flatMap((slotKey) => {
    if (slotKey === currentSlotKey) return [];
    const manifest = createLocalCiSlotManifest({
      slotKey,
      rootClone,
      gitCommonDir,
      candidateGitDir,
    });
    const fence = inspectLocalSandboxFence({ path: manifest.fence.path });
    if (fence.status !== "live") return [];
    return [{
      pid: fence.record.pid,
      workspace: manifest.scratch.workspace,
    }];
  });
}

function readProcessRows({ platform = process.platform, spawnSyncImpl = spawnSync } = {}) {
  if (platform === "win32") {
    const result = spawnSyncImpl("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress",
    ], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0 || !result.stdout) return [];
    try {
      const parsed = JSON.parse(result.stdout);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows.map((row) => ({
        pid: Number(row.ProcessId),
        parentPid: Number(row.ParentProcessId),
        commandLine: typeof row.CommandLine === "string" ? row.CommandLine : "",
      }));
    } catch {
      return [];
    }
  }

  const result = spawnSyncImpl("ps", ["-eo", "pid=,ppid=,args="], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s*(.*)$/))
    .filter(Boolean)
    .map((match) => ({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      commandLine: match[3] || "",
    }));
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function terminatePid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Process already exited.
  }
}

export function createProcessTreeTracker({
  rootPid,
  listProcessRows = readProcessRows,
  processAlive = isProcessAlive,
  terminate = terminatePid,
  wait = sleep,
  now = () => Date.now(),
  onEvent = () => {},
} = {}) {
  const root = Number(rootPid);
  const remembered = new Set();

  const sample = () => {
    const descendants = collectDescendantPids(root, listProcessRows());
    for (const pid of descendants) remembered.add(pid);
    return descendants;
  };

  const liveRememberedDescendants = () =>
    [...remembered].filter((pid) => pid !== root && processAlive(pid));

  const waitForQuiescence = async ({ graceMs = 5000, pollMs = 250 } = {}) => {
    const deadline = now() + graceMs;
    sample();
    while (liveRememberedDescendants().length > 0 && now() < deadline) {
      await wait(pollMs);
      sample();
    }
    const live = liveRememberedDescendants();
    if (live.length === 0) return [];
    onEvent({ type: "descendants-terminating", pids: live });
    for (const pid of live) terminate(pid);
    const terminatedDeadline = now() + Math.max(1000, pollMs * 4);
    while (liveRememberedDescendants().length > 0 && now() < terminatedDeadline) {
      await wait(pollMs);
    }
    return live;
  };

  return {
    sample,
    waitForQuiescence,
    liveRememberedDescendants,
    rememberedPids: () => [...remembered],
  };
}

function createGateCommand(commandSpec, { cwd, env, allowStub, fullLogFile }) {
  if (!commandSpec) {
    if (!allowStub) throw new Error("runGateCommand called with no command and no stub allowed");
    const stubOutput = "sandbox checkout/build stub: gate passed (DPF_ALLOW_LOCAL_CI_STUB=1)\n";
    writeFileSync(fullLogFile, stubOutput);
    return {
      run: async () => ({
        label: "sandbox checkout/build stub",
        status: 0,
        output: stubOutput,
      }),
      terminate: async () => {},
    };
  }
  let child = null;
  let tracker = null;
  let trackerTimer = null;
  let output = "";
  writeFileSync(fullLogFile, "");
  // BI-B1065D41: the child's transcript is ~28,000 lines. It is persisted in
  // full to fullLogFile (and its tail travels in the evidence record), so
  // mirroring it to stdout bought nothing except unreadability — and the piping
  // habit that unreadability provoked SIGPIPE-killed runs mid-install. stdout
  // now gets a throttled heartbeat; DPF_PREGATE_VERBOSE=1 restores the mirror
  // for anyone debugging the gate itself.
  const relay = createGateOutputRelay({
    write: (text) => process.stdout.write(text),
    verbose: isVerboseGateConsole(),
  });
  const append = (chunk) => {
    const text = String(chunk);
    output = `${output}${text}`.slice(-12000);
    appendFileSync(fullLogFile, text);
    relay.absorb(text);
  };
  return {
    run: () => new Promise((resolve, reject) => {
      const common = {
        cwd,
        env,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      };
      if (commandSpec.kind === "argv") {
        const [command, ...rest] = commandSpec.value;
        child = spawn(command, rest, common);
      } else {
        child = spawn(commandSpec.value, { ...common, shell: true });
      }
      tracker = createProcessTreeTracker({ rootPid: child.pid });
      tracker.sample();
      trackerTimer = setInterval(
        () => tracker.sample(),
        Math.max(50, numberOrDefault(process.env.DPF_GATE_PROCESS_SCAN_MS, defaultProcessScanMs())),
      );
      child.stdout.on("data", (chunk) => append(chunk));
      child.stderr.on("data", (chunk) => append(chunk));
      child.once("error", reject);
      child.once("close", async (code, signal) => {
        if (trackerTimer) {
          clearInterval(trackerTimer);
          trackerTimer = null;
        }
        const terminated = tracker
          ? await tracker.waitForQuiescence({
            graceMs: numberOrDefault(process.env.DPF_GATE_DESCENDANT_GRACE_MS, 5000),
            pollMs: Math.max(50, numberOrDefault(
              process.env.DPF_GATE_DESCENDANT_POLL_MS,
              defaultDescendantPollMs(),
            )),
          })
          : [];
        if (terminated.length > 0) {
          append(
            `gate-worktree: terminated ${terminated.length} descendant process(es) before lease release: ${terminated.join(", ")}\n`,
          );
        }
        relay.finish();
        resolve({
          label: commandSpec.label,
          status: code ?? (signal ? 143 : 1),
          output,
          logLines: relay.stats().lines,
          elapsedMs: relay.stats().elapsedMs,
        });
      });
    }),
    terminate: async () => {
      if (trackerTimer) {
        clearInterval(trackerTimer);
        trackerTimer = null;
      }
      if (child && child.exitCode === null) {
        if (process.platform === "win32") {
          spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } else {
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {
            child.kill("SIGTERM");
          }
        }
      }
      if (tracker) {
        await tracker.waitForQuiescence({ graceMs: 0, pollMs: 50 });
      }
    },
  };
}

function responseData(response) {
  return response?.data ?? response ?? {};
}

async function readQuiescenceStatus({ mcpUrl, bearerToken }) {
  try {
    const response = await mcpCall("get_quiescence_status", {}, { mcpUrl, bearerToken });
    if (response?.success !== true) return null;
    return responseData(response);
  } catch (error) {
    process.stderr.write(`gate-worktree: quiescence preflight unavailable (${error.message}); continuing to governed lease claim\n`);
    return null;
  }
}

function quiescenceBlocksWrites(status) {
  return Boolean(status)
    && ((status.level && status.level !== "normal") || status.writesRefused === true);
}

/**
 * Is anything still holding the local-CI slot?
 *
 * Returns `true` when an active `local-integration-ci` lease exists, `false`
 * when the control plane answers and there is none, and `null` when we could
 * not find out.
 *
 * `null` is NOT `false` on purpose. Every "nothing is running" verdict has to
 * come from an answer we actually received, because the caller turns it into a
 * hard stop — and the failure that motivated this (BI-40230C6F) was the portal
 * going down mid-run, which is exactly when an unreachable control plane must
 * NOT be read as "the executor is gone".
 */
export async function hasActiveLocalCiLease({ mcpUrl, bearerToken, call = mcpCall }) {
  let response;
  try {
    response = await call("list_nonprod_environment_leases", {}, { mcpUrl, bearerToken });
  } catch {
    return null;
  }
  if (response?.success !== true) return null;
  const data = responseData(response);
  // A missing `leases` key is NOT the same claim as `leases: []`. Only the latter
  // is the control plane saying nothing holds the slot; the former is a payload we
  // do not understand, and an unreadable answer must not stop the wait.
  if (!Array.isArray(data?.leases)) return null;
  return data.leases.some((lease) =>
    (lease.environmentKey || lease.environment || lease.key) === "local-integration-ci");
}

async function cancelDeadLocalQueueObservers({
  directory,
  mcpUrl,
  bearerToken,
  leaseEvents,
  reportActive = false,
}) {
  let response;
  try {
    response = await mcpCall(
      "list_nonprod_environment_leases",
      {},
      leaseQueueCallOptions(mcpUrl, bearerToken),
    );
  } catch (error) {
    process.stderr.write(
      `gate-worktree: dead-waiter reconciliation unavailable (${describeLeaseCallFailure(error)}); queue remains fail-closed\n`,
    );
    return;
  }
  if (response?.success !== true) return;
  const data = responseData(response);
  if (reportActive) {
    const leases = Array.isArray(data.leases) ? data.leases : [];
    const active = leases.filter((lease) =>
      (lease.environmentKey || lease.environment || lease.key) === "local-integration-ci");
    if (active.length > 0) {
      process.stderr.write(
        `gate-worktree: preflight sees ${active.length} active local-integration-ci lease(s); claim will queue if busy.\n`,
      );
    }
  }
  const queued = Array.isArray(data.queued) ? data.queued : [];
  const dead = findDeadLocalQueueObservers({
    directory,
    queuedLeases: queued,
  });
  for (const candidate of dead) {
    let released;
    try {
      released = await mcpCall(
        "release_nonprod_environment_lease",
        { leaseId: candidate.leaseId },
        { mcpUrl, bearerToken },
      );
    } catch (error) {
      process.stderr.write(
        `gate-worktree: proven-dead queue observer ${candidate.leaseId} could not be cancelled (${error.message}); queue remains authoritative\n`,
      );
      continue;
    }
    if (released?.success !== true) {
      process.stderr.write(
        `gate-worktree: could not cancel proven-dead queue observer ${candidate.leaseId}; queue remains authoritative\n`,
      );
      continue;
    }
    const proofs = Array.isArray(candidate.livenessProofs) && candidate.livenessProofs.length > 0
      ? candidate.livenessProofs
      : [candidate.livenessProof];
    for (const proof of proofs) {
      releaseLocalQueueObserver({
        path: resolvePath(directory, `${proof.observerToken}.json`),
        token: proof.observerToken,
      });
    }
    const event = {
      type: "dead_queue_observer_cancelled",
      leaseId: candidate.leaseId,
      reason: candidate.reason,
      livenessProof: candidate.livenessProof,
      ...(proofs.length > 1 ? { livenessProofs: proofs } : {}),
      at: new Date().toISOString(),
    };
    leaseEvents.push(event);
    const proofText = proofs.length === 1
      ? `pid ${candidate.livenessProof.pid}`
      : `${proofs.length} dead observer records`;
    process.stdout.write(
      `cancelled dead same-host queue observer ${candidate.leaseId} (${candidate.reason}; ${proofText})\n`,
    );
  }

  // BI-2C7F51BA Defect 1 — self-heal the shared observer directory.
  //
  // Every killed gate leaks its record, and nothing on the success path ever
  // swept them: the field directory held 192 records, 185 with dead pids, the
  // oldest six days old. Sweeping here (rather than only in pregate's recovery
  // paths, which are skipped exactly when the worktree path cannot be resolved)
  // means any single crashed run is cleaned up by the NEXT launch on this host.
  //
  // Deliberately unfiltered by branch/sha/session — see the reaper's contract.
  // Records backing a lease the queue still knows about are retained so the
  // reconciliation above keeps its liveness proof.
  const leaseSessions = new Set(
    [...(Array.isArray(data.leases) ? data.leases : []), ...queued]
      .map((lease) => lease?.ownerSessionId)
      .filter((id) => typeof id === "string" && id.length > 0),
  );
  const sweptRecords = releaseDeadLocalQueueObserversForGate({
    directory,
    retainOwnerSessionIds: leaseSessions,
  });
  if (sweptRecords.length > 0) {
    const reasons = [...new Set(sweptRecords.map((entry) => entry.reason))].join(", ");
    // Recorded as a lease event, not just stdout: the cross-session reach is the
    // property most likely to be "tightened" later, and an evidence record makes
    // it auditable after the fact — which session's record was reclaimed, why,
    // and that the sweep left live records alone.
    leaseEvents.push({
      type: "dead_queue_observers_swept",
      count: sweptRecords.length,
      observers: sweptRecords,
      at: new Date().toISOString(),
    });
    process.stdout.write(
      `swept ${sweptRecords.length} leaked local-CI queue observer record(s) (${reasons})\n`,
    );
  }
}


function warnAboutMainFreshness({ gitBin, worktreePath }) {
  if (!gitOrEmpty(gitBin, ["rev-parse", "--verify", "origin/main"], worktreePath)) return;
  const behind = gitOrEmpty(gitBin, ["rev-list", "--count", "HEAD..origin/main"], worktreePath);
  if (behind && behind !== "0") {
    process.stderr.write(`gate-worktree: preflight warning: HEAD is ${behind} commit(s) behind origin/main; local-ci-runner will merge the current base before expensive gates.\n`);
  }
}

function writePendingEvidence(path, { branch, sha, expiresAt, reason, retryAfterSeconds, recordArgs }) {
  mkdirSync(dirname(path), { recursive: true });
  const payload = {
    schema: "dpf-local-ci-pending-evidence/v1",
    branch,
    sha,
    expiresAt,
    reason,
    retryAfterSeconds,
    recordedAt: new Date().toISOString(),
    recordArgs,
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

async function main() {
  // BI-B1065D41: a stray `| head` must DEGRADE, not kill a 20-minute run that is
  // holding a shared lease. Without this, the EPIPE raised when the reader exits
  // is an unhandled stream error and the gate dies mid-install.
  installBrokenPipeTolerance();
  const options = parseArgs(process.argv.slice(2));
  const gitBin = process.env.DPF_GATE_GIT_BIN || "git";
  const allowStub = process.env.DPF_ALLOW_LOCAL_CI_STUB === "1";

  const branch = options.branch || gitOrEmpty(gitBin, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "HEAD") die("cannot gate detached HEAD");
  const sha = options.sha || gitOrEmpty(gitBin, ["rev-parse", "HEAD"]);
  const worktreePath = options.worktree || gitOrEmpty(gitBin, ["rev-parse", "--show-toplevel"]);
  // BI-3A34D7A9: resolve WHO is gating from the calling client's own
  // environment. The provider is NOT required here — a dry run records nothing,
  // and demanding attribution before any side effect would break every
  // contract test and any bare shell. The requirement lands at the lease claim,
  // which is the first moment a provider is actually written.
  const identity = resolveAgentIdentity({
    env: process.env,
    providerOverride: options.ownerProvider,
    sessionOverride: options.ownerSessionId,
    pid: process.pid,
  });
  for (const warning of identity.warnings) {
    process.stderr.write(`gate-worktree: ${warning}
`);
  }
  const ownerProvider = identity.provider;
  const ownerSessionId = identity.sessionId;
  // Liveness is a SEPARATE concern from identity (#3750 + BI-3A34D7A9). The
  // observer token/pid proves "this waiting process is alive" so a dead waiter
  // can be reconciled out of the queue; the session id says "which thread owns
  // this work". They used to share one field, so the observer was registered
  // only when no session id was supplied — under honest attribution that is
  // almost never, hence unconditional.
  const gateObserverIdentity = createGateObserverIdentity();
  const baseClaimKey = `local-ci:${ownerSessionId}:${sha}`;
  let claimKey = baseClaimKey;
  let preAdmissionGateIdentity = null;
  let gateKey = "";
  const deadline = Date.now() + options.leaseWaitSeconds * 1000;
  const commandSpec = resolveGateCommand({ branch, allowStub, gitBin });

  if (options.dryRun) {
    process.stdout.write("gate-worktree dry-run\n");
    process.stdout.write(`branch=${branch}\nsha=${sha}\nworktree=${worktreePath}\nremote=${options.remote}\nmcpUrl=${options.mcpUrl}\n`);
    process.stdout.write(`pushBeforeLease=${options.pushBranch}\n`);
    // A dry run should answer "will this be attributable, and to whom?" before
    // the lease is taken, not after the evidence is written.
    process.stdout.write(
      `ownerProvider=${ownerProvider ?? "unresolved"} (${identity.providerSource})\n`
        + `ownerSessionId=${ownerSessionId} (${identity.sessionSource})\n`
        + `rootSessionId=${identity.rootSessionId ?? "none"}\n`
        + `attribution=${identity.attribution}\n`,
    );
    if (commandSpec) {
      process.stdout.write(`localCiCommand=${commandSpec.label}\n`);
    } else if (allowStub) {
      process.stdout.write("localCiCommand=sandbox checkout/build stub (explicitly allowed)\n");
    } else {
      process.stdout.write("localCiCommand=missing; gate would fail before push/lease\n");
    }
    process.stdout.write("would call claim_nonprod_environment_lease and record_local_integration_result only when a real command or explicit stub is configured\n");
    process.exit(0); // exit-0: --dry-run routing probe; changes nothing and records nothing
  }

  const bearerToken = process.env.DPF_MCP_BEARER_TOKEN;
  if (!bearerToken) die("DPF_MCP_BEARER_TOKEN is required to claim the local-CI lease");

  const candidateGitDir = dirname(gitPath(gitBin, worktreePath, "dpf-local-ci-gate.json"));
  const gitCommonDir = resolvePath(
    worktreePath,
    gitOrEmpty(gitBin, ["rev-parse", "--git-common-dir"], worktreePath),
  );
  const rootClone = resolveLocalCiRootClone(gitCommonDir);
  const queueObserverDirectory = process.env.DPF_LOCAL_QUEUE_OBSERVER_DIR
    || resolvePath(gitCommonDir, "dpf-local-ci-queue-observers");
  let slotManifest = createLocalCiSlotManifest({
    slotKey: process.env.DPF_LOCAL_CI_SLOT_KEY || "slot-0",
    rootClone,
    gitCommonDir,
    candidateGitDir,
  });
  let stateFile = slotManifest.evidence.state;
  let metadataFile = slotManifest.evidence.metadata;
  let pendingEvidenceFile = slotManifest.evidence.pending;
  let fullLogFile;
  let freshnessReportFile;
  let localFencePath = process.env.DPF_LOCAL_SANDBOX_FENCE_PATH
    || slotManifest.fence.path;

  let quiescenceAttempt = 0;
  for (;;) {
    const quiescence = await readQuiescenceStatus({
      mcpUrl: options.mcpUrl,
      bearerToken,
    });
    if (!quiescenceBlocksWrites(quiescence)) break;
    const retryAfterSeconds = Number(quiescence.retryAfterSeconds || 30);
    if (Date.now() >= deadline) {
      writeState(stateFile, {
        branch,
        sha,
        gatePassed: false,
        leaseId: "",
        evidenceId: "",
        status: "blocked_quiescence",
        expiresAt: new Date(Date.now() + retryAfterSeconds * 1000).toISOString(),
        resilience: null,
        leaseEvents: [],
        quiescence,
      });
      process.stderr.write(`gate-worktree: portal remained ${quiescence.level || "quiescing"} through the admission deadline.\n`);
      process.stderr.write("gate-worktree: no expensive local-CI command was run; use get_quiescence_status for drain blockers.\n");
      process.exit(4);
    }
    // BI-2C7F51BA Defect 3 (secondary) — back off while the portal drains.
    //
    // `retryAfterSeconds` alone pins this at a fixed ~30s forever, and every
    // poll is itself a ToolExecution row, i.e. the waiter re-arms the very
    // `request.recent-tool-execution` soft blocker it is waiting on. Excluding
    // read-only calls from that signal is the primary fix (quiescence.ts);
    // widening the interval as the drain persists is the defence in depth.
    // Capped at 8x the server's own retry-after so a cleared drain is still
    // noticed within a few minutes of the 2h admission budget.
    const drainBackoff = 2 ** Math.min(quiescenceAttempt, 3);
    const delayMs = retryDelayMs({
      attempt: quiescenceAttempt,
      pollSeconds: options.pollSeconds,
      retryAfterSeconds: retryAfterSeconds * drainBackoff,
    });
    quiescenceAttempt += 1;
    waiting(`portal is ${quiescence.level || "quiescing"}; retrying governed admission in ${(delayMs / 1000).toFixed(1)}s...`);
    await sleep(Math.min(delayMs, Math.max(10, deadline - Date.now())));
  }

  if (options.finalizeEvidence) {
    if (!existsSync(pendingEvidenceFile)) {
      const state = readLocalCiGateState(stateFile);
      let metadata = null;
      try {
        metadata = JSON.parse(readFileSync(metadataFile, "utf8"));
      } catch {
        // The exact metadata check below remains fail-closed.
      }
      if (
        state?.branch !== branch
        || state?.sha !== sha
        || state?.gatePassed !== true
        || state?.status !== "passed"
        || state?.evidencePending === true
        || !state?.evidenceRecordId
        || metadata?.candidateSha !== sha
      ) {
        die(`no exact published PASS is available to finalize at ${stateFile}`);
      }
      const evidenceValidity = createLocalCiPassEvidenceValidity({
        issuedAt: state.evidenceValidity?.issuedAt || state.recordedAt,
      });
      if (Date.parse(evidenceValidity.expiresAt) <= Date.now()) {
        die(`published local-CI evidence expired at ${evidenceValidity.expiresAt}; re-run pregate`);
      }
      writeState(stateFile, {
        branch,
        sha,
        gatePassed: true,
        leaseId: state.leaseId || "",
        evidenceId: state.evidenceRecordId,
        status: "passed",
        expiresAt: evidenceValidity.expiresAt,
        leaseExpiresAt: state.leaseExpiresAt || state.expiresAt || "",
        evidenceValidity,
        resilience: state.resilience ?? null,
        leaseEvents: state.leaseEvents ?? [],
        evidencePending: false,
      });
      process.stdout.write(`finalized existing local-CI evidence: ${state.evidenceRecordId}\n`);
      process.exit(0); // exit-0: --finalize-evidence revalidated an already-recorded PASS for this sha
    }
    const pending = JSON.parse(readFileSync(pendingEvidenceFile, "utf8"));
    if (pending.branch !== branch) die(`pending evidence branch mismatch: ${pending.branch} != ${branch}`);
    if (pending.sha !== sha) die(`pending evidence sha mismatch: ${pending.sha} != ${sha}`);
    const response = await mcpCall(
      "record_local_integration_result",
      pending.recordArgs,
      { mcpUrl: options.mcpUrl, bearerToken },
    );
    if (response?.success !== true) {
      die(`failed to record pending local-CI evidence: ${JSON.stringify(response)}`);
    }
    const evidenceId = response.entityId || "";
    const evidence = pending.recordArgs?.evidence ?? {};
    const pendingState = readLocalCiGateState(stateFile);
    const evidenceValidity = createLocalCiPassEvidenceValidity({
      issuedAt: pendingState?.recordedAt || new Date().toISOString(),
    });
    writeState(stateFile, {
      branch,
      sha,
      gatePassed: true,
      leaseId: evidence.leaseId || "",
      evidenceId,
      status: "passed",
      expiresAt: evidenceValidity.expiresAt,
      leaseExpiresAt: pending.expiresAt || evidence.expiresAt || "",
      evidenceValidity,
      resilience: evidence.resilience ?? null,
      leaseEvents: evidence.leaseEvents ?? [],
      evidencePending: false,
    });
    rmSync(pendingEvidenceFile, { force: true });
    process.stdout.write(`recorded pending local-CI evidence: ${evidenceId}\n`);
    process.exit(0); // exit-0: --finalize-evidence recorded the pending PASS evidence for this sha
  }

  warnAboutMainFreshness({ gitBin, worktreePath });

  if (options.pushBranch) {
    const push = git(gitBin, ["push", options.remote, branch], worktreePath);
    if (push.status !== 0) die(`push failed: ${push.stderr || push.stdout}`);
  }

  if (!ownerProvider) {
    die(
      "cannot attribute this gate to a client. Pass --owner-provider "
        + "<build-studio|claude|codex|grok|antigravity|coworker> or set "
        + "DPF_GATE_OWNER_PROVIDER. (The lease and the evidence record use a "
        + "closed provider vocabulary, so there is no honest default.)",
    );
  }

  if (!options.finalizeEvidence) {
    const documentationResult = await runPreAdmissionDocumentationLane({
      branch,
      sha,
      worktreePath,
      gitBin,
      ownerProvider,
      ownerSessionId,
      mcpUrl: options.mcpUrl,
      bearerToken,
      stateFile,
      planFile: resolvePath(candidateGitDir, "dpf-pre-admission-evidence-plan.json"),
      plannerPath: resolvePath(SCRIPT_DIR, "ci-evidence-plan.mjs"),
    });
    if (documentationResult.handled) {
      process.stdout.write(
        documentationResult.status === 0
          ? `documentation evidence passed without heavyweight admission: ${documentationResult.evidenceId}\n`
          : `documentation evidence failed without heavyweight admission: ${documentationResult.evidenceId}\n`,
      );
      process.exit(documentationResult.status);
    }
    preAdmissionGateIdentity = documentationResult.gateIdentity ?? null;
  }

  if (!options.finalizeEvidence && !commandSpec && !allowStub) {
    die("local-CI gate runner is not wired (scripts/local-ci-runner.mjs is missing); refusing to record passing stub evidence. Set DPF_LOCAL_CI_COMMAND to the canonical sandbox command, or use DPF_ALLOW_LOCAL_CI_STUB=1 only in contract tests.");
  }

  const leaseTtlMs = Math.min(
    options.expiresMinutes * 60_000,
    LOCAL_CI_ACTIVE_LEASE_TTL_MS,
  );
  let expiresAt = "";
  let url = slotManifest.portal.url;

  let leaseId = "";
  let localFenceToken = "";
  let queueObserverPath = "";
  let leaseReleased = false;
  let receivedSignal = "";
  let queuedClaimInterruptedByQuiescence = false;
  let terminalClaimAttemptSequence = 0;
  const leaseEvents = [];
  const hostPressureSamples = [];
  let admissionPoolPolicy = null;
  const queueObserverState = () => queueObserverPath
    ? {
      path: queueObserverPath,
      token: gateObserverIdentity.token,
      pid: gateObserverIdentity.pid,
      ownerSessionId,
    }
    : null;
  const signalHandlers = Object.fromEntries(["SIGINT", "SIGTERM"].map((signal) => [
    signal,
    () => {
      receivedSignal = signal;
      leaseEvents.push({ type: "signal", signal, at: new Date().toISOString() });
    },
  ]));
  for (const [signal, handler] of Object.entries(signalHandlers)) process.once(signal, handler);

  // Always register: the observer proves THIS PROCESS is alive, which is what
  // lets a dead waiter be reconciled out of the queue. It records the lease's
  // real owner session id so the reconciler can match without the lease having
  // to encode the token/pid.
  queueObserverPath = registerLocalQueueObserver({
    directory: queueObserverDirectory,
    identity: gateObserverIdentity,
    ownerSessionId,
    branch,
    sha,
  }).path;

  const releaseLeaseOnce = async () => {
    if (!leaseId || leaseReleased) return;
    leaseReleased = true;
    const response = await mcpCall("release_nonprod_environment_lease", {
      leaseId,
      ownerSessionId,
    }, leaseQueueCallOptions(options.mcpUrl, bearerToken));
    if (response?.success !== true) {
      throw new Error(`failed to release local-CI lease: ${JSON.stringify(response)}`);
    }
    if (queueObserverPath) {
      releaseLocalQueueObserver({
        path: queueObserverPath,
        token: gateObserverIdentity.token,
      });
      queueObserverPath = "";
    }
  };

  // BI-3A34D7A9: the admission loop below is the first side effect that writes
  // a provider. The lease and the evidence record share a CLOSED vocabulary with
  // no "unknown" member, so an unresolved provider has no honest value — refuse
  // rather than attribute this run to whichever client is most common. Everything
  // above (--dry-run, the runner-wiring check) stays runnable unattributed.
  let claimAttempt = 0;
  let nextQueueReconciliationAt = 0;
  for (;;) {
    if (receivedSignal) {
      await releaseLeaseOnce();
      process.exit(130);
    }
    // Reconciliation is a shared-host hygiene sweep, not an admission poll.
    // Run it before the first claim and at a human-scale cadence during long
    // queue waits; the durable claimKey remains the queue authority in between.
    if (Date.now() >= nextQueueReconciliationAt) {
      await cancelDeadLocalQueueObservers({
        directory: queueObserverDirectory,
        mcpUrl: options.mcpUrl,
        bearerToken,
        leaseEvents,
        reportActive: claimAttempt === 0,
      });
      nextQueueReconciliationAt = Date.now() + DEAD_QUEUE_RECONCILIATION_INTERVAL_MS;
    }
    expiresAt = new Date(Date.now() + leaseTtlMs).toISOString();
    const hostPressure = await observeLocalCiHostPressure({
      rootClone,
      gitCommonDir,
      candidateGitDir,
    });
    hostPressureSamples.push(hostPressure);
    let claimResponse;
    try {
      claimResponse = await mcpCall("claim_nonprod_environment_lease", {
        environmentKey: "local-integration-ci",
        ownerProvider,
        ownerSessionId,
        claimKey,
        ...(preAdmissionGateIdentity ? { gateIdentity: preAdmissionGateIdentity } : {}),
        purpose: `Pre-PR local-CI gate for ${branch} @ ${sha}`,
        url,
        ports: [slotManifest.portal.port, slotManifest.postgres.hostPort],
        expiresAt,
        worktreePath,
        branchName: branch,
        slotManifestVersion: slotManifest.schemaVersion,
        hostPressure,
      }, leaseQueueCallOptions(options.mcpUrl, bearerToken));
    } catch (error) {
      if (!isTransientMcpError(error) || Date.now() >= deadline) throw error;
      const delayMs = retryDelayMs({ attempt: claimAttempt, pollSeconds: options.pollSeconds });
      claimAttempt += 1;
      waiting(`local-CI admission transport unavailable (${error.message}); retrying in ${(delayMs / 1000).toFixed(1)}s...`);
      await sleep(Math.min(delayMs, Math.max(10, deadline - Date.now())));
      continue;
    }

    const admission = claimResponse?.data?.admission;
    const canonicalLeaseId = claimResponse?.data?.lease?.leaseId || "";
    gateKey = claimResponse?.data?.gateKey || gateKey;
    admissionPoolPolicy = claimResponse?.data?.poolPolicy ?? admissionPoolPolicy;
    if (claimResponse?.success === true && admission?.status === "reused") {
      const evidenceId = admission.evidenceRecordId || claimResponse.entityId || "";
      const passed = admission.resultClass === "pass";
      if (queueObserverPath) {
        releaseLocalQueueObserver({
          path: queueObserverPath,
          token: gateObserverIdentity.token,
        });
        queueObserverPath = "";
      }
      writeState(stateFile, {
        branch,
        sha,
        gatePassed: passed,
        leaseId: canonicalLeaseId,
        evidenceId,
        status: passed ? "passed" : "failed",
        expiresAt: claimResponse?.data?.lease?.expiresAt || expiresAt,
        resilience: null,
        leaseEvents: [
          ...leaseEvents,
          { type: "reused", gateKey, evidenceId, at: new Date().toISOString() },
        ],
        evidencePending: false,
      });
      process.stdout.write(`reused canonical local-CI ${admission.resultClass} evidence: ${evidenceId}\n`);
      process.exit(passed ? 0 : 1);
    }
    if (claimResponse?.success === true && admission?.status === "subscribed") {
      leaseEvents.push({
        type: "subscribed",
        at: new Date().toISOString(),
        gateKey,
        canonicalLeaseId,
        executionStatus: admission.executionStatus,
      });
      writeState(stateFile, {
        branch,
        sha,
        gatePassed: false,
        leaseId: canonicalLeaseId,
        evidenceId: "",
        status: "subscribed",
        expiresAt: claimResponse?.data?.lease?.expiresAt || expiresAt,
        resilience: null,
        leaseEvents,
        evidencePending: false,
        queueObserver: queueObserverState(),
      });
      if (Date.now() >= deadline) die("local-CI canonical execution observation timed out");
      const delayMs = retryDelayMs({ attempt: claimAttempt, pollSeconds: options.pollSeconds });
      claimAttempt += 1;
      waiting(`local-CI execution is owned by another caller; observing ${canonicalLeaseId} again in ${(delayMs / 1000).toFixed(1)}s...`);
      await sleep(Math.min(delayMs, Math.max(10, deadline - Date.now())));
      continue;
    }
    if (
      claimResponse?.success === true
      && (admission?.status === "admitted" || !admission?.status)
    ) {
      leaseId = canonicalLeaseId || claimResponse.entityId || leaseId;
      const admittedExpiresAt = claimResponse?.data?.lease?.expiresAt;
      if (
        typeof admittedExpiresAt === "string"
        && Number.isFinite(Date.parse(admittedExpiresAt))
      ) {
        expiresAt = admittedExpiresAt;
      }
      const admittedSlotKey = admission?.slotKey || "slot-0";
      slotManifest = createLocalCiSlotManifest({
        slotKey: admittedSlotKey,
        rootClone,
        gitCommonDir,
        candidateGitDir,
      });
      stateFile = slotManifest.evidence.state;
      metadataFile = slotManifest.evidence.metadata;
      pendingEvidenceFile = slotManifest.evidence.pending;
      fullLogFile = process.env.DPF_LOCAL_CI_OUTPUT_FILE || slotManifest.output.log;
      freshnessReportFile = slotManifest.evidence.freshness;
      localFencePath = process.env.DPF_LOCAL_SANDBOX_FENCE_PATH
        || slotManifest.fence.path;
      url = slotManifest.portal.url;
      leaseEvents.push({
        type: "admitted",
        at: new Date().toISOString(),
        slotKey: slotManifest.slotKey,
        waitAgeMs: admission?.waitAgeMs ?? null,
        expiresAt,
      });
      writeState(stateFile, {
        branch,
        sha,
        gatePassed: false,
        leaseId,
        evidenceId: "",
        status: "admitted",
        expiresAt,
        resilience: null,
        leaseEvents,
        evidencePending: false,
        queueObserver: queueObserverState(),
        admission: {
          queuePosition: admission?.queuePosition ?? null,
          waitAgeMs: admission?.waitAgeMs ?? null,
          poolPolicy: claimResponse?.data?.poolPolicy ?? null,
          hostPressure,
        },
      });
      break;
    }
    if (claimResponse?.success === true && admission?.status === "queued") {
      leaseId = canonicalLeaseId || claimResponse.entityId || leaseId;
      queuedClaimInterruptedByQuiescence = false;
      leaseEvents.push({
        type: "queued",
        at: new Date().toISOString(),
        queuePosition: admission.queuePosition ?? null,
        waitAgeMs: admission.waitAgeMs ?? null,
        expiresAt,
      });
      writeState(stateFile, {
        branch,
        sha,
        gatePassed: false,
        leaseId,
        evidenceId: "",
        status: "queued",
        expiresAt,
        resilience: null,
        leaseEvents,
        evidencePending: false,
        queueObserver: queueObserverState(),
        admission: {
          queuePosition: admission.queuePosition ?? null,
          waitAgeMs: admission.waitAgeMs ?? null,
          poolPolicy: claimResponse?.data?.poolPolicy ?? null,
          hostPressure,
        },
      });
      if (Date.now() >= deadline) {
        await releaseLeaseOnce();
        die("local-CI admission queue wait timed out");
      }
      const delayMs = retryDelayMs({ attempt: claimAttempt, pollSeconds: options.pollSeconds });
      claimAttempt += 1;
      waiting(`local-CI admission queued at position ${admission.queuePosition}; observing again in ${(delayMs / 1000).toFixed(1)}s...`);
      await sleep(Math.min(delayMs, Math.max(10, deadline - Date.now())));
      continue;
    }
    // Rolling-upgrade bridge: the currently deployed portal may still expose
    // the pre-FIFO conflict contract while this exact candidate is waiting to
    // deploy the durable queue. Observe it with the same bounded backoff; once
    // Phase 1 is live, responses use the queued branch above.
    if (claimResponse?.error === "lease_conflict") {
      if (Date.now() >= deadline) {
        die("local-CI admission wait timed out against the legacy conflict API");
      }
      const delayMs = retryDelayMs({
        attempt: claimAttempt,
        pollSeconds: options.pollSeconds,
      });
      claimAttempt += 1;
      waiting(`local-CI portal is on the legacy conflict contract; observing admission again in ${(delayMs / 1000).toFixed(1)}s...`);
      await sleep(Math.min(delayMs, Math.max(10, deadline - Date.now())));
      continue;
    }
    if (claimResponse?.error === "portal_quiescing") {
      if (leaseId) queuedClaimInterruptedByQuiescence = true;
      if (Date.now() >= deadline) die("portal remained quiescing through the local-CI admission deadline");
      const retryAfterSeconds = Number(
        claimResponse?.data?.retryAfterSeconds
          ?? claimResponse?.retryAfterSeconds
          ?? 30,
      );
      const delayMs = retryDelayMs({
        attempt: claimAttempt,
        pollSeconds: options.pollSeconds,
        retryAfterSeconds,
      });
      claimAttempt += 1;
      waiting(`portal is quiescing; preserving queue intent and retrying in ${(delayMs / 1000).toFixed(1)}s...`);
      await sleep(Math.min(delayMs, Math.max(10, deadline - Date.now())));
      continue;
    }
    if (
      claimResponse?.error === "gate_evidence_blocked"
      && claimResponse?.data?.admission?.reason === "missing-evidence"
    ) {
      if (Date.now() >= deadline) {
        die("canonical local-CI executor ended without publishing evidence before the deadline");
      }
      // BI-40230C6F: "finalizing evidence" only means the slot holder has not
      // published yet. It does NOT mean anything is still running. When the
      // executor dies — the portal restarting mid-run is enough — the evidence
      // it owed will never arrive, and this loop used to keep polling a corpse
      // for the whole deadline. Measured: ~30 minutes of "finalizing evidence"
      // after the gate had already logged the observer as proven dead.
      //
      // That is not merely slow. The pool is structurally ONE slot, so a wedged
      // wait blocks every session on the host for the full deadline.
      //
      // Only an explicit `false` stops the wait: `null` means we could not ask,
      // and an unreachable control plane is the very condition that kills the
      // executor, so it must keep waiting rather than fail.
      const slotHeld = await hasActiveLocalCiLease({
        mcpUrl: options.mcpUrl,
        bearerToken,
      });
      if (slotHeld === false) {
        die(
          "canonical local-CI executor is gone and its evidence will never arrive "
            + "(no active local-integration-ci lease). Re-run pregate; this is not a verdict on the diff.",
        );
      }
      const delayMs = retryDelayMs({ attempt: claimAttempt, pollSeconds: options.pollSeconds });
      claimAttempt += 1;
      waiting(`canonical local-CI execution is finalizing evidence; observing again in ${(delayMs / 1000).toFixed(1)}s...`);
      await sleep(Math.min(delayMs, Math.max(10, deadline - Date.now())));
      continue;
    }
    const terminalReason = claimResponse?.data?.reason
      ?? claimResponse?.data?.lease?.reason
      ?? claimResponse?.data?.lease?.status;
    if (
      claimResponse?.error === "lease_terminal"
      && ["released", "cancelled", "expired"].includes(terminalReason)
    ) {
      if (Date.now() >= deadline) {
        die(`previous local-CI lease claim was already ${terminalReason} at the admission deadline`);
      }
      const priorClaimKey = claimKey;
      const terminalAttemptPrefix = `${baseClaimKey}:rerun-`;
      const priorAttemptText = priorClaimKey.startsWith(terminalAttemptPrefix)
        ? priorClaimKey.slice(terminalAttemptPrefix.length)
        : "";
      const priorAttemptSequence = /^\d+$/.test(priorAttemptText)
        ? Number.parseInt(priorAttemptText, 10)
        : 0;
      terminalClaimAttemptSequence = Math.max(
        terminalClaimAttemptSequence,
        Number.isSafeInteger(priorAttemptSequence) ? priorAttemptSequence : 0,
      ) + 1;
      claimKey = `${baseClaimKey}:rerun-${terminalClaimAttemptSequence}`;
      const interruptedByQuiescence = queuedClaimInterruptedByQuiescence;
      leaseEvents.push({
        type: interruptedByQuiescence
          ? "queue-intent-reestablished"
          : "terminal-claim-replaced",
        at: new Date().toISOString(),
        priorLeaseId: leaseId,
        priorClaimKey,
        replacementClaimKey: claimKey,
        terminalReason,
        terminalAttemptSequence: terminalClaimAttemptSequence,
        interruptedByQuiescence,
      });
      leaseId = "";
      queuedClaimInterruptedByQuiescence = false;
      process.stdout.write(interruptedByQuiescence
        ? `queued claim ${terminalReason} during portal quiescence; re-establishing queue intent with terminal attempt ${terminalClaimAttemptSequence}...\n`
        : `previous local-CI lease claim was ${terminalReason}; creating fresh admission attempt ${terminalClaimAttemptSequence}...\n`);
      continue;
    }
    die(`failed to claim local-CI lease: ${JSON.stringify(claimResponse)}`);
  }

  const renewLeaseAuthority = async ({ bindSlot = false } = {}) => {
    const hostPressure = await observeLocalCiHostPressure({
      rootClone,
      gitCommonDir,
      candidateGitDir,
    });
    hostPressureSamples.push(hostPressure);
    const response = await mcpCall("renew_nonprod_environment_lease", {
      leaseId,
      ownerSessionId,
      ttlMinutes: LOCAL_CI_ACTIVE_LEASE_TTL_MS / 60_000,
      hostPressure,
      ...(bindSlot
        ? {
          slotBinding: {
            manifestVersion: slotManifest.schemaVersion,
            slotKey: slotManifest.slotKey,
            url: slotManifest.portal.url,
            ports: [
              slotManifest.portal.port,
              slotManifest.postgres.hostPort,
            ],
            cleanupCommand:
              `node scripts/local-ci-slot-cleanup.mjs --slot-key ${slotManifest.slotKey}`,
          },
        }
        : {}),
    }, leaseQueueCallOptions(options.mcpUrl, bearerToken));
    const renewedExpiresAt = response?.data?.lease?.expiresAt;
    if (
      response?.success === true
      && typeof renewedExpiresAt === "string"
      && Number.isFinite(Date.parse(renewedExpiresAt))
    ) {
      expiresAt = renewedExpiresAt;
    } else if (response?.success === true) {
      // Rolling-upgrade compatibility for a portal that renews successfully
      // but does not yet return the authoritative expiry.
      expiresAt = new Date(Date.now() + leaseTtlMs).toISOString();
    }
    const pressureFenceReason = response?.success === true
      ? executionPressureFenceReason(response?.data?.poolPolicy)
      : null;
    if (pressureFenceReason) {
      return {
        success: false,
        error: pressureFenceReason,
        data: response.data,
      };
    }
    return response;
  };

  const binding = await renewLeaseAuthority({ bindSlot: true });
  if (binding?.success !== true) {
    await releaseLeaseOnce();
    die(`failed to bind admitted local-CI slot before mutation: ${JSON.stringify(binding)}`);
  }
  leaseEvents.push({
    type: "slot_bound",
    at: new Date().toISOString(),
    slotKey: slotManifest.slotKey,
    manifestVersion: slotManifest.schemaVersion,
    expiresAt,
  });

  // Durable remote admission is authoritative. The host-process fence is a
  // second, local safety belt acquired only after this waiter owns and has
  // bound the server-assigned slot.
  for (;;) {
    if (receivedSignal) {
      await releaseLeaseOnce();
      process.exit(130);
    }
    if (Date.now() >= Date.parse(expiresAt) - authoritySafetyMarginMs(leaseTtlMs)) {
      await releaseLeaseOnce();
      die("local-CI lease authority expired while waiting for the host process fence");
    }
    const localFence = acquireLocalSandboxFence({
      path: localFencePath,
      ownerSessionId,
      branch,
    });
    if (localFence.status !== "conflict") {
      // The checked-in runner is the shared-sandbox mutator whose mixed-version
      // predecessors must drain before a successor starts. Explicit commands
      // remain fenced by their host record, but may be source-local contract
      // harnesses that neither use nor mutate the convergence sandbox.
      const processRows = commandSpec?.kind === "argv" ? readProcessRows() : [];
      const liveMutatorPids = commandSpec?.kind === "argv"
        ? findConflictingLocalCiMutatorPids(processRows, {
          currentPid: process.pid,
          peerOwners: readLivePeerSlotOwners({
            currentSlotKey: slotManifest.slotKey,
            rootClone,
            gitCommonDir,
            candidateGitDir,
          }),
        })
        : [];
      if (liveMutatorPids.length === 0) {
        localFenceToken = localFence.record.token;
        break;
      }
      releaseLocalSandboxFence({
        path: localFencePath,
        token: localFence.record.token,
      });
      localFence.liveMutatorPids = liveMutatorPids;
    }
    if (Date.now() >= deadline) {
      await releaseLeaseOnce();
      die("local-CI sandbox owner process is still live; timed out waiting");
    }
    let renewal;
    try {
      renewal = await renewLeaseAuthority();
    } catch (error) {
      leaseEvents.push({
        type: "pre_run_heartbeat_uncertain",
        at: new Date().toISOString(),
        reason: error?.message || String(error),
        expiresAt,
      });
      process.stderr.write(
        `gate-worktree: lease heartbeat uncertain while waiting for the host fence (${error.message}); retrying within known authority\n`,
      );
      await sleep(Math.min(options.pollSeconds * 1000, Math.max(10, deadline - Date.now())));
      continue;
    }
    if (renewal?.success !== true) {
      await releaseLeaseOnce();
      die(`local-CI lease authority lost while waiting for the host process fence: ${JSON.stringify(renewal)}`);
    }
    leaseEvents.push({
      type: "pre_run_heartbeat_renewed",
      at: new Date().toISOString(),
      expiresAt,
    });
    if (localFence.liveMutatorPids?.length > 0) {
      waiting(
        `local-CI sandbox still has live mutator processes (${localFence.liveMutatorPids.join(", ")}); retrying after admission...`,
      );
    } else {
      waiting(`local-CI sandbox process fence held by ${localFence.active?.ownerSessionId || "unknown"}; retrying after admission...`);
    }
    await sleep(Math.min(options.pollSeconds * 1000, Math.max(10, deadline - Date.now())));
  }
  try {
    rmSync(freshnessReportFile, { force: true });
    rmSync(slotManifest.evidence.controlPlane, { force: true });
  } catch (error) {
    releaseLocalSandboxFence({ path: localFencePath, token: localFenceToken });
    await releaseLeaseOnce();
    throw error;
  }
  if (receivedSignal) {
    releaseLocalSandboxFence({ path: localFencePath, token: localFenceToken });
    await releaseLeaseOnce();
    process.exit(130);
  }

  process.stdout.write(`local-CI sandbox admitted: ${leaseId}\n`);
  // BI-B1065D41: name the full log BEFORE the long stage, so the detail is one
  // command away for the whole run rather than only after it finishes.
  process.stdout.write(`full log: ${fullLogFile}\n`);
  if (commandSpec) process.stdout.write(`running local-CI command: ${commandSpec.label}\n`);
  else process.stdout.write("sandbox checkout/build stub: gate passed (explicit test-only mode)\n");

  writeState(stateFile, {
    branch,
    sha,
    gatePassed: false,
    leaseId,
    evidenceId: "",
    status: "running",
    expiresAt,
    resilience: null,
    leaseEvents: [
      ...leaseEvents,
      { type: "started", at: new Date().toISOString() },
    ],
    evidencePending: false,
    queueObserver: queueObserverState(),
  });

  // The preflight executes in the shared scratch integration worktree, whose
  // gitdir differs from this candidate worktree's gitdir. Give the descendant
  // process one explicit handoff path so the wrapper reads evidence from the
  // same location the preflight writes.
  const gateCommand = createGateCommand(commandSpec, {
    cwd: worktreePath,
    env: {
      ...process.env,
      ...localCiSlotEnvironment(slotManifest),
      DPF_LOCAL_CI_METADATA_FILE: metadataFile,
      DPF_LOCAL_CI_FRESHNESS_REPORT_FILE: freshnessReportFile,
      DPF_LOCAL_CI_GATE_STATE_FILE: stateFile,
      DPF_NONPROD_LEASE_ID: leaseId,
      DPF_NONPROD_OWNER_SESSION_ID: ownerSessionId,
    },
    allowStub,
    fullLogFile,
  });
  // Replace the queue-stage handlers so a signal also terminates the running
  // descendant tree. The shared receivedSignal state preserves one cleanup.
  for (const [signal, handler] of Object.entries(signalHandlers)) process.removeListener(signal, handler);
  const runSignalHandlers = Object.fromEntries(["SIGINT", "SIGTERM"].map((signal) => [
    signal,
    () => {
      receivedSignal = signal;
      leaseEvents.push({ type: "signal", signal, at: new Date().toISOString() });
      void gateCommand.terminate();
    },
  ]));
  for (const [signal, handler] of Object.entries(runSignalHandlers)) process.once(signal, handler);
  let supervised;
  try {
    const admittedTtlMs = Math.max(
      1,
      (Number.isFinite(Date.parse(expiresAt)) ? Date.parse(expiresAt) : Date.now() + leaseTtlMs)
        - Date.now(),
    );
    supervised = await superviseLeaseRun({
      ttlMs: admittedTtlMs,
      expiresAt,
      run: gateCommand.run,
      terminate: gateCommand.terminate,
      renew: async () => {
        const localHeartbeat = heartbeatLocalSandboxFence({
          path: localFencePath,
          token: localFenceToken,
        });
        if (localHeartbeat.status !== "renewed") {
          return { success: false, error: "local-process-fence-lost" };
        }
        return renewLeaseAuthority();
      },
      release: async () => {
        try {
          await releaseLeaseOnce();
        } finally {
          releaseLocalSandboxFence({ path: localFencePath, token: localFenceToken });
        }
      },
      onEvent: (event) => leaseEvents.push(event),
    });
  } finally {
    for (const [signal, handler] of Object.entries(runSignalHandlers)) process.removeListener(signal, handler);
  }
  const runResult = supervised.result;
  if (supervised.status === "fenced") {
    runResult.status = 75;
    runResult.output = `${runResult.output}\ngate-worktree: lease fenced (${supervised.reason}); child process tree terminated\n`;
    process.stderr.write(`gate-worktree: lease fenced (${supervised.reason}); child process tree terminated\n`);
  }
  if (receivedSignal) {
    runResult.status = 130;
    runResult.output = `${runResult.output}\ngate-worktree: received ${receivedSignal}; child process tree terminated\n`;
    process.stderr.write(`gate-worktree: received ${receivedSignal}; child process tree terminated\n`);
  }
  if (!commandSpec) process.stdout.write(runResult.output);
  const gateOutput = runResult.output.slice(-12000);
  const failureSummary = summarizeLocalCiOutput(readFileSync(fullLogFile, "utf8"));

  let freshnessReport = null;
  try {
    freshnessReport = JSON.parse(readFileSync(freshnessReportFile, "utf8"));
  } catch {
    // No report produced; the command exit code remains authoritative and the
    // evidence records freshness as unknown.
  }
  const outcome = classifyGateOutcome({
    freshnessVerdict: freshnessReport ? freshnessReport.verdict : "",
    gateExitCode: runResult.status,
  });
  const freshness = freshnessReport
    ? {
      verdict: freshnessReport.verdict,
      failures: freshnessReport.failures,
      packages: (freshnessReport.packages || []).map((p) => ({ name: p.name, locked: p.lockedVersion, resolved: p.resolvedVersion })),
      convergence: freshnessReport.convergence,
      generatedAt: freshnessReport.generatedAt,
    }
    : { verdict: "unknown", reason: "no freshness report was produced by the gate command" };

  let contentMetadata = null;
  try {
    contentMetadata = JSON.parse(readFileSync(metadataFile, "utf8"));
  } catch {
    // no metadata written by this run — evidence.content stays null, matching the sh port.
  }
  let controlPlaneEvidence = null;
  try {
    controlPlaneEvidence = JSON.parse(
      readFileSync(slotManifest.evidence.controlPlane, "utf8"),
    );
  } catch {
    // A non-build failure may occur before the bounded wrapper writes samples.
  }
  const resilience = classifyBaseResilience(
    contentMetadata,
    options.pushBranch ? "push-before-lease" : "deferred",
  );

  const commandLabel = commandSpec ? commandSpec.label : "sandbox checkout/build stub";
  const evidenceValidity = ["passed", "failed"].includes(outcome.status)
    ? createLocalCiPassEvidenceValidity()
    : null;
  let evidenceArgs = {
    provider: ownerProvider,
    externalSessionId: ownerSessionId,
    routeContext: "/build",
    candidateBranch: branch,
    mode: "single-branch",
    status: outcome.status,
    summary: outcome.summary,
    ...(gateKey ? { gateKey, leaseId } : {}),
    evidence: {
      bi: "BI-166C59F3",
      resilienceBi: "BI-76551B2D",
      freshnessBi: "BI-ECDF9520",
      impactedTestRecommendationBi: "BI-A4EC0EA6",
      phase: 3,
      slotIsolationBi: "BI-4BE30454",
      poolPilotBi: "BI-A4427AB8",
      // BI-3A34D7A9: how this run's client/thread identity was resolved, and
      // the parent thread when the client exposes one. Lives in free-form
      // evidence rather than a lease column: it is descriptive provenance, so
      // it needs no migration and can grow without touching the lease contract.
      originBi: "BI-3A34D7A9",
      origin: buildAttributionEvidence(identity),
      slotManifest: {
        schemaVersion: slotManifest.schemaVersion,
        slotKey: slotManifest.slotKey,
        scratchWorkspace: slotManifest.scratch.workspace,
        integrationBranchPrefix: slotManifest.scratch.integrationBranchPrefix,
        fencePath: slotManifest.fence.path,
        composeProject: slotManifest.compose.project,
        portalUrl: slotManifest.portal.url,
        portalPort: slotManifest.portal.port,
        postgresContainer: slotManifest.postgres.container,
        postgresPort: slotManifest.postgres.hostPort,
        postgresDatabase: slotManifest.postgres.database,
        postgresVolume: slotManifest.postgres.volume,
        dependencyStore: slotManifest.dependencies.freshStore,
        artifactPath: slotManifest.evidence.artifact,
        controlPlaneEvidencePath: slotManifest.evidence.controlPlane,
      },
      leaseId,
      leaseEvents,
      leaseSupervisionStatus: supervised.status,
      admissionPoolPolicy,
      hostPressure: summarizeLocalCiPressureSamples(hostPressureSamples),
      branch,
      sha,
      expiresAt,
      evidenceValidity,
      pushBeforeLease: options.pushBranch,
      resilience,
      content: contentMetadata,
      controlPlane: controlPlaneEvidence,
      gatePassed: outcome.gatePassed,
      freshness,
      commands: [commandLabel],
      buildCommand: commandLabel,
      buildExitCode: runResult.status,
      output: gateOutput,
      fullLogFile,
      failureSummary,
      impactedTests: {
        recommendationBacklogItem: "BI-A4EC0EA6",
        status: "deferred_to_code_graph_recommender",
        note: "Local-CI records the handoff; graph-backed impacted-test selection remains owned by BI-A4EC0EA6.",
      },
      url,
    },
    failureSummary,
  };

  let evidenceResponse;
  try {
    evidenceResponse = await mcpCall("record_local_integration_result", evidenceArgs, { mcpUrl: options.mcpUrl, bearerToken });
  } catch (error) {
    evidenceResponse = {
      success: false,
      error: "transport_unavailable",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  // BI-C59AC8AF: generalized from the blocked_sandbox_drift-only version. An
  // installed portal cannot know a status a newer gate emits, and dropping the
  // write is the worst available outcome: the lease releases terminal with no
  // evidence, and because the gate key hashes the integration tree, that tree is
  // then permanently unable to be gated. Record SOMETHING, always — `failed` is
  // the honest floor and the prefix keeps the real class readable.
  if (evidenceResponse?.error === "invalid_status" && evidenceResponse?.success !== true) {
    const fallback = fallbackStatusForUnknown(outcome.status);
    process.stdout.write(
      `gate-worktree: portal does not know ${outcome.status} yet; recording as ${fallback.status} with the original class in the summary\n`,
    );
    evidenceArgs = {
      ...evidenceArgs,
      status: fallback.status,
      summary: `${fallback.summaryPrefix} ${evidenceArgs.summary}`,
    };
    evidenceResponse = await mcpCall("record_local_integration_result", evidenceArgs, { mcpUrl: options.mcpUrl, bearerToken });
  }

  let evidenceId = "";
  if (evidenceResponse?.success === true) {
    evidenceId = evidenceResponse.entityId || "";
  } else {
    const evidenceError = evidenceResponse?.error ?? evidenceResponse?.data?.error ?? "";
    if (outcome.status === "blocked_control_plane_starvation") {
      writePendingEvidence(pendingEvidenceFile, {
        branch,
        sha,
        expiresAt,
        reason: evidenceError || "control_plane_unavailable",
        retryAfterSeconds: 30,
        recordArgs: evidenceArgs,
      });
      writeState(stateFile, {
        branch,
        sha,
        gatePassed: false,
        leaseId,
        evidenceId: "",
        status: outcome.status,
        expiresAt,
        resilience,
        leaseEvents,
        evidencePending: true,
        evidencePendingReason: evidenceError || "control_plane_unavailable",
      });
      process.stderr.write("gate-worktree: control-plane starvation evidence is preserved locally and pending portal recovery.\n");
      process.exit(5);
    }
    if (outcome.gatePassed && evidenceError === "portal_quiescing") {
      const retryAfterSeconds = Number(
        evidenceResponse?.data?.retryAfterSeconds
          ?? evidenceResponse?.retryAfterSeconds
          ?? 30,
      );
      writePendingEvidence(pendingEvidenceFile, {
        branch,
        sha,
        expiresAt,
        reason: evidenceError,
        retryAfterSeconds,
        recordArgs: evidenceArgs,
      });
      writeState(stateFile, {
        branch,
        sha,
        gatePassed: true,
        leaseId,
        evidenceId: "",
        status: outcome.status,
        expiresAt,
        resilience,
        leaseEvents,
        evidencePending: true,
        evidencePendingReason: evidenceError,
      });
      process.stderr.write("gate-worktree: local-CI gate passed but evidence recording is pending because the portal is quiescing.\n");
      process.stderr.write(`gate-worktree: the lease is released; rerun pnpm run pregate -- --finalize-evidence --branch "${branch}" --sha "${sha}" --worktree "${worktreePath}" after quiescence clears.\n`);
      process.exit(4);
    }
    writeState(stateFile, {
      branch,
      sha,
      gatePassed: false,
      leaseId,
      evidenceId: "",
      status: "failed",
      expiresAt,
      resilience,
      leaseEvents,
      evidencePending: false,
    });
    die(`failed to record local integration evidence: ${JSON.stringify(evidenceResponse)}`);
  }

  writeState(stateFile, {
    branch,
    sha,
    gatePassed: outcome.gatePassed,
    leaseId,
    evidenceId,
    status: outcome.status,
    expiresAt: evidenceValidity?.expiresAt || expiresAt,
    leaseExpiresAt: expiresAt,
    evidenceValidity,
    resilience,
    leaseEvents,
    evidencePending: false,
  });

  // BI-B1065D41 Phase 1: one bounded, stable block closes every run. On a pass
  // its LAST line is still the literal `gate passed` — the documented anchor,
  // load-bearing because the exit code lies in two independent directions (a
  // chained command surfaces someone else's status; a run that gave up while
  // queued exits 0 without gating anything). Failure paths keep their own
  // terminal wording, so the block carries only the supporting facts there.
  const summaryInput = {
    branch,
    sha,
    logFile: fullLogFile,
    logLines: runResult.logLines,
    elapsedMs: runResult.elapsedMs,
    metadataFile: contentMetadata ? metadataFile : "",
    candidateSha: contentMetadata?.candidateSha || "",
    evidenceId,
  };

  if (outcome.gatePassed) {
    process.stdout.write(`${formatGateSummary({ ...summaryInput, verdictLine: "gate passed" }).join("\n")}\n`);
    process.exit(0); // exit-0: gate passed; the PASS record for this sha was written above
  }
  process.stderr.write(
    `${formatGateSummary({ ...summaryInput, verdictLine: "", failureSummary }).join("\n")}\n`,
  );
  if (outcome.status === "blocked_sandbox_drift") {
    process.stderr.write(`gate-worktree: BLOCKED (sandbox drift): ${outcome.summary}\n`);
    process.stderr.write("gate-worktree: this is a sandbox defect, not product build evidence; converge the sandbox and re-run the gate\n");
    process.exit(3);
  }
  if (outcome.status === "blocked_control_plane_starvation") {
    process.stderr.write(`gate-worktree: BLOCKED (control-plane starvation): ${outcome.summary}\n`);
    process.exit(5);
  }
  die("gate failed");
}

function writeState(stateFile, {
  branch,
  sha,
  gatePassed,
  leaseId,
  evidenceId,
  status,
  expiresAt,
  leaseExpiresAt = "",
  evidenceValidity = null,
  resilience,
  leaseEvents,
  evidencePending = false,
  evidencePendingReason = "",
  quiescence = null,
  recovery = null,
  queueObserver = null,
  admission = null,
}) {
  writeLocalCiGateState(stateFile, {
    branch,
    sha,
    gatePassed,
    leaseId,
    evidenceId,
    status,
    expiresAt,
    leaseExpiresAt,
    evidenceValidity,
    resilience,
    leaseEvents,
    evidencePending,
    evidencePendingReason,
    quiescence,
    recovery,
    queueObserver,
    admission,
  });
}

// A gate that silently skips main() exits 0 — a false "pass" — so the entry
// check must survive symlinked invocation paths (macOS /var tmpdir, symlinked
// checkouts) where argv[1] and import.meta.url spell the same file differently.
if (isEntryModule(import.meta.url)) {
  main().catch((error) => {
    die(error?.stack || String(error));
  });
}
