import { describe, expect, it, vi } from "vitest";

import { resolveProfileMaterial } from "./material";
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
