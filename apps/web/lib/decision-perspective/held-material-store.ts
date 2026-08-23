// Release path for profession material held by the high-stakes review hold
// (BI-5F3BFD13).
//
// packages/db/src/profession-material-promotion.ts deliberately withholds
// derived-tier material for high-stakes families — those whose registry
// contextSlugs touch finance or compliance — from an unattended platform seed.
// Those rows land reviewStatus "draft" / promotionState "candidate": visible
// for audit, invisible to the gate (which requires approved+promoted), "until
// a human approves them".
//
// That hold is correct. What was missing is the human's half: nothing listed
// the held rows and nothing could approve them, so a high-stakes profession
// stayed permanently mute on a fresh install — a hold with no release is
// indistinguishable from a silent drop. This module is that release path.
//
// Deliberately NOT an auto-promoter. It surfaces the nomination and records a
// named human's approval; it never decides on its own.

import type { Prisma } from "@dpf/db";

import { err, ok, type ActionResult } from "@/lib/shared/action-result";

/** Narrow client surface so tests can pass a stub instead of a real Prisma client. */
export type HeldMaterialClient = {
  perspectiveMaterial: {
    findMany(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

/** A profession-material row awaiting the human approval the hold requires. */
export type HeldMaterialRow = {
  materialId: string;
  profileId: string;
  /** Profession family key, derived from the `wsid-<key>` profile id. */
  professionKey: string;
  domainClass: string;
  sourceType: string;
  evidenceGrade: string;
  confidenceWeight: number;
  summary: string | null;
};

/** One family's held rows, the unit the operator actually approves. */
export type HeldMaterialFamily = {
  profileId: string;
  professionKey: string;
  rows: HeldMaterialRow[];
};

export const HELD_REVIEW_STATUS = "draft";
export const HELD_PROMOTION_STATE = "candidate";
export const APPROVED_REVIEW_STATUS = "approved";
export const APPROVED_PROMOTION_STATE = "promoted";

const WSID_PREFIX = "wsid-";

/** `wsid-security` -> `security`. Non-wsid profile ids pass through unchanged. */
export function professionKeyForProfileId(profileId: string): string {
  return profileId.startsWith(WSID_PREFIX) ? profileId.slice(WSID_PREFIX.length) : profileId;
}

/**
 * The exact cohort the gate cannot see: profession material still held at
 * draft/candidate. Scoped to `wsid-` profiles so an org or platform profile's
 * own draft material never appears in a craft-approval queue.
 *
 * Uses the existing [profileId, reviewStatus, promotionState] index.
 */
export async function listHeldProfessionMaterial(
  db: HeldMaterialClient,
): Promise<HeldMaterialFamily[]> {
  const where: Prisma.PerspectiveMaterialWhereInput = {
    profileId: { startsWith: WSID_PREFIX },
    reviewStatus: HELD_REVIEW_STATUS,
    promotionState: HELD_PROMOTION_STATE,
  };

  const rows = (await db.perspectiveMaterial.findMany({
    where,
    orderBy: [{ profileId: "asc" }, { materialId: "asc" }],
    select: {
      materialId: true,
      profileId: true,
      domainClass: true,
      sourceType: true,
      evidenceGrade: true,
      confidenceWeight: true,
      summary: true,
    },
  })) as Array<Omit<HeldMaterialRow, "professionKey">>;

  const byProfile = new Map<string, HeldMaterialFamily>();
  for (const row of rows) {
    const professionKey = professionKeyForProfileId(row.profileId);
    let family = byProfile.get(row.profileId);
    if (!family) {
      family = { profileId: row.profileId, professionKey, rows: [] };
      byProfile.set(row.profileId, family);
    }
    family.rows.push({ ...row, professionKey });
  }
  return [...byProfile.values()];
}

/** Success carries the number of rows released to the gate. */
export type ApproveHeldMaterialResult = ActionResult<number>;

/**
 * Release one family's held material to the gate.
 *
 * Scoped by the held state itself, so it is idempotent and can never pull an
 * already-approved row backwards — the same non-downgrade invariant
 * profession-material-promotion.ts holds on the write side. Approving a family
 * that has nothing held is reported, not silently treated as success: a
 * no-op that reads as an approval is how a hold gets believed to be released
 * when it never was.
 */
export async function approveHeldProfessionMaterial(
  db: HeldMaterialClient,
  input: { profileId: string; approvedByUserId: string; now?: Date },
): Promise<ApproveHeldMaterialResult> {
  const result = await db.perspectiveMaterial.updateMany({
    where: {
      profileId: input.profileId,
      reviewStatus: HELD_REVIEW_STATUS,
      promotionState: HELD_PROMOTION_STATE,
    },
    data: {
      reviewStatus: APPROVED_REVIEW_STATUS,
      promotionState: APPROVED_PROMOTION_STATE,
      reviewedByUserId: input.approvedByUserId,
      reviewedAt: input.now ?? new Date(),
    },
  });

  if (result.count === 0) return err("no-held-material");
  return ok(result.count);
}
