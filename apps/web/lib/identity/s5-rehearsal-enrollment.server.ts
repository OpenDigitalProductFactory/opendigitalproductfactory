import "server-only";

import { createHash } from "node:crypto";

import { prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";

import { PERMISSIONS } from "@/lib/govern/permissions";

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

/** Injected effects, so the ordering is testable and the served adapters can deny until their owners land. */
export type RequesterBoundaryPorts = {
  environmentClass(): Promise<string>;
  canonicalOrigin(request: Request): string | null;
  sessionUserId(): Promise<string | null>;
  /** BI-588688A7 one-shot owner: does the live reservation still equal the context exactly? */
  currentReservation(context: EnrollSetupContext): Promise<"matches" | "released" | "replaced" | "unavailable">;
  retainedRecord(setupDigest: string): Promise<{ lifecycle: "active" | "retired" } | null>;
  readiness(command: RequesterCommand): Promise<{ ready: true } | { ready: false; code: string }>;
  preBodyOwnerAndDb(command: RequesterCommand, userId: string, setupDigest: string): Promise<{ ok: true } | { ok: false; code: string }>;
  verifyRequesterState(setupDigest: string, context: EnrollSetupContext):
    Promise<{ verified: true; lifecycle: "active" | "retired"; factsMatch: boolean } | { verified: false }>;
  readBody(request: Request): Promise<string>;
  /** The hasher and every mutator live behind this port; it is reached only after every check passed. */
  execute(input: RequesterCommandInput): Promise<RequesterBoundaryResult>;
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
  // 7. Readiness, then 8. the pre-body owner and exact-DB check.
  const readiness = await ports.readiness(command);
  if (!readiness.ready) return held(409, readiness.code);
  const owner = await ports.preBodyOwnerAndDb(command, userId, setupDigest);
  if (!owner.ok) return held(409, owner.code);
  // 9. Enrollment pre-parse replay through the shared verification; never reads the body.
  if (context.command === "enroll" && (await ports.retainedRecord(setupDigest))) {
    const state = await ports.verifyRequesterState(setupDigest, context);
    if (state.verified && state.lifecycle === "retired") return { status: 200, body: { outcome: "retired", setupDigest } };
    if (state.verified && state.lifecycle === "active" && state.factsMatch) return { status: 200, body: { outcome: "replay", setupDigest } };
    return held(409, "requester_state_unverified");
  }
  // Only then is the body read.
  const parsed = parseRequesterBody(await ports.readBody(request), request.headers.get("content-type"), command);
  if (!parsed) return held(400, "body_invalid");
  return context.command === "enroll"
    ? ports.execute({ command: "enroll", userId, setupDigest, context, password: (parsed as { password: string }).password })
    : ports.execute({ command: "retire", userId, setupDigest, context,
      retirementReason: (parsed as { retirementReason: (typeof S5_REQUESTER_RETIREMENT_REASONS)[number] }).retirementReason });
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
