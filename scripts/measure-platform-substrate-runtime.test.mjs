import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const modulePath = "./measure-platform-substrate-runtime.mjs";

const manifest = {
  version: 1,
  operationalState: { serviceStates: { postgres: "required", portal: "required", optional: "optional_degraded", inactive: "optional_inactive", "linux-only": "optional_inactive" } },
  services: [
    { service: "postgres", capability: "postgres", defaultRequired: true, healthSemantics: "compose-healthcheck", hostPlatforms: ["windows", "macos", "linux"] },
    { service: "portal", capability: "portal", defaultRequired: true, healthSemantics: "compose-healthcheck", hostPlatforms: ["windows", "macos", "linux"] },
    { service: "optional", capability: "optional", defaultRequired: false, healthSemantics: "compose-healthcheck", hostPlatforms: ["windows", "macos", "linux"] },
    { service: "inactive", capability: "inactive", defaultRequired: false, healthSemantics: "compose-healthcheck", hostPlatforms: ["windows", "macos", "linux"] },
    { service: "linux-only", capability: "linux-only", defaultRequired: false, healthSemantics: "compose-healthcheck", hostPlatforms: ["linux"] },
  ],
};
const ps = [
  { Service: "postgres", Name: "dpf-postgres-1", State: "running", Health: "healthy" },
  { Service: "portal", Name: "dpf-portal-1", State: "running", Health: "healthy" },
  { Service: "optional", Name: "dpf-optional-1", State: "running", Health: "unhealthy" },
];
const stats = [
  { Name: "dpf-postgres-1", MemUsage: "100MiB / 1GiB" },
  { Name: "dpf-portal-1", MemUsage: "256.5MiB / 1GiB" },
  { Name: "dpf-optional-1", MemUsage: "1GiB / 2GiB" },
];
const governedLease = { id: "lease-1", environmentKey: "local-integration-ci", ownerSessionId: "session-1" };
const verifyGovernedLease = async (lease) => ({ leaseId: lease.id, environmentKey: lease.environmentKey, ownerSessionId: lease.ownerSessionId, status: "active", expiresAt: "2099-01-01T00:00:00Z" });

function execFixture(command, args) {
  const key = [command, ...args].join(" ");
  if (key === "docker compose ps --format json --all") return JSON.stringify(ps);
  if (key === "docker stats --no-stream --format {{json .}}") return stats.map(JSON.stringify).join("\n");
  throw new Error(`unexpected command: ${key}`);
}

test("runtime measurement module loads without executing Docker", async () => {
  await assert.doesNotReject(import(modulePath));
});

test("collects required, memory, health, optional-state, and served identity metrics", async () => {
  const { collectRuntimeMeasurements } = await import(modulePath);
  const result = await collectRuntimeMeasurements({
    manifest,
    execute: execFixture,
    fetchJson: async (url) => url.endsWith("/api/health") ? { status: "ok" } : { gitSha: "abc123", version: "1.2.3", imageVersion: { raw: "abc123", source: "git-sha" } },
    portalUrl: "http://portal.test",
    lease: { id: "lease-1", environmentKey: "local-integration-ci" },
    hostProfile: "windows-x64",
  });
  assert.deepEqual(result.metrics, {
    requiredRunningServices: { direction: "non-increasing", value: 2 },
    totalIdleContainerRssBytes: { direction: "non-increasing", value: 1447559168 },
    portalIdleRssBytes: { direction: "non-increasing", value: 268959744 },
    unhealthyRequiredServices: { direction: "non-increasing", value: 0 },
    optionalInactiveServices: { direction: "informational", value: 1 },
    optionalDegradedServices: { direction: "informational", value: 1 },
    servedIdentity: { direction: "informational", value: { gitSha: "abc123", imageVersion: { raw: "abc123", source: "git-sha" }, version: "1.2.3" } },
  });
});

test("runtime diagnostics consume serialized operational state for inactive and degraded optional services", async () => {
  const { collectRuntimeMeasurements } = await import(modulePath);
  const result = await collectRuntimeMeasurements({ manifest, execute: execFixture, fetchJson: async (url) => url.endsWith("/api/health") ? { status: "ok" } : { gitSha: "served" }, portalUrl: "http://portal", lease: { id: "l", environmentKey: "local-integration-ci" }, hostProfile: "windows-x64" });
  assert.equal(result.metrics.optionalInactiveServices.value, 1);
  assert.equal(result.metrics.optionalDegradedServices.value, 1);
  await assert.rejects(collectRuntimeMeasurements({ manifest: { ...manifest, operationalState: undefined }, execute: execFixture, fetchJson: async (url) => url.endsWith("/api/health") ? { status: "ok" } : { gitSha: "served" }, portalUrl: "http://portal", lease: { id: "l", environmentKey: "local-integration-ci" }, hostProfile: "windows-x64" }), /OperationalCapabilityState/);
});

test("normalizes Node host platform names before applying hostPlatforms", async () => {
  const { normalizeHostPlatform } = await import(modulePath);
  assert.equal(normalizeHostPlatform("win32"), "windows");
  assert.equal(normalizeHostPlatform("darwin"), "macos");
  assert.equal(normalizeHostPlatform("linux"), "linux");
});

test("stopped required services are unhealthy but successful lifecycle completion is not", async () => {
  const { collectRuntimeMeasurements } = await import(modulePath);
  const lifecycleManifest = { version: 1, services: [
    ...manifest.services,
    { service: "portal-init", capability: "portal-init", defaultRequired: true, healthSemantics: "lifecycle-completion", hostPlatforms: ["windows", "macos", "linux"] },
  ], operationalState: { serviceStates: { ...manifest.operationalState.serviceStates, "portal-init": "required" } } };
  const fetchJson = async (url) => url.endsWith("/api/health") ? { status: "ok" } : { gitSha: "served" };
  const basePs = [...ps, { Service: "portal-init", Name: "dpf-portal-init-1", State: "exited", Health: "", ExitCode: 0 }];
  const execute = (command, args) => args[0] === "compose" ? JSON.stringify(basePs) : stats.map(JSON.stringify).join("\n");
  const completed = await collectRuntimeMeasurements({ manifest: lifecycleManifest, execute, fetchJson, portalUrl: "http://portal", lease: { id: "l", environmentKey: "local-integration-ci" }, hostProfile: "windows-x64" });
  assert.equal(completed.metrics.unhealthyRequiredServices.value, 0);
  const stoppedPs = basePs.map((item) => item.Service === "postgres" ? { ...item, State: "exited", Health: "", ExitCode: 1 } : item);
  const stopped = await collectRuntimeMeasurements({ manifest: lifecycleManifest, execute: (command, args) => args[0] === "compose" ? JSON.stringify(stoppedPs) : stats.filter((item) => item.Name !== "dpf-postgres-1").map(JSON.stringify).join("\n"), fetchJson, portalUrl: "http://portal", lease: { id: "l", environmentKey: "local-integration-ci" }, hostProfile: "windows-x64" });
  assert.equal(stopped.metrics.unhealthyRequiredServices.value, 1);
});

test("observed served identity cannot be overridden by caller provenance", async () => {
  const { collectRuntimeMeasurements } = await import(modulePath);
  const result = await collectRuntimeMeasurements({ manifest, execute: execFixture, fetchJson: async (url) => url.endsWith("/api/health") ? { status: "ok" } : { gitSha: "observed" }, portalUrl: "http://portal", lease: { id: "l", environmentKey: "local-integration-ci" }, gitSha: "caller" });
  assert.equal(result.gitSha, "observed");
  assert.equal(result.metrics.servedIdentity.value.gitSha, "observed");
});

test("fails closed on malformed or partial Docker output", async () => {
  const { collectRuntimeMeasurements } = await import(modulePath);
  const base = { manifest, fetchJson: async (url) => url.endsWith("/api/health") ? { status: "ok" } : { gitSha: "abc" }, portalUrl: "http://portal", lease: { id: "l", environmentKey: "local-integration-ci" } };
  await assert.rejects(collectRuntimeMeasurements({ ...base, execute: () => "not-json" }), /compose ps.*JSON/i);
  await assert.rejects(collectRuntimeMeasurements({ ...base, execute: (c, a) => a[0] === "compose" ? JSON.stringify(ps) : JSON.stringify(stats.slice(0, 2)) }), /missing stats.*optional/i);
  await assert.rejects(collectRuntimeMeasurements({ ...base, execute: (c, a) => a[0] === "compose" ? JSON.stringify(ps.filter((item) => item.Service !== "postgres")) : JSON.stringify(stats) }), /missing required.*postgres/i);
});

test("baseline serialization is stable after removing timestamp and collection SHA", async () => {
  const { serializeRuntimeBaseline } = await import(modulePath);
  const common = { version: 1, manifestVersion: 1, lease: { id: "l", environmentKey: "local-integration-ci" }, hostProfile: "linux-x64", metrics: { requiredRunningServices: { direction: "non-increasing", value: 2 } } };
  const withoutVolatile = ({ generatedAt: _at, gitSha: _sha, ...value }) => value;
  assert.equal(serializeRuntimeBaseline(withoutVolatile({ ...common, generatedAt: "first", gitSha: "one" })), serializeRuntimeBaseline(withoutVolatile({ ...common, generatedAt: "second", gitSha: "two" })));
});

test("checker refuses unleased and unidentifiable runtimes", async () => {
  const { runRuntimeMeasurement } = await import(modulePath);
  const dir = await mkdtemp(join(tmpdir(), "dpf-runtime-"));
  const manifestPath = join(dir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  const dependencies = { manifestPath, execute: execFixture, fetchJson: async (url) => url.endsWith("/api/health") ? { status: "ok" } : { gitSha: "abc" }, portalUrl: "http://portal", verifyLease: verifyGovernedLease };
  assert.equal((await runRuntimeMeasurement(dependencies)).exitCode, 1);
  assert.match((await runRuntimeMeasurement({ ...dependencies, lease: { ...governedLease, environmentKey: "wrong" } })).stderr, /local-integration-ci/);
  assert.match((await runRuntimeMeasurement({ ...dependencies, lease: governedLease, fetchJson: async () => ({ status: "ok" }) })).stderr, /identity/i);
});

test("nonexistent, expired, wrong-environment, and wrong-holder leases refuse and preserve baseline", async () => {
  const { runRuntimeMeasurement } = await import(modulePath);
  const dir = await mkdtemp(join(tmpdir(), "dpf-runtime-"));
  const manifestPath = join(dir, "manifest.json"), baselinePath = join(dir, "baseline.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  const original = "original\n";
  const base = { manifestPath, baselinePath, update: true, lease: governedLease, execute: execFixture, fetchJson: async (url) => url.endsWith("/api/health") ? { status: "ok" } : { gitSha: "served" }, portalUrl: "http://portal" };
  const cases = [
    ["nonexistent", async () => null],
    ["expired", async () => ({ leaseId: governedLease.id, environmentKey: governedLease.environmentKey, ownerSessionId: governedLease.ownerSessionId, status: "active", expiresAt: "2000-01-01T00:00:00Z" })],
    ["environment", async () => ({ leaseId: governedLease.id, environmentKey: "active-candidate", ownerSessionId: governedLease.ownerSessionId, status: "active", expiresAt: "2099-01-01T00:00:00Z" })],
    ["holder", async () => ({ leaseId: governedLease.id, environmentKey: governedLease.environmentKey, ownerSessionId: "someone-else", status: "active", expiresAt: "2099-01-01T00:00:00Z" })],
  ];
  for (const [label, verifyLease] of cases) {
    await writeFile(baselinePath, original);
    const result = await runRuntimeMeasurement({ ...base, verifyLease });
    assert.equal(result.exitCode, 1, label);
    assert.match(result.stderr, new RegExp(label, "i"));
    assert.equal(await readFile(baselinePath, "utf8"), original, label);
  }
});

test("production verifier accepts the MCP structuredContent lease envelope", async () => {
  const { runRuntimeMeasurement } = await import(modulePath);
  const dir = await mkdtemp(join(tmpdir(), "dpf-runtime-"));
  const manifestPath = join(dir, "manifest.json"), baselinePath = join(dir, "baseline.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  const leaseRecord = await verifyGovernedLease(governedLease);
  const result = await runRuntimeMeasurement({
    manifestPath, baselinePath, update: true, lease: governedLease, mcpToken: "fixture-token",
    fetchImpl: async () => ({ ok: true, json: async () => ({ result: { structuredContent: { leases: [leaseRecord] } } }) }),
    execute: execFixture,
    fetchJson: async (url) => url.endsWith("/api/health") ? { status: "ok" } : { gitSha: "served" },
    portalUrl: "http://portal",
  });
  assert.equal(result.exitCode, 0, result.stderr);
});

test("update is atomic and partial collection never overwrites baseline", async () => {
  const { runRuntimeMeasurement } = await import(modulePath);
  const dir = await mkdtemp(join(tmpdir(), "dpf-runtime-"));
  const manifestPath = join(dir, "manifest.json");
  const baselinePath = join(dir, "baseline.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(baselinePath, "original\n");
  const result = await runRuntimeMeasurement({ manifestPath, baselinePath, update: true, execute: () => "bad", fetchJson: async () => ({}), portalUrl: "http://portal", lease: governedLease, verifyLease: verifyGovernedLease });
  assert.equal(result.exitCode, 1);
  assert.equal(await readFile(baselinePath, "utf8"), "original\n");
});

test("check applies runtime ratchets while informational changes never fail", async () => {
  const { compareRuntimeMetrics } = await import(modulePath);
  const metric = (direction, value) => ({ direction, value });
  const baseline = {
    requiredRunningServices: metric("non-increasing", 1), totalIdleContainerRssBytes: metric("non-increasing", 10),
    portalIdleRssBytes: metric("non-increasing", 10), unhealthyRequiredServices: metric("non-increasing", 0),
    optionalInactiveServices: metric("informational", 0), optionalDegradedServices: metric("informational", 0),
    servedIdentity: metric("informational", { gitSha: "old", imageVersion: null, version: null }),
  };
  assert.equal(compareRuntimeMetrics(baseline, { ...baseline, requiredRunningServices: metric("non-increasing", 2), optionalInactiveServices: metric("informational", 99) }).passed, false);
  assert.equal(compareRuntimeMetrics(baseline, { ...baseline, totalIdleContainerRssBytes: metric("non-increasing", 10.5), portalIdleRssBytes: metric("non-increasing", 10.5) }).passed, true);
  assert.equal(compareRuntimeMetrics(baseline, { ...baseline, totalIdleContainerRssBytes: metric("non-increasing", 10.51) }).passed, false);
  assert.equal(compareRuntimeMetrics(baseline, { ...baseline, optionalInactiveServices: metric("informational", 99), servedIdentity: metric("informational", { gitSha: "new", imageVersion: null, version: null }) }).passed, true);
});

test("comparison rejects malformed numeric and served-identity metric shapes", async () => {
  const { compareRuntimeMetrics } = await import(modulePath);
  const metric = (direction, value) => ({ direction, value });
  const valid = {
    requiredRunningServices: metric("non-increasing", 1), totalIdleContainerRssBytes: metric("non-increasing", 10),
    portalIdleRssBytes: metric("non-increasing", 10), unhealthyRequiredServices: metric("non-increasing", 0),
    optionalInactiveServices: metric("informational", 0), optionalDegradedServices: metric("informational", 0),
    servedIdentity: metric("informational", { gitSha: "served", imageVersion: null, version: "1" }),
  };
  for (const bad of ["1", NaN, Infinity, -1]) {
    assert.throws(() => compareRuntimeMetrics({ ...valid, portalIdleRssBytes: metric("non-increasing", bad) }, valid), /portalIdleRssBytes.*finite nonnegative/i);
    assert.throws(() => compareRuntimeMetrics(valid, { ...valid, portalIdleRssBytes: metric("non-increasing", bad) }), /portalIdleRssBytes.*finite nonnegative/i);
  }
  const structuredIdentity = {
    ...valid,
    servedIdentity: metric("informational", { gitSha: "served", imageVersion: { raw: "served", source: "git-sha" }, version: "1" }),
  };
  assert.doesNotThrow(() => compareRuntimeMetrics(structuredIdentity, structuredIdentity));
  assert.throws(() => compareRuntimeMetrics({ ...valid, optionalInactiveServices: metric("informational", "0") }, valid), /optionalInactiveServices.*finite nonnegative/i);
  assert.throws(() => compareRuntimeMetrics(valid, { ...valid, servedIdentity: metric("informational", { gitSha: "" }) }), /servedIdentity/i);
  for (const imageVersion of ["legacy", {}, { raw: "", source: "git-sha" }, { raw: "served", source: "invalid" }]) {
    assert.throws(() => compareRuntimeMetrics(valid, { ...valid, servedIdentity: metric("informational", { gitSha: "served", imageVersion, version: "1" }) }), /servedIdentity/i);
  }
});

test("runtime baseline contract rejects unverifiable provenance and host drift", async () => {
  const { validateRuntimeBaseline } = await import(modulePath);
  const metric = (direction, value) => ({ direction, value });
  const baseline = {
    version: 1, manifestVersion: 1, generatedAt: "2026-07-17T00:00:00.000Z", gitSha: "served", hostProfile: "win32-x64",
    lease: { id: "NPEL-1", environmentKey: "local-integration-ci" },
    sampling: { maxVariancePercent: 5, samples: 2, selection: "higher-non-increasing-budget" },
    commands: ["docker compose ps --format json --all", "docker stats --no-stream --format {{json .}}", "GET /api/health", "GET /api/platform/version"],
    metrics: {
      requiredRunningServices: metric("non-increasing", 1), totalIdleContainerRssBytes: metric("non-increasing", 10), portalIdleRssBytes: metric("non-increasing", 10), unhealthyRequiredServices: metric("non-increasing", 0), optionalInactiveServices: metric("informational", 0), optionalDegradedServices: metric("informational", 0), servedIdentity: metric("informational", { gitSha: "served", imageVersion: null, version: "1" }),
    },
  };
  assert.doesNotThrow(() => validateRuntimeBaseline(baseline, { manifestVersion: 1, hostProfile: "win32-x64" }));
  const invalid = [
    { ...baseline, lease: { ...baseline.lease, id: "" } },
    { ...baseline, lease: { ...baseline.lease, environmentKey: "active-candidate" } },
    { ...baseline, hostProfile: "linux-x64" },
    { ...baseline, gitSha: "caller" },
    { ...baseline, generatedAt: "not-a-date" },
    { ...baseline, sampling: { ...baseline.sampling, samples: 1 } },
    { ...baseline, commands: baseline.commands.slice(1) },
  ];
  for (const value of invalid) assert.throws(() => validateRuntimeBaseline(value, { manifestVersion: 1, hostProfile: "win32-x64" }), /runtime baseline/i);
});

test("update reverifies the lease immediately before write and preserves baseline on change", async () => {
  const { runRuntimeMeasurement } = await import(modulePath);
  const dir = await mkdtemp(join(tmpdir(), "dpf-runtime-"));
  const manifestPath = join(dir, "manifest.json"), baselinePath = join(dir, "baseline.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(baselinePath, "original\n");
  let calls = 0;
  const result = await runRuntimeMeasurement({ manifestPath, baselinePath, update: true, lease: governedLease, execute: execFixture, fetchJson: async (url) => url.endsWith("/api/health") ? { status: "ok" } : { gitSha: "served" }, portalUrl: "http://portal", verifyLease: async (lease) => {
    calls++;
    const record = await verifyGovernedLease(lease);
    return calls < 3 ? record : { ...record, ownerSessionId: "changed-holder" };
  } });
  assert.equal(calls, 3);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /holder/i);
  assert.equal(await readFile(baselinePath, "utf8"), "original\n");
});

test("lease expiry between samples refuses before the second sample and preserves baseline", async () => {
  const { runRuntimeMeasurement } = await import(modulePath);
  const dir = await mkdtemp(join(tmpdir(), "dpf-runtime-"));
  const manifestPath = join(dir, "manifest.json"), baselinePath = join(dir, "baseline.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(baselinePath, "original\n");
  let calls = 0, statsCalls = 0;
  const result = await runRuntimeMeasurement({ manifestPath, baselinePath, update: true, lease: governedLease,
    execute: (command, args) => { if (args[0] === "stats") statsCalls++; return execFixture(command, args); },
    fetchJson: async (url) => url.endsWith("/api/health") ? { status: "ok" } : { gitSha: "served" }, portalUrl: "http://portal",
    verifyLease: async (lease) => { calls++; const record = await verifyGovernedLease(lease); return calls === 1 ? record : { ...record, expiresAt: "2000-01-01T00:00:00Z" }; },
  });
  assert.equal(calls, 2);
  assert.equal(statsCalls, 1);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /expired/i);
  assert.equal(await readFile(baselinePath, "utf8"), "original\n");
});

test("sample merge rejects identity, host, version, manifest, and lease swaps", async () => {
  const { mergeStableSamples } = await import(modulePath);
  const base = {
    version: 1, manifestVersion: 1, gitSha: "served", hostProfile: "windows-x64",
    lease: { id: "lease", environmentKey: "local-integration-ci" },
    metrics: {
      requiredRunningServices: { direction: "non-increasing", value: 1 }, totalIdleContainerRssBytes: { direction: "non-increasing", value: 1 },
      portalIdleRssBytes: { direction: "non-increasing", value: 1 }, unhealthyRequiredServices: { direction: "non-increasing", value: 0 },
      optionalInactiveServices: { direction: "informational", value: 0 }, optionalDegradedServices: { direction: "informational", value: 0 },
      servedIdentity: { direction: "informational", value: { gitSha: "served", imageVersion: { raw: "img", source: "unknown" }, version: "1" } },
    },
  };
  const changes = [
    ["identity", { gitSha: "other" }], ["host", { hostProfile: "linux-x64" }], ["version", { version: 2 }],
    ["manifest", { manifestVersion: 2 }], ["lease", { lease: { id: "other", environmentKey: "local-integration-ci" } }],
    ["servedIdentity", { metrics: { ...base.metrics, servedIdentity: { direction: "informational", value: { gitSha: "other", imageVersion: { raw: "img", source: "unknown" }, version: "1" } } } }],
  ];
  for (const [label, change] of changes) assert.throws(() => mergeStableSamples(base, { ...base, ...change }), new RegExp(label, "i"));
});

test("update takes two samples, stores higher budgets, and records collection contract", async () => {
  const { runRuntimeMeasurement } = await import(modulePath);
  const dir = await mkdtemp(join(tmpdir(), "dpf-runtime-"));
  const manifestPath = join(dir, "manifest.json"), baselinePath = join(dir, "baseline.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  let statsCall = 0;
  const execute = (command, args) => {
    if (args[0] === "compose") return JSON.stringify(ps);
    statsCall++;
    const multiplier = statsCall === 1 ? 1 : 1.04;
    return stats.map((record) => JSON.stringify({ ...record, MemUsage: `${parseFloat(record.MemUsage) * multiplier}${record.MemUsage.match(/GiB|MiB/)[0]} / 4GiB` })).join("\n");
  };
  const result = await runRuntimeMeasurement({ manifestPath, baselinePath, update: true, execute, fetchJson: async (url) => url.endsWith("/api/health") ? { status: "ok" } : { gitSha: "served" }, portalUrl: "http://portal", lease: governedLease, verifyLease: verifyGovernedLease, generatedAt: "now", gitSha: "source" });
  assert.equal(result.exitCode, 0, result.stderr);
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  assert.equal(statsCall, 2);
  assert.deepEqual(baseline.lease, { id: governedLease.id, environmentKey: governedLease.environmentKey });
  assert.equal("ownerSessionId" in baseline.lease, false);
  assert.equal(baseline.metrics.portalIdleRssBytes.value, 279718134);
  assert.deepEqual(baseline.sampling, { maxVariancePercent: 5, samples: 2, selection: "higher-non-increasing-budget" });
  assert.deepEqual(baseline.commands, ["docker compose ps --format json --all", "docker stats --no-stream --format {{json .}}", "GET /api/health", "GET /api/platform/version"]);
});

test("unstable consecutive samples fail without overwriting a baseline", async () => {
  const { runRuntimeMeasurement } = await import(modulePath);
  const dir = await mkdtemp(join(tmpdir(), "dpf-runtime-"));
  const manifestPath = join(dir, "manifest.json"), baselinePath = join(dir, "baseline.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(baselinePath, "original\n");
  let statsCall = 0;
  const execute = (command, args) => args[0] === "compose" ? JSON.stringify(ps) : stats.map((record) => JSON.stringify({ ...record, MemUsage: statsCall++ < 3 ? record.MemUsage : "2GiB / 4GiB" })).join("\n");
  const result = await runRuntimeMeasurement({ manifestPath, baselinePath, update: true, execute, fetchJson: async (url) => url.endsWith("/api/health") ? { status: "ok" } : { gitSha: "served" }, portalUrl: "http://portal", lease: governedLease, verifyLease: verifyGovernedLease });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /5%/);
  assert.equal(await readFile(baselinePath, "utf8"), "original\n");
});
