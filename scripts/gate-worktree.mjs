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
import { summarizeLocalCiOutput } from "./lib/local-ci-failure-summary.mjs";
import { classifyGateOutcome } from "./lib/sandbox-freshness.mjs";
import {
  authoritySafetyMarginMs,
  superviseLeaseRun,
} from "./lib/lease-supervisor.mjs";
import {
  acquireLocalSandboxFence,
  heartbeatLocalSandboxFence,
  releaseLocalSandboxFence,
} from "./lib/local-sandbox-fence.mjs";
import {
  createGateObserverIdentity,
  findDeadLocalQueueObservers,
  registerLocalQueueObserver,
  releaseLocalQueueObserver,
} from "./lib/local-queue-observer.mjs";
import {
  createLocalCiSlotManifest,
  localCiSlotEnvironment,
} from "./lib/local-ci-slot-manifest.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(THIS_FILE);
const LOCAL_CI_ACTIVE_LEASE_TTL_MS = 2 * 60_000;

function die(message) {
  process.stderr.write(`gate-worktree: ${message}\n`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  --owner-provider NAME       build-studio|claude|codex|coworker (default: codex)
  --owner-session-id ID       External session id (default: host-local gate observer)
  --mcp-url URL                MCP endpoint (default: DPF_MCP_URL or local portal)
  --lease-wait-seconds N       Max time to wait for admission (default: 7200)
  --poll-seconds N             Initial queue-observation backoff (default: 10)
  --expires-minutes N          Lease expiry window (default: 2; local-CI cap: 2)
  --push                       Push before claiming the lease (legacy/explicit publication mode)
  --no-push                    Do not push before claiming the lease (default)
  --dry-run                    Print planned actions; skip git push and MCP calls
  --finalize-evidence          Publish pending local-CI evidence without rerunning the gate
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
    ownerProvider: process.env.DPF_GATE_OWNER_PROVIDER || "codex",
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
        process.exit(0);
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
  let output = "";
  writeFileSync(fullLogFile, "");
  const append = (chunk, stream) => {
    const text = String(chunk);
    output = `${output}${text}`.slice(-12000);
    appendFileSync(fullLogFile, text);
    stream.write(text);
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
      child.stdout.on("data", (chunk) => append(chunk, process.stdout));
      child.stderr.on("data", (chunk) => append(chunk, process.stderr));
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({
        label: commandSpec.label,
        status: code ?? (signal ? 143 : 1),
        output,
      }));
    }),
    terminate: async () => {
      if (!child || child.exitCode !== null) return;
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
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
      { mcpUrl, bearerToken },
    );
  } catch (error) {
    process.stderr.write(
      `gate-worktree: dead-waiter reconciliation unavailable (${error.message}); queue remains fail-closed\n`,
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
    releaseLocalQueueObserver({
      path: resolvePath(directory, `${candidate.livenessProof.observerToken}.json`),
      token: candidate.livenessProof.observerToken,
    });
    const event = {
      type: "dead_queue_observer_cancelled",
      leaseId: candidate.leaseId,
      reason: candidate.reason,
      livenessProof: candidate.livenessProof,
      at: new Date().toISOString(),
    };
    leaseEvents.push(event);
    process.stdout.write(
      `cancelled dead same-host queue observer ${candidate.leaseId} (${candidate.reason}; pid ${candidate.livenessProof.pid})\n`,
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
  const options = parseArgs(process.argv.slice(2));
  const gitBin = process.env.DPF_GATE_GIT_BIN || "git";
  const allowStub = process.env.DPF_ALLOW_LOCAL_CI_STUB === "1";

  const branch = options.branch || gitOrEmpty(gitBin, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "HEAD") die("cannot gate detached HEAD");
  const sha = options.sha || gitOrEmpty(gitBin, ["rev-parse", "HEAD"]);
  const worktreePath = options.worktree || gitOrEmpty(gitBin, ["rev-parse", "--show-toplevel"]);
  const gateObserverIdentity = options.ownerSessionId
    ? null
    : createGateObserverIdentity();
  const ownerSessionId = options.ownerSessionId || gateObserverIdentity.ownerSessionId;
  const claimKey = `local-ci:${ownerSessionId}:${sha}`;
  const deadline = Date.now() + options.leaseWaitSeconds * 1000;
  const commandSpec = resolveGateCommand({ branch, allowStub, gitBin });

  if (options.dryRun) {
    process.stdout.write("gate-worktree dry-run\n");
    process.stdout.write(`branch=${branch}\nsha=${sha}\nworktree=${worktreePath}\nremote=${options.remote}\nmcpUrl=${options.mcpUrl}\n`);
    process.stdout.write(`pushBeforeLease=${options.pushBranch}\n`);
    if (commandSpec) {
      process.stdout.write(`localCiCommand=${commandSpec.label}\n`);
    } else if (allowStub) {
      process.stdout.write("localCiCommand=sandbox checkout/build stub (explicitly allowed)\n");
    } else {
      process.stdout.write("localCiCommand=missing; gate would fail before push/lease\n");
    }
    process.stdout.write("would call claim_nonprod_environment_lease and record_local_integration_result only when a real command or explicit stub is configured\n");
    process.exit(0);
  }

  if (!options.finalizeEvidence && !commandSpec && !allowStub) {
    die("local-CI gate runner is not wired (scripts/local-ci-runner.mjs is missing); refusing to record passing stub evidence. Set DPF_LOCAL_CI_COMMAND to the canonical sandbox command, or use DPF_ALLOW_LOCAL_CI_STUB=1 only in contract tests.");
  }

  const bearerToken = process.env.DPF_MCP_BEARER_TOKEN;
  if (!bearerToken) die("DPF_MCP_BEARER_TOKEN is required to claim the local-CI lease");

  const candidateGitDir = dirname(gitPath(gitBin, worktreePath, "dpf-local-ci-gate.json"));
  const gitCommonDir = resolvePath(
    worktreePath,
    gitOrEmpty(gitBin, ["rev-parse", "--git-common-dir"], worktreePath),
  );
  const rootClone = dirname(gitCommonDir);
  const queueObserverDirectory = process.env.DPF_LOCAL_QUEUE_OBSERVER_DIR
    || resolvePath(gitCommonDir, "dpf-local-ci-queue-observers");
  let slotManifest = createLocalCiSlotManifest({
    slotKey: process.env.DPF_LOCAL_CI_SLOT_KEY || "slot-0",
    rootClone,
    gitCommonDir,
    candidateGitDir,
  });
  let stateFile = slotManifest.evidence.state;
  let metadataFile;
  let pendingEvidenceFile = slotManifest.evidence.pending;
  let fullLogFile;
  let freshnessReportFile;
  let localFencePath = slotManifest.fence.path;

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
    const delayMs = retryDelayMs({
      attempt: quiescenceAttempt,
      pollSeconds: options.pollSeconds,
      retryAfterSeconds,
    });
    quiescenceAttempt += 1;
    process.stdout.write(`portal is ${quiescence.level || "quiescing"}; retrying governed admission in ${(delayMs / 1000).toFixed(1)}s...\n`);
    await sleep(Math.min(delayMs, Math.max(10, deadline - Date.now())));
  }

  if (options.finalizeEvidence) {
    if (!existsSync(pendingEvidenceFile)) {
      die(`no pending local-CI evidence file found at ${pendingEvidenceFile}`);
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
    writeState(stateFile, {
      branch,
      sha,
      gatePassed: true,
      leaseId: evidence.leaseId || "",
      evidenceId,
      status: "passed",
      expiresAt: pending.expiresAt || evidence.expiresAt || "",
      resilience: evidence.resilience ?? null,
      leaseEvents: evidence.leaseEvents ?? [],
      evidencePending: false,
    });
    rmSync(pendingEvidenceFile, { force: true });
    process.stdout.write(`recorded pending local-CI evidence: ${evidenceId}\n`);
    process.exit(0);
  }

  warnAboutMainFreshness({ gitBin, worktreePath });

  if (options.pushBranch) {
    const push = git(gitBin, ["push", options.remote, branch], worktreePath);
    if (push.status !== 0) die(`push failed: ${push.stderr || push.stdout}`);
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
  const leaseEvents = [];
  const signalHandlers = Object.fromEntries(["SIGINT", "SIGTERM"].map((signal) => [
    signal,
    () => {
      receivedSignal = signal;
      leaseEvents.push({ type: "signal", signal, at: new Date().toISOString() });
    },
  ]));
  for (const [signal, handler] of Object.entries(signalHandlers)) process.once(signal, handler);

  if (gateObserverIdentity) {
    queueObserverPath = registerLocalQueueObserver({
      directory: queueObserverDirectory,
      identity: gateObserverIdentity,
      branch,
      sha,
    }).path;
  }

  const releaseLeaseOnce = async () => {
    if (!leaseId || leaseReleased) return;
    leaseReleased = true;
    const response = await mcpCall("release_nonprod_environment_lease", {
      leaseId,
    }, { mcpUrl: options.mcpUrl, bearerToken });
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

  let claimAttempt = 0;
  for (;;) {
    if (receivedSignal) {
      await releaseLeaseOnce();
      process.exit(130);
    }
    await cancelDeadLocalQueueObservers({
      directory: queueObserverDirectory,
      mcpUrl: options.mcpUrl,
      bearerToken,
      leaseEvents,
      reportActive: claimAttempt === 0,
    });
    expiresAt = new Date(Date.now() + leaseTtlMs).toISOString();
    let claimResponse;
    try {
      claimResponse = await mcpCall("claim_nonprod_environment_lease", {
        environmentKey: "local-integration-ci",
        ownerProvider: options.ownerProvider,
        ownerSessionId,
        claimKey,
        purpose: `Pre-PR local-CI gate for ${branch} @ ${sha}`,
        url,
        ports: [slotManifest.portal.port, slotManifest.postgres.hostPort],
        expiresAt,
        worktreePath,
        branchName: branch,
        cleanupCommand: `node scripts/local-ci-slot-cleanup.mjs --slot-key ${slotManifest.slotKey}`,
      }, { mcpUrl: options.mcpUrl, bearerToken });
    } catch (error) {
      if (!isTransientMcpError(error) || Date.now() >= deadline) throw error;
      const delayMs = retryDelayMs({ attempt: claimAttempt, pollSeconds: options.pollSeconds });
      claimAttempt += 1;
      process.stdout.write(`local-CI admission transport unavailable (${error.message}); retrying in ${(delayMs / 1000).toFixed(1)}s...\n`);
      await sleep(Math.min(delayMs, Math.max(10, deadline - Date.now())));
      continue;
    }

    leaseId = claimResponse?.entityId || claimResponse?.data?.lease?.leaseId || leaseId;
    const admission = claimResponse?.data?.admission;
    if (claimResponse?.success === true && admission?.status !== "queued") {
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
      localFencePath = slotManifest.fence.path;
      url = slotManifest.portal.url;
      leaseEvents.push({
        type: "admitted",
        at: new Date().toISOString(),
        slotKey: slotManifest.slotKey,
        waitAgeMs: admission?.waitAgeMs ?? null,
        expiresAt,
      });
      break;
    }
    if (claimResponse?.success === true && admission?.status === "queued") {
      if (Date.now() >= deadline) {
        await releaseLeaseOnce();
        die("local-CI admission queue wait timed out");
      }
      const delayMs = retryDelayMs({ attempt: claimAttempt, pollSeconds: options.pollSeconds });
      claimAttempt += 1;
      process.stdout.write(`local-CI admission queued at position ${admission.queuePosition}; observing again in ${(delayMs / 1000).toFixed(1)}s...\n`);
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
      process.stdout.write(`local-CI portal is on the legacy conflict contract; observing admission again in ${(delayMs / 1000).toFixed(1)}s...\n`);
      await sleep(Math.min(delayMs, Math.max(10, deadline - Date.now())));
      continue;
    }
    if (claimResponse?.error === "portal_quiescing") {
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
      process.stdout.write(`portal is quiescing; preserving queue intent and retrying in ${(delayMs / 1000).toFixed(1)}s...\n`);
      await sleep(Math.min(delayMs, Math.max(10, deadline - Date.now())));
      continue;
    }
    die(`failed to claim local-CI lease: ${JSON.stringify(claimResponse)}`);
  }

  const renewLeaseAuthority = async () => {
    const response = await mcpCall("renew_nonprod_environment_lease", {
      leaseId,
      ownerSessionId,
      ttlMinutes: LOCAL_CI_ACTIVE_LEASE_TTL_MS / 60_000,
    }, { mcpUrl: options.mcpUrl, bearerToken });
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
    return response;
  };

  // Durable remote admission is authoritative. The host-process fence is a
  // second, local safety belt acquired only after this waiter owns slot-0.
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
      localFenceToken = localFence.record.token;
      break;
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
    process.stdout.write(`local-CI sandbox process fence held by ${localFence.active?.ownerSessionId || "unknown"}; retrying after admission...\n`);
    await sleep(Math.min(options.pollSeconds * 1000, Math.max(10, deadline - Date.now())));
  }
  try {
    rmSync(freshnessReportFile, { force: true });
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
  if (commandSpec) process.stdout.write(`running local-CI command: ${commandSpec.label}\n`);
  else process.stdout.write("sandbox checkout/build stub: gate passed (explicit test-only mode)\n");

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
  const resilience = {
    publicationMode: options.pushBranch ? "push-before-lease" : "deferred",
    acceptedBaseMode: contentMetadata?.fetchBase === true ? "fetch-base" : "local-ref",
    networkTolerance: (!options.pushBranch && contentMetadata?.fetchBase !== true) ? "offline-capable" : "network-required",
  };

  const commandLabel = commandSpec ? commandSpec.label : "sandbox checkout/build stub";
  let evidenceArgs = {
    provider: options.ownerProvider,
    externalSessionId: ownerSessionId,
    routeContext: "/build",
    candidateBranch: branch,
    mode: "single-branch",
    status: outcome.status,
    summary: outcome.summary,
    evidence: {
      bi: "BI-166C59F3",
      resilienceBi: "BI-76551B2D",
      freshnessBi: "BI-ECDF9520",
      impactedTestRecommendationBi: "BI-A4EC0EA6",
      phase: 2,
      slotIsolationBi: "BI-4BE30454",
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
      },
      leaseId,
      leaseEvents,
      leaseSupervisionStatus: supervised.status,
      branch,
      sha,
      expiresAt,
      pushBeforeLease: options.pushBranch,
      resilience,
      content: contentMetadata,
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

  let evidenceResponse = await mcpCall("record_local_integration_result", evidenceArgs, { mcpUrl: options.mcpUrl, bearerToken });
  if (evidenceResponse?.success !== true && outcome.status === "blocked_sandbox_drift" && evidenceResponse?.error === "invalid_status") {
    process.stdout.write("gate-worktree: portal does not know blocked_sandbox_drift yet; recording as failed with sandbox-drift evidence\n");
    evidenceArgs = { ...evidenceArgs, status: "failed", summary: `[SANDBOX_DRIFT — not product evidence] ${evidenceArgs.summary}` };
    evidenceResponse = await mcpCall("record_local_integration_result", evidenceArgs, { mcpUrl: options.mcpUrl, bearerToken });
  }

  let evidenceId = "";
  if (evidenceResponse?.success === true) {
    evidenceId = evidenceResponse.entityId || "";
  } else {
    const evidenceError = evidenceResponse?.error ?? evidenceResponse?.data?.error ?? "";
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
    expiresAt,
    resilience,
    leaseEvents,
    evidencePending: false,
  });

  if (outcome.gatePassed) {
    process.stdout.write("gate passed\n");
    process.exit(0);
  }
  if (outcome.status === "blocked_sandbox_drift") {
    process.stderr.write(`gate-worktree: BLOCKED (sandbox drift): ${outcome.summary}\n`);
    process.stderr.write("gate-worktree: this is a sandbox defect, not product build evidence; converge the sandbox and re-run the gate\n");
    process.exit(3);
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
  resilience,
  leaseEvents,
  evidencePending = false,
  evidencePendingReason = "",
  quiescence = null,
}) {
  mkdirSync(dirname(stateFile), { recursive: true });
  const payload = {
    branch,
    sha,
    gatePassed,
    leaseId,
    evidenceRecordId: evidenceId,
    status,
    expiresAt,
    leaseEvents,
    evidencePending,
    recordedAt: new Date().toISOString(),
  };
  if (resilience) payload.resilience = resilience;
  if (evidencePending) payload.evidencePendingReason = evidencePendingReason || "unknown";
  if (quiescence) payload.quiescence = quiescence;
  writeFileSync(stateFile, `${JSON.stringify(payload, null, 2)}\n`);
}

if (process.argv[1] === THIS_FILE) {
  main().catch((error) => {
    die(error?.stack || String(error));
  });
}
