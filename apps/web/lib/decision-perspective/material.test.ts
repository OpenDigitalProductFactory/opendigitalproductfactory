import { describe, expect, it, vi } from "vitest";

import {
  isMaterialApplicable,
  resolveProfileMaterial,
  resolveOrgProfileId,
  resolveProfileMaterialForOrg,
} from "./material";
import {
  CROSS_DOMAIN_MATERIAL_TAG,
  PLAN_READINESS_DOMAIN_CLASS,
  type PerspectiveMaterial,
} from "./types";

describe("resolveProfileMaterial", () => {
  it("walks profile fallback order and returns the first profile with applicable material", async () => {
    const db = {
      decisionPerspectiveProfile: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            profileId: "customer-profile",
            fallbackProfileId: "dpf-product-doctrine",
            currentVersion: { versionId: "customer-profile-v1", versionNumber: 1 },
          })
          .mockResolvedValueOnce({
            profileId: "dpf-product-doctrine",
            fallbackProfileId: null,
            currentVersion: { versionId: "dpf-product-doctrine-v1", versionNumber: 1 },
          })
          .mockResolvedValueOnce(null),
      },
      perspectiveMaterial: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              materialId: "fallback-material",
              profileId: "dpf-product-doctrine",
              sourceType: "principle",
              sourceRef: { path: "docs/founder-kernel/wiki/principles/architecture-over-shortcuts.md", principleDirection: "support" },
              summary: "Architecture over shortcuts.",
              domainClass: PLAN_READINESS_DOMAIN_CLASS,
              direction: "support",
              domains: [PLAN_READINESS_DOMAIN_CLASS],
              freshness: "current",
              evidenceGrade: "B",
              confidenceWeight: 1,
              reviewStatus: "approved",
              promotionState: "promoted",
              lastValidatedAt: new Date("2026-05-17T00:00:00.000Z"),
            },
          ]),
      },
    };

    const result = await resolveProfileMaterial({
      db: db as never,
      profileId: "customer-profile",
      domainClass: PLAN_READINESS_DOMAIN_CLASS,
    });

    expect(result.coverageGap).toBe(false);
    expect(result.selectedProfileId).toBe("dpf-product-doctrine");
    expect(result.resolvedProfileChain).toEqual([
      "customer-profile",
      "dpf-product-doctrine",
      "dpf-organizational-principles",
    ]);
    expect(result.materials).toHaveLength(1);
    expect(result.materials[0].principleDirection).toBe("support");
    expect(result.materials[0].domainClass).toBe(PLAN_READINESS_DOMAIN_CLASS);
    expect(result.materials[0].direction).toBe("support");
    expect(result.materials[0].evidenceGrade).toBe("B");
    // BI-F5F2869D: the query is no longer a bare `domainClass` equality. It must
    // mirror isMaterialApplicable — own class OR an explicit topic tag OR the
    // cross-domain tag — otherwise the DB re-imposes the hard gate and the
    // additive tag is dead code.
    expect(db.perspectiveMaterial.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { domainClass: PLAN_READINESS_DOMAIN_CLASS },
            { domains: { has: PLAN_READINESS_DOMAIN_CLASS } },
            { domains: { has: CROSS_DOMAIN_MATERIAL_TAG } },
          ],
        }),
      }),
    );
  });

  it("returns a coverage gap when no profile in the chain has material", async () => {
    const db = {
      decisionPerspectiveProfile: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            profileId: "customer-profile",
            fallbackProfileId: null,
            currentVersion: { versionId: "customer-profile-v1", versionNumber: 1 },
          })
          .mockResolvedValueOnce(null),
      },
      perspectiveMaterial: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const result = await resolveProfileMaterial({
      db: db as never,
      profileId: "customer-profile",
      domainClass: "risk-assessment",
    });

    expect(result.coverageGap).toBe(true);
    expect(result.materials).toEqual([]);
    expect(result.selectedProfileId).toBeNull();
  });
});

describe("resolveOrgProfileId (BI-230C9EF7)", () => {
  it("returns null without a DB call when organizationId is absent", async () => {
    const findFirst = vi.fn();
    const db = { decisionPerspectiveProfile: { findFirst } };

    await expect(
      resolveOrgProfileId({ db: db as never, organizationId: null }),
    ).resolves.toBeNull();
    await expect(
      resolveOrgProfileId({ db: db as never, organizationId: undefined }),
    ).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("selects the active org-owned profile by ownerOrganizationId", async () => {
    const findFirst = vi.fn().mockResolvedValue({ profileId: "org-perspective-org-123" });
    const db = { decisionPerspectiveProfile: { findFirst } };

    const profileId = await resolveOrgProfileId({
      db: db as never,
      organizationId: "org-123",
    });

    expect(profileId).toBe("org-perspective-org-123");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerOrganizationId: "org-123",
          kind: "organization",
          status: "active",
        },
        select: { profileId: true },
        orderBy: { createdAt: "asc" },
      }),
    );
  });

  it("returns null when the org has no active profile", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const db = { decisionPerspectiveProfile: { findFirst } };

    await expect(
      resolveOrgProfileId({ db: db as never, organizationId: "org-none" }),
    ).resolves.toBeNull();
  });
});

describe("resolveProfileMaterialForOrg (BI-230C9EF7)", () => {
  it("enters the resolution chain at the org profile when one exists", async () => {
    const findUnique = vi.fn().mockResolvedValueOnce({
      profileId: "org-perspective-org-123",
      fallbackProfileId: "dpf-organizational-principles",
      currentVersion: { versionId: "org-perspective-org-123-v1", versionNumber: 1 },
    });
    const findMany = vi.fn().mockResolvedValueOnce([
      {
        materialId: "org-mat",
        profileId: "org-perspective-org-123",
        sourceType: "stance",
        sourceRef: {},
        summary: "We serve patients first.",
        domainClass: PLAN_READINESS_DOMAIN_CLASS,
        direction: "support",
        domains: [PLAN_READINESS_DOMAIN_CLASS],
        freshness: "current",
        evidenceGrade: "B",
        confidenceWeight: 0.6,
        reviewStatus: "approved",
        promotionState: "promoted",
        lastValidatedAt: null,
      },
    ]);
    const findFirst = vi.fn().mockResolvedValue({ profileId: "org-perspective-org-123" });
    const db = {
      decisionPerspectiveProfile: { findUnique, findFirst },
      perspectiveMaterial: { findMany },
    };

    const result = await resolveProfileMaterialForOrg({
      db: db as never,
      organizationId: "org-123",
      domainClass: PLAN_READINESS_DOMAIN_CLASS,
    });

    expect(result.orgProfileSelected).toBe(true);
    expect(result.selectedProfileId).toBe("org-perspective-org-123");
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { profileId: "org-perspective-org-123" } }),
    );
  });

  it("falls back to the platform profile when the org has none", async () => {
    const findUnique = vi.fn().mockResolvedValueOnce(null);
    const findMany = vi.fn().mockResolvedValue([]);
    const findFirst = vi.fn().mockResolvedValue(null);
    const db = {
      decisionPerspectiveProfile: { findUnique, findFirst },
      perspectiveMaterial: { findMany },
    };

    const result = await resolveProfileMaterialForOrg({
      db: db as never,
      organizationId: "org-none",
      domainClass: PLAN_READINESS_DOMAIN_CLASS,
    });

    expect(result.orgProfileSelected).toBe(false);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { profileId: "mark-dpf-platform" } }),
    );
  });

  it("honors an explicit fallbackProfileId when the org has none", async () => {
    const findUnique = vi.fn().mockResolvedValueOnce(null);
    const findMany = vi.fn().mockResolvedValue([]);
    const findFirst = vi.fn().mockResolvedValue(null);
    const db = {
      decisionPerspectiveProfile: { findUnique, findFirst },
      perspectiveMaterial: { findMany },
    };

    await resolveProfileMaterialForOrg({
      db: db as never,
      organizationId: null,
      domainClass: PLAN_READINESS_DOMAIN_CLASS,
      fallbackProfileId: "custom-fallback",
    });

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { profileId: "custom-fallback" } }),
    );
  });
});

// BI-F5F2869D — doctrine eligibility must not be hard-gated by an exact
// domainClass match. The live regression: the owner's own ruling on "offer a
// self-hosted support subscription through MSP partners" is filed under
// plan-readiness; the MSP question arrived as risk-assessment; the ruling was
// excluded before relevance ever ran and the decision escalated with its answer
// already in the corpus.
describe("isMaterialApplicable — additive domain tags (BI-F5F2869D)", () => {
  function material(overrides: Partial<PerspectiveMaterial>): PerspectiveMaterial {
    return {
      materialId: "m-1",
      profileId: "org-perspective-1",
      sourceType: "stance",
      sourceRef: {},
      summary: "Offer a self-hosted support subscription through MSP partners.",
      domainClass: PLAN_READINESS_DOMAIN_CLASS,
      direction: "support",
      domains: [PLAN_READINESS_DOMAIN_CLASS],
      freshness: "current",
      evidenceGrade: "A",
      confidenceWeight: 1,
      reviewStatus: "approved",
      promotionState: "promoted",
      lastValidatedAt: null,
      ...overrides,
    } as PerspectiveMaterial;
  }

  it("still matches its own domainClass", () => {
    expect(isMaterialApplicable(material({}), PLAN_READINESS_DOMAIN_CLASS)).toBe(true);
  });

  it("does NOT leak into an unrelated domain without a tag", () => {
    // Widening eligibility must not become "everything is always applicable".
    expect(isMaterialApplicable(material({}), "risk-assessment")).toBe(false);
  });

  it("matches a domain it explicitly declares as a topic tag", () => {
    const m = material({ domains: [PLAN_READINESS_DOMAIN_CLASS, "risk-assessment"] });
    expect(isMaterialApplicable(m, "risk-assessment")).toBe(true);
  });

  it("matches every business domain when tagged cross-domain", () => {
    const m = material({ domains: [PLAN_READINESS_DOMAIN_CLASS, CROSS_DOMAIN_MATERIAL_TAG] });
    expect(isMaterialApplicable(m, "risk-assessment")).toBe(true);
    expect(isMaterialApplicable(m, "architecture-tradeoff")).toBe(true);
    expect(isMaterialApplicable(m, "professional-practice")).toBe(true);
  });

  it("tolerates material with no tags at all", () => {
    const m = material({ domains: undefined as unknown as string[] });
    expect(isMaterialApplicable(m, PLAN_READINESS_DOMAIN_CLASS)).toBe(true);
    expect(isMaterialApplicable(m, "risk-assessment")).toBe(false);
  });
});
