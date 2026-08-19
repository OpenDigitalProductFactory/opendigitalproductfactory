import { describe, expect, it } from "vitest";
import {
  INTEGRATION_READINESS_STATES,
  isIntegrationReadinessState,
  normalizeReadinessCapability,
} from "./readiness";

describe("integration readiness descriptor primitives", () => {
  it("recognizes every supported readiness state", () => {
    expect(INTEGRATION_READINESS_STATES).toContain("not-connected");
    expect(INTEGRATION_READINESS_STATES).toContain("dpf-primary-ready");
    expect(isIntegrationReadinessState("read")).toBe(true);
    expect(isIntegrationReadinessState("invented")).toBe(false);
  });

  it("marks unsupported capability states as not mapped", () => {
    const capability = normalizeReadinessCapability({
      key: "vendors",
      label: "Vendors",
      description: "Vendor directory",
      state: "read",
      operatingMode: "integration-led",
      supportedNow: false,
      hiveTag: "hive:aggregate-only",
      nextAction: "Map the QuickBooks Vendor entity.",
    });

    expect(capability.state).toBe("not-mapped");
    expect(capability.supportedNow).toBe(false);
  });

  it("preserves partner-led capabilities even when DPF does not support ownership", () => {
    const capability = normalizeReadinessCapability({
      key: "payroll",
      label: "Payroll",
      description: "Partner-led payroll execution",
      state: "partner-led",
      operatingMode: "partner-led",
      supportedNow: false,
      hiveTag: "hive:aggregate-only",
      nextAction: "Connect the payroll provider.",
    });

    expect(capability.state).toBe("partner-led");
    expect(capability.operatingMode).toBe("partner-led");
  });
});
