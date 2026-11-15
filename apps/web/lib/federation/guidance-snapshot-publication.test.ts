import { describe, expect, it, vi } from "vitest";

import { validateGuidanceSnapshotV1, computeGuidanceSnapshotManifest } from "@dpf/db/guidance-snapshot-contract";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { buildAuthorityWwwd, type AuthorityGuidanceDb } from "./guidance-snapshot-publication";

function db(rows: unknown[], profile: unknown = {
  profileId: "wwwd-org-1", name: "Operator organization", fallbackProfileId: "dpf-organizational-principles",
  autonomyPolicy: { allowRecommendation: true }, defaultResolver: null,
}) {
  const findMany = vi.fn(async () => rows);
  return {
    findMany,
    db: {
      decisionPerspectiveProfile: {
        findFirst: async () => (profile ? { profileId: "wwwd-org-1" } : null),
        findUnique: async () => profile,
      },
      perspectiveMaterial: { findMany },
    } satisfies AuthorityGuidanceDb,
  };
}

const row = {
  materialId: "PM-1", sourceType: "organization-stance", sourceRef: { principleDirection: "oppose" }, summary: null,
  domainClass: "plan-readiness", direction: null, domains: ["all-business-domains"], freshness: "current",
  evidenceGrade: "A", confidenceWeight: 0.9, lastValidatedAt: new Date("2026-11-01T00:00:00.000Z"),
};

describe("buildAuthorityWwwd", () => {
  it("carries the organization profile and only approved, promoted material, in a valid shape", async () => {
    const { db: fake, findMany } = db([row]);
    const wwwd = await buildAuthorityWwwd(fake, "org-1");
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { profileId: "wwwd-org-1", reviewStatus: "approved", promotionState: "promoted" },
    }));
    expect(wwwd?.profile).toMatchObject({ profileId: "wwwd-org-1", fallbackProfileId: "dpf-organizational-principles" });
    expect(wwwd?.materials[0]).toMatchObject({ direction: "oppose", summary: "", lastValidatedAt: "2026-11-01T00:00:00.000Z" });
    const violations = validateGuidanceSnapshotV1({
      specVersion: "dpf.guidance-snapshot/1",
      meta: {
        authorityInstallationDid: `did_${"a".repeat(64)}`, authoritySigningPublicKey: "key",
        companionInstallationDid: `did_${"c".repeat(64)}`, version: 1,
        issuedAt: "2026-11-11T00:00:00.000Z", expiresAt: "2026-11-25T00:00:00.000Z", // clock-bomb-guard: allow shape validation only; no clock is read
      },
      wwwd, manifest: computeGuidanceSnapshotManifest(wwwd!), signature: "a.b.c",
    });
    expect(violations).toEqual([]);
  });

  it("publishes nothing when the organization has no profile", async () => {
    expect(await buildAuthorityWwwd(db([row], null).db, "org-1")).toBeNull();
    expect(await buildAuthorityWwwd(db([row]).db, null)).toBeNull();
  });

  it("refuses rather than truncating doctrine that will not fit", async () => {
    const many = Array.from({ length: 2001 }, (_, index) => ({ ...row, materialId: `PM-${index}` }));
    await expect(buildAuthorityWwwd(db(many).db, "org-1")).rejects.toThrow(/cannot carry them all/);
  });
});
