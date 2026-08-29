#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { mcpCall } from "./lib/mcp-client.mjs";
import {
  buildxBuildArgs,
  buildxCreateArgs,
  classifyBoundedBuildExit,
  postgresContainerProbeArgs,
  validateBuilderInspection,
} from "./lib/local-ci-bounded-builder.mjs";
import {
  buildxRmArgs,
  buildxStopArgs,
  decidePostBuildCoolDown,
  isBuilderCoolDownEnabled,
  isManagedBuilderName,
  parseManagedBuilderName,
} from "./lib/local-ci-builder-lifecycle.mjs";
import {
  EXIT_CONTROL_PLANE_STARVATION,
  establishHealthyControlPlane,
  monitorControlPlane,
  terminateProcessTreeCommand,
} from "./lib/local-ci-control-plane-watchdog.mjs";
import { reapSupersededSlotImages } from "./lib/local-integration-image-retention.mjs";
import {
  canonicalStageReceiptStatus,
  classifyPriorStage,
  createStageReceiptWriter,
  markStageReceiptReused,
  readStageReceipt,
  reusablePassedStage,
} from "./lib/local-ci-stage-receipt.mjs";

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

// Repository-only listing: `docker images` prints one repository per line, and
// these build tags carry the implicit `:latest`, so the repository name IS the
// tag the build produced.
function listLocalImageTags() {
  const listed = runDocker(["images", "--format", "{{.Repository}}"], 30_000);
  if (listed.status !== 0) {
    throw new Error(listed.stderr?.trim() || "docker images failed");
  }
  return (listed.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function removeLocalImage(tag) {
  const removed = runDocker(["rmi", tag], 60_000);
  if (removed.status !== 0) {
    throw new Error(removed.stderr?.trim() || `docker rmi ${tag} failed`);
  }
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

/**
 * List managed local-CI builder names from `docker buildx ls`.
 * Best-effort: a listing failure returns [] so ensure can still create.
 */
function listManagedBuilderNames() {
  const listed = runDocker(["buildx", "ls", "--format", "{{.Name}}"], 15_000);
  if (listed.status !== 0) return [];
  return (listed.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((name) => isManagedBuilderName(name));
}

/**
 * Remove builders from older/newer policy generations so only the current
 * `builderPolicy.version` remains (BI-C85D1B0A). Never throws — a stuck rm
 * must not block a green path that can still use the current builder.
 */
function reapObsoletePolicyBuilders(builder, log = () => {}) {
  const current = parseManagedBuilderName(builder.name);
  if (!current) return;
  for (const name of listManagedBuilderNames()) {
    const parsed = parseManagedBuilderName(name);
    if (!parsed || parsed.policyVersion === current.policyVersion) continue;
    const removed = runDocker(buildxRmArgs(name), 120_000);
    if (removed.status === 0) {
      log(`reaped obsolete builder ${name} (current policy v${current.policyVersion})`);
    } else {
      log(
        `failed to reap obsolete builder ${name}: ${(removed.stderr || removed.stdout || "").trim()}`,
      );
    }
  }
}

/**
 * Session cool-down: stop the BuildKit daemon after the build so multi-GiB
 * idle RSS is not held forever. Disk cache stays (buildx stop, not rm).
 */
function coolDownBuilder(builder, log = () => {}) {
  const decision = decidePostBuildCoolDown(builder, {
    coolDownEnabled: isBuilderCoolDownEnabled(process.env),
  });
  if (decision.action !== "STOP") {
    log(`cool-down skipped: ${decision.reason}`);
    return;
  }
  const stopped = runDocker(buildxStopArgs(builder.name), 60_000);
  if (stopped.status === 0) {
    log(`stopped builder ${builder.name} (session cool-down; cache retained)`);
  } else {
    log(
      `cool-down stop failed for ${builder.name}: ${(stopped.stderr || stopped.stdout || "").trim()}`,
    );
  }
}

function ensureBoundedBuilder(builder, log = () => {}) {
  reapObsoletePolicyBuilders(builder, log);
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

// BI-24D5D7C2 — how long a control-plane probe may take before the build is
// abandoned. The MCP surface is a full tool dispatch (auth, tool registry, DB),
// not a static health handler, and it slows down under exactly the load this
// watchdog runs during: a Docker image build. At 2.5s a 13-minute build was
// aborted while portal answered in 19ms and docker and postgres were healthy.
const CONTROL_PLANE_PROBE_TIMEOUT_MS = (() => {
  const raw = Number(process.env.DPF_GATE_CONTROL_PLANE_PROBE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 15_000;
})();

/** True when a rejection is a deadline, whoever phrased it. */
export function isTimeoutRejection(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  // mcpCall throws "mcpCall: <tool> timed out after <n>ms"; AbortSignal.timeout
  // throws a TimeoutError; the local race throws the bare word.
  return /timed out|timeout/i.test(message)
    || (error instanceof Error && error.name === "TimeoutError");
}

async function timedProbe(run, timeoutMs = CONTROL_PLANE_PROBE_TIMEOUT_MS) {
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
      // BI-24D5D7C2: only a rejection whose message is EXACTLY "timeout" counted,
      // so an inner mcpCall deadline was reported as "request-failed" — the
      // operator reads that as a broken endpoint and goes looking for a
      // connection fault that never happened. A deadline is a deadline.
      reason: isTimeoutRejection(error) ? "timeout" : "request-failed",
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
      const response = await fetch(`${portalUrl}/api/health`, { signal: AbortSignal.timeout(CONTROL_PLANE_PROBE_TIMEOUT_MS) });
      if (response.status !== 200) return false;
      const payload = await response.json();
      return ["ok", "healthy"].includes(String(payload?.status).toLowerCase());
    }),
    timedProbe(async () => {
      if (!bearerToken) return false;
      const response = await mcpCall("get_quiescence_status", {}, {
        mcpUrl,
        bearerToken,
        timeoutMs: CONTROL_PLANE_PROBE_TIMEOUT_MS,
      });
      return response?.success === true;
    }),
    timedProbe(() => commandHealthy("docker", ["info"], CONTROL_PLANE_PROBE_TIMEOUT_MS)),
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

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function localImageId(tag) {
  const inspected = runDocker(["image", "inspect", tag, "--format", "{{.Id}}"], 15_000);
  return inspected.status === 0 ? inspected.stdout.trim() : null;
}

export function canReuseBuildReceipt({ receipt, identity, resolveImageId }) {
  const exactPassedReceipt = reusablePassedStage({
    receipt,
    stage: "production-build",
    identity,
  });
  if (!exactPassedReceipt || !receipt.artifact?.imageId) return false;
  return resolveImageId() === receipt.artifact.imageId;
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
  const metadataPath = process.env.DPF_LOCAL_CI_METADATA_FILE || "";
  const stageReceiptPath = process.env.DPF_LOCAL_CI_BUILD_RECEIPT_FILE
    || (metadataPath ? `${metadataPath}.build.json` : "");
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
  const stageIdentity = {
    candidateSha: identity.candidateSha,
    integrationTreeSha: identity.integrationTreeSha,
    imageTag: identity.imageTag,
    command: JSON.stringify(buildxBuildArgs({ builder, tag, context: "." })),
  };
  const priorReceipt = readStageReceipt(stageReceiptPath);
  if (canReuseBuildReceipt({
    receipt: priorReceipt,
    identity: stageIdentity,
    resolveImageId: () => localImageId(tag),
  })) {
    const payload = markStageReceiptReused({
      path: stageReceiptPath,
      receipt: priorReceipt,
    });
    writeEvidence(evidencePath, payload);
    process.stdout.write(
      `[local-ci-bounded-build] reusing exact-tree passed receipt ${stageReceiptPath}\n`,
    );
    return 0;
  }
  const priorDisposition = classifyPriorStage({
    receipt: priorReceipt,
    isProcessAlive: processAlive,
  });
  const stageReceipt = createStageReceiptWriter({
    path: stageReceiptPath,
    stage: "production-build",
    identity: stageIdentity,
  });
  stageReceipt.start({
    bi: "BI-872CB1BF",
    identity: stageIdentity,
    policy,
    recoveredFrom: priorDisposition === "externally-terminated"
      ? {
          hostPid: priorReceipt.hostPid ?? null,
          childPid: priorReceipt.childPid ?? null,
          lastHeartbeatAt: priorReceipt.lastHeartbeatAt ?? null,
        }
      : null,
  });

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
    stageReceipt.complete(payload.status, payload);
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
    stageReceipt.complete(payload.status, payload);
    process.stderr.write(`[local-ci-bounded-build] ${payload.status} ${payload.failures.join(",")}\n`);
    return EXIT_CONTROL_PLANE_STARVATION;
  }

  const lifecycleLog = (message) => {
    process.stdout.write(`[local-ci-bounded-build] lifecycle: ${message}\n`);
  };

  try {
    ensureBoundedBuilder(builder, lifecycleLog);
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
    stageReceipt.complete(payload.status, payload);
    process.stderr.write(`[local-ci-bounded-build] ${payload.status} ${payload.failures[0]}\n`);
    return EXIT_CONTROL_PLANE_STARVATION;
  }

  let exitCode = 1;
  try {
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
      onSample: (sample) => stageReceipt.heartbeat({
        phase: "production-build",
        childPid: child.pid ?? null,
        controlPlane: sample,
        outputTail: buildOutput.slice(-4_000),
      }),
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
      artifact: finalStatus === "healthy"
        ? { imageTag: tag, imageId: localImageId(tag) }
        : null,
    };
    writeEvidence(evidencePath, payload);
    const receiptStatus = canonicalStageReceiptStatus(finalStatus);
    stageReceipt.complete(receiptStatus, payload);
    if (finalStatus === "blocked_control_plane_starvation") {
      process.stderr.write(`[local-ci-bounded-build] ${finalStatus} ${failures.join(",")}\n`);
      exitCode = EXIT_CONTROL_PLANE_STARVATION;
    } else {
      // Retention runs ONLY on a green build, so the slot always keeps a working
      // image: the one just produced supersedes the slot's older images. Gating on
      // success is what makes this safe — reaping after a failure would delete the
      // last image that actually worked. Best-effort by construction; it must never
      // turn a passing build red.
      if (finalStatus === "healthy") {
        reapSupersededSlotImages({
          slotKey,
          keepTag: tag,
          listImages: listLocalImageTags,
          removeImage: removeLocalImage,
          log: (message) => process.stdout.write(`[local-ci-bounded-build] retention: ${message}\n`),
        });
      }
      exitCode = buildOutcome.exitCode;
    }
  } finally {
    // BI-C85D1B0A: always cool down the session builder so multi-GiB BuildKit
    // RSS is not held after pregate/self-upgrade builds (cache retained).
    coolDownBuilder(builder, lifecycleLog);
  }
  return exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
