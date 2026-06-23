import { describe, expect, it } from "vitest";

import type { GoldenTrianglePreference } from "@/lib/golden-triangle";

import {
  aggregatePostureContributions,
  anonymizePosture,
  contributePostureDefault,
  getHivePostureSuggestion,
  storeHivePostureSuggestion,
  type AnonymizedPosture,
  type HiveContributeClient,
  type HivePostureConsensus,
  type HiveSuggestionClient,
} from "./hive";

const ASSURED: GoldenTrianglePreference = { preset: "assured", qualityWeight: 0.8, costWeight: 0.1, timeWeight: 0.1 };

function ap(preset: AnonymizedPosture["preset"], q: number, c: number, t: number): AnonymizedPosture {
  return { preset, qualityWeight: q, costWeight: c, timeWeight: t };
}

describe("anonymizePosture", () => {
  it("keeps only preset + weights (nothing identifying)", () => {
    expect(anonymizePosture(ASSURED)).toEqual({ preset: "assured", qualityWeight: 0.8, costWeight: 0.1, timeWeight: 0.1 });
  });
});

describe("aggregatePostureContributions", () => {
  it("returns null for no contributions", () => {
    expect(aggregatePostureContributions([])).toBeNull();
  });

  it("picks the modal preset, means the weights, and reports confidence", () => {
    const out = aggregatePostureContributions([
      ap("frugal", 0.2, 0.6, 0.2),
      ap("frugal", 0.2, 0.6, 0.2),
      ap("assured", 0.8, 0.1, 0.1),
    ]);
    expect(out).not.toBeNull();
    expect(out?.preset).toBe("frugal");
    expect(out?.peerCount).toBe(3);
    expect(out?.confidence).toBe(0.67); // 2 of 3
    expect(out?.qualityWeight).toBe(0.4); // (0.2 + 0.2 + 0.8) / 3
  });
});

describe("contributePostureDefault", () => {
  function client(mode: string, paused: boolean, capture?: (data: Record<string, unknown>) => void): HiveContributeClient {
    return {
      platformDevConfig: {
        findUnique: async () => ({ deviceFingerprintOptIn: true, hiveContributionsPaused: paused, contributionMode: mode }),
      },
      hiveContributionLedger: {
        create: async ({ data }) => {
          capture?.(data as Record<string, unknown>);
          return { id: "ledger_1" };
        },
      },
    };
  }

  it("contributes (as an 'improvement') when sharing is enabled", async () => {
    let recorded: Record<string, unknown> | undefined;
    const res = await contributePostureDefault(ASSURED, client("selective", false, (d) => (recorded = d)));
    expect(res.contributed).toBe(true);
    expect(res.ledgerId).toBe("ledger_1");
    expect(recorded?.contributionType).toBe("improvement");
    expect(recorded?.payloadHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is fail-closed when contributionMode is fork_only", async () => {
    expect(await contributePostureDefault(ASSURED, client("fork_only", false))).toEqual({
      contributed: false,
      reason: "contribution_disabled",
    });
  });

  it("respects the master pause", async () => {
    expect((await contributePostureDefault(ASSURED, client("contribute_all", true))).contributed).toBe(false);
  });
});

describe("hive posture suggestion seam", () => {
  function client(initial: unknown): HiveSuggestionClient {
    let policy = initial;
    return {
      decisionPerspectiveProfile: {
        findFirst: async () => (policy === null ? null : { autonomyPolicy: policy }),
        updateMany: async (args) => {
          policy = (args as { data: { autonomyPolicy: unknown } }).data.autonomyPolicy;
          return { count: 1 };
        },
      },
    };
  }

  const consensus: HivePostureConsensus = {
    preset: "frugal",
    qualityWeight: 0.2,
    costWeight: 0.6,
    timeWeight: 0.2,
    peerCount: 5,
    confidence: 0.8,
  };

  it("returns null when nothing is stored", async () => {
    expect(await getHivePostureSuggestion(client({}))).toBeNull();
  });

  it("stores then reads back a consensus, preserving other autonomyPolicy keys", async () => {
    const c = client({ goldenTriangle: ASSURED });
    expect(await storeHivePostureSuggestion(consensus, c)).toBe(true);
    expect(await getHivePostureSuggestion(c)).toEqual(consensus);
  });
});
