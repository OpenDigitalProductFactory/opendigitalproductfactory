import { beforeEach, describe, expect, it, vi } from "vitest";

const guardState = vi.hoisted(() => ({
  selfClearance: ["public", "internal", "confidential", "restricted"] as string[],
  peerClearances: [] as string[][],
  lastPeerWhere: null as Record<string, unknown> | null,
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    modelProfile: {
      findUnique: vi.fn(async () => ({
        id: "self-profile-id",
        provider: { sensitivityClearance: guardState.selfClearance },
      })),
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        guardState.lastPeerWhere = args.where;
        return guardState.peerClearances.map((c) => ({
          provider: { sensitivityClearance: c },
        }));
      }),
    },
  },
}));

import { sensitivityClassesLeftUncoveredByRetiring } from "./endpoint-retirement-guard";

// BI-32426CA0. Retiring is not a downrank — routing filters candidates on
// `retiredAt: null`, so retiring the sole holder of a clearance leaves that
// sensitivity class with zero eligible endpoints, and every request in it fails
// with the generic "No AI model can handle this request right now".
describe("sensitivityClassesLeftUncoveredByRetiring", () => {
  beforeEach(() => {
    guardState.selfClearance = ["public", "internal", "confidential", "restricted"];
    guardState.peerClearances = [];
    guardState.lastPeerWhere = null;
  });

  it("reports the classes only this endpoint covers", async () => {
    // The live shape: the bundled local model is the only holder of
    // `restricted`; a cloud peer covers everything below it.
    guardState.peerClearances = [["public", "internal", "confidential"]];
    expect(await sensitivityClassesLeftUncoveredByRetiring("local", "qwen3.6"))
      .toEqual(["restricted"]);
  });

  it("reports nothing when a peer covers every class", async () => {
    guardState.peerClearances = [["public", "internal", "confidential", "restricted"]];
    expect(await sensitivityClassesLeftUncoveredByRetiring("local", "qwen3.6")).toEqual([]);
  });

  it("reports every class when no routable peer remains", async () => {
    guardState.peerClearances = [];
    expect(await sensitivityClassesLeftUncoveredByRetiring("local", "qwen3.6"))
      .toEqual(["public", "internal", "confidential", "restricted"]);
  });

  it("unions cover across several peers", async () => {
    guardState.peerClearances = [["public"], ["internal"], ["confidential", "restricted"]];
    expect(await sensitivityClassesLeftUncoveredByRetiring("local", "qwen3.6")).toEqual([]);
  });

  it("does not guard a provider that holds no clearance at all", async () => {
    guardState.selfClearance = [];
    expect(await sensitivityClassesLeftUncoveredByRetiring("x", "y")).toEqual([]);
  });

  // The peer query must mirror queryEndpointManifests exactly. If it drifts to a
  // looser filter, a retired/disabled/transcription endpoint would count as
  // cover and the guard would wave through the very retirement it exists to
  // prevent — on the motivating install the only other `restricted`-cleared
  // provider was a transcription endpoint that can never serve a chat request.
  it("only counts endpoints that routing would actually consider", async () => {
    guardState.peerClearances = [["restricted"]];
    await sensitivityClassesLeftUncoveredByRetiring("local", "qwen3.6");
    const where = guardState.lastPeerWhere as Record<string, any>;
    expect(where.retiredAt).toBeNull();
    expect(where.modelStatus).toEqual({ in: ["active", "degraded"] });
    expect(where.provider.status).toEqual({ in: ["active", "degraded"] });
    expect(where.provider.endpointType.in).toEqual(
      expect.arrayContaining(["llm", "chat"]),
    );
    // A transcription endpoint must not be routable cover.
    expect(where.provider.endpointType.in).not.toContain("transcription");
    // and never counts itself as its own peer
    expect(where.id).toEqual({ not: "self-profile-id" });
  });
});
