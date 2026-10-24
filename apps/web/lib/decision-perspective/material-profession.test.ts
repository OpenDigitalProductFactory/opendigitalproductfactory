import { describe, expect, it, vi } from "vitest";
import { MARK_DPF_PLATFORM_PROFILE } from "./default-profile";
import { resolveProfileMaterialForProfession } from "./material";
import type { DecisionDomainClass } from "./types";

const DOMAIN: DecisionDomainClass = "professional-practice";

describe("resolveProfileMaterialForProfession", () => {
  function materialRow(profileId: string) {
    return {
      materialId: "m-1",
      profileId,
      sourceType: "wiki",
      sourceRef: {},
      summary: "s",
      domainClass: DOMAIN,
      direction: "support",
      domains: [],
      freshness: "current",
      evidenceGrade: "A",
      confidenceWeight: 1,
      reviewStatus: "approved",
      promotionState: "promoted",
      lastValidatedAt: null,
    };
  }

  function profileRow(profileId: string) {
    return {
      profileId,
      name: profileId,
      kind: "profession",
      scope: {},
      fallbackProfileId: null,
      defaultResolver: null,
      autonomyPolicy: null,
      currentVersion: { versionId: `${profileId}-v1`, versionNumber: 1 },
    };
  }

  it("enters at wsid-<key> for a registry-mapped coworker and flags professionProfileSelected", async () => {
    const db = {
      decisionPerspectiveProfile: {
        findUnique: vi.fn().mockImplementation(async (args: { where: { profileId: string } }) =>
          args.where.profileId === "wsid-data-architect" ? profileRow("wsid-data-architect") : null,
        ),
      },
      perspectiveMaterial: {
        findMany: vi.fn().mockResolvedValue([materialRow("wsid-data-architect")]),
      },
    };

    const resolved = await resolveProfileMaterialForProfession({
      db: db as never,
      // build-data-architect is in the data-architect family roles[] in
      // docs/professions/registry.json (the seed invariant).
      agentIdentity: { slugId: "build-data-architect" },
      domainClass: DOMAIN,
    });

    expect(resolved.professionKey).toBe("data-architect");
    expect(resolved.resolvedProfileChain[0]).toBe("wsid-data-architect");
    expect(resolved.professionProfileSelected).toBe(true);
    expect(resolved.coverageGap).toBe(false);
  });

  it("unbound identity enters at the platform fallback with professionProfileSelected=false", async () => {
    const db = {
      decisionPerspectiveProfile: { findUnique: vi.fn().mockResolvedValue(null) },
      perspectiveMaterial: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const resolved = await resolveProfileMaterialForProfession({
      db: db as never,
      agentIdentity: { slugId: "not-a-real-role-xyz" },
      domainClass: DOMAIN,
    });

    expect(resolved.professionKey).toBeNull();
    expect(resolved.professionProfileSelected).toBe(false);
    expect(resolved.resolvedProfileChain[0]).toBe(MARK_DPF_PLATFORM_PROFILE.profileId);
  });

  it("mapped coworker with an empty craft corpus yields coverageGap, not a false selection", async () => {
    const db = {
      decisionPerspectiveProfile: {
        findUnique: vi.fn().mockImplementation(async (args: { where: { profileId: string } }) =>
          args.where.profileId === "wsid-data-architect" ? profileRow("wsid-data-architect") : null,
        ),
      },
      perspectiveMaterial: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const resolved = await resolveProfileMaterialForProfession({
      db: db as never,
      agentIdentity: { slugId: "build-data-architect" },
      domainClass: DOMAIN,
    });

    expect(resolved.professionKey).toBe("data-architect");
    expect(resolved.coverageGap).toBe(true);
    expect(resolved.professionProfileSelected).toBe(false);
  });
});
