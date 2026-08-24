import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { computeCapabilityStateVersion } from "./capability-state-hash.mjs";
import { resolveCapabilityComposeProfiles } from "./resolve-capability-compose-profiles.mjs";

const root = new URL("../../", import.meta.url);
const adapter = new URL("./resolve-capability-compose-profiles.mjs", import.meta.url);
const catalog = JSON.parse(await readFile(new URL("../capability-service-catalog.generated.json", import.meta.url), "utf8"));

const stateVersion = (keys) => {
  const states = catalog.capabilities.map(({ capabilityId }) => `${capabilityId}=${keys.includes(capabilityId) ? "active" : "disabled"}`).sort().join("\n");
  const result = spawnSync(process.execPath, ["-e", `process.stdout.write(require('crypto').createHash('sha256').update(${JSON.stringify(`${catalog.catalogHash}\n${states}`)}).digest('hex'))`], { encoding: "utf8" });
  return result.stdout;
};

async function run(state, ...args) {
  const dir = await mkdtemp(join(tmpdir(), "dpf-capability-profiles-"));
  const path = join(dir, "install-state.json");
  await writeFile(path, JSON.stringify(state));
  const result = spawnSync(process.execPath, [fileURLToPath(adapter), "--state", path, ...args], { cwd: fileURLToPath(new URL("../..", root)), encoding: "utf8" });
  result.statePath = path;
  return result;
}

const snapshot = (keys) => ({
  schemaVersion: 1,
  enabledRuntimeCapabilities: keys,
  capabilityCatalogHash: catalog.catalogHash,
  capabilityStateVersion: stateVersion(keys),
});

test("Windows and POSIX consumers receive the same deterministic ordered profiles", async () => {
  const keys = ["runtime:local-speech", "runtime:deep-observability", "runtime:core"];
  const windows = await run(snapshot(keys), "--host", "windows");
  const posix = await run(snapshot([...keys].reverse()), "--host", "linux");
  assert.equal(windows.status, 0, windows.stderr);
  assert.equal(posix.status, 0, posix.stderr);
  assert.deepEqual(JSON.parse(windows.stdout).runtimeProfiles, ["runtime-deep-observability", "runtime-local-speech"]);
  assert.deepEqual(JSON.parse(posix.stdout).runtimeProfiles, JSON.parse(windows.stdout).runtimeProfiles);
});

test("unknown capability fails with the stable error", async () => {
  const result = await run(snapshot(["runtime:core", "runtime:unknown"]));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^unknown_runtime_capability:runtime:unknown\s*$/);
});

test("stale catalog or state hash fails closed", async () => {
  const staleCatalog = await run({ ...snapshot(["runtime:core"]), capabilityCatalogHash: "0".repeat(64) });
  assert.equal(staleCatalog.status, 2);
  assert.match(staleCatalog.stderr, /^capability_state_stale\s*$/);
  const staleState = await run({ ...snapshot(["runtime:core"]), capabilityStateVersion: "0".repeat(64) });
  assert.equal(staleState.status, 2);
  assert.match(staleState.stderr, /^capability_state_stale\s*$/);
});

test("a platform catalog change migrates instead of wedging the install", async () => {
  // The regression this guards: shipping a release that adds or moves a service
  // moves `catalogHash`, so every already-installed state carries the previous
  // one. Refusing that under --migrate wedges every pre-existing install,
  // because the upgrade that would restamp the state IS the blocked upgrade.
  // Observed live as promoter readiness `capability_projection_failed`.
  const previousRelease = { ...snapshot(["runtime:core"]), capabilityCatalogHash: "0".repeat(64) };

  const withoutMigrate = await run(previousRelease);
  assert.equal(withoutMigrate.status, 2, "still fails closed without --migrate");
  assert.match(withoutMigrate.stderr, /^capability_state_stale\s*$/);

  const migrated = await run(previousRelease, "--migrate");
  assert.equal(migrated.status, 0, migrated.stderr);
  const projection = JSON.parse(migrated.stdout);
  // The operator's chosen capabilities survive the migration untouched; only
  // the platform's own version stamp moves.
  assert.ok(projection.enabledRuntimeCapabilities.includes("runtime:core"));
  assert.notEqual(projection.capabilityCatalogHash, "0".repeat(64));
});

test("an edited enabled-set is NOT papered over by --migrate", async () => {
  // Opposite cause, identical-looking symptom. The catalog is unchanged, so a
  // mismatched state version means the enabled set was edited without
  // restamping. Migration must never accept that.
  const base = snapshot(["runtime:core"]);
  const tampered = { ...base, capabilityStateVersion: "0".repeat(64) };
  const result = await run(tampered, "--migrate");
  assert.equal(result.status, 2, "an unstamped edit must still fail closed under --migrate");
  assert.match(result.stderr, /^capability_state_stale\s*$/);
});

test("a partial legacy capability snapshot fails closed instead of receiving defaults", async () => {
  const result = await run({ schemaVersion: 1, enabledRuntimeCapabilities: ["runtime:core"] }, "--migrate");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^capability_state_stale\s*$/);
});

test("a previous-release state migrates to the documented default-start compatibility set", async () => {
  const result = await run({ schemaVersion: 1 }, "--migrate");
  assert.equal(result.status, 0, result.stderr);
  const resolved = JSON.parse(result.stdout);
  assert.deepEqual(resolved.enabledRuntimeCapabilities, [
    "runtime:browser-automation",
    "runtime:build",
    "runtime:core",
    "runtime:deep-observability",
    "runtime:durable-automation",
    "runtime:external-ai",
    "runtime:local-speech",
  ]);
  assert.ok(!resolved.enabledRuntimeCapabilities.includes("runtime:adp-integration"));
  assert.ok(!resolved.enabledRuntimeCapabilities.includes("runtime:development"));
  const seededStates = JSON.parse(await readFile(new URL("../../packages/db/data/platform-runtime-capabilities.json", import.meta.url), "utf8"));
  assert.deepEqual(
    resolved.enabledRuntimeCapabilities,
    seededStates.capabilities.filter((entry) => entry.state === "active").map((entry) => entry.capabilityId).sort(),
    "migration must preserve the prior release's active capability semantics as well as its local topology",
  );
});

test("a fresh initialized state migrates to the core-only capability closure", async () => {
  const result = await run({ schemaVersion: 1, installerVersion: "fresh", platform: "linux", arch: "amd64", enabledRuntimeCapabilities: [] }, "--host", "linux", "--migrate", "--write");
  assert.equal(result.status, 0, result.stderr);
  const resolved = JSON.parse(result.stdout);
  assert.deepEqual(resolved.enabledRuntimeCapabilities, ["runtime:core"]);
  assert.deepEqual(resolved.runtimeProfiles, []);
  const stored = JSON.parse(await readFile(result.statePath, "utf8"));
  assert.deepEqual(stored.enabledRuntimeCapabilities, ["runtime:core"]);
  assert.equal(stored.capabilityCatalogHash, catalog.catalogHash);
  assert.equal(typeof stored.capabilityStateVersion, "string");
});

test("migration atomically persists the resolved snapshot for restart and autostart", async () => {
  const migrated = await run({ schemaVersion: 1, installerVersion: "previous", platform: "win32", arch: "amd64" }, "--host", "windows", "--migrate", "--write");
  assert.equal(migrated.status, 0, migrated.stderr);
  const stored = JSON.parse(await readFile(migrated.statePath, "utf8"));
  const projection = JSON.parse(migrated.stdout);
  assert.deepEqual(stored.enabledRuntimeCapabilities, projection.enabledRuntimeCapabilities);
  assert.equal(stored.capabilityCatalogHash, projection.capabilityCatalogHash);
  assert.equal(stored.capabilityStateVersion, projection.capabilityStateVersion);
  const restart = await run(stored, "--host", "windows");
  assert.equal(restart.status, 0, restart.stderr);
  assert.deepEqual(JSON.parse(restart.stdout), projection);
});

test("write mode delegates to the canonical install-state transaction", async () => {
  const source = await readFile(adapter, "utf8");
  assert.match(source, /updateInstallState/);
  assert.doesNotMatch(source, /`\$\{statePath\}\.tmp`/);
  assert.doesNotMatch(source, /rename\(temporary, statePath\)/);
});

test("special lifecycle profiles remain overlays and compatibility aliases resolve canonical closures", async () => {
  const state = snapshot(["runtime:core", "runtime:local-speech", "runtime:deep-observability"]);
  const result = await run(state, "--overlay", "promote", "--overlay", "linux-monitoring", "--alias", "tts", "--alias", "observability-ui", "--host", "linux");
  assert.equal(result.status, 0, result.stderr);
  const resolved = JSON.parse(result.stdout);
  assert.deepEqual(resolved.runtimeProfiles, ["runtime-deep-observability", "runtime-local-speech"]);
  assert.deepEqual(resolved.overlayProfiles, ["linux-monitoring", "promote"]);
  assert.deepEqual(resolved.composeProfiles, ["runtime-deep-observability", "runtime-local-speech", "linux-monitoring", "promote"]);
  assert.ok(resolved.requiredServices.includes("dpf-tts"));
  assert.ok(resolved.requiredServices.includes("grafana"));
});

test("governed COMPOSE_PROFILES preserves an allowlisted host overlay without granting runtime authority", async () => {
  const preserved = await run(snapshot(["runtime:core"]), "--host", "linux", "--compose-profiles", "linux-host-network");
  assert.equal(preserved.status, 0, preserved.stderr);
  assert.deepEqual(JSON.parse(preserved.stdout).composeProfiles, ["linux-host-network"]);

  const rejected = await run(snapshot(["runtime:core"]), "--host", "linux", "--compose-profiles", "runtime-build");
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /^capability_profile_not_enabled:runtime-build\s*$/);
});

test("host filtering preserves Linux and macOS service requirements without changing capability profiles", async () => {
  const state = snapshot(["runtime:core", "runtime:deep-observability"]);
  const linux = JSON.parse((await run(state, "--host", "linux")).stdout);
  const macos = JSON.parse((await run(state, "--host", "macos")).stdout);
  assert.deepEqual(linux.runtimeProfiles, macos.runtimeProfiles);
  assert.ok(linux.requiredServices.includes("node-exporter"));
  assert.ok(!macos.requiredServices.includes("node-exporter"));
});

test("service requirements retain operator-controlled init services but exclude on-demand lifecycle services", async () => {
  const build = await run(snapshot(["runtime:core", "runtime:build"]), "--host", "windows");
  assert.equal(build.status, 0, build.stderr);
  const required = JSON.parse(build.stdout).requiredServices;
  assert.ok(required.includes("sandbox-init"));
  assert.ok(required.includes("sandbox"));
  assert.ok(!required.includes("promoter"));
});

test("lifecycle scripts consume the adapter instead of carrying runtime service lists", async () => {
  const files = [
    "scripts/installer/lib/state.sh",
    "scripts/installer/lib/state.ps1",
    "scripts/installer/lib/compose.sh",
    "scripts/installer/lib/autostart.sh",
    "scripts/fresh-install.ps1",
    "scripts/dpf-start.ps1",
    "scripts/setup.ps1",
    "scripts/promote.sh",
    "scripts/dpf-compose.mjs",
  ];
  for (const file of files) {
    const source = await readFile(new URL(`../../${file}`, import.meta.url), "utf8");
    assert.match(source, /resolve-capability-compose-profiles|Resolve-DpfCapabilityComposeProfiles|dpf_resolve_capability_compose_profiles/, `${file} must consume the adapter`);
  }
  const setup = await readFile(new URL("../../scripts/setup.ps1", import.meta.url), "utf8");
  assert.match(setup, /capabilityProjection\.requiredServices\) -contains "ollama"/);
  const promote = await readFile(new URL("../../scripts/promote.sh", import.meta.url), "utf8");
  assert.match(promote, /requiredServices\.includes\("sandbox"\)/);
  assert.match(promote, /sandbox-refresh-optional-inactive/);
  const compose = await readFile(new URL("../../scripts/installer/lib/compose.sh", import.meta.url), "utf8");
  assert.match(compose, /--compose-profiles/);
});

test("a declared retirement migrates; an undeclared id still fails closed (BI-5AA0345E)", async () => {
  const catalog = JSON.parse(await readFile(new URL("../capability-service-catalog.generated.json", import.meta.url), "utf8"));
  const enabled = catalog.capabilities.map(({ capabilityId }) => capabilityId);
  const ids = [...enabled];
  const state = {
    schemaVersion: 2,
    enabledRuntimeCapabilities: enabled,
    capabilityCatalogHash: catalog.catalogHash,
    capabilityStateVersion: computeCapabilityStateVersion(catalog.catalogHash, enabled, ids),
  };
  // A future release that RETIRES one capability: the entry stays, marked.
  const retiredCatalog = {
    ...catalog,
    catalogHash: "9".repeat(64),
    capabilities: catalog.capabilities.map((entry) =>
      entry.capabilityId === "runtime:local-speech" ? { ...entry, lifecycle: "retired" } : entry),
  };

  // Under --migrate the platform's own withdrawal is migrated, not refused —
  // refusing wedges every install that had it enabled, and the upgrade that
  // would drop it IS the blocked upgrade.
  const migrated = resolveCapabilityComposeProfiles({ catalog: retiredCatalog, state, hostPlatform: "linux", migrate: true });
  assert.ok(!migrated.enabledRuntimeCapabilities.includes("runtime:local-speech"));
  assert.deepEqual(migrated.droppedRetiredCapabilities, ["runtime:local-speech"]);
  assert.equal(migrated.capabilityCatalogHash, retiredCatalog.catalogHash);

  // Without --migrate the snapshot is genuinely stale and the caller has not
  // asked to rewrite it.
  assert.throws(
    () => resolveCapabilityComposeProfiles({ catalog: retiredCatalog, state, hostPlatform: "linux" }),
    /capability_state_stale/,
  );

  // An id nothing in the catalog vouches for still fails closed EVEN under
  // migrate — that is the tampering case retirement must not be confused with.
  const bogus = { ...state, enabledRuntimeCapabilities: [...enabled, "runtime:never-existed"] };
  assert.throws(
    () => resolveCapabilityComposeProfiles({ catalog: retiredCatalog, state: bogus, hostPlatform: "linux", migrate: true }),
    /unknown_runtime_capability:runtime:never-existed/,
  );
});

test("a retired capability still required by a live one is a catalog authoring error", async () => {
  const catalog = JSON.parse(await readFile(new URL("../capability-service-catalog.generated.json", import.meta.url), "utf8"));
  // runtime:core is a dependency of others; retiring it must surface loudly
  // rather than yield a projection that depends on something withdrawn.
  const broken = {
    ...catalog,
    catalogHash: "8".repeat(64),
    capabilities: catalog.capabilities.map((entry) =>
      entry.capabilityId === "runtime:core" ? { ...entry, lifecycle: "retired" } : entry),
  };
  const enabled = ["runtime:build"];
  assert.throws(
    () => resolveCapabilityComposeProfiles({
      catalog: broken,
      state: { schemaVersion: 2, enabledRuntimeCapabilities: enabled,
        capabilityCatalogHash: broken.catalogHash,
        capabilityStateVersion: computeCapabilityStateVersion(broken.catalogHash, enabled, catalog.capabilities.map((c) => c.capabilityId)) },
      hostPlatform: "linux",
      migrate: true,
    }),
    /retired_runtime_capability_required:runtime:core/,
  );
});
