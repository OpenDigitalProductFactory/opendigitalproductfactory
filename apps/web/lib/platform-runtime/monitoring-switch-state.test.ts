import { describe, expect, it } from "vitest";

import {
  MONITORING_CAPABILITY,
  MONITORING_SERVICES,
  deriveMonitoringSwitchState,
  type MonitoringSwitchInput,
} from "./monitoring-switch-state";

const allUp = {
  prometheus: { composePresent: true, healthy: true },
  grafana: { composePresent: true, healthy: null },
  "postgres-exporter": { composePresent: true, healthy: true },
};

function input(overrides: Partial<MonitoringSwitchInput> = {}): MonitoringSwitchInput {
  return {
    installEnabled: ["runtime:core"],
    dbState: "disabled",
    observed: {},
    decision: null,
    divergent: false,
    pendingTransition: null,
    ...overrides,
  };
}

describe("deriveMonitoringSwitchState", () => {
  it("names the capability and its three services", () => {
    expect(MONITORING_CAPABILITY).toBe("runtime:deep-observability");
    expect([...MONITORING_SERVICES]).toEqual(["prometheus", "grafana", "postgres-exporter"]);
  });

  it("is on when install-state enables it and all three services run", () => {
    const state = deriveMonitoringSwitchState(input({
      installEnabled: ["runtime:core", MONITORING_CAPABILITY],
      dbState: "active",
      observed: allUp,
    }));
    expect(state).toMatchObject({ status: "on", canToggle: true, reason: null, missingServices: [] });
  });

  it("is off when install-state does not enable it and none of the services exist", () => {
    const state = deriveMonitoringSwitchState(input({ observed: { portal: { composePresent: true, healthy: true } } }));
    expect(state).toMatchObject({ status: "off", canToggle: true, reason: null, missingServices: [] });
  });

  it("needs attention when enabled but a service is absent or unhealthy, naming them", () => {
    const state = deriveMonitoringSwitchState(input({
      installEnabled: [MONITORING_CAPABILITY],
      dbState: "active",
      observed: { prometheus: { composePresent: true, healthy: false }, grafana: { composePresent: true, healthy: true } },
    }));
    expect(state.status).toBe("needs-attention");
    expect(state.missingServices).toEqual(["prometheus", "postgres-exporter"]);
    expect(state.reason).toBe("monitoringSettings.reason.enabledMissing");
    expect(state.canToggle).toBe(true);
  });

  it("needs attention when disabled but some services still run, naming them", () => {
    const state = deriveMonitoringSwitchState(input({ observed: { grafana: { composePresent: true, healthy: true } } }));
    expect(state.status).toBe("needs-attention");
    expect(state.missingServices).toEqual(["grafana"]);
    expect(state.reason).toBe("monitoringSettings.reason.disabledRunning");
  });

  it("is unreconciled and locked when the two authorities disagree", () => {
    const state = deriveMonitoringSwitchState(input({ observed: allUp, divergent: true }));
    expect(state).toMatchObject({ status: "unreconciled", canToggle: false, reason: "monitoringSettings.reason.unreconciled" });
  });

  it("treats a DB row that disagrees with install-state about monitoring as unreconciled", () => {
    const state = deriveMonitoringSwitchState(input({ installEnabled: [MONITORING_CAPABILITY], dbState: "disabled", observed: allUp }));
    expect(state.status).toBe("unreconciled");
    expect(state.canToggle).toBe(false);
  });

  it("locks the switch while a transition is in flight", () => {
    expect(deriveMonitoringSwitchState(input({ pendingTransition: "enabling" }))).toMatchObject({ status: "turning-on", canToggle: false, reason: "monitoringSettings.reason.inFlight" });
    expect(deriveMonitoringSwitchState(input({ pendingTransition: "disabling", divergent: true }))).toMatchObject({ status: "turning-off", canToggle: false });
  });

  it("cannot toggle when install-state is unreadable", () => {
    const state = deriveMonitoringSwitchState(input({ installEnabled: null }));
    expect(state).toMatchObject({ status: "needs-attention", canToggle: false, reason: "monitoringSettings.reason.installUnknown" });
  });

  it("reports undecided when no decision is recorded or it says undecided", () => {
    expect(deriveMonitoringSwitchState(input()).undecided).toBe(true);
    expect(deriveMonitoringSwitchState(input({ decision: { decision: "undecided", source: "upgrade-carried", decidedAt: null } })).undecided).toBe(true);
    expect(deriveMonitoringSwitchState(input({ decision: { decision: "disabled", source: "installer-flag", decidedAt: "2026-10-13T00:00:00Z" } })).undecided).toBe(false);
  });
});
