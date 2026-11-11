import { describe, expect, it } from "vitest";

import type { GuidanceMaterialV1, GuidanceSnapshotV1 } from "@dpf/db/guidance-snapshot-contract";

import { MARK_DPF_PLATFORM_PROFILE } from "./default-profile";
import {
  NO_ORGANIZATION_GUIDANCE_PROFILE_ID,
  resolveOrganizationDecisionMaterial,
  type OrganizationGuidance,
} from "./organization-guidance";

const now = new Date("2026-11-12T00:00:00.000Z");

function material(overrides: Partial<GuidanceMaterialV1> = {}): GuidanceMaterialV1 {
  return {
    materialId: "PM-AUTH-1", sourceType: "organization-stance", sourceRef: {}, summary: "Authority stance.",
    domainClass: "plan-readiness", direction: "support", domains: [], freshness: "current",
    evidenceGrade: "A", confidenceWeight: 0.9, lastValidatedAt: "2026-11-01T00:00:00.000Z", ...overrides,
  };
}

function snapshot(materials: GuidanceMaterialV1[], expiresAt = "2026-11-25T00:00:00.000Z"): GuidanceSnapshotV1 {
  return {
    specVersion: "dpf.guidance-snapshot/1",
    meta: {
      authorityInstallationDid: `did_${"a".repeat(64)}`, authoritySigningPublicKey: "k",
      companionInstallationDid: `did_${"c".repeat(64)}`, version: 10,
      issuedAt: "2026-11-11T00:00:00.000Z", expiresAt,
    },
    wwwd: {
      profile: { profileId: "wwwd-authority-org", name: "Authority organization", fallbackProfileId: null, autonomyPolicy: null, defaultResolver: null },
      materials,
    },
    manifest: {},
    signature: "x.y.z",
  };
}

/** A local org profile with one supporting and one opposing row, behind the platform profile. */
function localDb() {
  const profiles: Record<string, { profileId: string; name: string; kind: string; fallbackProfileId: string | null }> = {
    "wwwd-local-org": { profileId: "wwwd-local-org", name: "Local demo org", kind: "organization", fallbackProfileId: MARK_DPF_PLATFORM_PROFILE.profileId },
    [MARK_DPF_PLATFORM_PROFILE.profileId]: { profileId: MARK_DPF_PLATFORM_PROFILE.profileId, name: "Platform", kind: "platform", fallbackProfileId: null },
  };
  const rows = [
    { materialId: "PM-LOCAL-SUPPORT", profileId: "wwwd-local-org", direction: "support" },
    { materialId: "PM-LOCAL-OPPOSE", profileId: "wwwd-local-org", direction: "oppose" },
    { materialId: "PM-PLATFORM", profileId: MARK_DPF_PLATFORM_PROFILE.profileId, direction: "support" },
  ].map((row) => ({
    ...row, sourceType: "organization-stance", sourceRef: {}, summary: row.materialId, domainClass: "plan-readiness",
    domains: [], freshness: "current", evidenceGrade: "A", confidenceWeight: 0.8, reviewStatus: "approved",
    promotionState: "promoted", lastValidatedAt: null,
  }));
  return {
    decisionPerspectiveProfile: {
      findUnique: async ({ where }: { where: { profileId: string } }) => profiles[where.profileId] ?? null,
      findFirst: async () => ({ profileId: "wwwd-local-org" }),
    },
    perspectiveMaterial: {
      findMany: async ({ where }: { where: { profileId: string } }) => rows.filter((row) => row.profileId === where.profileId),
    },
  };
}

function resolve(guidance: OrganizationGuidance) {
  return resolveOrganizationDecisionMaterial({
    db: localDb() as never, organizationId: "org-local", domainClass: "plan-readiness",
    loadGuidance: async () => guidance,
  });
}

describe("resolveOrganizationDecisionMaterial", () => {
  it("leaves a non-companion installation on its own organization profile", async () => {
    const resolved = await resolve({ role: "local" });
    expect(resolved.selectedProfileId).toBe("wwwd-local-org");
    expect(resolved.orgProfileSelected).toBe(true);
    expect(resolved.organizationGuidance).toEqual({ state: "local" });
  });

  it("AC-PAC-01: on a companion, resolves the authority snapshot's profile", async () => {
    const resolved = await resolve({ role: "companion", snapshot: snapshot([material()]), now });
    expect(resolved.selectedProfileId).toBe("wwwd-authority-org");
    expect(resolved.selectedProfile?.kind).toBe("organization");
    expect(resolved.orgProfileSelected).toBe(true);
    expect(resolved.coverageGap).toBe(false);
    expect(resolved.materials.map((m) => m.materialId)).toContain("PM-AUTH-1");
    expect(resolved.organizationGuidance).toMatchObject({ state: "current", version: 10 });
  });

  it("local material may only narrow: opposing local material is kept, supporting local material is not", async () => {
    const resolved = await resolve({ role: "companion", snapshot: snapshot([material()]), now });
    const ids = resolved.materials.map((m) => m.materialId);
    expect(ids).toContain("PM-LOCAL-OPPOSE");
    expect(ids).not.toContain("PM-LOCAL-SUPPORT");
    expect(ids).not.toContain("PM-PLATFORM");
  });

  it("filters snapshot material to the decision's domain the same way local material is filtered", async () => {
    const resolved = await resolve({
      role: "companion",
      snapshot: snapshot([material(), material({ materialId: "PM-AUTH-RISK", domainClass: "risk-assessment" })]),
      now,
    });
    expect(resolved.materials.map((m) => m.materialId)).not.toContain("PM-AUTH-RISK");
  });

  it("AC-PAC-01: with no snapshot, reports no organization guidance instead of the platform profile", async () => {
    const resolved = await resolve({ role: "companion", snapshot: null, now });
    expect(resolved.selectedProfileId).toBe(NO_ORGANIZATION_GUIDANCE_PROFILE_ID);
    expect(resolved.selectedProfile?.autonomyPolicy.allowRecommendation).toBe(false);
    expect(resolved.selectedProfile?.autonomyPolicy.allowArbitration).toBe(false);
    expect(resolved.resolvedProfileChain).not.toContain(MARK_DPF_PLATFORM_PROFILE.profileId);
    expect(resolved.materials).toEqual([]);
    expect(resolved.coverageGap).toBe(true);
    expect(resolved.orgProfileSelected).toBe(false);
    expect(resolved.organizationGuidance).toMatchObject({ state: "none", notice: expect.stringMatching(/^No organization guidance/) });
  });

  it("AC-PAC-04 (guidance): an expired snapshot is not used and is reported as expired", async () => {
    const resolved = await resolve({
      role: "companion", snapshot: snapshot([material()], "2026-11-11T12:00:00.000Z"), now,
    });
    expect(resolved.selectedProfileId).toBe(NO_ORGANIZATION_GUIDANCE_PROFILE_ID);
    expect(resolved.materials).toEqual([]);
    expect(resolved.organizationGuidance).toMatchObject({ state: "expired", version: 10, notice: expect.stringMatching(/expired/) });
  });
});
