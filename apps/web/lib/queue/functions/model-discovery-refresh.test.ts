import { describe, expect, it } from "vitest";
import { scheduledModelDiscoveryStatus } from "./model-discovery-refresh";

describe("scheduledModelDiscoveryStatus", () => {
  it("records partial when any provider failed", () => {
    expect(scheduledModelDiscoveryStatus({
      acquired: true,
      outcomes: [
        { providerId: "codex", status: "failed", error: "unavailable" },
        { providerId: "openai", status: "ok", discovered: 3, profiled: 3 },
      ],
    })).toBe("partial");
  });

  it("records ok only when every attempted provider succeeded", () => {
    expect(scheduledModelDiscoveryStatus({
      acquired: true,
      outcomes: [{ providerId: "codex", status: "ok", discovered: 6, profiled: 6 }],
    })).toBe("ok");
  });
});
