import { describe, expect, it, vi } from "vitest";

import {
  approveHeldProfessionMaterial,
  listHeldProfessionMaterial,
  professionKeyForProfileId,
  type HeldMaterialClient,
} from "./held-material-store";

function client(overrides: {
  findMany?: unknown[];
  updateCount?: number;
}): { db: HeldMaterialClient; findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> } {
  const findMany = vi.fn().mockResolvedValue(overrides.findMany ?? []);
  const updateMany = vi.fn().mockResolvedValue({ count: overrides.updateCount ?? 0 });
  return { db: { perspectiveMaterial: { findMany, updateMany } }, findMany, updateMany };
}

const heldRow = (profileId: string, materialId: string) => ({
  materialId,
  profileId,
  domainClass: "professional-practice",
  sourceType: "principle",
  evidenceGrade: "B",
  confidenceWeight: 0.6,
  summary: null,
});

describe("listHeldProfessionMaterial (BI-5F3BFD13)", () => {
  it("queries exactly the cohort the gate cannot see", async () => {
    const { db, findMany } = client({});
    await listHeldProfessionMaterial(db);

    const where = (findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({
      profileId: { startsWith: "wsid-" },
      reviewStatus: "draft",
      promotionState: "candidate",
    });
  });

  it("groups held rows by family and derives the profession key", async () => {
    const { db } = client({
      findMany: [
        heldRow("wsid-security", "wsid-security:professions/security/threat-modeling"),
        heldRow("wsid-security", "wsid-security:professions/security/never-hardcode-secrets"),
        heldRow("wsid-legal-compliance", "wsid-legal-compliance:professions/legal/x"),
      ],
    });

    const families = await listHeldProfessionMaterial(db);
    expect(families).toHaveLength(2);
    expect(families[0]).toMatchObject({ profileId: "wsid-security", professionKey: "security" });
    expect(families[0].rows).toHaveLength(2);
    expect(families[1].professionKey).toBe("legal-compliance");
  });

  it("returns no families when nothing is held", async () => {
    const { db } = client({});
    await expect(listHeldProfessionMaterial(db)).resolves.toEqual([]);
  });
});

describe("approveHeldProfessionMaterial (BI-5F3BFD13)", () => {
  it("releases the family to the gate and records the approving human", async () => {
    const { db, updateMany } = client({ updateCount: 6 });
    const now = new Date("2026-08-23T04:00:00.000Z");

    const result = await approveHeldProfessionMaterial(db, {
      profileId: "wsid-security",
      approvedByUserId: "user-1",
      now,
    });

    expect(result).toEqual({ ok: true, data: 6 });
    const args = updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(args.data).toEqual({
      reviewStatus: "approved",
      promotionState: "promoted",
      reviewedByUserId: "user-1",
      reviewedAt: now,
    });
  });

  it("scopes the write to held rows so an approved row can never be pulled backwards", async () => {
    // The same non-downgrade invariant profession-material-promotion.ts holds
    // on the write side: approving twice must not disturb the first approval.
    const { db, updateMany } = client({ updateCount: 6 });
    await approveHeldProfessionMaterial(db, {
      profileId: "wsid-security",
      approvedByUserId: "user-1",
    });

    const where = (updateMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).toEqual({
      profileId: "wsid-security",
      reviewStatus: "draft",
      promotionState: "candidate",
    });
  });

  it("reports a no-op rather than passing it off as an approval", async () => {
    // A hold believed released when it never was is the failure this whole
    // module exists to prevent; a silent success here would recreate it.
    const { db } = client({ updateCount: 0 });
    await expect(
      approveHeldProfessionMaterial(db, {
        profileId: "wsid-security",
        approvedByUserId: "user-1",
      }),
    ).resolves.toEqual({ ok: false, error: "no-held-material" });
  });
});

describe("professionKeyForProfileId", () => {
  it("strips the wsid- prefix and passes other profile ids through", () => {
    expect(professionKeyForProfileId("wsid-mcp-integration")).toBe("mcp-integration");
    expect(professionKeyForProfileId("mark-dpf-platform")).toBe("mark-dpf-platform");
  });
});
