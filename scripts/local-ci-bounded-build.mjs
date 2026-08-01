#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mcpCall } from "./lib/mcp-client.mjs";
import {
  buildxBuildArgs,
  buildxCreateArgs,
  classifyBoundedBuildExit,
  postgresContainerProbeArgs,
  validateBuilderInspection,
} from "./lib/local-ci-bounded-builder.mjs";
import {
  EXIT_CONTROL_PLANE_STARVATION,
  establishHealthyControlPlane,
  monitorControlPlane,
  terminateProcessTreeCommand,
} from "./lib/local-ci-control-plane-watchdog.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BUILDKIT_CONFIG = join(SCRIPT_DIR, "config", "local-ci-buildkitd.toml");

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

function usage() {
  return "Usage: node scripts/local-ci-bounded-build.mjs --tag IMAGE --slot-key SLOT --candidate BRANCH\n";
}

function numberFromEnv(name) {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function builderFromEnvironment() {
  const name = process.env.DPF_LOCAL_CI_BUILDER_NAME || "";
  const container = process.env.DPF_LOCAL_CI_BUILDER_CONTAINER || "";
  if (!name || !container) throw new Error("slot builder identity is missing");
  return {
    policyVersion: numberFromEnv("DPF_LOCAL_CI_BUILDER_POLICY_VERSION"),
    name,
    container,
    memoryBytes: numberFromEnv("DPF_LOCAL_CI_BUILDER_MEMORY_BYTES"),
    cpuQuota: numberFromEnv("DPF_LOCAL_CI_BUILDER_CPU_QUOTA"),
    cpuPeriod: numberFromEnv("DPF_LOCAL_CI_BUILDER_CPU_PERIOD"),
    maxParallelism: numberFromEnv("DPF_LOCAL_CI_BUILDER_MAX_PARALLELISM"),
  };
}

function runDocker(args, timeout = 20_000) {
  return spawnSync("docker", args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout,
  });
}

function inspectBuilder(builder) {
  const buildx = runDocker(["buildx", "inspect", builder.name], 15_000);
  if (buildx.status !== 0) return { status: "absent", detail: buildx.stderr || buildx.stdout };
  const host = runDocker([
    "inspect", builder.container, "--format", "{{json .HostConfig}}",
  ], 15_000);
  if (host.status !== 0) return { status: "invalid", detail: host.stderr || host.stdout };
  let hostConfig;
  try {
    hostConfig = JSON.parse(host.stdout);
  } catch {
    return { status: "invalid", detail: "builder HostConfig was not JSON" };
  }
  const inspection = {
    driver: /^Driver:\s+docker-container\s*$/m.test(buildx.stdout)
      ? "docker-container"
      : "unknown",
    container: builder.container,
    memoryBytes: Number(hostConfig.Memory),
    cpuQuota: Number(hostConfig.CpuQuota),
    cpuPeriod: Number(hostConfig.CpuPeriod),
  };
  return { status: "present", inspection };
}

function ensureBoundedBuilder(builder) {
  let observed = inspectBuilder(builder);
  if (observed.status === "absent") {
    const created = runDocker(buildxCreateArgs(builder, BUILDKIT_CONFIG), 120_000);
    if (created.status !== 0) {
      throw new Error(`bounded builder creation failed: ${(created.stderr || created.stdout).trim()}`);
    }
    observed = inspectBuilder(builder);
  }
  if (observed.status !== "present") {
    throw new Error(`bounded builder inspection failed: ${observed.detail || observed.status}`);
  }
  const validation = validateBuilderInspection(builder, observed.inspection);
  if (!validation.ok) {
    throw new Error(`bounded builder resource drift: ${validation.failures.join(",")}`);
  }
  return observed.inspection;
}

async function timedProbe(run, timeoutMs = 3_000) {
  const started = Date.now();
  let timer;
  try {
    const value = await Promise.race([
      run(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    return {
      healthy: value === true,
      elapsedMs: Date.now() - started,
      ...(value === true ? {} : { reason: "invalid-response" }),
    };
  } catch (error) {
    return {
      healthy: false,
      elapsedMs: Date.now() - started,
      reason: error instanceof Error && error.message === "timeout" ? "timeout" : "request-failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function commandHealthy(command, args, timeoutMs) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true, shell: false });
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, timeoutMs);
    child.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

async function probePostgres(databaseUrl) {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2_500 });
  try {
    await client.connect();
    const result = await client.query("SELECT 1 AS healthy");
    return result.rows[0]?.healthy === 1;
  } finally {
    await client.end().catch(() => {});
  }
}

function resolveControlPlanePostgresProbe() {
  if (process.env.DPF_CONTROL_PLANE_DATABASE_URL) {
    const databaseUrl = process.env.DPF_CONTROL_PLANE_DATABASE_URL;
    return () => probePostgres(databaseUrl);
  }
  const container = process.env.DPF_CONTROL_PLANE_POSTGRES_CONTAINER
    || "dpf-postgres-1";
  const inspected = runDocker([
    "inspect",
    container,
    "--format",
    "{{range .Config.Env}}{{println .}}{{end}}",
  ], 5_000);
  if (inspected.status !== 0) {
    throw new Error("live PostgreSQL container environment is unavailable");
  }
  const args = postgresContainerProbeArgs({
    container,
    environment: inspected.stdout,
  });
  return () => commandHealthy("docker", args, 2_500);
}

async function probeControlPlane(postgresProbe) {
  const portalUrl = process.env.DPF_CONTROL_PLANE_PORTAL_URL || "http://127.0.0.1:3000";
  const mcpUrl = process.env.DPF_MCP_URL || `${portalUrl}/api/mcp/v1`;
  const bearerToken = process.env.DPF_MCP_BEARER_TOKEN || "";
  const [portal, mcp, docker, postgres] = await Promise.all([
    timedProbe(async () => {
      const response = await fetch(`${portalUrl}/api/health`, { signal: AbortSignal.timeout(2_500) });
      if (response.status !== 200) return false;
      const payload = await response.json();
      return ["ok", "healthy"].includes(String(payload?.status).toLowerCase());
    }),
    timedProbe(async () => {
      if (!bearerToken) return false;
      const response = await mcpCall("get_quiescence_status", {}, {
        mcpUrl,
        bearerToken,
        timeoutMs: 2_500,
      });
      return response?.success === true;
    }),
    timedProbe(() => commandHealthy("docker", ["info"], 2_500)),
    timedProbe(postgresProbe),
  ]);
  return { portal, mcp, docker, postgres };
}

function resolveGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8", shell: false });
  return result.status === 0 ? result.stdout.trim() : null;
}

function writeEvidence(path, payload) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

async function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write(usage());
    return 0;
  }
  const tag = valueAfter("--tag");
  const slotKey = valueAfter("--slot-key") || process.env.DPF_LOCAL_CI_SLOT_KEY || "slot-0";
  const candidate = valueAfter("--candidate");
  if (!tag || !candidate) {
    process.stderr.write(usage());
    return 2;
  }

  const builder = builderFromEnvironment();
  const evidencePath = process.env.DPF_LOCAL_CI_CONTROL_PLANE_EVIDENCE_FILE || "";
  const startedAt = new Date().toISOString();
  const identity = {
    candidate,
    candidateSha: resolveGit(["rev-parse", "--verify", candidate]),
    integrationCommitSha: resolveGit(["rev-parse", "--verify", "HEAD"]),
    integrationTreeSha: resolveGit(["rev-parse", "--verify", "HEAD^{tree}"]),
    slotKey,
    imageTag: tag,
  };
  const policy = {
    version: builder.policyVersion,
    builderName: builder.name,
    memoryBytes: builder.memoryBytes,
    cpuQuota: builder.cpuQuota,
    cpuPeriod: builder.cpuPeriod,
    maxParallelism: builder.maxParallelism,
  };

  let controlPlanePostgresProbe;
  try {
    controlPlanePostgresProbe = resolveControlPlanePostgresProbe();
  } catch (error) {
    const payload = {
      schemaVersion: 1,
      status: "blocked_control_plane_starvation",
      phase: "control-plane-credential-resolution",
      startedAt,
      completedAt: new Date().toISOString(),
      identity,
      policy,
      failures: [error instanceof Error ? error.message : String(error)],
      samples: [],
    };
    writeEvidence(evidencePath, payload);
    process.stderr.write(`[local-ci-bounded-build] ${payload.status} ${payload.failures[0]}\n`);
    return EXIT_CONTROL_PLANE_STARVATION;
  }

  const preflight = await establishHealthyControlPlane({
    sample: () => probeControlPlane(controlPlanePostgresProbe),
  });
  if (preflight.status !== "healthy") {
    const payload = {
      schemaVersion: 1,
      status: preflight.status,
      phase: "control-plane-preflight",
      startedAt,
      completedAt: new Date().toISOString(),
      identity,
      policy,
      failures: preflight.failures,
      samples: preflight.samples,
    };
    writeEvidence(evidencePath, payload);
    process.stderr.write(`[local-ci-bounded-build] ${payload.status} ${payload.failures.join(",")}\n`);
    return EXIT_CONTROL_PLANE_STARVATION;
  }

  try {
    ensureBoundedBuilder(builder);
  } catch (error) {
    const payload = {
      schemaVersion: 1,
      status: "blocked_control_plane_starvation",
      phase: "builder-preflight",
      startedAt,
      completedAt: new Date().toISOString(),
      identity,
      policy,
      failures: [error instanceof Error ? error.message : String(error)],
      samples: preflight.samples,
    };
    writeEvidence(evidencePath, payload);
    process.stderr.write(`[local-ci-bounded-build] ${payload.status} ${payload.failures[0]}\n`);
    return EXIT_CONTROL_PLANE_STARVATION;
  }

  const args = buildxBuildArgs({ builder, tag, context: "." });
  const child = spawn("docker", args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: false,
    detached: process.platform !== "win32",
  });
  let childComplete = false;
  let childExit = null;
  let buildOutput = "";
  const capture = (stream, destination) => {
    stream.on("data", (chunk) => {
      destination.write(chunk);
      buildOutput = `${buildOutput}${chunk}`.slice(-32_000);
    });
  };
  capture(child.stdout, process.stdout);
  capture(child.stderr, process.stderr);
  const closed = new Promise((resolve) => {
    child.once("error", () => {
      childComplete = true;
      childExit = 1;
      resolve();
    });
    child.once("close", (code) => {
      childComplete = true;
      childExit = code ?? 1;
      resolve();
    });
  });
  const watchdog = await monitorControlPlane({
    sample: () => probeControlPlane(controlPlanePostgresProbe),
    isComplete: () => childComplete,
  });
  let termination = null;
  if (watchdog.status === "blocked_control_plane_starvation" && !childComplete) {
    const command = terminateProcessTreeCommand(child.pid);
    const stopped = spawnSync(command.command, command.args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    });
    termination = { status: stopped.status, signal: stopped.signal || null };
  }
  await closed;
  const buildOutcome = classifyBoundedBuildExit({
    exitCode: childExit,
    output: buildOutput,
  });
  const finalStatus = watchdog.status === "blocked_control_plane_starvation"
    ? watchdog.status
    : buildOutcome.status;
  const failures = watchdog.status === "blocked_control_plane_starvation"
    ? watchdog.failures
    : buildOutcome.failures;
  const payload = {
    schemaVersion: 1,
    status: finalStatus,
    phase: "production-build",
    startedAt,
    completedAt: new Date().toISOString(),
    identity,
    policy,
    failures,
    samples: [...preflight.samples, ...watchdog.samples],
    buildExitCode: childExit,
    termination,
  };
  writeEvidence(evidencePath, payload);
  if (finalStatus === "blocked_control_plane_starvation") {
    process.stderr.write(`[local-ci-bounded-build] ${finalStatus} ${failures.join(",")}\n`);
    return EXIT_CONTROL_PLANE_STARVATION;
  }
  return buildOutcome.exitCode;
}

process.exitCode = await main();
