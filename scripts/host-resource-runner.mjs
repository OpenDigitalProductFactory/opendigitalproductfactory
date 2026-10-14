#!/usr/bin/env node

import { parseArgs as utilParseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { hostname, freemem, totalmem } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { gitTextOrNull } from "./lib/git.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";
import { mcpCall } from "./lib/mcp-client.mjs";
import { MCP_CREDENTIAL_HELP, resolveMcpCredential } from "./lib/mcp-credential.mjs";
import { admittedLeaseTtlMs, superviseLeaseRun } from "./lib/lease-supervisor.mjs";
import { readProcessIdentity } from "./lib/local-sandbox-fence.mjs";
import { spawnDurableWaitResumer } from "./lib/durable-wait-resumer.mjs";
import { readHostAttemptContext, resolveHostAttempt, hostResumePin } from "./lib/host-resource-attempt.mjs";

const PROFILE_CONTRACT = JSON.parse(readFileSync(
  new URL("../apps/web/lib/nonprod/host-resource-profiles.json", import.meta.url),
  "utf8",
));

const DEFAULT_LOCAL_MCP_URL = "http://127.0.0.1:3000/api/mcp/v1";
const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));

export const HEAVY_PROCESS_CLASSES = Object.freeze([
  "typescript",
  "vitest",
  "next-build",
  "docker-build",
  "preview",
  "inference",
  "semantic-review",
]);

export function parseHostResourceArgs(argv) {
  const options = { class: { type: "string" }, "resume-pin": { type: "string" } };
  const { values, tokens } = utilParseArgs({ args: argv, options, strict: false, allowPositionals: true, tokens: true });
  const terminator = tokens.find((token) => token.kind === "option-terminator");
  const stray = tokens.find((token) => token !== terminator && (terminator === undefined || token.index < terminator.index)
    && (token.kind !== "option" || !Object.hasOwn(options, token.name)));
  if (stray) throw new Error(`unknown argument: ${stray.rawName ?? stray.value}`);
  const resourceClass = typeof values.class === "string" ? values.class : "";
  if (!resourceClass) throw new Error("--class is required");
  if (!HEAVY_PROCESS_CLASSES.includes(resourceClass)) {
    throw new Error(`unsupported resource class: ${resourceClass}`);
  }
  if (values["resume-pin"] !== undefined && (typeof values["resume-pin"] !== "string" || !values["resume-pin"])) {
    throw new Error("--resume-pin requires a nonempty value");
  }
  const command = terminator === undefined ? [] : argv.slice(terminator.index + 1);
  if (command.length === 0) {
    throw new Error("a command is required after --");
  }
  return {
    resourceClass,
    command: command[0],
    commandArgs: command.slice(1),
    ...(values["resume-pin"] ? { resumePin: values["resume-pin"] } : {}),
  };
}

const PROCESS_PATTERNS = Object.freeze([
  ["docker-build", /\bdocker(?:\.exe)?\s+(?:build|buildx\s+build)\b/i],
  ["next-build", /(?:\bnext(?:\.cmd)?\s+build\b|next[\\/]dist[\\/]bin[\\/]next\s+build\b)/i],
  ["preview", /(?:\bnext(?:\.cmd)?\s+dev\b|scripts[\\/]dev-portal-lease\.)/i],
  ["vitest", /(?:\bvitest(?:\.mjs|\.cmd)?\s+(?:run|watch)\b|node_modules[\\/]vitest[\\/]vitest\.mjs)/i],
  ["typescript", /(?:\btsc(?:\.cmd)?\b|typescript[\\/]bin[\\/]tsc)/i],
  ["semantic-review", /(?:review_semantic_change|routed-semantic-review|semantic-review)/i],
  ["inference", /(?:com\.docker\.llama-server|ollama\s+(?:run|serve)|llama-server)/i],
]);

export function classifyHeavyProcess(commandLine) {
  const match = PROCESS_PATTERNS.find(([, pattern]) => pattern.test(String(commandLine ?? "")));
  return match?.[0] ?? null;
}

export function findUngovernedHeavyProcesses(processRows, { governedPids = [] } = {}) {
  const governed = new Set(governedPids.map(Number));
  return processRows.flatMap((row) => {
    const resourceClass = classifyHeavyProcess(row.commandLine);
    if (!resourceClass || governed.has(Number(row.pid))) return [];
    return [{
      pid: Number(row.pid),
      parentPid: Number(row.parentPid),
      resourceClass,
      commandLine: String(row.commandLine),
      disposition: "evidence-only",
    }];
  });
}

export function buildHostResourceClaim({
  resourceClass,
  ownerProvider,
  ownerSessionId,
  worktreePath,
  branchName,
  pid,
  processIdentity,
  now,
  totalMemoryBytes,
  availableMemoryBytes,
  inferenceResident,
  ungovernedProcesses,
  attempt,
}) {
  const profile = PROFILE_CONTRACT.profiles[resourceClass];
  if (!profile) throw new Error(`unsupported resource class: ${resourceClass}`);
  if (!attempt?.claimKey) throw new Error("host resource attempt identity is required");
  return {
    environmentKey: "host-heavy-resource",
    ownerProvider,
    ownerSessionId,
    claimKey: attempt.claimKey,
    ...(attempt?.leaseId ? { resumeLeaseId: attempt.leaseId } : {}),
    purpose: `host-resource:${resourceClass}`,
    url: "host://localhost",
    ports: [],
    expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    worktreePath,
    branchName,
    resourceClass,
    expectedMemoryBytes: profile.expectedMemoryMiB * 1024 ** 2,
    ownerProcessId: pid,
    ownerProcessIdentity: processIdentity,
    hostResource: {
      totalMemoryBytes,
      availableMemoryBytes,
      inferenceResident,
      ungovernedProcesses,
    },
  };
}

function gitValue(args) {
  return gitTextOrNull(args, { cwd: process.cwd() }) ?? "";
}

/**
 * The admission connection: DPF_MCP_URL (operator intent, persisted by setup)
 * or the local default, with the credential every gate script resolves
 * (scripts/lib/mcp-credential.mjs: client_credentials, then the legacy PAT).
 * Returns null when no credential is configured.
 *
 * It does not read a project .mcp.json (BI-5201141C): on https no writer
 * produces one -- Claude Code's dpf connector is the plugin's URL-only,
 * OAuth-authorized descriptor, which carries no token a script could reuse.
 */
export function readMcpConnection(env = process.env) {
  const mcpUrl = env.DPF_MCP_URL || DEFAULT_LOCAL_MCP_URL;
  try {
    return { mcpUrl, bearerToken: resolveMcpCredential({ mcpUrl, env }).bearer };
  } catch {
    return null;
  }
}

export function readProcessRows({ platform = process.platform, spawnSyncImpl = spawnSync } = {}) {
  let result;
  const unavailable = reason => {
    // Neither producer output nor JSON.parse's excerpt may leave this reader:
    // process command lines can contain credentials belonging to other work.
    const error = new Error(`Host process inventory unavailable (${reason}); no command was admitted. Retry the same governed command after inventory collection recovers.`);
    Object.assign(error, { code: "host_inventory_unavailable", reason,
      producerStatus: result?.status ?? null, producerSignal: result?.signal ?? null,
      stdoutBytes: Buffer.byteLength(String(result?.stdout ?? ""), "utf8") });
    throw error;
  };
  const command = [
    "$ErrorActionPreference = 'Stop';",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);",
    "$rows = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine);",
    "ConvertTo-Json -InputObject $rows -Compress -Depth 3",
  ].join(" ");
  try {
    result = spawnSyncImpl(platform === "win32" ? "powershell.exe" : "ps",
      platform === "win32" ? ["-NoProfile", "-NonInteractive", "-Command", command] : ["-eo", "pid=,ppid=,args="],
      { encoding: "utf8", windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 });
  } catch { unavailable("producer-failed"); }
  if (result?.error?.code === "ETIMEDOUT") unavailable("producer-timeout");
  if (result?.error?.code === "ENOBUFS") unavailable("producer-output-limit");
  if (result?.error || result?.status !== 0) unavailable("producer-failed");
  const text = String(result.stdout ?? "").replace(/^\uFEFF/, "").trim();
  if (!text) unavailable("empty-output");
  let rows;
  if (platform === "win32") {
    let parsed;
    try { parsed = JSON.parse(text); } catch { unavailable("malformed-output"); }
    rows = (Array.isArray(parsed) ? parsed : [parsed]).map(row => ({
      pid: row?.ProcessId, parentPid: row?.ParentProcessId, commandLine: row?.CommandLine ?? "",
    }));
  } else {
    rows = text.split(/\r?\n/).map(line => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) unavailable("invalid-rows");
      return { pid: Number(match[1]), parentPid: Number(match[2]), commandLine: match[3] };
    });
  }
  if (!rows.length || rows.some(row => !Number.isSafeInteger(row.pid) || row.pid < 0
    || !Number.isSafeInteger(row.parentPid) || row.parentPid < 0 || typeof row.commandLine !== "string")) unavailable("invalid-rows");
  return rows;
}

async function runCommand({ command, commandArgs }) {
  const child = spawn(command, commandArgs, {
    stdio: "inherit",
    windowsHide: true,
    shell: false,
  });
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
}

function createOwnedChild({ command, commandArgs }) {
  const child = spawn(command, commandArgs, {
    stdio: "inherit",
    windowsHide: true,
    shell: false,
    detached: process.platform !== "win32",
  });
  return {
    run: () => new Promise((resolveRun, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolveRun(signal ? 1 : code ?? 1));
    }),
    terminate: async () => {
      if (!child.pid || child.exitCode !== null) return;
      if (process.platform === "win32") {
        spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
      } else {
        try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
      }
    },
  };
}

async function main() {
  const parsed = parseHostResourceArgs(process.argv.slice(2));
  if (!parsed.resumePin && (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true")) {
    process.exitCode = await runCommand(parsed);
    return;
  }
  const cwd = process.cwd();
  const connection = readMcpConnection();
  if (!connection) throw new Error(`DPF MCP admission is unavailable. ${MCP_CREDENTIAL_HELP}`);

  const processRows = readProcessRows();
  const findings = findUngovernedHeavyProcesses(processRows, { governedPids: [process.pid] });
  const ownerProvider = process.env.DPF_GATE_OWNER_PROVIDER || "codex";
  const ownerSessionId = process.env.DPF_GATE_OWNER_SESSION_ID
    || process.env.CODEX_THREAD_ID
    || `host-${hostname()}`;
  const identify = () => readHostAttemptContext({
    resourceClass: parsed.resourceClass, command: parsed.command, commandArgs: parsed.commandArgs,
    expectedMemoryBytes: PROFILE_CONTRACT.profiles[parsed.resourceClass].expectedMemoryMiB * 1024 ** 2,
    ownerProvider, ownerSessionId, worktreePath: cwd.replaceAll("\\", "/"),
    branchName: gitValue(["branch", "--show-current"]), mcpUrl: connection.mcpUrl,
  });
  let attempt;
  let context;
  try { context = identify(); attempt = resolveHostAttempt(context, parsed.resumePin); } catch {
    process.stderr.write("host-resource-runner: source or invocation identity unavailable/changed; command unrun.\n");
    process.exitCode = 82;
    return;
  }
  const claimArgs = buildHostResourceClaim({
    ...parsed,
    ownerProvider,
    ownerSessionId,
    worktreePath: cwd.replaceAll("\\", "/"),
    branchName: context.branchName,
    attempt,
    pid: process.pid,
    processIdentity: readProcessIdentity(process.pid),
    now: new Date(),
    totalMemoryBytes: totalmem(),
    availableMemoryBytes: freemem(),
    inferenceResident: processRows.some((row) => classifyHeavyProcess(row.commandLine) === "inference"),
    ungovernedProcesses: findings.slice(0, 20),
  });
  const claim = await mcpCall("claim_nonprod_environment_lease", claimArgs, connection);
  const leaseId = claim?.entityId ?? claim?.data?.lease?.leaseId;
  if (claim?.success !== true || !leaseId) {
    if (claim?.error === "lease_terminal" || (parsed.resumePin && /^nonprod_resume_/.test(claim?.error ?? ""))) {
      process.stderr.write(JSON.stringify({ status: "unrun", reason: claim.error }) + "\n");
      process.exitCode = 81;
      return;
    }
    throw new Error(`host resource admission failed: ${claim?.error ?? "unknown"}`);
  }
  if (claim?.data?.admission?.status === "terminal") {
    process.stderr.write(JSON.stringify({ status: "unrun", reason: "terminal-lease", leaseId }) + "\n");
    process.exitCode = 81;
    return;
  }
  if (claim?.data?.admission?.status === "queued") {
    // BI-D35B85BF. This block used to assert that "the event/reconciler wakes
    // this exact claimant". It never did: applyNonprodCapacityEvent writes a
    // TaskRun projection that no process reads back. Spawn the resumer that
    // actually re-claims, and report who owns the resume rather than leaving
    // the reader to assume the platform does.
    const resume = spawnDurableWaitResumer({
      runnerPath: resolve(SCRIPT_DIR, "local-ci-durable-wait-resumer.mjs"),
      gateArgv: process.argv,
      cwd: process.cwd(),
      observerDirectory: process.env.DPF_LOCAL_QUEUE_OBSERVER_DIR
        || resolve(cwd, gitValue(["rev-parse", "--git-common-dir"]), "dpf-local-ci-queue-observers"),
      branch: context.branchName,
      sha: context.source.head,
      ownerSessionId,
      gateFlags: ["--resume-pin", hostResumePin(attempt, leaseId)],
      gateFlagsBeforeTerminator: true,
    });
    process.stderr.write(JSON.stringify({
      status: "queued",
      code: "host_resource_durable_wait",
      leaseId,
      resumePin: hostResumePin(attempt, leaseId),
      taskRunId: claim?.data?.admission?.taskRunId ?? null,
      resumeMode: claim?.data?.admission?.resumeMode ?? "durable-task",
      resumeOwner: resume.spawned ? "detached-resumer" : "caller",
      resumerPid: resume.via === "wmi-breakaway" ? null : resume.pid,
      launcherPid: resume.via === "wmi-breakaway" ? resume.pid : null,
      ...(resume.spawned ? {} : { resumeUnavailableReason: resume.reason }),
      resourceClass: parsed.resourceClass,
      reason: claim?.data?.poolPolicy?.rollbackReason ?? "capacity-full",
      ungovernedProcesses: findings,
    }) + "\n");
    process.exitCode = 75;
    return;
  }

  if (claim?.data?.admission?.status !== "admitted") throw new Error("host resource admission was not granted");
  try { resolveHostAttempt(identify(), hostResumePin(attempt, leaseId)); } catch {
    await mcpCall("release_nonprod_environment_lease", { leaseId }, connection);
    process.exitCode = 82;
    return;
  }
  const child = createOwnedChild(parsed);
  const expiresAt = claim?.data?.lease?.expiresAt;
  const result = await superviseLeaseRun({
    ttlMs: admittedLeaseTtlMs(expiresAt, 10 * 60_000),
    expiresAt,
    run: child.run,
    terminate: child.terminate,
    renew: () => mcpCall("renew_nonprod_environment_lease", {
      leaseId,
      ownerSessionId,
      ttlMinutes: 10,
    }, connection),
    release: () => mcpCall("release_nonprod_environment_lease", { leaseId }, connection),
  });
  if (result.status !== "completed") {
    process.stderr.write(`host-resource-runner: lease ${leaseId} ${result.status} (${result.reason}); the command was stopped.\n`);
  }
  process.exitCode = result.status === "completed" ? result.result : 1;
}

if (isEntryModule(import.meta.url)) {
  try { await main(); } catch (error) {
    if (error.code !== "host_inventory_unavailable") throw error;
    process.stderr.write(JSON.stringify({ status: "unrun", reason: error.code,
      commandExecuted: false, failure: { reason: error.reason, producerStatus: error.producerStatus,
        producerSignal: error.producerSignal, stdoutBytes: error.stdoutBytes },
      recovery: error.message }) + "\n");
    process.exitCode = 88;
  }
}
