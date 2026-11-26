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

// ── Audit evidence (phase 3, AC-E8) ─────────────────────────────────────────
// Each successful command writes one typed, transaction-bound
// AuthorizationDecisionLog row. Audit only: lifecycle never reads it, the S5
// approval reader rejects it (different actionKey and decision) and M-4
// excludes it.

export const S5_REQUESTER_AUDIT_ACTION_KEYS = {
  enroll: "s5.rehearsal-requester.enroll",
  retire: "s5.rehearsal-requester.retire",
} as const;

export type RequesterAuditCommand = keyof typeof S5_REQUESTER_AUDIT_ACTION_KEYS;

export const S5_REQUESTER_RETIREMENT_REASONS = [
  "rehearsal_complete",
  "quarantine_after_failure",
  "setup_superseded",
  "operator_cleanup",
] as const;

export type RequesterEvidenceRefs = {
  rulingRef: string;
  reservationRef: string;
  attemptRef: string;
  fixtureRef: string;
  installationRef: string;
  leaseRef: string;
  dbIdentityRef: string;
};

export type RequesterAuditInput = {
  command: RequesterAuditCommand;
  setupDigest: string;
  ownerUserId: string;
  ownerPrincipalId: string;
  requesterUserId: string;
  refs: RequesterEvidenceRefs;
  retirementReason?: (typeof S5_REQUESTER_RETIREMENT_REASONS)[number];
};

const REF_KEYS: ReadonlyArray<keyof RequesterEvidenceRefs> = [
  "rulingRef", "reservationRef", "attemptRef", "fixtureRef", "installationRef", "leaseRef", "dbIdentityRef",
];

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`requester audit row needs ${field}`);
  return value;
}

/** The exact AuthorizationDecisionLog create data for one command; references only, never credentials. */
export function buildRequesterAuditRow(input: RequesterAuditInput) {
  const actionKey = S5_REQUESTER_AUDIT_ACTION_KEYS[input.command];
  if (!actionKey) throw new Error("requester audit row needs a known command");
  if (typeof input.setupDigest !== "string" || !/^[a-f0-9]{64}$/u.test(input.setupDigest)) {
    throw new Error("requester audit row needs a full sha256 setup digest");
  }
  const refs = Object.fromEntries(REF_KEYS.map((key) => [key, requireText(input.refs?.[key], key)]));
  const rationale: Record<string, string> = {
    schema: "s5-rehearsal-requester-audit.v1",
    command: input.command,
    setupDigest: input.setupDigest,
    ownerPrincipalId: requireText(input.ownerPrincipalId, "ownerPrincipalId"),
    ...refs,
  };
  if (input.command === "retire") {
    if (!input.retirementReason || !S5_REQUESTER_RETIREMENT_REASONS.includes(input.retirementReason)) {
      throw new Error("requester retirement audit row needs a retirement reason");
    }
    rationale.retirementReason = input.retirementReason;
  }
  const ownerUserId = requireText(input.ownerUserId, "ownerUserId");
  return {
    decisionId: `s5rr:${input.command}:${input.setupDigest}`,
    actorType: "human",
    actorRef: ownerUserId,
    humanContextRef: ownerUserId,
    actionKey,
    objectRef: requireText(input.requesterUserId, "requesterUserId"),
    decision: "allow",
    purposeOfUse: "s5-rehearsal-requester-custody",
    policyVersion: "s5-rehearsal-requester.v1",
    rationale,
  };
}

/** Write the command's audit row inside the caller's transaction. */
export async function writeRequesterAudit(
  tx: { authorizationDecisionLog: { create(args: { data: ReturnType<typeof buildRequesterAuditRow> }): Promise<unknown> } },
  input: RequesterAuditInput,
): Promise<void> {
  await tx.authorizationDecisionLog.create({ data: buildRequesterAuditRow(input) });
}
