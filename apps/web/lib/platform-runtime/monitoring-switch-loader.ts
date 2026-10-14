// BI-8BBFE50B: server loader for /admin/settings/monitoring.
//
// Every read fails soft to "unknown" — the page must render (read-only, with an
// honest reason) when install-state, the database, Docker or the budget file is
// unavailable, rather than throw inside a settings route.
//
// The last change comes from the durable RuntimeCapabilityTransition row, which
// stores the verified host receipt (`hostReceipt`). The executor only reads a
// receipt file by transition id; there is no "latest receipt" helper to reuse.

import { readFile } from "node:fs/promises";
import { prisma } from "@dpf/db";

import budgets from "../../../../config/install-resource-budgets.json";

import type { LiveCapabilityState } from "./capability-service-projection";
import { diagnoseCapabilityStateDivergence } from "./capability-state-divergence";
import { observeDockerProjectServices, type ObservedServiceState } from "./operational-state";
import {
  MONITORING_CAPABILITY,
  MONITORING_SERVICES,
  deriveMonitoringSwitchState,
  type MonitoringDecisionRecord,
  type MonitoringSwitchState,
} from "./monitoring-switch-state";
import { ACTIVE_RUNTIME_TRANSITION_STATUSES } from "./transition-coordinator";

export interface MonitoringCost { memoryGb: number; cpus: number }

export interface MonitoringLastChange {
  transitionId: string;
  status: string;
  completedAt: string | null;
  observedServices: string[];
  failure: string | null;
}

export interface MonitoringSwitchView {
  state: MonitoringSwitchState;
  /** Enabled keys from install-state; null when unreadable. */
  enabledKeys: string[] | null;
  enabled: boolean;
  cost: MonitoringCost | null;
  divergenceSummary: string | null;
  lastChange: MonitoringLastChange | null;
}

interface InstallStateFile {
  enabledRuntimeCapabilities?: unknown;
  runtimeCapabilityDecisions?: Record<string, unknown>;
}

interface TransitionRow {
  transitionId: string;
  status: string;
  previousKeys: string[];
  desiredKeys: string[];
  hostReceipt: unknown;
  failure: unknown;
  completedAt: Date | null;
}

export interface MonitoringLoaderDeps {
  readInstallState?: () => Promise<InstallStateFile>;
  readCapabilityStates?: () => Promise<LiveCapabilityState[]>;
  readObservedServices?: () => Promise<Record<string, ObservedServiceState>>;
  readLatestTransition?: () => Promise<TransitionRow | null>;
  budgetFile?: unknown;
}

function parseQuantity(value: unknown, unit: "memory" | "cpus"): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim().toLowerCase();
  if (unit === "cpus") {
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  const match = /^(\d+(?:\.\d+)?)([kmg])?b?$/.exec(text);
  if (!match) return null;
  const n = Number(match[1]);
  const factor = match[2] === "g" ? 1 : match[2] === "m" ? 1 / 1024 : match[2] === "k" ? 1 / (1024 * 1024) : 1 / (1024 ** 3);
  return n * factor;
}

/**
 * Sum the budgeted memory/CPU of the three monitoring services from
 * `config/install-resource-budgets.json` `optionalProfileServices`. Null unless
 * all three are budgeted — a partial sum would understate the cost.
 */
export function monitoringBudgetCost(budgetFile: unknown): MonitoringCost | null {
  const services = (budgetFile as { optionalProfileServices?: Record<string, { memory?: unknown; cpus?: unknown }> } | null)?.optionalProfileServices;
  if (!services || typeof services !== "object") return null;
  let memoryGb = 0;
  let cpus = 0;
  for (const name of MONITORING_SERVICES) {
    const entry = services[name];
    const memory = parseQuantity(entry?.memory, "memory");
    const cpu = parseQuantity(entry?.cpus, "cpus");
    if (memory === null || cpu === null) return null;
    memoryGb += memory;
    cpus += cpu;
  }
  return { memoryGb: Math.round(memoryGb * 10) / 10, cpus: Math.round(cpus * 100) / 100 };
}

function readDecision(file: InstallStateFile | null): MonitoringDecisionRecord | null {
  const raw = file?.runtimeCapabilityDecisions?.[MONITORING_CAPABILITY];
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.decision !== "string") return null;
  return {
    decision: record.decision,
    source: typeof record.source === "string" ? record.source : null,
    decidedAt: typeof record.decidedAt === "string" ? record.decidedAt : null,
  };
}

function togglesMonitoring(row: TransitionRow): "enabling" | "disabling" | null {
  const before = row.previousKeys.includes(MONITORING_CAPABILITY);
  const after = row.desiredKeys.includes(MONITORING_CAPABILITY);
  if (before === after) return null;
  return after ? "enabling" : "disabling";
}

function failureText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && typeof (value as { failure?: unknown }).failure === "string") return (value as { failure: string }).failure;
  return JSON.stringify(value);
}

async function soft<T>(read: () => Promise<T>, fallback: T, source: string): Promise<T> {
  try {
    return await read();
  } catch {
    console.error("[monitoring-settings] read unavailable", { event: "monitoring_settings_read_unavailable", source });
    return fallback;
  }
}

export async function loadMonitoringSwitchView(deps: MonitoringLoaderDeps = {}): Promise<MonitoringSwitchView> {
  const readInstallState = deps.readInstallState ?? (async () =>
    JSON.parse(await readFile("/dpf-state/install-state.json", "utf8")) as InstallStateFile);
  const readCapabilityStates = deps.readCapabilityStates ?? (async () => {
    const rows = await prisma.platformCapability.findMany({
      where: { capabilityId: { startsWith: "runtime:" } },
      select: { capabilityId: true, state: true },
    });
    return rows.map((row) => ({ capabilityId: row.capabilityId, state: row.state as LiveCapabilityState["state"] }));
  });
  const readObservedServices = deps.readObservedServices ?? (() => observeDockerProjectServices());
  const readLatestTransition = deps.readLatestTransition ?? (() =>
    prisma.runtimeCapabilityTransition.findFirst({
      orderBy: { createdAt: "desc" },
      select: { transitionId: true, status: true, previousKeys: true, desiredKeys: true, hostReceipt: true, failure: true, completedAt: true },
    }));

  const [installState, capabilityStates, observed, latest] = await Promise.all([
    soft<InstallStateFile | null>(readInstallState, null, "install-state"),
    soft<LiveCapabilityState[] | null>(readCapabilityStates, null, "capability-states"),
    soft<Record<string, ObservedServiceState>>(readObservedServices, {}, "docker"),
    soft<TransitionRow | null>(readLatestTransition, null, "transitions"),
  ]);

  const rawEnabled = installState?.enabledRuntimeCapabilities;
  const enabledKeys = Array.isArray(rawEnabled) && rawEnabled.every((key) => typeof key === "string")
    ? (rawEnabled as string[])
    : null;

  const dbState = capabilityStates?.find((row) => row.capabilityId === MONITORING_CAPABILITY)?.state ?? null;

  // Only a directional disagreement (or no row for monitoring itself) locks the
  // switch; the coordinator compares exactly these two authorities.
  let divergent = false;
  let divergenceSummary: string | null = null;
  if (enabledKeys && capabilityStates) {
    const report = diagnoseCapabilityStateDivergence({ enabledRuntimeCapabilities: enabledKeys, capabilityStates });
    divergent = report.divergences.some((entry) =>
      entry.kind !== "missing-live-state" || entry.capabilityId === MONITORING_CAPABILITY);
    divergenceSummary = divergent ? report.summary : null;
  }

  const pendingTransition = latest && (ACTIVE_RUNTIME_TRANSITION_STATUSES as readonly string[]).includes(latest.status)
    ? togglesMonitoring(latest)
    : null;

  const state = deriveMonitoringSwitchState({
    installEnabled: enabledKeys,
    dbState,
    observed,
    decision: readDecision(installState),
    divergent,
    pendingTransition,
  });

  const receipt = latest?.hostReceipt && typeof latest.hostReceipt === "object"
    ? (latest.hostReceipt as { observedServices?: unknown; completedAt?: unknown; failure?: unknown })
    : null;
  const lastChange: MonitoringLastChange | null = latest
    ? {
        transitionId: latest.transitionId,
        status: latest.status,
        completedAt: latest.completedAt?.toISOString() ?? (typeof receipt?.completedAt === "string" ? receipt.completedAt : null),
        observedServices: Array.isArray(receipt?.observedServices)
          ? receipt.observedServices.filter((service): service is string => typeof service === "string")
          : [],
        failure: failureText(latest.failure) ?? failureText(receipt?.failure),
      }
    : null;

  return {
    state,
    enabledKeys,
    enabled: enabledKeys?.includes(MONITORING_CAPABILITY) ?? false,
    cost: monitoringBudgetCost(deps.budgetFile ?? budgets),
    divergenceSummary,
    lastChange,
  };
}
