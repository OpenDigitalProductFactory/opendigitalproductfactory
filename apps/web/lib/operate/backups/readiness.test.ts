import { describe, expect, it } from "vitest";
import { projectCapabilityBackupReadiness } from "./readiness";

describe("projectCapabilityBackupReadiness", () => {
  it("uses operational state instead of a consumer-owned service list", () => {
    expect(projectCapabilityBackupReadiness("browser-use", {
      backupServices: ["postgres"],
      serviceStates: { "browser-use": "optional_inactive" },
    })).toEqual({ target: "browser-use", status: "optional_inactive" });

    expect(projectCapabilityBackupReadiness("browser-use", {
      backupServices: ["postgres", "browser-use"],
      serviceStates: { "browser-use": "optional_degraded" },
    })).toEqual({ target: "browser-use", status: "optional_degraded" });
  });
});
