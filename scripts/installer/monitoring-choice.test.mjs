// BI-31F11C37 (slice D3 of BI-83260BB3): the installer asks whether to turn
// monitoring on, records who chose it, and never re-asks a recorded choice.
// docs/superpowers/specs/2026-10-13-monitoring-operator-choice-design.md §4-5.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { computeCapabilityStateVersion } from "../lib/capability-state-hash.mjs";
import {
  MONITORING_CAPABILITY,
  applyMonitoringChoice,
  monitoringCost,
  needsMonitoringPrompt,
} from "./monitoring-choice.mjs";

const helper = fileURLToPath(new URL("./monitoring-choice.mjs", import.meta.url));
const resolver = fileURLToPath(new URL("../lib/resolve-capability-compose-profiles.mjs", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const catalog = JSON.parse(await readFile(new URL("../capability-service-catalog.generated.json", import.meta.url), "utf8"));
const budget = JSON.parse(await readFile(new URL("../../config/install-resource-budgets.json", import.meta.url), "utf8"));
const ids = catalog.capabilities.map(({ capabilityId }) => capabilityId);
const NOW = "2026-10-13T12:00:00.000Z";

const base = { schemaVersion: 2, installerVersion: "test", platform: "linux", arch: "amd64" };
// Exactly what Initialize-DpfState / dpf_state_init write on a fresh install.
const fresh = () => ({ ...base, enabledRuntimeCapabilities: [], capabilityCatalogHash: null, capabilityStateVersion: null });
const snapshot = (keys) => {
  const enabled = [...keys].sort();
  return { ...base, enabledRuntimeCapabilities: enabled, capabilityCatalogHash: catalog.catalogHash, capabilityStateVersion: computeCapabilityStateVersion(catalog.catalogHash, enabled, ids) };
};
const decided = (decision, source = "installer-prompt") => ({ [MONITORING_CAPABILITY]: { decision, source, decidedAt: "2026-10-01T00:00:00.000Z" } });

async function stateFile(state) {
  const dir = await mkdtemp(join(tmpdir(), "dpf-monitoring-choice-"));
  const path = join(dir, "install-state.json");
  await writeFile(path, JSON.stringify(state));
  return path;
}
const runNode = (args) => spawnSync(process.execPath, args, { cwd: repoRoot, encoding: "utf8" });
const resolveWrite = (path) => runNode([resolver, "--state", path, "--host", "linux", "--migrate", "--write"]);

// ── cost ────────────────────────────────────────────────────────────────────

test("cost sums prometheus, grafana and postgres-exporter from the budget file", () => {
  assert.deepEqual(monitoringCost(budget), { memoryGiB: 1.625, cpus: 1.75 });
});

test("cost is null when any monitoring service lacks a budget entry", () => {
  const { grafana: _omitted, ...rest } = budget.optionalProfileServices;
  assert.equal(monitoringCost({ ...budget, optionalProfileServices: rest }), null);
  assert.equal(monitoringCost({ ...budget, optionalProfileServices: { ...budget.optionalProfileServices, grafana: { memory: "lots", cpus: "0.5" } } }), null);
  assert.equal(monitoringCost(undefined), null);
});

test("cost CLI prints JSON and the operator-facing text from the shipped budget", () => {
  const json = runNode([helper, "cost"]);
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), { memoryGiB: 1.625, cpus: 1.75 });
  const text = runNode([helper, "cost", "--text"]);
  assert.equal(text.status, 0, text.stderr);
  assert.equal(text.stdout.trim(), "about 1.6 GB memory and 1.75 CPU");
});

// ── needs-prompt ────────────────────────────────────────────────────────────

test("a prompt is needed unless an enabled or disabled decision is recorded", () => {
  assert.equal(needsMonitoringPrompt(fresh()), true);
  assert.equal(needsMonitoringPrompt({ ...fresh(), runtimeCapabilityDecisions: decided("undecided", "upgrade-carried") }), true);
  assert.equal(needsMonitoringPrompt({ ...fresh(), runtimeCapabilityDecisions: decided("enabled") }), false);
  assert.equal(needsMonitoringPrompt({ ...fresh(), runtimeCapabilityDecisions: decided("disabled", "portal") }), false);
  assert.equal(needsMonitoringPrompt(null), true);
});

test("needs-prompt CLI answers true/false from the install-state file", async () => {
  const ask = runNode([helper, "needs-prompt", "--state", await stateFile(fresh())]);
  assert.equal(ask.status, 0, ask.stderr);
  assert.equal(ask.stdout.trim(), "true");
  const skip = runNode([helper, "needs-prompt", "--state", await stateFile({ ...fresh(), runtimeCapabilityDecisions: decided("disabled") })]);
  assert.equal(skip.stdout.trim(), "false");
});

// ── apply (pure) ────────────────────────────────────────────────────────────

test("a recorded enabled/disabled decision is never re-asked or overwritten", () => {
  for (const decision of ["enabled", "disabled"]) {
    const state = { ...snapshot(["runtime:core"]), runtimeCapabilityDecisions: decided(decision) };
    for (const choice of ["on", "off", null]) {
      assert.equal(applyMonitoringChoice(state, { choice, source: "installer-flag", now: NOW, catalog }), state);
    }
  }
});

test("on adds the capability, records the choice and restamps a consistent snapshot", () => {
  const next = applyMonitoringChoice(snapshot(["runtime:core"]), { choice: "on", source: "installer-prompt", now: NOW, catalog });
  assert.deepEqual(next.enabledRuntimeCapabilities, ["runtime:core", MONITORING_CAPABILITY]);
  assert.deepEqual(next.runtimeCapabilityDecisions[MONITORING_CAPABILITY], { decision: "enabled", source: "installer-prompt", decidedAt: NOW });
  assert.equal(next.capabilityCatalogHash, catalog.catalogHash);
  assert.equal(next.capabilityStateVersion, computeCapabilityStateVersion(catalog.catalogHash, next.enabledRuntimeCapabilities, ids));
});

test("off removes the capability and records disabled", () => {
  const next = applyMonitoringChoice(snapshot(["runtime:core", MONITORING_CAPABILITY]), { choice: "off", source: "installer-flag", now: NOW, catalog });
  assert.deepEqual(next.enabledRuntimeCapabilities, ["runtime:core"]);
  assert.deepEqual(next.runtimeCapabilityDecisions[MONITORING_CAPABILITY], { decision: "disabled", source: "installer-flag", decidedAt: NOW });
  assert.equal(next.capabilityStateVersion, computeCapabilityStateVersion(catalog.catalogHash, ["runtime:core"], ids));
});

test("a choice that matches the current set records the decision without touching the snapshot", () => {
  const state = snapshot(["runtime:core"]);
  const next = applyMonitoringChoice(state, { choice: "off", source: "installer-prompt", now: NOW, catalog });
  assert.deepEqual(next.enabledRuntimeCapabilities, state.enabledRuntimeCapabilities);
  assert.equal(next.capabilityStateVersion, state.capabilityStateVersion);
  assert.equal(next.runtimeCapabilityDecisions[MONITORING_CAPABILITY].decision, "disabled");
});

test("headless without a flag leaves the enabled set alone and records undecided", () => {
  const state = snapshot(["runtime:core", MONITORING_CAPABILITY]);
  const next = applyMonitoringChoice(state, { choice: null, source: "headless-default", now: NOW, catalog });
  assert.deepEqual(next.enabledRuntimeCapabilities, state.enabledRuntimeCapabilities);
  assert.equal(next.capabilityStateVersion, state.capabilityStateVersion);
  assert.deepEqual(next.runtimeCapabilityDecisions[MONITORING_CAPABILITY], { decision: "undecided", source: "headless-default", decidedAt: NOW });
});

test("headless keeps an existing undecided record rather than churning it", () => {
  const state = { ...snapshot(["runtime:core"]), runtimeCapabilityDecisions: decided("undecided", "upgrade-carried") };
  assert.equal(applyMonitoringChoice(state, { choice: null, source: "headless-default", now: NOW, catalog }), state);
});

test("an undecided record is replaced by a real choice", () => {
  const state = { ...snapshot(["runtime:core"]), runtimeCapabilityDecisions: decided("undecided", "upgrade-carried") };
  const next = applyMonitoringChoice(state, { choice: "on", source: "installer-prompt", now: NOW, catalog });
  assert.equal(next.runtimeCapabilityDecisions[MONITORING_CAPABILITY].decision, "enabled");
});

test("an edited enabled set is refused, not papered over by the restamp", () => {
  const edited = { ...snapshot(["runtime:core"]), enabledRuntimeCapabilities: ["runtime:build", "runtime:core"] };
  assert.throws(() => applyMonitoringChoice(edited, { choice: "on", source: "installer-flag", now: NOW, catalog }), /^Error: capability_state_stale$/);
});

test("a membership change without the catalog is refused rather than left unstamped", () => {
  assert.throws(() => applyMonitoringChoice(fresh(), { choice: "on", source: "installer-flag", now: NOW }), /capability_catalog_required/);
});

test("invalid choice, source or schema version is refused", () => {
  assert.throws(() => applyMonitoringChoice(fresh(), { choice: "maybe", source: "installer-flag", now: NOW, catalog }), /invalid_monitoring_choice/);
  assert.throws(() => applyMonitoringChoice(fresh(), { choice: "on", source: "portal", now: NOW, catalog }), /invalid_monitoring_source/);
  assert.throws(() => applyMonitoringChoice({ ...fresh(), schemaVersion: 1 }, { choice: "on", source: "installer-flag", now: NOW, catalog }), /install_state_schema_unsupported/);
});

// ── apply CLI + resolver round trip ─────────────────────────────────────────
// The decision is recorded BEFORE the installer's resolver run, so the very
// first compose up starts monitoring when chosen. The resolver's fail-closed
// snapshot checks must accept what apply wrote, on a fresh and an existing state.

for (const [label, initial] of [["fresh initialized state", fresh], ["existing v2 snapshot", () => snapshot(["runtime:core"])]]) {
  for (const choice of ["on", "off"]) {
    test(`apply ${choice} then resolver --migrate --write succeeds on a ${label}`, async () => {
      const path = await stateFile(initial());
      const applied = runNode([helper, "apply", "--state", path, "--choice", choice, "--source", "installer-flag"]);
      assert.equal(applied.status, 0, applied.stderr);
      const resolved = resolveWrite(path);
      assert.equal(resolved.status, 0, resolved.stderr);
      const projection = JSON.parse(resolved.stdout);
      assert.equal(projection.enabledRuntimeCapabilities.includes(MONITORING_CAPABILITY), choice === "on");
      assert.equal(projection.runtimeProfiles.includes("runtime-deep-observability"), choice === "on");
      const stored = JSON.parse(await readFile(path, "utf8"));
      assert.equal(stored.runtimeCapabilityDecisions[MONITORING_CAPABILITY].decision, choice === "on" ? "enabled" : "disabled");
      assert.equal(stored.runtimeCapabilityDecisions[MONITORING_CAPABILITY].source, "installer-flag");
      // A non-migrating read (restart/autostart) accepts the stored snapshot.
      const restart = runNode([resolver, "--state", path, "--host", "linux"]);
      assert.equal(restart.status, 0, restart.stderr);
    });
  }
}

test("apply none (headless) then resolver keeps monitoring off and undecided", async () => {
  const path = await stateFile(fresh());
  const applied = runNode([helper, "apply", "--state", path, "--choice", "none", "--source", "headless-default"]);
  assert.equal(applied.status, 0, applied.stderr);
  const resolved = resolveWrite(path);
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.deepEqual(JSON.parse(resolved.stdout).enabledRuntimeCapabilities, ["runtime:core"]);
  const stored = JSON.parse(await readFile(path, "utf8"));
  assert.equal(stored.runtimeCapabilityDecisions[MONITORING_CAPABILITY].decision, "undecided");
  assert.equal(stored.runtimeCapabilityDecisions[MONITORING_CAPABILITY].source, "headless-default");
});

test("apply on a snapshot from the previous catalog restamps it like --migrate would", async () => {
  const previous = { ...snapshot(["runtime:core"]), capabilityCatalogHash: "0".repeat(64), capabilityStateVersion: "1".repeat(64) };
  const path = await stateFile(previous);
  const applied = runNode([helper, "apply", "--state", path, "--choice", "on", "--source", "installer-prompt"]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(resolveWrite(path).status, 0);
  const stored = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(stored.enabledRuntimeCapabilities, ["runtime:core", MONITORING_CAPABILITY]);
  assert.equal(stored.capabilityCatalogHash, catalog.catalogHash);
});

test("apply CLI refuses unknown arguments and bad values with a stable error", async () => {
  const path = await stateFile(fresh());
  const unknown = runNode([helper, "apply", "--state", path, "--choice", "on", "--source", "installer-flag", "--force"]);
  assert.equal(unknown.status, 2);
  const badChoice = runNode([helper, "apply", "--state", path, "--choice", "yes", "--source", "installer-flag"]);
  assert.equal(badChoice.status, 2);
  assert.match(badChoice.stderr, /invalid_monitoring_choice/);
  const noCommand = runNode([helper]);
  assert.equal(noCommand.status, 2);
  // Nothing was written by the refused calls.
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), fresh());
});
