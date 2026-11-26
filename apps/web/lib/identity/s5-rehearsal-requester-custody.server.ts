import "server-only";

import { prisma, type Prisma } from "@dpf/db";

import { revokeAccountAgentAccessInTransaction } from "@/lib/auth/account-agent-access";
import {
  SETUP_LOCK_PREFIX,
  decideOwnerBinding,
  deriveRequesterSetupDigest,
  evaluateRequesterState,
  hasExactSameOriginEvidence,
  held,
  readRequesterState,
  refused,
  servedOwnerReceiptPort,
  writeRequesterAudit,
  type OwnerDecision,
  type RequestScope,
  type RequesterAuditInput,
  type RequesterBoundaryResult,
  type RequesterCommandInput,
  type RequesterSql,
  type RequesterStateRow,
  type RequesterTxResult,
} from "./s5-rehearsal-enrollment.server";

/**
 * BI-9F7192F9 custody of the S5 rehearsal requester after enrollment: the
 * read-only status recovery (phase 6), retirement (phase 9, AC-E6) and the
 * read-only verification seam (phase 10, AC-E8). Design:
 * docs/superpowers/specs/2026-11-26-s5-rehearsal-requester-enrollment-design.md
 */

/**
 * Lost-acknowledgement recovery, read only. On one pinned connection: the
 * session-level per-setup lock first (so it waits for an in-flight enroll),
 * then one REPEATABLE READ READ ONLY snapshot, then unlock. Never creates.
 */
export async function readRequesterStatus(conn: RequesterSql, setupDigest: string): Promise<RequesterBoundaryResult> {
  const key = SETUP_LOCK_PREFIX + setupDigest;
  await conn.query("SELECT true AS locked FROM pg_advisory_lock(hashtextextended($1, 0))", [key]);
  try {
    await conn.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    let row: RequesterStateRow | null;
    let present: boolean;
    try {
      present = (await conn.query(`SELECT 1 AS present FROM "S5RehearsalRequesterEnrollment" WHERE "setupDigest" = $1`, [setupDigest])).length > 0;
      row = await readRequesterState(conn, setupDigest);
      await conn.query("COMMIT");
    } catch (error) {
      await conn.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    if (!present) return { status: 200, body: { outcome: "not_committed", setupDigest } };
    return { status: 200, body: { outcome: "committed", setupDigest, verification: evaluateRequesterState(row, { setupDigest }) } };
  } finally {
    await conn.query("SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked", [key]);
  }
}

export type RequesterStatusPorts = {
  environmentClass(): Promise<string>;
  canonicalOrigin(request: Request): string | null;
  sessionUserId(): Promise<string | null>;
  /** Owner binding plus the lease-independent installation and DB proofs; denies until served. */
  statusProofs(userId: string): Promise<{ ok: true } | { ok: false; code: string }>;
  pinnedConnection<T>(run: (conn: RequesterSql) => Promise<T>): Promise<T>;
};

/** GET …/status?setupDigest=: gated like retirement, keyed only by the digest, never accepts a body. */
export async function handleRequesterStatus(request: Request, rawCommand: string, ports: RequesterStatusPorts): Promise<RequesterBoundaryResult> {
  if ((await ports.environmentClass()) === "production") return refused(403, "production_refused");
  if (!hasExactSameOriginEvidence(request, ports.canonicalOrigin(request))) return refused(403, "origin_refused");
  const userId = await ports.sessionUserId();
  if (!userId) return refused(401, "session_required");
  if (rawCommand !== "status") return refused(404, "unknown_command");
  const setupDigest = new URL(request.url).searchParams.get("setupDigest");
  if (!setupDigest || !/^[a-f0-9]{64}$/u.test(setupDigest)) return held(400, "setup_digest_invalid");
  const proofs = await ports.statusProofs(userId);
  if (!proofs.ok) return held(409, proofs.code);
  return ports.pinnedConnection((conn) => readRequesterStatus(conn, setupDigest));
}

/** Served status ports: the proofs deny until owner binding (BI-C7100183) and the preview proofs are served. */
export function servedRequesterStatusPorts(deps: Pick<RequesterStatusPorts, "environmentClass" | "canonicalOrigin" | "sessionUserId">): RequesterStatusPorts {
  return {
    ...deps,
    statusProofs: async () => ({ ok: false, code: "owner_binding_unavailable" }),
    pinnedConnection: async () => { throw new Error("status connection is not served"); },
  };
}

// ── Phase 9: retirement (AC-E6) ─────────────────────────────────────────────

/** Effects of one retirement. Each proof owned elsewhere is a port that denies until its owner serves it. */
export type RetirementDeps = {
  ownerBinding(scope: RequestScope, userId: string): Promise<OwnerDecision>;
  /** Same-connection DB identity (BI-5C193A3F); null until served. */
  dbIdentity(scope: RequestScope): Promise<string | null>;
  /** Installation attestation (BI-8EA98961); null until served. */
  installationAttestation(scope: RequestScope): Promise<string | null>;
  revokeTokensAndClients(scope: RequestScope, input: { userId: string; revokedAt: Date; revokedReason: string }): Promise<void>;
  writeAudit(scope: RequestScope, input: RequesterAuditInput): Promise<void>;
  /** A fresh REPEATABLE READ READ ONLY snapshot, after the retirement transaction ended. */
  readback(setupDigest: string): Promise<RequesterStateRow | null>;
};

type LockedRecord = {
  userId: string; principalId: string; lifecycle: "active" | "retired";
  rulingRef: string; reservationRef: string; attemptRef: string; fixtureRef: string;
  installationRef: string; leaseRef: string; dbIdentityRef: string;
};

/** Owner-binding codes that mean the actor lacks authority (refuse); the rest are holds. */
const ACTOR_REFUSALS = new Set(["actor_inactive", "automation_actor", "handed_over_actor", "requester_actor", "not_owner", "owner_capability_missing"]);

const committedUnverified = (setupDigest: string): RequesterBoundaryResult =>
  ({ status: 202, body: { outcome: "committed_unverified", reason: "requester_state_unverified", setupDigest } });

/** Fresh readback through the shared verification: `retired` only when every fact verifies. */
async function retirementReadback(
  deps: RetirementDeps,
  target: { setupDigest: string; userId: string; principalId: string },
  mode: "committed" | "repeat",
): Promise<RequesterBoundaryResult> {
  let state: ReturnType<typeof evaluateRequesterState>;
  try {
    state = evaluateRequesterState(await deps.readback(target.setupDigest), target);
  } catch {
    state = { verified: false };
  }
  if (state.verified && state.lifecycle === "retired") return { status: 200, body: { outcome: "retired", setupDigest: target.setupDigest } };
  return mode === "committed" ? committedUnverified(target.setupDigest) : held(409, "requester_state_unverified");
}

/**
 * Retirement, inside the fenced Read Committed request transaction. The
 * record is locked first; authority, DB identity, installation and the exact
 * alias are checked under the lock before any branch, for first attempts and
 * repeats alike. A repeat writes nothing. The result is decided by a fresh
 * readback after the transaction ends.
 */
export async function executeRetirement(
  input: Extract<RequesterCommandInput, { command: "retire" }>,
  scope: RequestScope,
  deps: RetirementDeps,
): Promise<RequesterTxResult> {
  const { setupDigest } = input;
  const record = (await scope.sql.query(
    `SELECT "userId", "principalId", lifecycle::text AS lifecycle, "rulingRef", "reservationRef", "attemptRef", "fixtureRef",
       "installationRef", "leaseRef", "dbIdentityRef"
     FROM "S5RehearsalRequesterEnrollment" WHERE "setupDigest" = $1 FOR UPDATE`, [setupDigest]))[0] as LockedRecord | undefined;
  if (!record) return held(409, "requester_record_missing");

  const owner = await deps.ownerBinding(scope, input.userId);
  if (!owner.ok) return ACTOR_REFUSALS.has(owner.code) ? refused(403, owner.code) : held(409, owner.code);
  if ((await deps.dbIdentity(scope)) !== record.dbIdentityRef) return held(409, "db_identity_mismatch");
  if ((await deps.installationAttestation(scope)) !== record.installationRef) return held(409, "installation_mismatch");
  const alias = (await scope.sql.query(
    `SELECT count(*)::int AS total,
       count(*) FILTER (WHERE "aliasType" = 'user' AND "aliasValue" = $2 AND issuer = '')::int AS exact
     FROM "PrincipalAlias" WHERE "principalId" = $1`, [record.principalId, record.userId]))[0];
  if (alias?.total !== 1 || alias?.exact !== 1) return held(409, "requester_alias_drift");

  const target = { setupDigest, userId: record.userId, principalId: record.principalId };
  if (record.lifecycle === "retired") {
    return { ...held(409, "requester_state_unverified"), after: () => retirementReadback(deps, target, "repeat") };
  }

  await scope.sql.query(
    `UPDATE "AuthorityBinding" SET status = 'revoked', "updatedAt" = now()
     WHERE "oauthUserId" = $1 AND status <> 'revoked' RETURNING 1 AS revoked`, [record.userId]);
  await deps.revokeTokensAndClients(scope, {
    userId: record.userId, revokedAt: new Date(),
    revokedReason: `s5_rehearsal_requester_retired: ${input.retirementReason} (by ${owner.ownerPrincipalId})`,
  });
  await scope.sql.query(`UPDATE "User" SET "isActive" = false WHERE id = $1 RETURNING 1 AS updated`, [record.userId]);
  await scope.sql.query(`UPDATE "Principal" SET status = 'inactive', "updatedAt" = now() WHERE id = $1 RETURNING 1 AS updated`, [record.principalId]);
  const terminal = await scope.sql.query(
    `UPDATE "S5RehearsalRequesterEnrollment"
     SET lifecycle = 'retired', "lifecycleAt" = now(),
         "retirementReason" = $2::"S5RehearsalRequesterRetirementReason", "retiredByPrincipalId" = $3
     WHERE "setupDigest" = $1 AND lifecycle = 'active' RETURNING 1 AS retired`,
    [setupDigest, input.retirementReason, owner.ownerPrincipalId]);
  if (terminal.length !== 1) throw new Error("terminal write did not apply");
  const { rulingRef, reservationRef, attemptRef, fixtureRef, installationRef, leaseRef, dbIdentityRef } = record;
  await deps.writeAudit(scope, {
    command: "retire", setupDigest, ownerUserId: input.userId, ownerPrincipalId: owner.ownerPrincipalId,
    requesterUserId: record.userId, retirementReason: input.retirementReason,
    refs: { rulingRef, reservationRef, attemptRef, fixtureRef, installationRef, leaseRef, dbIdentityRef },
  });
  return {
    status: 200,
    body: { outcome: "retired", setupDigest },
    commit: { ifCommitLost: committedUnverified(setupDigest) },
    after: () => retirementReadback(deps, target, "committed"),
  };
}

/** Served retirement effects: the owner receipt, DB identity and installation proofs deny until served. */
export function servedRetirementDeps(installationRef: string): RetirementDeps {
  return {
    ownerBinding: (scope, userId) => decideOwnerBinding(
      { $queryRawUnsafe: (q, ...values) => scope.sql.query(q, values) }, userId, servedOwnerReceiptPort(installationRef)),
    dbIdentity: async () => null,
    installationAttestation: async () => null,
    revokeTokensAndClients: async (scope, input) => {
      await revokeAccountAgentAccessInTransaction(scope.client as Prisma.TransactionClient, input);
    },
    writeAudit: (scope, input) => writeRequesterAudit(scope.client as Prisma.TransactionClient, input),
    readback: (setupDigest) => prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return readRequesterState({ query: (q, values = []) => tx.$queryRawUnsafe(q, ...values) }, setupDigest);
    }, { isolationLevel: "RepeatableRead" }),
  };
}

// ── Phase 10: read-only verification seam (AC-E8) ───────────────────────────

/** The narrow reads the seam needs; no mutator is reachable through it. */
export type EnrollmentSeamDb = {
  s5RehearsalRequesterEnrollment: Pick<Prisma.TransactionClient["s5RehearsalRequesterEnrollment"], "findUnique">;
  authorizationDecisionLog: Pick<Prisma.TransactionClient["authorizationDecisionLog"], "findMany">;
  user: Pick<Prisma.TransactionClient["user"], "findUnique">;
  principal: Pick<Prisma.TransactionClient["principal"], "findUnique">;
  authorityBinding: Pick<Prisma.TransactionClient["authorityBinding"], "findMany">;
  mcpApiToken: Pick<Prisma.TransactionClient["mcpApiToken"], "count">;
  oAuthRefreshToken: Pick<Prisma.TransactionClient["oAuthRefreshToken"], "count">;
  oAuthClient: Pick<Prisma.TransactionClient["oAuthClient"], "count">;
};

const RECORD_SELECT = {
  id: true, setupDigest: true, rulingRef: true, reservationRef: true, attemptRef: true, fixtureRef: true,
  installationRef: true, leaseRef: true, dbIdentityRef: true, userId: true, principalId: true,
  enrolledByPrincipalId: true, enrolledAt: true, lifecycle: true, lifecycleAt: true, retirementReason: true, retiredByPrincipalId: true,
} as const;

/**
 * Explicit read-only projections of one enrollment, for the provisioner to
 * verify without credential access. Never returns a password hash, a token or
 * session material, and calls no mutator. Null when no record exists.
 */
export async function readS5RehearsalEnrollment(
  refs: { rulingRef: string; reservationRef: string },
  tx: EnrollmentSeamDb = prisma,
) {
  const setupDigest = deriveRequesterSetupDigest(refs);
  const record = await tx.s5RehearsalRequesterEnrollment.findUnique({ where: { setupDigest }, select: RECORD_SELECT });
  if (!record) return null;
  const [audit, user, principal, bindings, accessTokens, refreshTokens, ownedClients] = await Promise.all([
    tx.authorizationDecisionLog.findMany({
      where: { decisionId: { in: [`s5rr:enroll:${setupDigest}`, `s5rr:retire:${setupDigest}`] } },
      select: { decisionId: true, actionKey: true, decision: true, actorRef: true, objectRef: true, rationale: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    tx.user.findUnique({
      where: { id: record.userId },
      select: {
        id: true, email: true, isActive: true, isSuperuser: true, workHandedOverAt: true,
        automationVerificationId: true, automationProfile: true, automationSlot: true, automationExpiresAt: true,
      },
    }),
    tx.principal.findUnique({
      where: { id: record.principalId },
      select: { id: true, principalId: true, kind: true, status: true, aliases: { select: { aliasType: true, aliasValue: true, issuer: true } } },
    }),
    tx.authorityBinding.findMany({
      where: { oauthUserId: record.userId },
      select: { bindingId: true, status: true, oauthPurpose: true, oauthClientId: true },
    }),
    tx.mcpApiToken.count({ where: { userId: record.userId, revokedAt: null } }),
    tx.oAuthRefreshToken.count({ where: { userId: record.userId, revokedAt: null } }),
    tx.oAuthClient.count({ where: { ownerUserId: record.userId, registrationKind: "credentials", revokedAt: null } }),
  ]);
  return {
    record,
    audit: audit.length > 0 ? audit : ("audit-expired" as const),
    user: user && {
      id: user.id, email: user.email, isActive: user.isActive, isSuperuser: user.isSuperuser,
      handedOver: user.workHandedOverAt !== null,
      automation: user.automationVerificationId !== null || user.automationProfile !== null
        || user.automationSlot !== null || user.automationExpiresAt !== null,
    },
    principal: principal && { id: principal.id, principalId: principal.principalId, kind: principal.kind, status: principal.status, aliases: principal.aliases },
    bindings,
    unrevokedTokens: accessTokens + refreshTokens,
    ownedClients,
  };
}

export type S5RehearsalEnrollmentProjection = NonNullable<Awaited<ReturnType<typeof readS5RehearsalEnrollment>>>;

/**
 * What the provisioner may do with the requester in this item: always hold.
 * Activation, delegation and issuance belong to BI-9F5D1052.
 */
export function requesterProvisionerDisposition(projection: S5RehearsalEnrollmentProjection | null):
  { disposition: "hold"; reason: "requester_missing" | "requester_retired" | "requester_inactive" | "activation_not_served" } {
  if (!projection) return { disposition: "hold", reason: "requester_missing" };
  if (projection.record.lifecycle === "retired") return { disposition: "hold", reason: "requester_retired" };
  if (!projection.user?.isActive || projection.principal?.status !== "active") return { disposition: "hold", reason: "requester_inactive" };
  return { disposition: "hold", reason: "activation_not_served" };
}
