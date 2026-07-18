import { describe, expect, it } from "vitest";

import { projectCapabilityServices } from "./capability-service-projection";

describe("projectCapabilityServices", () => {
  it("excludes disabled optional services", () => {
    const result = projectCapabilityServices({
      enabledRuntimeCapabilities: ["runtime:core"],
      capabilityStates: [{ capabilityId: "runtime:core", state: "active" }],
    });

    expect(result.requiredServices).toContain("postgres");
    expect(result.requiredServices).not.toContain("browser-use");
    expect(result.inactiveOptionalServices).toContain("browser-use");
  });

  it("retains the manifest backup policy for an enabled stateful service", () => {
    const result = projectCapabilityServices({
      enabledRuntimeCapabilities: ["runtime:browser-automation", "runtime:core"],
      capabilityStates: [
        { capabilityId: "runtime:browser-automation", state: "active" },
        { capabilityId: "runtime:core", state: "active" },
      ],
    });

    expect(result.serviceRequirements.find((item) => item.service === "browser-use")?.backupPolicy).toBe("separate-required");
    expect(result.backupServices).toContain("browser-use");
  });

  it("never treats provider-managed external runtimes as local backup targets", () => {
    const result = projectCapabilityServices({
      enabledRuntimeCapabilities: ["runtime:core", "runtime:external-ai"],
      capabilityStates: [
        { capabilityId: "runtime:core", state: "active" },
        { capabilityId: "runtime:external-ai", state: "active" },
      ],
    });

    expect(result.externalRuntimes.length).toBeGreaterThan(0);
    expect(result.backupServices).not.toEqual(expect.arrayContaining(result.externalRuntimes.map((item) => item.runtimeKey)));
  });
});
