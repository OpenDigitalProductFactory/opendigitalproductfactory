import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  platformDevConfigFindUnique,
  hiveContributionLedgerFindMany,
  featurePackFindMany,
} = vi.hoisted(() => ({
  platformDevConfigFindUnique: vi.fn(),
  hiveContributionLedgerFindMany: vi.fn(),
  featurePackFindMany: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    platformDevConfig: { findUnique: platformDevConfigFindUnique, upsert: vi.fn() },
    hiveContributionLedger: { findMany: hiveContributionLedgerFindMany },
    featurePack: { findMany: featurePackFindMany },
  },
  resolveHiveContributionStatuses: vi.fn(() => []),
}));

vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: vi.fn() }));
vi.mock("@/lib/integrate/identity-privacy", () => ({
  getDisplayPseudonym: vi.fn(async () => "contributor-123"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getHiveContributionsView } from "./hive-contributions";

describe("getHiveContributionsView seed reviews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformDevConfigFindUnique.mockResolvedValue(null);
    hiveContributionLedgerFindMany.mockResolvedValue([]);
  });

  it("maps reviewed seed-fit evidence from FeaturePack.reviewReport", async () => {
    featurePackFindMany.mockResolvedValue([{
      packId: "FP-1",
      title: "Shared banking defaults",
      prUrl: "https://github.com/example/repo/pull/42",
      prNumber: 42,
      mergeReadiness: "ready",
      reviewedAt: new Date("2026-07-11T00:00:00.000Z"),
      manifest: { files: ["packages/db/src/seed-banking-compliance.ts"] },
      reviewReport: {
        seedFit: {
          touchesSeededContent: true,
          changedSeedPaths: ["packages/db/src/seed-banking-compliance.ts"],
          decision: "vertical-scoped",
          distributionScope: "vertical-scoped",
          applicableArchetypeCategories: [],
          applicableVerticals: ["banking-financial-services"],
          sourceVertical: "banking-financial-services",
          rationale: "Limited to the reviewed financial-services vertical.",
          mergeEligible: true,
        },
      },
    }]);

    const view = await getHiveContributionsView();

    expect(view.seedReviews).toEqual([{
      packId: "FP-1",
      title: "Shared banking defaults",
      decision: "vertical-scoped",
      distributionScope: "vertical-scoped",
      applicableScope: ["banking-financial-services"],
      mergeEligible: true,
      mergeReadiness: "ready",
      changedSeedPaths: ["packages/db/src/seed-banking-compliance.ts"],
      rationale: "Limited to the reviewed financial-services vertical.",
      prUrl: "https://github.com/example/repo/pull/42",
      prNumber: 42,
      reviewedAt: "2026-07-11T00:00:00.000Z",
    }]);
  });

  it("shows legacy seed-changing packs as requiring review", async () => {
    featurePackFindMany.mockResolvedValue([{
      packId: "FP-OLD",
      title: "Legacy prompt update",
      prUrl: null,
      prNumber: null,
      mergeReadiness: "ready",
      reviewedAt: new Date("2026-06-01T00:00:00.000Z"),
      manifest: { files: ["prompts/reviewer/code-review.prompt.md"] },
      reviewReport: { mergeReadiness: "ready" },
    }]);

    const view = await getHiveContributionsView();

    expect(view.seedReviews[0]).toMatchObject({
      packId: "FP-OLD",
      decision: null,
      mergeEligible: false,
      changedSeedPaths: ["prompts/reviewer/code-review.prompt.md"],
      rationale: "Seed-fit evidence is unavailable; review is required.",
    });
  });
});
