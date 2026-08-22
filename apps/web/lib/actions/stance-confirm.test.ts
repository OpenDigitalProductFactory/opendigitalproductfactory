import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnsureProfile, mockPrisma, mockPromote, mockRequireCapability } = vi.hoisted(() => ({
  mockEnsureProfile: vi.fn(),
  mockPromote: vi.fn(),
  mockRequireCapability: vi.fn(),
  mockPrisma: {
    organization: { findFirst: vi.fn() },
    storefrontConfig: { findFirst: vi.fn() },
    wikiPage: { findFirst: vi.fn() },
  },
}));

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));
vi.mock("@dpf/db/wiki-store", () => ({
  upsertWikiPage: vi.fn(async () => ({ id: "wiki-stance" })),
  appendRevision: vi.fn(async () => ({})),
}));
vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: mockRequireCapability }));
vi.mock("@/lib/decision-perspective/stance-promotion", () => ({
  promoteStanceMaterial: mockPromote,
}));
vi.mock("@/lib/onboarding/ensure-org-decision-perspective-profile", () => ({
  ensureOrgDecisionPerspectiveProfile: mockEnsureProfile,
}));
vi.mock("@/lib/wiki/embeddings", () => ({ storeWikiPage: vi.fn(async () => true) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { confirmStanceVectors } from "./stance-confirm";

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireCapability.mockResolvedValue({ userId: "owner-1" });
  mockPrisma.organization.findFirst.mockResolvedValue({
    id: "org-rescue",
    name: "Second Chance Animal Rescue",
  });
  mockPrisma.storefrontConfig.findFirst.mockResolvedValue({
    archetypeId: "pet-rescue",
    archetype: { category: "nonprofit-community" },
  });
  mockPrisma.wikiPage.findFirst.mockResolvedValue(null);
  mockEnsureProfile.mockResolvedValue({
    profileId: "org-perspective-org-rescue",
    versionId: "org-perspective-org-rescue-v1",
  });
  mockPromote.mockResolvedValue({
    ok: true,
    profileId: "org-perspective-org-rescue",
    materialIds: [],
    keptHigherTier: [],
  });
});

describe("confirmStanceVectors", () => {
  it("ensures the decision profile before promoting stances during active setup", async () => {
    const result = await confirmStanceVectors({
      vectors: [
        {
          key: "customer-goodwill",
          stance: "Make the adopter whole quickly and protect the animal's wellbeing.",
          ceilingUsd: 100,
        },
      ],
    });

    expect(result).toEqual({ ok: true, confirmedVectors: 1, upgradedIdentityPages: 0 });
    expect(mockEnsureProfile).toHaveBeenCalledWith({
      organizationId: "org-rescue",
      organizationName: "Second Chance Animal Rescue",
      db: mockPrisma,
    });
    expect(mockEnsureProfile.mock.invocationCallOrder[0]).toBeLessThan(
      mockPromote.mock.invocationCallOrder[0],
    );
  });
});
