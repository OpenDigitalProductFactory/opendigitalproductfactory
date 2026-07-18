import { describe, expect, it } from "vitest";

import { projectCapabilityServices } from "./capability-service-projection";

describe("projectCapabilityServices", () => {
  it("excludes disabled optional services", () => {
    const result = projectCapabilityServices({
      enabledRuntimeCapabilities: ["runtime:core"],
      capabilityStates: catalogStates(["runtime:core"]),
    });

    expect(result.requiredServices).toContain("postgres");
    expect(result.requiredServices).not.toContain("browser-use");
    expect(result.inactiveOptionalServices).toContain("browser-use");
  });

  it("retains the manifest backup policy for an enabled stateful service", () => {
    const result = projectCapabilityServices({
      enabledRuntimeCapabilities: ["runtime:browser-automation", "runtime:core"],
      capabilityStates: catalogStates(["runtime:browser-automation", "runtime:core"]),
    });

    expect(result.serviceRequirements.find((item) => item.service === "browser-use")?.backupPolicy).toBe("separate-required");
    expect(result.backupServices).toContain("browser-use");
    expect(result.capabilityBackupCandidates).toContain("browser-use");
  });

  it("keeps included non-core services in the complete capability backup candidate set", () => {
    const result = projectCapabilityServices({
      enabledRuntimeCapabilities: ["runtime:adp-integration", "runtime:core"],
      capabilityStates: catalogStates(["runtime:adp-integration", "runtime:core"]),
    });
    expect(result.backupServices).toContain("adp");
    expect(result.capabilityBackupCandidates).toContain("adp");
  });

  it("never treats provider-managed external runtimes as local backup targets", () => {
    const result = projectCapabilityServices({
      enabledRuntimeCapabilities: ["runtime:core", "runtime:external-ai"],
      capabilityStates: catalogStates(["runtime:core", "runtime:external-ai"]),
    });

    expect(result.externalRuntimes.length).toBeGreaterThan(0);
    expect(result.backupServices).not.toEqual(expect.arrayContaining(result.externalRuntimes.map((item) => item.runtimeKey)));
  });

  it.each([
    ["missing", [{ capabilityId: "runtime:core", state: "active" }], /missing_live_capability/],
    ["duplicate", [{ capabilityId: "runtime:core", state: "active" }, { capabilityId: "runtime:core", state: "active" }], /duplicate_live_capability/],
    ["unknown", [{ capabilityId: "runtime:unknown", state: "active" }], /unknown_live_capability/],
    ["invalid", [{ capabilityId: "runtime:core", state: "inactive" }], /invalid_live_capability_state/],
  ])("fails closed for %s live capability authority", (_label, capabilityStates, error) => {
    expect(() => projectCapabilityServices({
      enabledRuntimeCapabilities: ["runtime:core"],
      capabilityStates: capabilityStates as never,
    })).toThrow(error);
  });
});

const CAPABILITIES = ["runtime:adp-integration", "runtime:browser-automation", "runtime:build", "runtime:core", "runtime:deep-observability", "runtime:development", "runtime:durable-automation", "runtime:external-ai", "runtime:local-speech"];
function catalogStates(enabled: string[]) {
  return CAPABILITIES.map((capabilityId) => ({ capabilityId, state: enabled.includes(capabilityId) ? "active" as const : "disabled" as const }));
}
