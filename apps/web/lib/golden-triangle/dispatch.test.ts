import { describe, expect, it } from "vitest";

import type { GoldenTrianglePreference } from "@/lib/golden-triangle";

import { resolveDispatchPosture } from "./dispatch";
import type { GoldenTrianglePersistenceClient } from "./persistence";

const ASSURED: GoldenTrianglePreference = { preset: "assured", qualityWeight: 0.8, costWeight: 0.1, timeWeight: 0.1 };
const BALANCED: GoldenTrianglePreference = { preset: "balanced", qualityWeight: 0.34, costWeight: 0.33, timeWeight: 0.33 };

function clientWith(platform: GoldenTrianglePreference | null): GoldenTrianglePersistenceClient {
  return {
    decisionPerspectiveProfile: {
      findFirst: async () => (platform ? { autonomyPolicy: { goldenTriangle: platform } } : null),
      updateMany: async () => ({ count: 0 }),
    },
  };
}

describe("resolveDispatchPosture", () => {
  it("returns null when no default is saved (inert)", async () => {
    expect(await resolveDispatchPosture(null, "conversation", clientWith(null))).toBeNull();
  });

  it("returns null for a Balanced default — byte-identical to flag-off", async () => {
    expect(await resolveDispatchPosture(null, "conversation", clientWith(BALANCED))).toBeNull();
  });

  it("applies a non-Balanced posture as routing overrides", async () => {
    const p = await resolveDispatchPosture(null, "conversation", clientWith(ASSURED));
    expect(p).not.toBeNull();
    expect(p?.preset).toBe("assured");
    expect(p?.source).toBe("platform");
    expect(p?.routeContext.minimumTier).toBe("frontier");
  });

  it("is fail-open: returns null when the db throws", async () => {
    const throwing: GoldenTrianglePersistenceClient = {
      decisionPerspectiveProfile: {
        findFirst: async () => {
          throw new Error("db down");
        },
        updateMany: async () => ({ count: 0 }),
      },
    };
    expect(await resolveDispatchPosture(null, "conversation", throwing)).toBeNull();
  });
});
