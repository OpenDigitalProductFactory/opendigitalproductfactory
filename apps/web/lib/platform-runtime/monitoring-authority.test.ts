import { describe, expect, it } from "vitest";

import { decideMonitoringAuthority, readMonitoringAuthority } from "./monitoring-authority";

describe("decideMonitoringAuthority", () => {
  it("is off when install state does not enable deep observability and no collector runs", () => {
    expect(decideMonitoringAuthority({ enabledRuntimeCapabilities: ["runtime:core"] }, {})).toBe("off");
  });

  it("is on when install state enables deep observability", () => {
    expect(decideMonitoringAuthority({ enabledRuntimeCapabilities: ["runtime:core", "runtime:deep-observability"] }, {})).toBe("on");
  });

  it("is on when a prometheus container exists even though install state disagrees", () => {
    expect(decideMonitoringAuthority(
      { enabledRuntimeCapabilities: ["runtime:core"] },
      { prometheus: { composePresent: true, healthy: true } },
    )).toBe("on");
  });

  it("is unknown when install state cannot be read", () => {
    expect(decideMonitoringAuthority(null, {})).toBe("unknown");
  });
});

describe("readMonitoringAuthority", () => {
  it("reads install state and observed services through its dependencies", async () => {
    await expect(readMonitoringAuthority({
      readInstallSnapshot: async () => ({ enabledRuntimeCapabilities: ["runtime:core"] }),
      readObservedServices: async () => ({}),
    })).resolves.toBe("off");
  });

  it("reports unknown, not off, when install state is unreadable", async () => {
    await expect(readMonitoringAuthority({
      readInstallSnapshot: async () => { throw new Error("ENOENT"); },
      readObservedServices: async () => ({}),
    })).resolves.toBe("unknown");
  });
});
