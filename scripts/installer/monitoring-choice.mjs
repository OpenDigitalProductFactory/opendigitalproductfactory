#!/usr/bin/env node
// Installer monitoring question (BI-31F11C37, slice D3 of BI-83260BB3).
// docs/superpowers/specs/2026-10-13-monitoring-operator-choice-design.md §4-5.
//
// The installers (install-dpf.ps1, install-dpf.sh) ask one question — turn
// monitoring on? — and record the answer here, BEFORE the capability resolver
// runs, so the first `compose up` starts monitoring when it was chosen.
//
//   cost         [--budget <path>] [--text]   cost of monitoring when on
//   needs-prompt --state <path>               true unless a choice is recorded
//   apply        --state <path> --choice on|off|none --source <src> [--catalog <path>]
//
// The cost is computed from config/install-resource-budgets.json, never
// hard-coded in the installers. A recorded enabled/disabled decision is never
// re-asked or overwritten; changing it later is the portal's job.
import { parseArgs as utilParseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseMemoryBytes } from "../check-compose-resource-budgets.mjs";
import { computeCapabilityStateVersion } from "../lib/capability-state-hash.mjs";
import { resolveCapabilityComposeProfiles } from "../lib/resolve-capability-compose-profiles.mjs";
import { scriptArgv } from "../lib/script-argv.mjs";

export const MONITORING_CAPABILITY = "runtime:deep-observability";
export const MONITORING_SERVICES = Object.freeze(["prometheus", "grafana", "postgres-exporter"]);
const CHOICES = new Set(["on", "off", null]);
const SOURCES = new Set(["installer-prompt", "installer-flag", "headless-default"]);
const GIB = 1024 ** 3;

/** Memory (GiB) and CPUs monitoring reserves when on; null if any budget entry is missing or unreadable. */
export function monitoringCost(budget) {
  let bytes = 0;
  let cpus = 0;
  for (const service of MONITORING_SERVICES) {
    const entry = budget?.optionalProfileServices?.[service];
    const memory = parseMemoryBytes(entry?.memory);
    const cpu = Number(entry?.cpus);
    if (memory === null || !Number.isFinite(cpu) || entry?.cpus === undefined) return null;
    bytes += memory;
    cpus += cpu;
  }
  return { memoryGiB: bytes / GIB, cpus: Math.round(cpus * 100) / 100 };
}

/** The installer prompt's cost phrase, e.g. "about 1.6 GB memory and 1.75 CPU". */
export function monitoringCostText(cost) {
  return `about ${(Math.round(cost.memoryGiB * 10) / 10).toString()} GB memory and ${cost.cpus.toString()} CPU`;
}

const recordedDecision = (state) => state?.runtimeCapabilityDecisions?.[MONITORING_CAPABILITY]?.decision;

/** True unless a person (or the portal) already chose enabled/disabled. */
export function needsMonitoringPrompt(state) {
  const decision = recordedDecision(state);
  return decision !== "enabled" && decision !== "disabled";
}

/**
 * Record the installer's monitoring choice in install-state. Returns the same
 * object when nothing changes.
 *
 * When the choice changes membership of enabledRuntimeCapabilities, the
 * capability snapshot is restamped — but only after the CURRENT snapshot passes
 * the resolver's own checks (with --migrate semantics: a catalog moved by a
 * release is restamped, an enabled set edited without restamping still fails
 * closed). The resolver refuses a non-empty unstamped set, so leaving the
 * restamp to it is not an option.
 */
export function applyMonitoringChoice(state, { choice, source, now = new Date().toISOString(), catalog } = {}) {
  if (!CHOICES.has(choice)) throw new Error(`invalid_monitoring_choice:${choice}`);
  if (!SOURCES.has(source)) throw new Error(`invalid_monitoring_source:${source}`);
  if (!needsMonitoringPrompt(state)) return state;
  // An existing undecided record already says "nobody chose"; do not churn it.
  if (choice === null && recordedDecision(state) === "undecided") return state;
  if (!(state?.schemaVersion >= 2)) throw new Error("install_state_schema_unsupported");

  const decision = choice === "on" ? "enabled" : choice === "off" ? "disabled" : "undecided";
  const runtimeCapabilityDecisions = {
    ...(state.runtimeCapabilityDecisions ?? {}),
    [MONITORING_CAPABILITY]: { decision, source: choice === null ? "headless-default" : source, decidedAt: now },
  };
  const current = Array.isArray(state.enabledRuntimeCapabilities) ? state.enabledRuntimeCapabilities : null;
  const wantOn = choice === "on";
  if (choice === null || (current && current.includes(MONITORING_CAPABILITY) === wantOn)) {
    return { ...state, runtimeCapabilityDecisions };
  }

  if (!catalog) throw new Error("capability_catalog_required");
  const validated = resolveCapabilityComposeProfiles({ catalog, state, migrate: true });
  const enabledRuntimeCapabilities = [...new Set(wantOn
    ? [...validated.enabledRuntimeCapabilities, MONITORING_CAPABILITY]
    : validated.enabledRuntimeCapabilities.filter((id) => id !== MONITORING_CAPABILITY))].sort();
  const next = {
    ...state,
    enabledRuntimeCapabilities,
    capabilityCatalogHash: catalog.catalogHash,
    capabilityStateVersion: computeCapabilityStateVersion(catalog.catalogHash, enabledRuntimeCapabilities, catalog.capabilities.map(({ capabilityId }) => capabilityId)),
    runtimeCapabilityDecisions,
  };
  // The written snapshot must satisfy a non-migrating read (restart/autostart).
  resolveCapabilityComposeProfiles({ catalog, state: next });
  return next;
}

const readJson = async (path) => JSON.parse((await readFile(path, "utf8")).replace(/^﻿/, ""));

async function main() {
  const { values, positionals } = utilParseArgs({
    args: scriptArgv(),
    allowPositionals: true,
    strict: true,
    options: {
      state: { type: "string" },
      budget: { type: "string" },
      catalog: { type: "string" },
      choice: { type: "string" },
      source: { type: "string" },
      text: { type: "boolean" },
    },
  });
  const scriptsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const [command, ...extra] = positionals;
  if (extra.length > 0) throw new Error(`unknown_argument:${extra[0]}`);
  if (command === "cost") {
    const cost = monitoringCost(await readJson(resolve(values.budget ?? resolve(scriptsDir, "..", "config", "install-resource-budgets.json"))));
    if (!cost) throw new Error("monitoring_budget_missing");
    process.stdout.write(values.text ? `${monitoringCostText(cost)}\n` : `${JSON.stringify(cost)}\n`);
    return;
  }
  if (!values.state) throw new Error("missing_install_state");
  const statePath = resolve(values.state);
  if (command === "needs-prompt") {
    process.stdout.write(`${needsMonitoringPrompt(await readJson(statePath))}\n`);
    return;
  }
  if (command === "apply") {
    const choice = values.choice === "none" ? null : values.choice;
    if (!CHOICES.has(choice ?? null) || values.choice === undefined) throw new Error(`invalid_monitoring_choice:${values.choice}`);
    if (!SOURCES.has(values.source)) throw new Error(`invalid_monitoring_source:${values.source}`);
    const catalog = await readJson(resolve(values.catalog ?? resolve(scriptsDir, "capability-service-catalog.generated.json")));
    const { updateInstallState } = await import("./install-state-transaction.mjs");
    let result;
    await updateInstallState(statePath, (current) => {
      result = applyMonitoringChoice(current, { choice, source: values.source, catalog });
      return result;
    });
    process.stdout.write(`${JSON.stringify(result.runtimeCapabilityDecisions?.[MONITORING_CAPABILITY] ?? null)}\n`);
    return;
  }
  throw new Error(`unknown_command:${command ?? ""}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
