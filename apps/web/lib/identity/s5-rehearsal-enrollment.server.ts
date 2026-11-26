import "server-only";

import { createHash } from "node:crypto";

import { prisma, type Prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";

import { PERMISSIONS } from "@/lib/govern/permissions";
import { passwordPolicyErrors } from "@/lib/identity/password-policy";

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

// ── Request boundary (phase 4, AC-E1) ───────────────────────────────────────
// POST /api/admin/rehearsal-requester/[command]. Every check before the body
// read is ordered exactly as the design's "Request boundary" section, and each
// refusal or hold returns before the body reader, the hasher or any mutator.

export type RequesterCommand = "enroll" | "retire";

export type EnrollSetupContext = {
  v: 1; command: "enroll";
  rulingRef: string; reservationRef: string; reservationRevision: string; attemptRef: string; fixtureRef: string;
};
export type RetireSetupContext = { v: 1; command: "retire"; setupDigest: string };
export type RequesterSetupContext = EnrollSetupContext | RetireSetupContext;

export type RequesterCommandInput =
  | { command: "enroll"; userId: string; setupDigest: string; context: EnrollSetupContext; password: string }
  | { command: "retire"; userId: string; setupDigest: string; context: RetireSetupContext; retirementReason: (typeof S5_REQUESTER_RETIREMENT_REASONS)[number] };

export type RequesterBoundaryResult = { status: number; body: Record<string, unknown> };
/** A result decided inside the request transaction; only one carrying `commit` is committed, every other rolls back. */
export type RequesterTxResult = RequesterBoundaryResult & { commit?: { ifCommitLost: RequesterBoundaryResult } };

/** Injected effects, so the ordering is testable and the served adapters can deny until their owners land. */
export type RequesterBoundaryPorts = {
  environmentClass(): Promise<string>;
  canonicalOrigin(request: Request): string | null;
  sessionUserId(): Promise<string | null>;
  /** BI-588688A7 one-shot owner: does the live reservation still equal the context exactly? */
  currentReservation(context: EnrollSetupContext): Promise<"matches" | "released" | "replaced" | "unavailable">;
  retainedRecord(setupDigest: string): Promise<{ lifecycle: "active" | "retired" } | null>;
  readiness(command: RequesterCommand): Promise<{ ready: true } | { ready: false; code: string }>;
  /**
   * The one request-scoped transaction. Its first statement is the shared
   * destination-fence try-lock (`clone_in_progress` when a clone holds it), and
   * it holds the fence through the pre-body checks, the body read and the write.
   */
  requestTransaction(run: (scope: RequestScope) => Promise<RequesterTxResult>): Promise<RequesterBoundaryResult>;
  preBodyOwnerAndDb(command: RequesterCommand, userId: string, setupDigest: string, scope: RequestScope):
    Promise<{ ok: true } | { ok: false; code: string }>;
  verifyRequesterState(setupDigest: string, context: EnrollSetupContext):
    Promise<{ verified: true; lifecycle: "active" | "retired"; factsMatch: boolean } | { verified: false }>;
  readBody(request: Request): Promise<string>;
  /** The hasher and every mutator live behind this port; it is reached only after every check passed. */
  execute(input: RequesterCommandInput, scope: RequestScope): Promise<RequesterTxResult>;
};

const SETUP_SCHEMA = "s5-rehearsal-setup.v1";
const MAX_BODY_BYTES = 4096;
const MAX_PASSWORD_BYTES = 72;
const MAX_REF_LENGTH = 200;
const ENROLL_CONTEXT_KEYS = ["v", "command", "rulingRef", "reservationRef", "reservationRevision", "attemptRef", "fixtureRef"];
const RETIRE_CONTEXT_KEYS = ["v", "command", "setupDigest"];

const held = (status: number, code: string): RequesterBoundaryResult => ({ status, body: { outcome: "held", code } });
const refused = (status: number, code: string): RequesterBoundaryResult => ({ status, body: { outcome: "refused", code } });

/** The setup digest is derived on the server from the verified refs; a caller-supplied digest is never accepted. */
export function deriveRequesterSetupDigest(context: Pick<EnrollSetupContext, "rulingRef" | "reservationRef">): string {
  return createHash("sha256")
    .update(canonicalJson({ schema: SETUP_SCHEMA, rulingRef: context.rulingRef, reservationRef: context.reservationRef }))
    .digest("hex");
}

/** Server-side issuance of the opaque locator; it names the reviewed setup and carries no authority. */
export function encodeRequesterSetupContext(context: RequesterSetupContext): string {
  return Buffer.from(JSON.stringify(context), "utf8").toString("base64url");
}

function isRef(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= MAX_REF_LENGTH;
}

export function parseRequesterSetupContext(raw: string | null, command: RequesterCommand): RequesterSetupContext | null {
  if (!raw || !/^[A-Za-z0-9_-]+$/u.test(raw)) return null;
  let value: unknown;
  try { value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (record.v !== 1 || record.command !== command) return null;
  if (command === "enroll") {
    if (keys.join() !== [...ENROLL_CONTEXT_KEYS].sort().join()) return null;
    const refs = ["rulingRef", "reservationRef", "reservationRevision", "attemptRef", "fixtureRef"] as const;
    if (!refs.every((key) => isRef(record[key]))) return null;
    return record as unknown as EnrollSetupContext;
  }
  if (keys.join() !== [...RETIRE_CONTEXT_KEYS].sort().join()) return null;
  if (typeof record.setupDigest !== "string" || !/^[a-f0-9]{64}$/u.test(record.setupDigest)) return null;
  return record as unknown as RetireSetupContext;
}

/** Positive, exact same-origin evidence; stricter than the OAuth authorize precedent (both absent refuses). */
export function hasExactSameOriginEvidence(request: Request, canonicalOrigin: string | null): boolean {
  if (!canonicalOrigin) return false;
  const origin = request.headers.get("origin");
  if (origin !== null) return origin === canonicalOrigin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

/** Bounded strict form body: at most 4 KiB, urlencoded, exactly the command's one field. */
function parseRequesterBody(raw: string, contentType: string | null, command: RequesterCommand):
  { password: string } | { retirementReason: (typeof S5_REQUESTER_RETIREMENT_REASONS)[number] } | null {
  if ((contentType ?? "").split(";")[0]?.trim().toLowerCase() !== "application/x-www-form-urlencoded") return null;
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return null;
  const form = new URLSearchParams(raw);
  const keys = [...form.keys()];
  const field = command === "enroll" ? "password" : "retirementReason";
  if (keys.length !== 1 || keys[0] !== field) return null;
  const value = form.get(field) ?? "";
  if (command === "enroll") {
    const bytes = Buffer.byteLength(value, "utf8");
    return bytes >= 1 && bytes <= MAX_PASSWORD_BYTES ? { password: value } : null;
  }
  return (S5_REQUESTER_RETIREMENT_REASONS as readonly string[]).includes(value)
    ? { retirementReason: value as (typeof S5_REQUESTER_RETIREMENT_REASONS)[number] } : null;
}

export async function handleRequesterCommand(
  request: Request,
  rawCommand: string,
  ports: RequesterBoundaryPorts,
): Promise<RequesterBoundaryResult> {
  // 1. Production refuses before anything else.
  if ((await ports.environmentClass()) === "production") return refused(403, "production_refused");
  // 2. Positive, exact same-origin evidence.
  if (!hasExactSameOriginEvidence(request, ports.canonicalOrigin(request))) return refused(403, "origin_refused");
  // 3. A session.
  const userId = await ports.sessionUserId();
  if (!userId) return refused(401, "session_required");
  // 4. The command, from the path only.
  if (rawCommand !== "enroll" && rawCommand !== "retire") return refused(404, "unknown_command");
  const command: RequesterCommand = rawCommand;
  // 5. The server-issued setup context, strictly parsed from the query.
  const context = parseRequesterSetupContext(new URL(request.url).searchParams.get("setupContext"), command);
  if (!context) return held(400, "setup_context_invalid");
  const setupDigest = context.command === "enroll" ? deriveRequesterSetupDigest(context) : context.setupDigest;
  // 6. Compare the context with current owner evidence.
  if (context.command === "enroll") {
    const reservation = await ports.currentReservation(context);
    if (reservation !== "matches") return held(409, `reservation_${reservation}`);
  } else if (!(await ports.retainedRecord(setupDigest))) {
    return held(409, "requester_record_missing");
  }
  // 7. Readiness: are the proofs owned elsewhere served at all?
  const readiness = await ports.readiness(command);
  if (!readiness.ready) return held(409, readiness.code);
  // 8 onward run inside the one fenced request transaction.
  return ports.requestTransaction(async (scope) => {
    const owner = await ports.preBodyOwnerAndDb(command, userId, setupDigest, scope);
    if (!owner.ok) return held(409, owner.code);
    // 9. Enrollment pre-parse replay through the shared verification; never reads the body.
    if (context.command === "enroll" && (await ports.retainedRecord(setupDigest))) {
      return replayOutcome(await ports.verifyRequesterState(setupDigest, context), setupDigest);
    }
    // Only then is the body read.
    const parsed = parseRequesterBody(await ports.readBody(request), request.headers.get("content-type"), command);
    if (!parsed) return held(400, "body_invalid");
    return context.command === "enroll"
      ? ports.execute({ command: "enroll", userId, setupDigest, context, password: (parsed as { password: string }).password }, scope)
      : ports.execute({ command: "retire", userId, setupDigest, context,
        retirementReason: (parsed as { retirementReason: (typeof S5_REQUESTER_RETIREMENT_REASONS)[number] }).retirementReason }, scope);
  });
}

/** Replay or hold for an existing record; `retired` and `replay` only after the shared verification. */
function replayOutcome(
  state: Awaited<ReturnType<RequesterBoundaryPorts["verifyRequesterState"]>>,
  setupDigest: string,
): RequesterBoundaryResult {
  if (state.verified && state.lifecycle === "retired") return { status: 200, body: { outcome: "retired", setupDigest } };
  if (state.verified && state.lifecycle === "active" && state.factsMatch) return { status: 200, body: { outcome: "replay", setupDigest } };
  return held(409, "requester_state_unverified");
}

/** Read at most 4 KiB + 1 byte, so an oversized body is rejected without buffering it. */
export async function readBoundedRequestBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    chunks.push(value);
    if (total > MAX_BODY_BYTES) { await reader.cancel(); break; }
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

/**
 * Served ports. Every proof owned elsewhere denies until it is served, so the
 * route is inert: the one-shot reservation owner (BI-588688A7), the preview
 * enrollment fence (BI-8EA98961, BI-5C193A3F, BI-60FC9291) and the owner
 * receipt (BI-C7100183). The requester verification and the commands
 * themselves land in later phases and hold until then.
 */
export function servedRequesterBoundaryPorts(deps: {
  environmentClass(): Promise<string>;
  canonicalOrigin(request: Request): string | null;
  sessionUserId(): Promise<string | null>;
}): RequesterBoundaryPorts {
  return {
    ...deps,
    currentReservation: async () => "unavailable",
    retainedRecord: async (setupDigest) =>
      (await prisma.s5RehearsalRequesterEnrollment.findUnique({ where: { setupDigest }, select: { lifecycle: true } })) as
        { lifecycle: "active" | "retired" } | null,
    readiness: async () => ({ ready: false, code: "preview_enrollment_fence_unavailable" }),
    requestTransaction: (run) => runFencedRequest(prismaRequestTransaction, run, logRequesterCode),
    preBodyOwnerAndDb: async () => ({ ok: false, code: "owner_binding_unavailable" }),
    verifyRequesterState: async () => ({ verified: false }),
    readBody: readBoundedRequestBody,
    execute: async () => held(409, "command_not_served"),
  };
}

// ── Phase 5: owner binding (AC-E2) ──────────────────────────────────────────

/** Platform roles that grant manage_platform, from the static PERMISSIONS table. */
export const MANAGE_PLATFORM_ROLE_KEYS: readonly string[] = [...PERMISSIONS.manage_platform.roles];
const MANAGE_USERS_ROLE_KEYS: readonly string[] = [...PERMISSIONS.manage_users.roles];

/**
 * Every owner fact in one statement, so one snapshot decides. $1 is the acting
 * User id; $2 is the text[] of role keys that grant manage_platform. Role keys
 * come only from UserGroup → PlatformRole: isSuperuser grants nothing here.
 */
export const OWNER_SNAPSHOT_SQL = `
WITH orgs AS (
  SELECT "topAccountablePrincipalId" AS top_id FROM "Organization" ORDER BY "createdAt" ASC, id ASC LIMIT 2
), org AS (
  SELECT count(*)::int AS n, (array_agg(top_id))[1] AS top_id FROM orgs
), top_user AS (
  SELECT count(a.*)::int AS alias_count, bool_and(u."isActive") AS local_active
  FROM org JOIN "PrincipalAlias" a ON a."principalId" = org.top_id AND a."aliasType" = 'user' AND a.issuer = ''
  LEFT JOIN "User" u ON u.id = a."aliasValue"
), fallback AS (
  SELECT coalesce(array_agg(DISTINCT p.id ORDER BY p.id), ARRAY[]::text[]) AS ids
  FROM "Principal" p
  JOIN "PrincipalAlias" a ON a."principalId" = p.id AND a."aliasType" = 'user' AND a.issuer = ''
  JOIN "User" u ON u.id = a."aliasValue" AND u."isActive"
  JOIN "UserGroup" g ON g."userId" = u.id
  JOIN "PlatformRole" r ON r.id = g."platformRoleId" AND r."roleId" = ANY($2::text[])
  WHERE p.kind = 'human' AND p.status = 'active'
), actor AS (
  SELECT u.*,
    (SELECT coalesce(array_agg(DISTINCT r."roleId" ORDER BY r."roleId"), ARRAY[]::text[])
       FROM "UserGroup" g JOIN "PlatformRole" r ON r.id = g."platformRoleId" WHERE g."userId" = u.id) AS role_keys,
    (SELECT a."principalId" FROM "PrincipalAlias" a
       WHERE a."aliasType" = 'user' AND a."aliasValue" = u.id AND a.issuer = '') AS principal_id,
    EXISTS (SELECT 1 FROM "S5RehearsalRequesterEnrollment" e WHERE e."userId" = u.id) AS governed
  FROM "User" u WHERE u.id = $1
)
SELECT json_build_object(
  'orgCount', org.n,
  'topPrincipalId', org.top_id,
  'top', (SELECT CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object(
            'kind', p.kind, 'status', p.status,
            'userAliasCount', top_user.alias_count, 'localUserActive', top_user.local_active) END
          FROM top_user LEFT JOIN "Principal" p ON p.id = org.top_id),
  'fallback', (SELECT to_json(ids) FROM fallback),
  'actor', json_build_object(
    'userExists', actor.id IS NOT NULL,
    'isActive', coalesce(actor."isActive", false),
    'isSuperuser', coalesce(actor."isSuperuser", false),
    'automation', actor."automationVerificationId" IS NOT NULL OR actor."automationProfile" IS NOT NULL
                  OR actor."automationSlot" IS NOT NULL OR actor."automationExpiresAt" IS NOT NULL,
    'handedOver', actor."workHandedOverAt" IS NOT NULL,
    'roleKeys', coalesce(to_json(actor.role_keys), '[]'::json),
    'principalId', actor.principal_id,
    'governedRequester', coalesce(actor.governed, false))
) AS snapshot
FROM org LEFT JOIN actor ON true`;

export type OwnerSnapshot = {
  orgCount: number;
  topPrincipalId: string | null;
  top: { kind: string; status: string; userAliasCount: number; localUserActive: boolean | null } | null;
  fallback: string[];
  actor: {
    userExists: boolean; isActive: boolean; isSuperuser: boolean; automation: boolean; handedOver: boolean;
    roleKeys: string[]; principalId: string | null; governedRequester: boolean;
  };
};

export type OwnerHoldCode = "org_missing" | "org_ambiguous" | "owner_mapping_invalid" | "owner_candidate_ambiguous";
export type OwnerRefuseCode =
  | "actor_inactive" | "automation_actor" | "handed_over_actor" | "requester_actor" | "not_owner" | "owner_capability_missing";
export type OwnerReceiptCode = "owner_receipt_missing" | "owner_receipt_mismatch";
export type OwnerDecision =
  | { ok: true; ownerPrincipalId: string }
  | { ok: false; code: OwnerHoldCode | OwnerRefuseCode | OwnerReceiptCode };

/**
 * Pure decision over one snapshot. No superuser fallback: capabilities come
 * only from role keys, so a superuser with no qualifying role is refused.
 */
export function evaluateOwnerSnapshot(snapshot: OwnerSnapshot): OwnerDecision {
  if (snapshot.orgCount === 0) return { ok: false, code: "org_missing" };
  if (snapshot.orgCount !== 1) return { ok: false, code: "org_ambiguous" };

  let candidate: string;
  if (snapshot.topPrincipalId !== null) {
    const top = snapshot.top;
    if (!top || top.kind !== "human" || top.status !== "active" || top.userAliasCount !== 1 || top.localUserActive !== true) {
      return { ok: false, code: "owner_mapping_invalid" };
    }
    candidate = snapshot.topPrincipalId;
  } else {
    if (snapshot.fallback.length !== 1) return { ok: false, code: "owner_candidate_ambiguous" };
    candidate = snapshot.fallback[0]!;
  }

  const actor = snapshot.actor;
  if (!actor.userExists || !actor.isActive) return { ok: false, code: "actor_inactive" };
  if (actor.automation) return { ok: false, code: "automation_actor" };
  if (actor.handedOver) return { ok: false, code: "handed_over_actor" };
  if (actor.governedRequester) return { ok: false, code: "requester_actor" };
  if (actor.principalId !== candidate) return { ok: false, code: "not_owner" };
  const grants = (keys: readonly string[]) => actor.roleKeys.some((role) => keys.includes(role));
  if (!grants(MANAGE_USERS_ROLE_KEYS) || !grants(MANAGE_PLATFORM_ROLE_KEYS)) {
    return { ok: false, code: "owner_capability_missing" };
  }
  return { ok: true, ownerPrincipalId: candidate };
}

export type OwnerSnapshotReader = { $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown> };
export type OwnerReceipt = { ownerPrincipalId: string; installationRef: string };
export type OwnerReceiptPort = {
  /** The owner-confirmed governed receipt (BI-C7100183). The served adapter returns null until it lands. */
  readOwnerReceipt(ownerPrincipalId: string): Promise<OwnerReceipt | null>;
  installationRef: string;
};

/**
 * Owner binding: one coherent statement, a pure evaluation, then the receipt.
 * Call it on the transaction client after the per-setup lock.
 */
export async function decideOwnerBinding(db: OwnerSnapshotReader, userId: string, receipts: OwnerReceiptPort): Promise<OwnerDecision> {
  const rows = (await db.$queryRawUnsafe(OWNER_SNAPSHOT_SQL, userId, [...MANAGE_PLATFORM_ROLE_KEYS])) as Array<{ snapshot: OwnerSnapshot }>;
  const snapshot = rows[0]?.snapshot;
  if (!snapshot) return { ok: false, code: "org_missing" };
  const decision = evaluateOwnerSnapshot(snapshot);
  if (!decision.ok) return decision;
  const receipt = await receipts.readOwnerReceipt(decision.ownerPrincipalId);
  if (!receipt) return { ok: false, code: "owner_receipt_missing" };
  if (receipt.ownerPrincipalId !== decision.ownerPrincipalId || receipt.installationRef !== receipts.installationRef) {
    return { ok: false, code: "owner_receipt_mismatch" };
  }
  return decision;
}

/** Served receipt port: denies until BI-C7100183 serves the owner-confirmed receipt. */
export const servedOwnerReceiptPort = (installationRef: string): OwnerReceiptPort => ({
  readOwnerReceipt: async () => null,
  installationRef,
});

// ── Phase 6: enrollment and read-only status (AC-E4) ───────────────────────

/** Must equal REQUESTER_DESTINATION_FENCE_KEY in packages/db/src/sanitized-clone-cleanup.ts (pinned by a test). */
export const REQUESTER_FENCE_KEY = "dpf:s5-rehearsal-requester:destination-fence";
const SETUP_LOCK_PREFIX = "s5rr-enroll:";
/** Read Committed; the transaction timeout deliberately exceeds the 5 s lock wait so a late waiter can still replay. */
export const REQUEST_TRANSACTION_OPTIONS = { isolationLevel: "ReadCommitted", timeout: 15_000, maxWait: 5_000 } as const;
export const SETUP_LOCK_TIMEOUT = "5s";

/** Raw statements on the request's pinned connection. Statements never select a void column. */
export type RequesterSql = { query(sql: string, values?: unknown[]): Promise<Array<Record<string, unknown>>> };
export type RequestScope = { sql: RequesterSql; client: unknown; stage: "pre-hash" | "hashed" };
export type RequesterTransactionRunner = <T>(run: (tx: { sql: RequesterSql; client: unknown }) => Promise<T>) => Promise<T>;

class RequesterRollback extends Error {
  constructor(readonly result: RequesterBoundaryResult) {
    super("s5 requester request rolled back");
  }
}

function isLockTimeout(error: unknown): boolean {
  const e = error as { code?: unknown; meta?: { code?: unknown }; message?: unknown } | null;
  return e?.code === "55P03" || e?.meta?.code === "55P03" || (typeof e?.message === "string" && /lock timeout/iu.test(e.message));
}

/**
 * Run one request inside the fenced transaction. Outcomes:
 * - the fence is held by a clone → `clone_in_progress`, nothing else runs;
 * - a result without `commit` → rolled back;
 * - a failure before the hash → generic hold; after the hash and before commit → `create_failed` (rolled back);
 * - a failure once commit was sent → the result's `ifCommitLost` (`create_unverified`); rollback is never claimed.
 * The log records codes only, never the body, password or hash.
 */
export async function runFencedRequest(
  transaction: RequesterTransactionRunner,
  run: (scope: RequestScope) => Promise<RequesterTxResult>,
  log: (code: string) => void,
): Promise<RequesterBoundaryResult> {
  let scope: RequestScope | null = null;
  let commitLost: RequesterBoundaryResult | null = null;
  try {
    return await transaction(async (tx) => {
      const fence = await tx.sql.query("SELECT pg_try_advisory_xact_lock_shared(hashtextextended($1, 0)) AS entered", [REQUESTER_FENCE_KEY]);
      if (fence[0]?.entered !== true) throw new RequesterRollback(held(409, "clone_in_progress"));
      scope = { sql: tx.sql, client: tx.client, stage: "pre-hash" };
      const { commit, ...result } = await run(scope);
      if (!commit) throw new RequesterRollback(result);
      commitLost = commit.ifCommitLost;
      return result;
    });
  } catch (error) {
    if (error instanceof RequesterRollback) return error.result;
    if (commitLost) { log("commit_unverified"); return commitLost; }
    if ((scope as RequestScope | null)?.stage === "hashed") { log("create_failed"); return { status: 500, body: { outcome: "create_failed" } }; }
    log("request_failed");
    return held(503, "request_failed");
  }
}

/** The served runner: an interactive Prisma transaction with the request options. */
const prismaRequestTransaction: RequesterTransactionRunner = (run) =>
  prisma.$transaction(
    (tx) => run({ sql: { query: (q, values = []) => tx.$queryRawUnsafe(q, ...values) }, client: tx }),
    REQUEST_TRANSACTION_OPTIONS,
  );

const logRequesterCode = (code: string) => console.warn(`[s5-rehearsal-requester] ${code}`);

/** A label only; the first 16 hex characters of the setup digest. */
export function requesterEmail(setupDigest: string): string {
  return `rehearsal-${setupDigest.slice(0, 16)}@s5-rehearsal.invalid`;
}

/** Every requester fact the shared verification needs, in one statement (one snapshot). $1 is the setup digest. */
export const REQUESTER_STATE_SQL = `
SELECT r."setupDigest" AS "setupDigest", r."userId" AS "userId", r."principalId" AS "principalId",
  r."rulingRef" AS "rulingRef", r."reservationRef" AS "reservationRef", r."attemptRef" AS "attemptRef", r."fixtureRef" AS "fixtureRef",
  r.lifecycle::text AS lifecycle,
  (r."lifecycleAt" IS NOT NULL AND r."retirementReason" IS NOT NULL AND r."retiredByPrincipalId" IS NOT NULL) AS terminal,
  u."isActive" AS "userActive", p.status AS "principalStatus",
  (SELECT count(*) FROM "PrincipalAlias" a WHERE a."principalId" = r."principalId")::int AS "aliasCount",
  EXISTS (SELECT 1 FROM "PrincipalAlias" a WHERE a."principalId" = r."principalId"
          AND a."aliasType" = 'user' AND a."aliasValue" = r."userId" AND a.issuer = '') AS "exactAlias",
  (SELECT count(*) FROM "AuthorityBinding" b WHERE b."oauthUserId" = r."userId" AND b.status <> 'revoked')::int AS "liveBindings",
  ((SELECT count(*) FROM "McpApiToken" t WHERE t."userId" = r."userId" AND t."revokedAt" IS NULL)
   + (SELECT count(*) FROM "OAuthRefreshToken" t WHERE t."userId" = r."userId" AND t."revokedAt" IS NULL))::int AS "liveTokens",
  (SELECT count(*) FROM "OAuthClient" c WHERE c."ownerUserId" = r."userId"
          AND c."registrationKind"::text = 'credentials' AND c."revokedAt" IS NULL)::int AS "liveClients"
FROM "S5RehearsalRequesterEnrollment" r
JOIN "User" u ON u.id = r."userId"
JOIN "Principal" p ON p.id = r."principalId"
WHERE r."setupDigest" = $1`;

export type RequesterStateRow = {
  setupDigest: string; userId: string; principalId: string;
  rulingRef: string; reservationRef: string; attemptRef: string; fixtureRef: string;
  lifecycle: "active" | "retired"; terminal: boolean; userActive: boolean; principalStatus: string;
  aliasCount: number; exactAlias: boolean; liveBindings: number; liveTokens: number; liveClients: number;
};
export type RequesterVerification =
  | { verified: true; lifecycle: "active" | "retired"; factsMatch: boolean }
  | { verified: false };

/**
 * The shared verification (enroll replay, status and retirement readback):
 * refs, inactive User and Principal, the exact single local alias, zero live
 * bindings, tokens and owned clients, and the full terminal tuple when retired.
 */
export function evaluateRequesterState(
  row: RequesterStateRow | null,
  target: { setupDigest: string; userId?: string; principalId?: string; facts?: Pick<EnrollSetupContext, "rulingRef" | "reservationRef" | "attemptRef" | "fixtureRef"> },
): RequesterVerification {
  if (!row || row.setupDigest !== target.setupDigest) return { verified: false };
  if (target.userId !== undefined && row.userId !== target.userId) return { verified: false };
  if (target.principalId !== undefined && row.principalId !== target.principalId) return { verified: false };
  const inert = !row.userActive && row.principalStatus === "inactive" && row.aliasCount === 1 && row.exactAlias
    && row.liveBindings === 0 && row.liveTokens === 0 && row.liveClients === 0;
  if (!inert || (row.lifecycle === "retired" && !row.terminal)) return { verified: false };
  const facts = target.facts;
  const factsMatch = !facts || (facts.rulingRef === row.rulingRef && facts.reservationRef === row.reservationRef
    && facts.attemptRef === row.attemptRef && facts.fixtureRef === row.fixtureRef);
  return { verified: true, lifecycle: row.lifecycle, factsMatch };
}

export async function readRequesterState(sql: RequesterSql, setupDigest: string): Promise<RequesterStateRow | null> {
  return ((await sql.query(REQUESTER_STATE_SQL, [setupDigest]))[0] as RequesterStateRow | undefined) ?? null;
}

export type ReservationState = "matches" | "released" | "replaced" | "unavailable";
export type EnrollmentRefs = { installationRef: string; leaseRef: string; dbIdentityRef: string };

/** Effects of one enrollment. Each proof owned elsewhere is a port that denies until its owner serves it. */
export type EnrollmentDeps = {
  ownerBinding(scope: RequestScope, userId: string): Promise<OwnerDecision>;
  currentReservation(context: EnrollSetupContext, scope: RequestScope): Promise<ReservationState>;
  /** Commit-time fences for the exact reservation revision, lease, installation and DB identity (BI-588688A7, BI-60FC9291, BI-8EA98961, BI-5C193A3F). */
  commitFences(context: EnrollSetupContext, scope: RequestScope): Promise<{ ok: true; refs: EnrollmentRefs } | { ok: false; code: string }>;
  verify(setupDigest: string, context: EnrollSetupContext, scope: RequestScope): Promise<RequesterVerification>;
  hashPassword(password: string): Promise<string>;
  createRequester(scope: RequestScope, input: {
    setupDigest: string; context: EnrollSetupContext; refs: EnrollmentRefs; email: string; passwordHash: string;
    ownerUserId: string; ownerPrincipalId: string;
  }): Promise<void>;
};

/** The create: per-setup lock before any hash, fresh reads after it, one hash, one create. */
export async function executeEnrollment(
  input: Extract<RequesterCommandInput, { command: "enroll" }>,
  scope: RequestScope,
  deps: EnrollmentDeps,
): Promise<RequesterTxResult> {
  const { setupDigest, context } = input;
  await scope.sql.query("SELECT set_config('lock_timeout', $1, true) AS applied", [SETUP_LOCK_TIMEOUT]);
  try {
    await scope.sql.query("SELECT true AS locked FROM pg_advisory_xact_lock(hashtextextended($1, 0))", [SETUP_LOCK_PREFIX + setupDigest]);
  } catch (error) {
    if (isLockTimeout(error)) return held(409, "enroll_busy");
    throw error;
  }
  const owner = await deps.ownerBinding(scope, input.userId);
  if (!owner.ok) return held(409, owner.code);
  const reservation = await deps.currentReservation(context, scope);
  if (reservation !== "matches") return held(409, `reservation_${reservation}`);
  const existing = await scope.sql.query(`SELECT 1 AS present FROM "S5RehearsalRequesterEnrollment" WHERE "setupDigest" = $1`, [setupDigest]);
  const fences = await deps.commitFences(context, scope);
  if (!fences.ok) return held(409, fences.code);
  if (existing.length > 0) return replayOutcome(await deps.verify(setupDigest, context, scope), setupDigest);
  const email = requesterEmail(setupDigest);
  if ((await scope.sql.query(`SELECT 1 AS present FROM "User" WHERE email = $1`, [email])).length > 0) {
    return held(409, "requester_email_orphan");
  }
  if (passwordPolicyErrors(input.password).length > 0 || Buffer.byteLength(input.password, "utf8") > MAX_PASSWORD_BYTES) {
    return held(400, "password_policy");
  }
  scope.stage = "hashed";
  const passwordHash = await deps.hashPassword(input.password);
  await deps.createRequester(scope, {
    setupDigest, context, refs: fences.refs, email, passwordHash, ownerUserId: input.userId, ownerPrincipalId: owner.ownerPrincipalId,
  });
  return {
    status: 201,
    body: { outcome: "created", setupDigest },
    commit: { ifCommitLost: { status: 202, body: { outcome: "create_unverified", setupDigest } } },
  };
}

/** The served create: an inactive, non-superuser User with no automation fields or role; Principal inactive; record; audit row. */
export async function createRequesterWithPrisma(
  scope: RequestScope,
  input: Parameters<EnrollmentDeps["createRequester"]>[1],
): Promise<void> {
  const tx = scope.client as Prisma.TransactionClient;
  const user = await tx.user.create({ data: { email: input.email, passwordHash: input.passwordHash, isActive: false, isSuperuser: false }, select: { id: true } });
  // Imported lazily: principal-linking guards on isGovernedRequester from this module.
  const { syncUserPrincipal } = await import("@/lib/identity/principal-linking");
  const principal = await syncUserPrincipal(user.id, tx);
  await tx.principal.update({ where: { id: principal.id }, data: { status: "inactive" } });
  const { rulingRef, reservationRef, attemptRef, fixtureRef } = input.context;
  const refs = { rulingRef, reservationRef, attemptRef, fixtureRef, ...input.refs };
  await tx.s5RehearsalRequesterEnrollment.create({
    data: { setupDigest: input.setupDigest, ...refs, userId: user.id, principalId: principal.id, enrolledByPrincipalId: input.ownerPrincipalId },
  });
  await writeRequesterAudit(tx, {
    command: "enroll", setupDigest: input.setupDigest, ownerUserId: input.ownerUserId, ownerPrincipalId: input.ownerPrincipalId,
    requesterUserId: user.id, refs,
  });
}

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
