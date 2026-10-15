import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { loadMonitoringSwitchView, monitoringBudgetCost } from "./monitoring-switch-loader";

const fullBudget = {
  optionalProfileServices: {
    prometheus: { memory: "1g", cpus: "0.5" },
    grafana: { memory: "512m", cpus: "0.5" },
    "postgres-exporter": { memory: "128m", cpus: "0.25" },
  },
};

const coreStates = [
  { capabilityId: "runtime:core", state: "active" as const },
  { capabilityId: "runtime:deep-observability", state: "disabled" as const },
];

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
      readInstallState: async () => ({ enabledRuntimeCapabilities: ["runtime:core"] }),
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
});
