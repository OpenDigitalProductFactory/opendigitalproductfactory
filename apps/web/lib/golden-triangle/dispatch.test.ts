import { describe, expect, it } from "vitest";

import type { GoldenTrianglePreference } from "@/lib/golden-triangle";

import {
  resolveDispatchPosture,
  resolveDispatchPostures,
} from "./dispatch";
import type { GoldenTrianglePersistenceClient } from "./persistence";

const ASSURED: GoldenTrianglePreference = { preset: "assured", qualityWeight: 0.8, costWeight: 0.1, timeWeight: 0.1 };
const FRUGAL: GoldenTrianglePreference = { preset: "frugal", qualityWeight: 0.1, costWeight: 0.8, timeWeight: 0.1 };
const BALANCED: GoldenTrianglePreference = { preset: "balanced", qualityWeight: 0.34, costWeight: 0.33, timeWeight: 0.33 };

/** Fake client over the single platform-profile row that holds both the platform
 *  default (goldenTriangle) and the per-agent map (goldenTrianglePerAgent). */
function client(opts: { platform?: GoldenTrianglePreference; perAgent?: Record<string, GoldenTrianglePreference> }): GoldenTrianglePersistenceClient {
  const policy: Record<string, unknown> = {};
  if (opts.platform) policy.goldenTriangle = opts.platform;
  if (opts.perAgent) policy.goldenTrianglePerAgent = opts.perAgent;
  return {
    decisionPerspectiveProfile: {
      findFirst: async () => (Object.keys(policy).length ? { autonomyPolicy: policy } : null),
      updateMany: async () => ({ count: 0 }),
    },
  };
}

describe("resolveDispatchPosture", () => {
  it("returns null when no default is saved (inert)", async () => {
    expect(await resolveDispatchPosture(null, "conversation", null, client({}))).toBeNull();
  });

  it("returns null for a Balanced default — byte-identical to flag-off", async () => {
    expect(await resolveDispatchPosture(null, "conversation", null, client({ platform: BALANCED }))).toBeNull();
  });

  it("applies the platform posture for a non-coworker run", async () => {
    const p = await resolveDispatchPosture(null, "conversation", null, client({ platform: ASSURED }));
    expect(p?.preset).toBe("assured");
    expect(p?.source).toBe("platform");
    expect(p?.routeContext.minimumTier).toBe("frontier");
  });

  it("lets a coworker's own posture override the platform default", async () => {
    const p = await resolveDispatchPosture("agent-x", "conversation", null, client({ platform: BALANCED, perAgent: { "agent-x": ASSURED } }));
    expect(p?.source).toBe("agent");
    expect(p?.preset).toBe("assured");
    expect(p?.routeContext.minimumTier).toBe("frontier");
  });

  it("falls back to the platform default when the coworker has no own posture", async () => {
    const p = await resolveDispatchPosture("agent-x", "conversation", null, client({ platform: ASSURED, perAgent: { other: FRUGAL } }));
    expect(p?.source).toBe("platform");
    expect(p?.preset).toBe("assured");
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
    expect(await resolveDispatchPosture("agent-x", "conversation", null, throwing)).toBeNull();
  });

  it("bulk-resolves coworker postures from one platform-profile read", async () => {
    let reads = 0;
    const base = client({
      platform: FRUGAL,
      perAgent: { "agent-x": ASSURED },
    });
    const cached: GoldenTrianglePersistenceClient = {
      decisionPerspectiveProfile: {
        findFirst: async (args) => {
          reads += 1;
          return base.decisionPerspectiveProfile.findFirst(args);
        },
        updateMany: base.decisionPerspectiveProfile.updateMany,
      },
    };

    const postures = await resolveDispatchPostures(
      ["agent-x", "agent-y"],
      "conversation",
      cached,
    );

    expect(reads).toBe(1);
    expect(postures.get("agent-x")?.preset).toBe("assured");
    expect(postures.get("agent-y")?.preset).toBe("frugal");
  });
});
