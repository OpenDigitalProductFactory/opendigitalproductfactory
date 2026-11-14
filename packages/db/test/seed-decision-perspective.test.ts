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
  it.each([null, "confirmed-owner-principal"])("preserves confirmed runtime ownership and the existing version promoter %j across reseeds", async (promotedByPrincipalId) => {
    // Apply the real seed's writes to stored rows, including SQL-like null
    // defaults. This checks the resulting state, not just the requested shape.
    let profile: Record<string, unknown> | null = null;
    let version: Record<string, unknown> | null = null;
    const stored = (row: Record<string, unknown> | null) => {
      if (!row) throw new Error("The initial seed must have created its stored row.");
      return row;
    };
    const materials = new Map<string, Record<string, unknown>>();
    type Upsert = { where: Record<string, string>; update: Record<string, unknown>; create: Record<string, unknown> };
    const db = {
      decisionPerspectiveProfile: {
        findUnique: vi.fn(async () => structuredClone(profile)),
        upsert: vi.fn(async ({ update, create }: Upsert) => {
          profile = profile ? { ...profile, ...structuredClone(update) }
            : { ownerPrincipalId: null, ownerOrganizationId: null, currentVersionId: null, ...structuredClone(create) };
          return profile;
        }),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (!profile) throw new Error("The profile must exist before selecting its current version.");
          profile = { ...profile, ...structuredClone(data) };
          return profile;
        }),
      },
      decisionPerspectiveProfileVersion: {
        upsert: vi.fn(async ({ update, create }: Upsert) => {
          version = version ? { ...version, ...structuredClone(update) } : { promotedByPrincipalId: null, ...structuredClone(create) };
          return version;
        }),
      },
      perspectiveMaterial: {
        upsert: vi.fn(async ({ where, update, create }: Upsert) => {
          const key = where.materialId!;
          materials.set(key, structuredClone(materials.has(key) ? { ...materials.get(key), ...update } : create));
          return materials.get(key);
        }),
      },
    };

    const initial = await seedDecisionPerspective(db as never);
    expect(profile).toMatchObject({ ownerPrincipalId: null, ownerOrganizationId: null, currentVersionId: initial.versionId });
    expect(version).toMatchObject({ promotedByPrincipalId: null });

    // The supported runtime confirmation owns these FKs. Ratification is a
    // separate fact: both an unratified and an already-ratified version survive.
    profile = { ...stored(profile), ownerPrincipalId: "confirmed-owner-principal", ownerOrganizationId: "confirmed-owner-organization", name: "Stale seed label" };
    version = { ...stored(version), promotedByPrincipalId, materialFingerprint: "stale-seed-material" };
    const seed = buildDecisionPerspectiveSeed();
    for (let pass = 0; pass < 2; pass += 1) {
      const result = await seedDecisionPerspective(db as never);
      expect(profile).toMatchObject({ ownerPrincipalId: "confirmed-owner-principal", ownerOrganizationId: "confirmed-owner-organization",
        currentVersionId: initial.versionId, name: seed.profile.name });
      expect(version).toMatchObject({ promotedByPrincipalId, materialFingerprint: seed.version.materialFingerprint });
      expect(result.materialCount).toBe(materials.size);
      expect(result.versionId).toBe(initial.versionId);
    }
  });

  it.each([
    null,
    { autonomyPolicy: { workroomPostureDefault: { actionBoundary: "preauthorized" } } },
  ])("upserts seed rows while preserving existing operator policy: %j", async (existing) => {
    const db = {
      decisionPerspectiveProfile: {
        findUnique: vi.fn().mockResolvedValue(existing),
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
    expect(db.decisionPerspectiveProfile.findUnique).toHaveBeenCalledWith({
      where: { profileId: MARK_DPF_PLATFORM_PROFILE_ID },
      select: { autonomyPolicy: true },
    });
    expect(db.decisionPerspectiveProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { profileId: MARK_DPF_PLATFORM_PROFILE_ID },
        update: expect.objectContaining({
          autonomyPolicy: {
            ...buildDecisionPerspectiveSeed().profile.autonomyPolicy,
            ...existing?.autonomyPolicy,
          },
        }),
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
