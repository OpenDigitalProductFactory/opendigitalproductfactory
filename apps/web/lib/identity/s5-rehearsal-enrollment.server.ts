import "server-only";

import { prisma } from "@dpf/db";

/**
 * BI-9F7192F9: owner-operated inactive enrollment and retirement of the S5
 * rehearsal requester. Design:
 * docs/superpowers/specs/2026-11-26-s5-rehearsal-requester-enrollment-design.md
 *
 * Phase 1 delivers the single durable marker read. A User is a governed
 * requester exactly when an S5RehearsalRequesterEnrollment row names it,
 * active or retired; the row cannot be deleted while the identity survives.
 */

/** The narrow read this module needs: one unique-index lookup by userId. */
export type GovernedRequesterReader = {
  s5RehearsalRequesterEnrollment: {
    findUnique(args: { where: { userId: string }; select: { id: true } }): Promise<{ id: string } | null>;
  };
};

/**
 * The marker could not be read. Guards must treat this as "governed" and
 * refuse: an unreadable marker never downgrades to "ordinary user".
 */
export class GovernedRequesterReadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GovernedRequesterReadError";
  }
}

/**
 * True when the user is an enrolled S5 rehearsal requester (active or
 * retired). One unique-index read; fails closed by throwing
 * GovernedRequesterReadError on a bad id or any read error.
 */
export async function isGovernedRequester(
  userId: string,
  db: GovernedRequesterReader = prisma,
): Promise<boolean> {
  if (typeof userId !== "string" || userId.trim() === "") {
    throw new GovernedRequesterReadError("governed requester check needs a userId");
  }
  let row: { id: string } | null;
  try {
    row = await db.s5RehearsalRequesterEnrollment.findUnique({ where: { userId }, select: { id: true } });
  } catch (cause) {
    throw new GovernedRequesterReadError("governed requester marker could not be read", { cause });
  }
  return row !== null;
}
