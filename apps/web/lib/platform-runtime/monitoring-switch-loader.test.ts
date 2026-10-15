import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import catalogSeed from "../../../../scripts/capability-service-catalog.generated.json";
import { loadMonitoringSwitchView, monitoringBudgetCost } from "./monitoring-switch-loader";

const catalog = catalogSeed as { catalogHash: string; capabilities: Array<{ capabilityId: string }> };
const CATALOG_HASH = catalog.catalogHash;
/** Every catalog capability has a record, as the reconciliation contract requires. */
function rows(active: string[]) {
  return catalog.capabilities.map(({ capabilityId }) => ({ capabilityId, state: (active.includes(capabilityId) ? "active" : "disabled") as "active" | "disabled" }));
}

const fullBudget = {
  optionalProfileServices: {
    prometheus: { memory: "1g", cpus: "0.5" },
    grafana: { memory: "512m", cpus: "0.5" },
    "postgres-exporter": { memory: "128m", cpus: "0.25" },
  },
};

const coreStates = rows(["runtime:core"]);

describe("monitoringBudgetCost", () => {
  it("sums the three monitoring services", () => {
    expect(monitoringBudgetCost(fullBudget)).toEqual({ memoryGb: 1.6, cpus: 1.25 });
  });

  it("is null when any service is not budgeted", () => {
    expect(monitoringBudgetCost({ optionalProfileServices: { prometheus: { memory: "1g", cpus: "1" } } })).toBeNull();
    expect(monitoringBudgetCost({})).toBeNull();
    expect(monitoringBudgetCost(null)).toBeNull();
  });
});

describe("loadMonitoringSwitchView", () => {
  it("fails soft when every read throws", async () => {
    const fail = () => Promise.reject(new Error("down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = await loadMonitoringSwitchView({
      readInstallState: fail,
      readCapabilityStates: fail,
      readObservedServices: fail,
      readLatestTransition: fail,
      budgetFile: {},
    });
    errorSpy.mockRestore();
    expect(view.enabledKeys).toBeNull();
    expect(view.state).toMatchObject({ status: "needs-attention", canToggle: false });
    expect(view.cost).toBeNull();
    expect(view.lastChange).toBeNull();
  });

  it("reports off with the decision, cost and last change", async () => {
    const view = await loadMonitoringSwitchView({
      readInstallState: async () => ({
        enabledRuntimeCapabilities: ["runtime:core"],
        capabilityCatalogHash: CATALOG_HASH,
        runtimeCapabilityDecisions: { "runtime:deep-observability": { decision: "disabled", source: "installer-flag", decidedAt: "2026-10-13T00:00:00Z" } },
      }),
      readCapabilityStates: async () => coreStates,
      readObservedServices: async () => ({}),
      readLatestTransition: async () => ({
        transitionId: "RCT-1",
        status: "failed",
        previousKeys: ["runtime:core"],
        desiredKeys: ["runtime:core", "runtime:deep-observability"],
        hostReceipt: { observedServices: ["portal"], completedAt: "2026-10-13T01:00:00Z" },
        failure: "promoter_unavailable",
        completedAt: null,
      }),
      budgetFile: fullBudget,
    });
    expect(view.state).toMatchObject({ status: "off", canToggle: true, undecided: false });
    expect(view.cost).toEqual({ memoryGb: 1.6, cpus: 1.25 });
    expect(view.lastChange).toEqual({ transitionId: "RCT-1", status: "failed", completedAt: "2026-10-13T01:00:00Z", observedServices: ["portal"], failure: "promoter_unavailable" });
  });

  it("shows turning-on while an active transition enables monitoring", async () => {
    const view = await loadMonitoringSwitchView({
      readInstallState: async () => ({ enabledRuntimeCapabilities: ["runtime:core"], capabilityCatalogHash: CATALOG_HASH }),
      readCapabilityStates: async () => coreStates,
      readObservedServices: async () => ({}),
      readLatestTransition: async () => ({
        transitionId: "RCT-2", status: "applying", previousKeys: ["runtime:core"], desiredKeys: ["runtime:core", "runtime:deep-observability"],
        hostReceipt: null, failure: null, completedAt: null,
      }),
      budgetFile: {},
    });
    expect(view.state.status).toBe("turning-on");
  });

  // BI-F0C2E8F5: the live install — host core-only, monitoring row and other
  // seeded rows active, no monitoring containers. Reconciliation repairs the
  // monitoring row, so the switch must not lock.
  it("does not lock when only the records disagree with the host", async () => {
    const view = await loadMonitoringSwitchView({
      readInstallState: async () => ({ enabledRuntimeCapabilities: ["runtime:core"], capabilityCatalogHash: CATALOG_HASH }),
      readCapabilityStates: async () => rows(["runtime:core", "runtime:deep-observability", "runtime:build", "runtime:external-ai"]),
      readObservedServices: async () => ({}),
      readLatestTransition: async () => null,
      budgetFile: {},
    });
    expect(view.state).toMatchObject({ status: "off", canToggle: true, recordMismatch: true });
    expect(view.divergenceSummary).toMatch(/runtime:deep-observability/);
  });

  it("locks as unreconciled when a catalog capability has no record", async () => {
    const view = await loadMonitoringSwitchView({
      readInstallState: async () => ({ enabledRuntimeCapabilities: ["runtime:core"], capabilityCatalogHash: CATALOG_HASH }),
      readCapabilityStates: async () => rows(["runtime:core"]).filter((row) => row.capabilityId !== "runtime:build"),
      readObservedServices: async () => ({}),
      readLatestTransition: async () => null,
      budgetFile: {},
    });
    expect(view.state).toMatchObject({ status: "unreconciled", canToggle: false, reason: "monitoringSettings.reason.unreconciled" });
  });

  it("locks as unreconciled when install-state was written for another catalog", async () => {
    const view = await loadMonitoringSwitchView({
      readInstallState: async () => ({ enabledRuntimeCapabilities: ["runtime:core"], capabilityCatalogHash: "f".repeat(64) }),
      readCapabilityStates: async () => coreStates,
      readObservedServices: async () => ({}),
      readLatestTransition: async () => null,
      budgetFile: {},
    });
    expect(view.state).toMatchObject({ status: "unreconciled", canToggle: false });
  });
});
