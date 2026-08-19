import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  platformDevConfigFindUnique,
  hiveContributionLedgerFindMany,
  featurePackFindMany,
  improvementProposalFindMany,
} = vi.hoisted(() => ({
  platformDevConfigFindUnique: vi.fn(),
  hiveContributionLedgerFindMany: vi.fn(),
  featurePackFindMany: vi.fn(),
  improvementProposalFindMany: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    platformDevConfig: { findUnique: platformDevConfigFindUnique, upsert: vi.fn() },
    hiveContributionLedger: { findMany: hiveContributionLedgerFindMany },
    featurePack: { findMany: featurePackFindMany },
    improvementProposal: { findMany: improvementProposalFindMany },
  },
  resolveHiveContributionStatuses: vi.fn(() => []),
}));

vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: vi.fn() }));
vi.mock("@/lib/build/identity-privacy", () => ({
  getDisplayPseudonym: vi.fn(async () => "contributor-123"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getHiveContributionsView } from "./hive-contributions";

describe("getHiveContributionsView seed reviews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformDevConfigFindUnique.mockResolvedValue(null);
    hiveContributionLedgerFindMany.mockResolvedValue([]);
    improvementProposalFindMany.mockResolvedValue([]);
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

describe("getHiveContributionsView contribution provenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformDevConfigFindUnique.mockResolvedValue(null);
    hiveContributionLedgerFindMany.mockResolvedValue([]);
    improvementProposalFindMany.mockResolvedValue([]);
  });

  it("does not treat FeaturePack.status=local as proof that nothing was shared", async () => {
    featurePackFindMany.mockResolvedValue([{
      packId: "FP-SHARED",
      title: "Shared dispatch workflow",
      status: "local",
      prUrl: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/42",
      prNumber: 42,
      mergeReadiness: null,
      reviewedAt: null,
      createdAt: new Date("2026-07-15T12:00:00.000Z"),
      manifest: {},
      reviewReport: null,
    }]);

    const view = await getHiveContributionsView();

    expect(view.contributionProvenance).toEqual([
      expect.objectContaining({
        id: "feature-pack:FP-SHARED",
        title: "Shared dispatch workflow",
        localAvailability: expect.objectContaining({ label: "Saved locally" }),
        privacyDisposition: expect.objectContaining({ label: "Approved to share" }),
        publication: expect.objectContaining({
          label: "Sent to community project",
          detail: "PR #42",
          url: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/42",
        }),
        upstreamAcceptance: expect.objectContaining({ label: "Under review" }),
      }),
    ]);
  });

  it("flags contributed FeaturePacks without PR or outbox evidence for provenance review", async () => {
    featurePackFindMany.mockResolvedValue([{
      packId: "FP-AMBIGUOUS",
      title: "Ambiguous contribution",
      status: "contributed",
      prUrl: null,
      prNumber: null,
      mergeReadiness: null,
      reviewedAt: null,
      createdAt: new Date("2026-07-15T12:00:00.000Z"),
      manifest: {},
      reviewReport: null,
    }]);

    const view = await getHiveContributionsView();

    expect(view.contributionProvenance[0]).toMatchObject({
      id: "feature-pack:FP-AMBIGUOUS",
      publication: {
        status: "needs-attention",
        label: "Needs attention",
        detail: "Marked contributed, but no sent-community proof was found.",
      },
      upstreamAcceptance: {
        status: "needs-review",
        label: "Needs provenance review",
        detail: "Legacy status cannot prove whether the community accepted it.",
      },
    });
  });

  it("shows local-only FeaturePacks as kept here and not queued", async () => {
    featurePackFindMany.mockResolvedValue([{
      packId: "FP-LOCAL",
      title: "Private workflow",
      status: "local",
      prUrl: null,
      prNumber: null,
      mergeReadiness: null,
      reviewedAt: null,
      createdAt: new Date("2026-07-15T12:00:00.000Z"),
      manifest: {},
      reviewReport: null,
    }]);

    const view = await getHiveContributionsView();

    expect(view.contributionProvenance[0]).toMatchObject({
      id: "feature-pack:FP-LOCAL",
      localAvailability: { status: "saved-locally", label: "Saved locally", detail: "Feature Pack exists on this install." },
      privacyDisposition: { status: "kept-here", label: "Kept on this system", detail: "No public contribution evidence was found." },
      publication: { status: "not-queued", label: "Not queued", detail: "Nothing has been sent outside this install." },
      upstreamAcceptance: { status: "not-sent", label: "Not sent", detail: "No community review exists." },
    });
  });
});
