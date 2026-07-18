#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { platform, arch, homedir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { atomicWriteFile } from "./measure-platform-substrate.mjs";
import { stableSerialize } from "./lib/platform-substrate-measurements.mjs";
import { resolveCapabilityServiceProjection } from "./lib/capability-service-projection.mjs";

const scriptRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REQUIRED_ENVIRONMENT = "local-integration-ci";
const RUNTIME_METRIC_DIRECTIONS = Object.freeze({
  requiredRunningServices: "non-increasing",
  totalIdleContainerRssBytes: "non-increasing",
  portalIdleRssBytes: "non-increasing",
  unhealthyRequiredServices: "non-increasing",
  optionalInactiveServices: "informational",
  optionalDegradedServices: "informational",
  servedIdentity: "informational",
});
const RUNTIME_RSS_TOLERANCE_PERCENT = 5;
const RUNTIME_RSS_METRICS = new Set(["totalIdleContainerRssBytes", "portalIdleRssBytes"]);
const RUNTIME_COMMANDS = Object.freeze(["docker compose ps --format json --all", "docker stats --no-stream --format {{json .}}", "GET /api/health", "GET /api/platform/version"]);

function parseJsonRecords(text, label) {
  if (typeof text !== "string" || !text.trim()) throw new Error(`${label} returned empty output`);
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    try { return text.trim().split(/\r?\n/).map((line) => JSON.parse(line)); }
    catch (error) { throw new Error(`${label} returned malformed JSON: ${error.message}`); }
  }
}
function parseLiveCapabilityRows(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("Live PlatformCapability runtime query returned no rows");
  return text.trim().split(/\r?\n/).map((line) => { const [capabilityId, state, extra] = line.split("\t"); if (!capabilityId || !state || extra !== undefined) throw new Error("Live PlatformCapability runtime query returned malformed rows"); return { capabilityId, state }; });
}

function bytes(value) {
  const match = String(value ?? "").split("/")[0].trim().match(/^(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB)$/i);
  if (!match) throw new Error(`docker stats returned unsupported memory value: ${value}`);
  const powers = { b: 0, kib: 10, mib: 20, gib: 30, tib: 40 };
  return Math.round(Number(match[1]) * 2 ** powers[match[2].toLowerCase()]);
}

function defaultExecute(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${(result.stderr || "unknown error").trim()}`);
  return result.stdout;
}

async function defaultFetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  try { return await response.json(); }
  catch (error) { throw new Error(`${url} returned invalid JSON: ${error.message}`); }
}

function requireLease(lease) {
  if (!lease?.id || lease.environmentKey !== REQUIRED_ENVIRONMENT) {
    throw new Error(`Runtime measurement requires an active ${REQUIRED_ENVIRONMENT} lease with an identifiable lease id`);
  }
}

function unwrapMcpToolResult(payload) {
  const structured = payload?.result?.structuredContent;
  if (structured) return structured;
  const text = payload?.result?.content?.find?.((entry) => entry?.type === "text" && typeof entry.text === "string")?.text;
  if (text) {
    try { return JSON.parse(text); } catch { throw new Error("Lease coordination plane returned malformed tool content"); }
  }
  throw new Error("Lease coordination plane returned no verifiable result");
}

async function defaultVerifyLease(request, options) {
  const token = options.mcpToken ?? process.env.DPF_MCP_BEARER_TOKEN;
  if (!token) throw new Error("Governed lease verification requires DPF_MCP_BEARER_TOKEN");
  const portalUrl = String(options.portalUrl ?? "").replace(/\/$/, "");
  const mcpUrl = options.mcpUrl ?? process.env.DPF_MCP_URL ?? `${portalUrl}/api/mcp/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(mcpUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_nonprod_environment_leases", arguments: {} } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Lease coordination plane returned HTTP ${response.status}`);
  const result = unwrapMcpToolResult(await response.json());
  const leases = result?.leases ?? result?.data?.leases;
  if (!Array.isArray(leases)) throw new Error("Lease coordination plane returned no verifiable lease inventory");
  return leases.find((lease) => lease.leaseId === request.id) ?? null;
}

async function verifyActiveLease(request, options) {
  requireLease(request);
  if (!request.ownerSessionId) throw new Error("Governed lease holder identity is required");
  const record = await (options.verifyLease ?? defaultVerifyLease)(request, options);
  if (!record) throw new Error(`Nonexistent governed lease: ${request.id}`);
  if (record.environmentKey !== request.environmentKey) throw new Error(`Governed lease environment mismatch for ${request.id}`);
  if (record.ownerSessionId !== request.ownerSessionId) throw new Error(`Governed lease holder mismatch for ${request.id}`);
  const expiry = new Date(record.expiresAt).getTime();
  if (record.status !== "active" || !Number.isFinite(expiry) || expiry <= Date.now()) throw new Error(`Expired or inactive governed lease: ${request.id}`);
  return record;
}

export function normalizeHostPlatform(value) {
  return ({ win32: "windows", darwin: "macos", linux: "linux", windows: "windows", macos: "macos" })[String(value).toLowerCase()] ?? String(value).toLowerCase();
}

function state(record) { return String(record.State ?? record.state ?? "").toLowerCase(); }
function health(record) { return String(record.Health ?? record.health ?? "").toLowerCase(); }
function service(record) { return record.Service ?? record.service; }
function name(record) { return record.Name ?? record.name ?? record.Container ?? record.container; }
function isRunning(record) { return state(record) === "running"; }
function isDegraded(record) { return !isRunning(record) || ["unhealthy", "starting"].includes(health(record)); }
function isUnhealthy(record) { return ["unhealthy", "starting"].includes(health(record)); }

export function resolveDpfStateDir(env = process.env, hostPlatform = platform(), home = homedir()) {
  if (env.DPF_STATE_DIR) return env.DPF_STATE_DIR;
  if (hostPlatform === "win32") return join(env.USERPROFILE || home, ".dpf");
  return env.XDG_STATE_HOME ? join(env.XDG_STATE_HOME, "dpf") : join(env.HOME || home, ".dpf");
}

export function buildOperationalStateFromAuthorities(catalog, installSnapshot, composeRecords, liveCapabilityStates) {
  if (!catalog || !Array.isArray(catalog.capabilities) || !/^[a-f0-9]{64}$/.test(catalog.catalogHash ?? "")) throw new Error("Generated capability catalog identity is invalid");
  if (!Array.isArray(installSnapshot?.enabledRuntimeCapabilities) || installSnapshot.capabilityCatalogHash !== catalog.catalogHash || !/^[a-f0-9]{64}$/.test(installSnapshot.capabilityStateVersion ?? "")) throw new Error("Install capability identity is missing or stale");
  if (!Array.isArray(liveCapabilityStates)) throw new Error("Live PlatformCapability runtime state is missing");
  const live = new Map();
  for (const row of liveCapabilityStates) { if (!catalog.capabilities.some((entry) => entry.capabilityId === row.capabilityId) || !["active", "disabled"].includes(row.state) || live.has(row.capabilityId)) throw new Error(`Invalid live runtime capability: ${row.capabilityId}`); live.set(row.capabilityId, row.state); }
  if (live.size !== catalog.capabilities.length) throw new Error("Live PlatformCapability runtime state is incomplete");
  const capabilities = catalog.capabilities.map((entry) => ({ capabilityId: entry.capabilityId, state: live.get(entry.capabilityId), manifest: { runtime: { dependencies: entry.dependencies, activation: { policy: entry.activationPolicy }, workGuards: entry.workGuards } } }));
  const substrate = { version: catalog.substrateManifestVersion, services: catalog.capabilities.flatMap((entry) => entry.services), externalRuntimes: catalog.capabilities.flatMap((entry) => entry.externalRuntimes) };
  const projection = resolveCapabilityServiceProjection({ substrate, capabilities, enabledRuntimeCapabilities: installSnapshot.enabledRuntimeCapabilities });
  if (projection.catalogHash !== catalog.catalogHash || projection.capabilityStateVersion !== installSnapshot.capabilityStateVersion) throw new Error("Install capability state identity is stale");
  const observed = new Map(composeRecords.map((record) => [service(record), record]));
  const serviceStates = Object.fromEntries(projection.inactiveOptionalServices.map((name) => [name, "optional_inactive"]));
  for (const requirement of projection.serviceRequirements) serviceStates[requirement.service] = requirement.capability === "runtime:core" ? "required" : (!observed.has(requirement.service) || isDegraded(observed.get(requirement.service)) ? "optional_degraded" : "required");
  return { catalogVersion: projection.catalogVersion, catalogHash: projection.catalogHash, capabilityStateVersion: projection.capabilityStateVersion, enabledRuntimeCapabilities: projection.enabledRuntimeCapabilities, serviceRequirements: projection.serviceRequirements, observedServices: {}, backupServices: projection.backupServices, externalRuntimes: projection.externalRuntimes, providerState: {}, serviceStates };
}

export async function collectRuntimeMeasurements(options) {
  requireLease(options.lease);
  if (!Array.isArray(options.manifest?.services) || !Number.isInteger(options.manifest.version)) throw new Error("Runtime measurement requires a valid capability/service manifest");
  const manifestNames = options.manifest.services.map((item) => item.service);
  if (manifestNames.some((item) => typeof item !== "string") || new Set(manifestNames).size !== manifestNames.length) throw new Error("Runtime capability/service projection is malformed or duplicated");
  const execute = options.execute ?? defaultExecute;
  const fetchJson = options.fetchJson ?? defaultFetchJson;
  const ps = parseJsonRecords(await execute("docker", ["compose", "ps", "--format", "json", "--all"]), "docker compose ps");
  for (const record of ps) if (!service(record) || !name(record) || !state(record)) throw new Error("docker compose ps returned a partial service record");
  const stats = parseJsonRecords(await execute("docker", ["stats", "--no-stream", "--format", "{{json .}}"]), "docker stats");
  const statsByName = new Map(stats.map((record) => [name(record), record]));
  for (const record of ps.filter(isRunning)) {
    if (!statsByName.has(name(record))) throw new Error(`docker stats is missing stats for running service ${service(record)}`);
  }
  const portalUrl = String(options.portalUrl ?? "").replace(/\/$/, "");
  if (!portalUrl) throw new Error("Portal URL is required to identify the served runtime");
  const healthResponse = await fetchJson(`${portalUrl}/api/health`);
  if (!healthResponse || !["ok", "healthy"].includes(String(healthResponse.status).toLowerCase())) throw new Error("Portal health response is not healthy or identifiable");
  const identity = await fetchJson(`${portalUrl}/api/platform/version`);
  if (!identity?.gitSha) throw new Error("Served runtime identity is missing gitSha");

  const manifestByService = new Map(options.manifest.services.map((item) => [item.service, item]));
  for (const record of ps) if (!manifestByService.has(service(record))) throw new Error(`Running projection contains service absent from manifest: ${service(record)}`);
  const byService = new Map(ps.map((record) => [service(record), record]));
  const hostPlatform = normalizeHostPlatform(String(options.hostProfile ?? platform()).split("-")[0]);
  const eligible = options.manifest.services.filter((item) => !Array.isArray(item.hostPlatforms) || item.hostPlatforms.includes(hostPlatform));
  const operationalState = options.operationalState ?? options.manifest.operationalState ?? buildOperationalStateFromAuthorities(options.catalog, options.installSnapshot, ps, options.liveCapabilityStates);
  if (!operationalState?.serviceStates || typeof operationalState.serviceStates !== "object") throw new Error("Serialized OperationalCapabilityState is required for runtime diagnostics");
  if (!Number.isInteger(operationalState.catalogVersion) || !/^[a-f0-9]{64}$/.test(operationalState.catalogHash ?? "") || !/^[a-f0-9]{64}$/.test(operationalState.capabilityStateVersion ?? "")) throw new Error("OperationalCapabilityState catalog/state identity is missing or invalid");
  if (options.manifest.capabilityCatalogHash && operationalState.catalogHash !== options.manifest.capabilityCatalogHash) throw new Error("OperationalCapabilityState catalog identity is stale");
  const allowedStatuses = new Set(["required", "optional_inactive", "optional_degraded"]);
  for (const [key, value] of Object.entries(operationalState.serviceStates)) if (!manifestByService.has(key) || !allowedStatuses.has(value)) throw new Error(`OperationalCapabilityState has invalid service status: ${key}=${value}`);
  const required = eligible.filter((item) => operationalState.serviceStates[item.service] === "required");
  const optionalInactive = eligible.filter((item) => operationalState.serviceStates[item.service] === "optional_inactive");
  const optionalDegraded = eligible.filter((item) => operationalState.serviceStates[item.service] === "optional_degraded");
  for (const item of eligible) if (!operationalState.serviceStates[item.service]) throw new Error(`OperationalCapabilityState is missing service ${item.service}`);
  const missingRequired = required.filter((item) => !byService.has(item.service));
  if (missingRequired.length) throw new Error(`docker compose ps is missing required services: ${missingRequired.map((item) => item.service).join(", ")}`);
  const running = ps.filter(isRunning);
  const totalBytes = running.reduce((sum, record) => sum + bytes(statsByName.get(name(record)).MemUsage ?? statsByName.get(name(record)).memUsage), 0);
  const portal = byService.get("portal");
  if (!portal || !isRunning(portal)) throw new Error("Required portal service is not running");
  const metric = (direction, value) => ({ direction, value });
  return {
    version: 1,
    manifestVersion: options.manifest.version,
    // The session holder is verified in-memory before, between, and after
    // sampling. Persist only stable lease identity to avoid session churn or
    // leaking an ephemeral coordination identifier into the tracked baseline.
    lease: { id: options.lease.id, environmentKey: options.lease.environmentKey },
    hostProfile: options.hostProfile ?? `${platform()}-${arch()}`,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    gitSha: identity.gitSha,
    metrics: {
      requiredRunningServices: metric("non-increasing", required.filter((item) => isRunning(byService.get(item.service) ?? {})).length),
      totalIdleContainerRssBytes: metric("non-increasing", totalBytes),
      portalIdleRssBytes: metric("non-increasing", bytes(statsByName.get(name(portal)).MemUsage ?? statsByName.get(name(portal)).memUsage)),
      unhealthyRequiredServices: metric("non-increasing", required.filter((item) => {
        const record = byService.get(item.service);
        if (isRunning(record)) return isUnhealthy(record);
        const exitCode = Number(record?.ExitCode ?? record?.exitCode);
        return !(item.healthSemantics === "lifecycle-completion" && state(record) === "exited" && exitCode === 0);
      }).length),
      optionalInactiveServices: metric("informational", optionalInactive.length),
      optionalDegradedServices: metric("informational", optionalDegraded.filter((item) => !byService.has(item.service) || isDegraded(byService.get(item.service))).length),
      servedIdentity: metric("informational", { gitSha: identity.gitSha, imageVersion: identity.imageVersion ?? null, version: identity.version ?? null }),
    },
  };
}

export function serializeRuntimeBaseline(value) { return stableSerialize(value); }

export function compareRuntimeMetrics(baseline, current) {
  const regressions = [];
  const expectedKeys = Object.keys(RUNTIME_METRIC_DIRECTIONS);
  if (JSON.stringify(Object.keys(baseline ?? {}).sort()) !== JSON.stringify(expectedKeys.sort()) || JSON.stringify(Object.keys(current ?? {}).sort()) !== JSON.stringify(expectedKeys.sort())) throw new Error("Runtime metrics are incomplete or contain unsupported keys");
  validateRuntimeMetricShapes(baseline);
  validateRuntimeMetricShapes(current);
  for (const [key, expected] of Object.entries(baseline)) {
    const actual = current?.[key];
    if (!actual || actual.direction !== expected.direction || expected.direction !== RUNTIME_METRIC_DIRECTIONS[key]) throw new Error(`Runtime metric policy mismatch: ${key}`);
    const allowed = RUNTIME_RSS_METRICS.has(key)
      ? expected.value * (1 + RUNTIME_RSS_TOLERANCE_PERCENT / 100)
      : expected.value;
    if (expected.direction === "non-increasing" && actual.value > allowed) regressions.push({ metric: key, baseline: expected.value, current: actual.value });
    else if (expected.direction !== "non-increasing" && expected.direction !== "informational") throw new Error(`Unsupported runtime metric direction: ${expected.direction}`);
  }
  return { passed: regressions.length === 0, regressions };
}

export function validateRuntimeBaseline(baseline, current) {
  const fail = (reason) => { throw new Error(`Runtime baseline is unverifiable: ${reason}`); };
  if (!baseline || typeof baseline !== "object" || baseline.version !== 1 || baseline.manifestVersion !== current?.manifestVersion) fail("version or manifest version mismatch");
  if (typeof baseline.generatedAt !== "string" || Number.isNaN(Date.parse(baseline.generatedAt))) fail("generatedAt must be an ISO-compatible timestamp");
  if (typeof baseline.hostProfile !== "string" || !baseline.hostProfile || baseline.hostProfile !== current?.hostProfile) fail("host profile mismatch");
  if (!baseline.lease || typeof baseline.lease.id !== "string" || !baseline.lease.id.trim() || baseline.lease.environmentKey !== REQUIRED_ENVIRONMENT) fail("canonical lease identity is missing");
  if (typeof baseline.gitSha !== "string" || !baseline.gitSha.trim() || baseline.gitSha !== baseline.metrics?.servedIdentity?.value?.gitSha) fail("served SHA provenance mismatch");
  if (baseline.sampling?.maxVariancePercent !== RUNTIME_RSS_TOLERANCE_PERCENT || baseline.sampling?.samples !== 2 || baseline.sampling?.selection !== "higher-non-increasing-budget") fail("sampling contract mismatch");
  if (JSON.stringify(baseline.commands) !== JSON.stringify(RUNTIME_COMMANDS)) fail("measurement command contract mismatch");
  try { validateRuntimeMetricShapes(baseline.metrics); } catch (error) { fail(error.message); }
}

function validateRuntimeMetricShapes(metrics) {
  for (const [key, direction] of Object.entries(RUNTIME_METRIC_DIRECTIONS)) {
    const metric = metrics?.[key];
    if (!metric || metric.direction !== direction) throw new Error(`Runtime metric policy mismatch: ${key}`);
    if (key !== "servedIdentity") {
      if (typeof metric.value !== "number" || !Number.isFinite(metric.value) || metric.value < 0) throw new Error(`${key} must be a finite nonnegative number`);
      continue;
    }
    const identity = metric.value;
    const imageVersion = identity?.imageVersion;
    const validImageVersion = imageVersion === null || (
      imageVersion && typeof imageVersion === "object" &&
      typeof imageVersion.raw === "string" && imageVersion.raw.trim() &&
      ["git-sha", "content-hash", "unknown"].includes(imageVersion.source)
    );
    if (!identity || typeof identity !== "object" || typeof identity.gitSha !== "string" || !identity.gitSha.trim() || !("version" in identity) || !("imageVersion" in identity) || !(identity.version === null || typeof identity.version === "string") || !validImageVersion) {
      throw new Error("servedIdentity must include a nonempty gitSha, nullable string version, and nullable structured imageVersion");
    }
  }
}

export function mergeStableSamples(first, second) {
  if (first.gitSha !== second.gitSha) throw new Error("Runtime sample identity gitSha changed between samples");
  if (first.hostProfile !== second.hostProfile) throw new Error("Runtime sample host profile changed between samples");
  if (first.version !== second.version) throw new Error("Runtime sample version changed between samples");
  if (first.manifestVersion !== second.manifestVersion) throw new Error("Runtime sample manifest version changed between samples");
  if (JSON.stringify(first.lease) !== JSON.stringify(second.lease)) throw new Error("Runtime sample lease identity changed between samples");
  if (JSON.stringify(first.metrics?.servedIdentity?.value) !== JSON.stringify(second.metrics?.servedIdentity?.value)) throw new Error("Runtime sample servedIdentity changed between samples");
  validateRuntimeMetricShapes(first.metrics);
  validateRuntimeMetricShapes(second.metrics);
  const metrics = {};
  for (const [key, direction] of Object.entries(RUNTIME_METRIC_DIRECTIONS)) {
    const a = first.metrics[key], b = second.metrics[key];
    if (!a || !b || a.direction !== direction || b.direction !== direction) throw new Error(`Runtime sample metric policy mismatch: ${key}`);
    if (direction === "non-increasing") {
      const high = Math.max(a.value, b.value), low = Math.min(a.value, b.value);
      const variance = high === 0 ? 0 : ((high - low) / high) * 100;
      if (variance > 5) throw new Error(`Runtime metric ${key} differs by ${variance.toFixed(2)}%, exceeding the 5% sample limit`);
      metrics[key] = { direction, value: high };
    } else metrics[key] = b;
  }
  return { ...second, metrics, sampling: { maxVariancePercent: RUNTIME_RSS_TOLERANCE_PERCENT, samples: 2, selection: "higher-non-increasing-budget" }, commands: [...RUNTIME_COMMANDS] };
}

async function loadJson(path, label) {
  let source; try { source = await readFile(path, "utf8"); } catch (error) { throw new Error(`${label} unavailable at ${path}: ${error.message}`); }
  try { return JSON.parse(source); } catch (error) { throw new Error(`${label} is invalid JSON at ${path}: ${error.message}`); }
}

export async function runRuntimeMeasurement(options = {}) {
  const manifestPath = resolve(options.manifestPath ?? scriptRoot, options.manifestPath ? "" : "scripts/platform-substrate-manifest.json");
  const baselinePath = resolve(options.baselinePath ?? scriptRoot, options.baselinePath ? "" : "scripts/platform-substrate-runtime-baseline.json");
  try {
    await verifyActiveLease(options.lease, options);
    const manifest = await loadJson(manifestPath, "substrate manifest");
    const operationalState = options.operationalState ?? (options.operationalStatePath ? await loadJson(options.operationalStatePath, "operational capability state") : manifest.operationalState);
    const catalog = operationalState ? undefined : await loadJson(resolve(options.catalogPath ?? join(scriptRoot, "scripts/capability-service-catalog.generated.json")), "generated capability catalog");
    const installStatePath = options.installStatePath ?? join(resolveDpfStateDir(), "install-state.json");
    const installSnapshot = operationalState ? undefined : await loadJson(resolve(installStatePath), "install state");
    const liveCapabilityStates = operationalState ? undefined : parseLiveCapabilityRows((options.execute ?? defaultExecute)("docker", ["compose", "exec", "-T", "postgres", "psql", "-U", process.env.POSTGRES_USER ?? "dpf", "-d", process.env.POSTGRES_DB ?? "dpf", "-At", "-F", "\t", "-c", "SELECT \"capabilityId\", state FROM \"PlatformCapability\" WHERE \"capabilityId\" LIKE 'runtime:%' ORDER BY \"capabilityId\""]));
    const current = await collectRuntimeMeasurements({ ...options, manifest, operationalState, catalog, installSnapshot, liveCapabilityStates });
    if (options.update) {
      await verifyActiveLease(options.lease, options);
      const second = await collectRuntimeMeasurements({ ...options, manifest, operationalState, catalog, installSnapshot, liveCapabilityStates });
      const baseline = mergeStableSamples(current, second);
      await verifyActiveLease(options.lease, options);
      await atomicWriteFile(baselinePath, serializeRuntimeBaseline(baseline), options.io);
      return { exitCode: 0, stdout: options.json ? serializeRuntimeBaseline(baseline) : `Updated runtime substrate baseline: ${baselinePath}\n`, stderr: "" };
    }
    const baseline = await loadJson(baselinePath, "runtime substrate baseline");
    validateRuntimeBaseline(baseline, { manifestVersion: manifest.version, hostProfile: current.hostProfile });
    const comparison = compareRuntimeMetrics(baseline.metrics, current.metrics);
    if (!comparison.passed) return { exitCode: 1, stdout: "", stderr: `Runtime substrate regression:\n${comparison.regressions.map((r) => `${r.metric}: ${r.baseline} -> ${r.current}`).join("\n")}\n` };
    return { exitCode: 0, stdout: options.json ? serializeRuntimeBaseline({ current, comparison }) : "Runtime substrate guard passed.\n", stderr: "" };
  } catch (error) { return { exitCode: 1, stdout: "", stderr: `${error.message}\n` }; }
}

function parseArgs(argv) {
  const options = { lease: { id: process.env.DPF_NONPROD_LEASE_ID, environmentKey: process.env.DPF_NONPROD_ENVIRONMENT_KEY, ownerSessionId: process.env.DPF_NONPROD_OWNER_SESSION_ID }, portalUrl: process.env.DPF_PORTAL_URL ?? "http://127.0.0.1:3000" };
  const paths = { "--manifest": "manifestPath", "--baseline": "baselinePath", "--operational-state": "operationalStatePath", "--catalog": "catalogPath", "--install-state": "installStatePath", "--portal-url": "portalUrl", "--lease-id": "leaseId", "--environment-key": "environmentKey", "--owner-session-id": "ownerSessionId", "--mcp-url": "mcpUrl" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") options.json = true;
    else if (argv[i] === "--update") options.update = true;
    else if (paths[argv[i]] && argv[i + 1]) {
      const key = paths[argv[i]], value = argv[++i];
      if (key === "leaseId") options.lease.id = value;
      else if (key === "environmentKey") options.lease.environmentKey = value;
      else if (key === "ownerSessionId") options.lease.ownerSessionId = value;
      else options[key] = key.endsWith("Path") ? resolve(value) : value;
    } else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  let result; try { result = await runRuntimeMeasurement(parseArgs(argv)); } catch (error) { result = { exitCode: 1, stdout: "", stderr: `${error.message}\n` }; }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main();
