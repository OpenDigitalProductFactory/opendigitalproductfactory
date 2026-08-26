#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { hostname, freemem, totalmem } from "node:os";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { isEntryModule } from "./lib/entry-module.mjs";
import { isAllowedMcpEndpoint, mcpCall } from "./lib/mcp-client.mjs";
import { superviseLeaseRun } from "./lib/lease-supervisor.mjs";
import { readProcessIdentity } from "./lib/local-sandbox-fence.mjs";

const PROFILE_CONTRACT = JSON.parse(readFileSync(
  new URL("../apps/web/lib/nonprod/host-resource-profiles.json", import.meta.url),
  "utf8",
));

const DEFAULT_LOCAL_MCP_URL = "http://127.0.0.1:3000/api/mcp/v1";

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
  const args = [...argv];
  let resourceClass = "";
  while (args.length > 0 && args[0] !== "--") {
    const flag = args.shift();
    if (flag === "--class") resourceClass = args.shift() ?? "";
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (!resourceClass) throw new Error("--class is required");
  if (!HEAVY_PROCESS_CLASSES.includes(resourceClass)) {
    throw new Error(`unsupported resource class: ${resourceClass}`);
  }
  if (args.shift() !== "--" || args.length === 0) {
    throw new Error("a command is required after --");
  }
  return {
    resourceClass,
    command: args.shift(),
    commandArgs: args,
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
}) {
  const profile = PROFILE_CONTRACT.profiles[resourceClass];
  if (!profile) throw new Error(`unsupported resource class: ${resourceClass}`);
  return {
    environmentKey: "host-heavy-resource",
    ownerProvider,
    ownerSessionId,
    claimKey: `host-resource:${ownerSessionId}:${pid}`,
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
  const result = spawnSync("git", args, { encoding: "utf8", windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : "";
}

export function readMcpConnection(cwd) {
  const envToken = process.env.DPF_MCP_BEARER_TOKEN;
  if (envToken) {
    // Explicit operator input: the endpoint is whatever the operator named.
    return {
      mcpUrl: process.env.DPF_MCP_URL || DEFAULT_LOCAL_MCP_URL,
      bearerToken: envToken,
    };
  }
  return readMcpConnectionFile(resolve(cwd, ".mcp.json"));
}

// `.mcp.json` is ambient state, not operator intent -- it is copied between
// worktrees by scripts/sync-mcp-worktrees.ps1 and is writable by anything with
// the checkout. The token it carries is a live DPF credential, so the endpoint
// it names is checked against the loopback contract before the token is put on
// the wire; a non-loopback endpoint is a stop (AGENTS.md section 1), not a
// silent fall-through to the default.
function readMcpConnectionFile(configPath) {
  const config = parseJsonFile(configPath);
  const server = config?.mcpServers?.dpf;
  const authorization = server?.headers?.Authorization ?? server?.headers?.authorization;
  const bearerToken = typeof authorization === "string"
    ? authorization.replace(/^Bearer\s+/i, "")
    : "";
  const mcpUrl = typeof server?.url === "string" ? server.url : "";
  if (!mcpUrl || !bearerToken) return null;
  if (!isAllowedMcpEndpoint(mcpUrl)) {
    throw new Error(
      `${configPath} points the dpf MCP server at ${mcpUrl}, which is not a local endpoint; `
      + "refusing to send the bearer token off-box. Set DPF_MCP_BEARER_TOKEN (and DPF_MCP_URL) "
      + "to reach a non-loopback endpoint deliberately.",
    );
  }
  return { mcpUrl, bearerToken };
}

function parseJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // Absent or malformed: the actionable fail-closed error is emitted by the caller.
    return null;
  }
}

function readProcessRows() {
  if (process.platform === "win32") {
    const command = [
      "Get-CimInstance Win32_Process |",
      "Select-Object ProcessId,ParentProcessId,CommandLine |",
      "ConvertTo-Json -Compress",
    ].join(" ");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status !== 0 || !result.stdout.trim()) return [];
    const parsed = JSON.parse(result.stdout);
    return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({
      pid: row.ProcessId,
      parentPid: row.ParentProcessId,
      commandLine: row.CommandLine ?? "",
    }));
  }
  const result = spawnSync("ps", ["-eo", "pid=,ppid=,args="], {
    encoding: "utf8",
  });
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    return match ? [{ pid: Number(match[1]), parentPid: Number(match[2]), commandLine: match[3] }] : [];
  });
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
  if (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true") {
    process.exitCode = await runCommand(parsed);
    return;
  }
  const cwd = process.cwd();
  const connection = readMcpConnection(cwd);
  if (!connection) throw new Error("DPF MCP admission is unavailable; seed .mcp.json or set DPF_MCP_BEARER_TOKEN");

  const processRows = readProcessRows();
  const findings = findUngovernedHeavyProcesses(processRows, { governedPids: [process.pid] });
  const ownerProvider = process.env.DPF_GATE_OWNER_PROVIDER || "codex";
  const ownerSessionId = process.env.DPF_GATE_OWNER_SESSION_ID
    || process.env.CODEX_THREAD_ID
    || `host-${hostname()}`;
  const claimArgs = buildHostResourceClaim({
    ...parsed,
    ownerProvider,
    ownerSessionId,
    worktreePath: cwd.replaceAll("\\", "/"),
    branchName: gitValue(["branch", "--show-current"]),
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
    throw new Error(`host resource admission failed: ${claim?.error ?? "unknown"}`);
  }
  if (claim?.data?.admission?.status === "queued") {
    // Bounded wait: no Node process remains resident behind a scarce gate. The
    // durable-wait slice will turn this typed retry into an event-driven wake.
    await mcpCall("release_nonprod_environment_lease", { leaseId }, connection);
    process.stderr.write(JSON.stringify({
      status: "queued",
      code: "host_resource_queued",
      resourceClass: parsed.resourceClass,
      reason: claim?.data?.poolPolicy?.rollbackReason ?? "capacity-full",
      retryAfterSeconds: 30,
      ungovernedProcesses: findings,
    }) + "\n");
    process.exitCode = 75;
    return;
  }

  const child = createOwnedChild(parsed);
  const result = await superviseLeaseRun({
    ttlMs: 10 * 60_000,
    expiresAt: claim?.data?.lease?.expiresAt,
    run: child.run,
    terminate: child.terminate,
    renew: () => mcpCall("renew_nonprod_environment_lease", {
      leaseId,
      ownerSessionId,
      ttlMinutes: 10,
    }, connection),
    release: () => mcpCall("release_nonprod_environment_lease", { leaseId }, connection),
  });
  process.exitCode = result.status === "completed" ? result.result : 1;
}

if (isEntryModule(import.meta.url)) {
  await main();
}
