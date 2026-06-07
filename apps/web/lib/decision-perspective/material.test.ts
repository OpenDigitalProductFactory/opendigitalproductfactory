import { describe, expect, it, vi } from "vitest";

import {
  resolveProfileMaterial,
  resolveOrgProfileId,
  resolveProfileMaterialForOrg,
} from "./material";
import { PLAN_READINESS_DOMAIN_CLASS } from "./types";

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
    expect(db.perspectiveMaterial.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ domainClass: PLAN_READINESS_DOMAIN_CLASS }),
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
