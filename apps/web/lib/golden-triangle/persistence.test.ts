import { describe, expect, it } from "vitest";

import type { GoldenTrianglePreference } from "@/lib/golden-triangle";

import {
  clearAgentGoldenTrianglePosture,
  getAgentGoldenTrianglePosture,
  getEffectiveGoldenTrianglePosture,
  getEffectivePostureForAgent,
  getGoldenTrianglePosture,
  isGoldenTrianglePreference,
  setAgentGoldenTrianglePosture,
  setGoldenTrianglePosture,
  type GoldenTrianglePersistenceClient,
} from "./persistence";

const ASSURED: GoldenTrianglePreference = { preset: "assured", qualityWeight: 0.8, costWeight: 0.1, timeWeight: 0.1 };
const FRUGAL: GoldenTrianglePreference = { preset: "frugal", qualityWeight: 0.1, costWeight: 0.8, timeWeight: 0.1 };

/** A where-aware fake: returns different stored postures for the platform vs org profile rows. */
function scopedClient(byScope: { platform?: GoldenTrianglePreference; org?: GoldenTrianglePreference }): GoldenTrianglePersistenceClient {
  return {
    decisionPerspectiveProfile: {
      findFirst: async (args) => {
        const where = (args as { where: Record<string, unknown> }).where;
        const pref = "profileId" in where ? byScope.platform : byScope.org;
        return pref ? { autonomyPolicy: { goldenTriangle: pref } } : null;
      },
      updateMany: async () => ({ count: 1 }),
    },
  };
}

interface Calls {
  findFirst: unknown[];
  updateMany: Array<{ where: unknown; data: { autonomyPolicy: Record<string, unknown> } }>;
}

function makeClient(initialPolicy: unknown = null) {
  let policy: unknown = initialPolicy;
  const calls: Calls = { findFirst: [], updateMany: [] };
  const client: GoldenTrianglePersistenceClient = {
    decisionPerspectiveProfile: {
      findFirst: async (args) => {
        calls.findFirst.push(args);
        return policy === null ? null : { autonomyPolicy: policy };
      },
      updateMany: async (args) => {
        const a = args as { where: unknown; data: { autonomyPolicy: Record<string, unknown> } };
        calls.updateMany.push(a);
        policy = a.data.autonomyPolicy;
        return { count: 1 };
      },
    },
  };
  return { client, calls, getPolicy: () => policy };
}

function throwingClient(): GoldenTrianglePersistenceClient {
  return {
    decisionPerspectiveProfile: {
      findFirst: async () => {
        throw new Error("db down");
      },
      updateMany: async () => {
        throw new Error("db down");
      },
    },
  };
}

describe("setGoldenTrianglePosture", () => {
  it("writes the posture onto the platform profile under goldenTriangle", async () => {
    const { client, calls } = makeClient();
    const ok = await setGoldenTrianglePosture({ kind: "platform" }, ASSURED, client);
    expect(ok).toBe(true);
    expect(calls.updateMany[0]?.where).toEqual({ profileId: "mark-dpf-platform" });
    expect(calls.updateMany[0]?.data.autonomyPolicy.goldenTriangle).toEqual(ASSURED);
  });

  it("preserves existing autonomyPolicy keys when merging", async () => {
    const { client, getPolicy } = makeClient({ allowRecommendation: true, allowArbitration: false });
    await setGoldenTrianglePosture({ kind: "platform" }, ASSURED, client);
    expect(getPolicy()).toMatchObject({
      allowRecommendation: true,
      allowArbitration: false,
      goldenTriangle: ASSURED,
    });
  });

  it("targets the org profile for an organization scope", async () => {
    const { client, calls } = makeClient();
    await setGoldenTrianglePosture({ kind: "organization", organizationId: "org_1" }, ASSURED, client);
    expect(calls.updateMany[0]?.where).toEqual({ ownerOrganizationId: "org_1", kind: "organization" });
  });

  it("is fail-open: returns false when the db throws", async () => {
    const ok = await setGoldenTrianglePosture({ kind: "platform" }, ASSURED, throwingClient());
    expect(ok).toBe(false);
  });
});

describe("clearAgentGoldenTrianglePosture", () => {
  it("removes only the target coworker's entry, preserving the rest of the per-agent map", async () => {
    const { client, getPolicy } = makeClient({
      goldenTriangle: FRUGAL,
      goldenTrianglePerAgent: { "agent-x": ASSURED, "agent-y": FRUGAL },
    });
    const ok = await clearAgentGoldenTrianglePosture("agent-x", client);
    expect(ok).toBe(true);
    const policy = getPolicy() as Record<string, Record<string, unknown>>;
    expect(policy.goldenTrianglePerAgent).toEqual({ "agent-y": FRUGAL }); // x gone, y kept
    expect(policy.goldenTriangle).toEqual(FRUGAL); // platform default untouched
  });

  it("is idempotent: clearing a coworker with no override still succeeds without writing nonsense", async () => {
    const { client, getPolicy } = makeClient({ goldenTrianglePerAgent: { other: ASSURED } });
    const ok = await clearAgentGoldenTrianglePosture("agent-x", client);
    expect(ok).toBe(true);
    expect((getPolicy() as Record<string, unknown>).goldenTrianglePerAgent).toEqual({ other: ASSURED });
  });

  it("rejects an unsafe agent key (prototype-pollution guard)", async () => {
    const { client } = makeClient({ goldenTrianglePerAgent: {} });
    expect(await clearAgentGoldenTrianglePosture("__proto__", client)).toBe(false);
  });

  it("is fail-open: returns false when the db throws", async () => {
    expect(await clearAgentGoldenTrianglePosture("agent-x", throwingClient())).toBe(false);
  });
});

describe("getGoldenTrianglePosture", () => {
  it("reads a previously saved posture back", async () => {
    const { client } = makeClient({ goldenTriangle: ASSURED });
    expect(await getGoldenTrianglePosture({ kind: "platform" }, client)).toEqual(ASSURED);
  });

  it("returns null when no posture is stored", async () => {
    const { client } = makeClient({ allowRecommendation: true });
    expect(await getGoldenTrianglePosture({ kind: "platform" }, client)).toBeNull();
  });

  it("returns null for a malformed stored value", async () => {
    const { client } = makeClient({ goldenTriangle: { preset: "assured" } });
    expect(await getGoldenTrianglePosture({ kind: "platform" }, client)).toBeNull();
  });

  it("is fail-open: returns null when the db throws", async () => {
    expect(await getGoldenTrianglePosture({ kind: "platform" }, throwingClient())).toBeNull();
  });
});

describe("getEffectiveGoldenTrianglePosture", () => {
  it("prefers the organization posture when one is set (WWWD over WWMD)", async () => {
    const client = scopedClient({ platform: ASSURED, org: FRUGAL });
    expect(await getEffectiveGoldenTrianglePosture("org_1", client)).toEqual({ preference: FRUGAL, source: "organization" });
  });

  it("falls back to the platform default when the org has none", async () => {
    const client = scopedClient({ platform: ASSURED });
    expect(await getEffectiveGoldenTrianglePosture("org_1", client)).toEqual({ preference: ASSURED, source: "platform" });
  });

  it("skips the org lookup entirely when organizationId is null", async () => {
    const client = scopedClient({ platform: ASSURED, org: FRUGAL });
    expect(await getEffectiveGoldenTrianglePosture(null, client)).toEqual({ preference: ASSURED, source: "platform" });
  });

  it("returns null when neither scope has a saved posture (caller uses Balanced)", async () => {
    expect(await getEffectiveGoldenTrianglePosture("org_1", scopedClient({}))).toBeNull();
  });

  it("is fail-open: returns null when the db throws", async () => {
    expect(await getEffectiveGoldenTrianglePosture("org_1", throwingClient())).toBeNull();
  });
});

describe("per-coworker (per-agent) posture", () => {
  it("writes a coworker posture into the per-agent map, preserving other keys", async () => {
    const { client, getPolicy } = makeClient({ goldenTriangle: FRUGAL });
    expect(await setAgentGoldenTrianglePosture("agent-x", ASSURED, client)).toBe(true);
    const pol = getPolicy() as Record<string, Record<string, unknown>>;
    expect(pol.goldenTriangle).toEqual(FRUGAL);
    expect(pol.goldenTrianglePerAgent["agent-x"]).toEqual(ASSURED);
  });

  it("reads a coworker's own posture back; null for an unset coworker", async () => {
    const { client } = makeClient({ goldenTrianglePerAgent: { "agent-x": ASSURED } });
    expect(await getAgentGoldenTrianglePosture("agent-x", client)).toEqual(ASSURED);
    expect(await getAgentGoldenTrianglePosture("agent-y", client)).toBeNull();
  });

  it("layers agent over platform (the coworker's own choice wins)", async () => {
    const { client } = makeClient({ goldenTriangle: FRUGAL, goldenTrianglePerAgent: { "agent-x": ASSURED } });
    expect(await getEffectivePostureForAgent("agent-x", null, client)).toEqual({ preference: ASSURED, source: "agent" });
    expect(await getEffectivePostureForAgent("agent-y", null, client)).toEqual({ preference: FRUGAL, source: "platform" });
  });

  it("is fail-open on read and write", async () => {
    expect(await getAgentGoldenTrianglePosture("a", throwingClient())).toBeNull();
    expect(await setAgentGoldenTrianglePosture("a", ASSURED, throwingClient())).toBe(false);
  });

  it("rejects prototype-pollution / malformed agent keys (js/remote-property-injection)", async () => {
    const { client, calls } = makeClient({});
    for (const bad of ["__proto__", "constructor", "prototype", "has space", "a/b", ""]) {
      expect(await setAgentGoldenTrianglePosture(bad, ASSURED, client)).toBe(false);
      expect(await getAgentGoldenTrianglePosture(bad, client)).toBeNull();
    }
    // No write reached the store, and the prototype is intact.
    expect(calls.updateMany).toHaveLength(0);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("isGoldenTrianglePreference", () => {
  it("accepts a well-formed preference", () => {
    expect(isGoldenTrianglePreference(ASSURED)).toBe(true);
  });
  it("rejects wrong shapes", () => {
    expect(isGoldenTrianglePreference(null)).toBe(false);
    expect(isGoldenTrianglePreference({ preset: "assured" })).toBe(false);
    expect(isGoldenTrianglePreference({ ...ASSURED, preset: "nope" })).toBe(false);
    expect(isGoldenTrianglePreference({ ...ASSURED, costWeight: "x" })).toBe(false);
  });
});
