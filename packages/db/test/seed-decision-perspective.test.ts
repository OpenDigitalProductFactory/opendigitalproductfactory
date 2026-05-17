import { describe, expect, it, vi } from "vitest";

import {
  MARK_DPF_PLATFORM_PROFILE_ID,
  PLAN_READINESS_DOMAIN_CLASS,
  buildDecisionPerspectiveSeed,
  seedDecisionPerspective,
} from "../src/seed-decision-perspective";

describe("buildDecisionPerspectiveSeed", () => {
  it("builds an initial Mark / DPF profile with a deterministic material fingerprint", () => {
    const first = buildDecisionPerspectiveSeed();
    const second = buildDecisionPerspectiveSeed();

    expect(first.profile.profileId).toBe(MARK_DPF_PLATFORM_PROFILE_ID);
    expect(first.version.profileId).toBe(MARK_DPF_PLATFORM_PROFILE_ID);
    expect(first.version.materialFingerprint).toBe(second.version.materialFingerprint);
    expect(first.materials.length).toBeGreaterThanOrEqual(5);
    expect(first.materials.every((material) => material.profileId === MARK_DPF_PLATFORM_PROFILE_ID)).toBe(true);
    expect(first.materials.every((material) => material.domainClass === PLAN_READINESS_DOMAIN_CLASS)).toBe(true);
    expect(first.materials.every((material) => material.domains.includes(PLAN_READINESS_DOMAIN_CLASS))).toBe(true);
    expect(first.materials.every((material) => material.evidenceGrade === "A")).toBe(true);
  });
});

describe("seedDecisionPerspective", () => {
  it("upserts the profile, version snapshot, and material rows idempotently", async () => {
    const db = {
      decisionPerspectiveProfile: {
        upsert: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
      decisionPerspectiveProfileVersion: {
        upsert: vi.fn().mockResolvedValue({}),
      },
      perspectiveMaterial: {
        upsert: vi.fn().mockResolvedValue({}),
      },
    };

    const result = await seedDecisionPerspective(db as never);

    expect(result.profileId).toBe(MARK_DPF_PLATFORM_PROFILE_ID);
    expect(result.materialCount).toBeGreaterThanOrEqual(5);
    expect(db.decisionPerspectiveProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { profileId: MARK_DPF_PLATFORM_PROFILE_ID },
      }),
    );
    expect(db.decisionPerspectiveProfileVersion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { versionId: expect.stringContaining(MARK_DPF_PLATFORM_PROFILE_ID) },
      }),
    );
    expect(db.perspectiveMaterial.upsert).toHaveBeenCalledTimes(result.materialCount);
    expect(db.decisionPerspectiveProfile.update).toHaveBeenCalledWith({
      where: { profileId: MARK_DPF_PLATFORM_PROFILE_ID },
      data: { currentVersionId: result.versionId },
    });
  });
});
