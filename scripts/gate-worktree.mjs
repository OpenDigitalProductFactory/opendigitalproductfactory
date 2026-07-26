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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { mcpCall } from "./lib/mcp-client.mjs";
import { classifyGateOutcome } from "./lib/sandbox-freshness.mjs";
import { superviseLeaseRun } from "./lib/lease-supervisor.mjs";
import {
  acquireLocalSandboxFence,
  heartbeatLocalSandboxFence,
  releaseLocalSandboxFence,
} from "./lib/local-sandbox-fence.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(THIS_FILE);

function die(message) {
  process.stderr.write(`gate-worktree: ${message}\n`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function git(gitBin, args, cwd) {
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
  --owner-session-id ID       External session id (default: gate-<pid>)
  --mcp-url URL                MCP endpoint (default: DPF_MCP_URL or local portal)
  --lease-wait-seconds N       Max time to wait when the lease is busy (default: 300)
  --poll-seconds N             Busy-lease poll interval (default: 10)
  --expires-minutes N          Lease expiry window (default: 60)
  --push                       Push before claiming the lease (legacy/explicit publication mode)
  --no-push                    Do not push before claiming the lease (default)
  --dry-run                    Print planned actions; skip git push and MCP calls
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
    leaseWaitSeconds: Number(process.env.DPF_GATE_LEASE_WAIT_SECONDS || 300),
    pollSeconds: Number(process.env.DPF_GATE_POLL_SECONDS || 10),
    expiresMinutes: Number(process.env.DPF_GATE_EXPIRES_MINUTES || 60),
    pushBranch: false,
    dryRun: false,
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

function createGateCommand(commandSpec, { cwd, env, allowStub }) {
  if (!commandSpec) {
    if (!allowStub) throw new Error("runGateCommand called with no command and no stub allowed");
    return {
      run: async () => ({
        label: "sandbox checkout/build stub",
        status: 0,
        output: "sandbox checkout/build stub: gate passed (DPF_ALLOW_LOCAL_CI_STUB=1)\n",
      }),
      terminate: async () => {},
    };
  }
  let child = null;
  let output = "";
  const append = (chunk, stream) => {
    const text = String(chunk);
    output = `${output}${text}`.slice(-12000);
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const gitBin = process.env.DPF_GATE_GIT_BIN || "git";
  const allowStub = process.env.DPF_ALLOW_LOCAL_CI_STUB === "1";

  const branch = options.branch || gitOrEmpty(gitBin, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "HEAD") die("cannot gate detached HEAD");
  const sha = options.sha || gitOrEmpty(gitBin, ["rev-parse", "HEAD"]);
  const worktreePath = options.worktree || gitOrEmpty(gitBin, ["rev-parse", "--show-toplevel"]);
  const ownerSessionId = options.ownerSessionId || `gate-${process.pid}`;

  const stateFile = gitPath(gitBin, worktreePath, "dpf-local-ci-gate.json");
  const metadataFile = gitPath(gitBin, worktreePath, "dpf-local-ci-metadata.json");
  const gitCommonDir = resolvePath(
    worktreePath,
    gitOrEmpty(gitBin, ["rev-parse", "--git-common-dir"], worktreePath),
  );
  const localFencePath = process.env.DPF_LOCAL_SANDBOX_FENCE_PATH
    || join(gitCommonDir, "dpf-local-ci-owner.json");

  const commandSpec = resolveGateCommand({ branch, allowStub, gitBin });

  if (options.dryRun) {
    process.stdout.write("gate-worktree dry-run\n");
    process.stdout.write(`branch=${branch}\nsha=${sha}\nworktree=${worktreePath}\nremote=${options.remote}\nmcpUrl=${options.mcpUrl}\n`);
    process.stdout.write(`metadataFile=${metadataFile}\n`);
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

  if (!commandSpec && !allowStub) {
    die("local-CI gate runner is not wired (scripts/local-ci-runner.mjs is missing); refusing to record passing stub evidence. Set DPF_LOCAL_CI_COMMAND to the canonical sandbox command, or use DPF_ALLOW_LOCAL_CI_STUB=1 only in contract tests.");
  }

  const bearerToken = process.env.DPF_MCP_BEARER_TOKEN;
  if (!bearerToken) die("DPF_MCP_BEARER_TOKEN is required to claim the local-CI lease");

  if (options.pushBranch) {
    const push = git(gitBin, ["push", options.remote, branch], worktreePath);
    if (push.status !== 0) die(`push failed: ${push.stderr || push.stdout}`);
  }

  const leaseTtlMs = Math.min(options.expiresMinutes * 60000, 20 * 60_000);
  let expiresAt = "";
  const deadline = Date.now() + options.leaseWaitSeconds * 1000;
  const url = process.env.DPF_LOCAL_CI_URL || "http://localhost:3010";

  let leaseId = "";
  let localFenceToken = "";
  for (;;) {
    const localFence = acquireLocalSandboxFence({
      path: localFencePath,
      ownerSessionId,
      branch,
    });
    if (localFence.status === "conflict") {
      if (Date.now() >= deadline) die("local-CI sandbox owner process is still live; timed out waiting");
      process.stdout.write(`local-CI sandbox process fence held by ${localFence.active?.ownerSessionId || "unknown"}; retrying in ${options.pollSeconds}s...\n`);
      await sleep(options.pollSeconds * 1000);
      continue;
    }
    localFenceToken = localFence.record.token;
    expiresAt = new Date(Date.now() + leaseTtlMs).toISOString();
    const claimResponse = await mcpCall("claim_nonprod_environment_lease", {
      environmentKey: "local-integration-ci",
      ownerProvider: options.ownerProvider,
      ownerSessionId,
      purpose: `Pre-PR local-CI gate for ${branch} @ ${sha}`,
      url,
      ports: [3010],
      expiresAt,
      worktreePath,
      branchName: branch,
      cleanupCommand: "docker compose -f docker-compose.local-ci.yml --profile local-ci down",
    }, { mcpUrl: options.mcpUrl, bearerToken });

    if (claimResponse?.success === true) {
      leaseId = claimResponse.entityId || claimResponse?.data?.lease?.leaseId || "";
      break;
    }
    releaseLocalSandboxFence({ path: localFencePath, token: localFenceToken });
    localFenceToken = "";
    if (claimResponse?.error === "lease_conflict") {
      if (Date.now() >= deadline) die("local-CI sandbox lease is busy; timed out waiting");
      process.stdout.write(`local-CI sandbox busy; queued behind active lease. Retrying in ${options.pollSeconds}s...\n`);
      await sleep(options.pollSeconds * 1000);
      continue;
    }
    die(`failed to claim local-CI lease: ${JSON.stringify(claimResponse)}`);
  }

  process.stdout.write(`local-CI sandbox lease claimed: ${leaseId}\n`);
  if (commandSpec) process.stdout.write(`running local-CI command: ${commandSpec.label}\n`);
  else process.stdout.write("sandbox checkout/build stub: gate passed (explicit test-only mode)\n");

  const gateCommand = createGateCommand(commandSpec, {
    cwd: worktreePath,
    env: {
      ...process.env,
      DPF_LOCAL_CI_METADATA_FILE: metadataFile,
      DPF_NONPROD_LEASE_ID: leaseId,
      DPF_NONPROD_OWNER_SESSION_ID: ownerSessionId,
    },
    allowStub,
  });
  const leaseEvents = [{ type: "claimed", at: new Date().toISOString(), expiresAt }];
  let receivedSignal = "";
  const signalHandlers = Object.fromEntries(["SIGINT", "SIGTERM"].map((signal) => [
    signal,
    () => {
      receivedSignal = signal;
      leaseEvents.push({ type: "signal", signal, at: new Date().toISOString() });
      void gateCommand.terminate();
    },
  ]));
  for (const [signal, handler] of Object.entries(signalHandlers)) process.once(signal, handler);
  let supervised;
  try {
    supervised = await superviseLeaseRun({
      ttlMs: leaseTtlMs,
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
        return mcpCall("renew_nonprod_environment_lease", {
          leaseId,
          ownerSessionId,
        }, { mcpUrl: options.mcpUrl, bearerToken });
      },
      release: async () => {
        try {
          const response = await mcpCall("release_nonprod_environment_lease", {
            leaseId,
          }, { mcpUrl: options.mcpUrl, bearerToken });
          if (response?.success !== true) {
            throw new Error(`failed to release local-CI lease: ${JSON.stringify(response)}`);
          }
        } finally {
          releaseLocalSandboxFence({ path: localFencePath, token: localFenceToken });
        }
      },
      onEvent: (event) => leaseEvents.push(event),
    });
  } finally {
    for (const [signal, handler] of Object.entries(signalHandlers)) process.removeListener(signal, handler);
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

  let freshnessReport = null;
  try {
    freshnessReport = JSON.parse(readFileSync(gitPath(gitBin, worktreePath, "dpf-sandbox-freshness.json"), "utf8"));
  } catch {
    // no report produced — classifyGateOutcome treats an empty verdict as "not green".
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
      phase: 1,
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
      url,
    },
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
    writeState(stateFile, { branch, sha, gatePassed: false, leaseId, evidenceId: "", status: "failed", expiresAt, resilience, leaseEvents });
    die(`failed to record local integration evidence: ${JSON.stringify(evidenceResponse)}`);
  }

  writeState(stateFile, { branch, sha, gatePassed: outcome.gatePassed, leaseId, evidenceId, status: outcome.status, expiresAt, resilience, leaseEvents });

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

function writeState(stateFile, { branch, sha, gatePassed, leaseId, evidenceId, status, expiresAt, resilience, leaseEvents }) {
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
    recordedAt: new Date().toISOString(),
  };
  if (resilience) payload.resilience = resilience;
  writeFileSync(stateFile, `${JSON.stringify(payload, null, 2)}\n`);
}

if (process.argv[1] === THIS_FILE) {
  main().catch((error) => {
    die(error?.stack || String(error));
  });
}
