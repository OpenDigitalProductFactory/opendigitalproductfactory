import "server-only";

import { createHash } from "node:crypto";

import { prisma, type Prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";

import { PERMISSIONS } from "@/lib/govern/permissions";
import { passwordPolicyErrors } from "@/lib/identity/password-policy";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

import {
  EMAIL_PRESENT_SQL,
  FENCE_TRY_SHARED_SQL,
  OWNER_SNAPSHOT_SQL,
  RECORD_PRESENT_SQL,
  REQUESTER_STATE_SQL,
  SET_LOCK_TIMEOUT_SQL,
  SETUP_XACT_LOCK_SQL,
  prismaRequesterSql,
} from "./s5-rehearsal-requester-sql.server";

export { OWNER_SNAPSHOT_SQL, REQUESTER_STATE_SQL };

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

/** The refusal every guard returns for an enrolled requester (phase 8, AC-E7). */
export const GOVERNED_REQUESTER_REFUSAL = "governed_rehearsal_requester";

/** Guard form of the marker: an unreadable marker counts as governed, so a guard never fails open. */
export async function refusesGovernedRequester(userId: string, db?: GovernedRequesterReader): Promise<boolean> {
  try {
    return await isGovernedRequester(userId, db);
  } catch {
    return true;
  }
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
/**
 * A result decided inside the request transaction; only one carrying `commit` is committed, every other rolls back.
 * `after` runs once the transaction has ended, on a fresh snapshot, and its answer replaces the result.
 */
export type RequesterTxResult = RequesterBoundaryResult & {
  commit?: { ifCommitLost: RequesterBoundaryResult };
  after?: () => Promise<RequesterBoundaryResult>;
};

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
    Promise<ActionResult>;
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

export const held = (status: number, code: string): RequesterBoundaryResult => ({ status, body: { outcome: "held", code } });
export const refused = (status: number, code: string): RequesterBoundaryResult => ({ status, body: { outcome: "refused", code } });

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
    if (!owner.ok) return held(409, owner.error);
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

/**
 * Replay or hold for an existing record; `retired` and `replay` only after the
 * shared verification, and only when the retained facts equal the reviewed
 * setup. The digest omits attempt and fixture, so a mismatch must hold.
 */
function replayOutcome(
  state: Awaited<ReturnType<RequesterBoundaryPorts["verifyRequesterState"]>>,
  setupDigest: string,
): RequesterBoundaryResult {
  if (state.verified && state.lifecycle === "retired" && state.factsMatch) return { status: 200, body: { outcome: "retired", setupDigest } };
  if (state.verified && state.lifecycle === "active" && state.factsMatch) return { status: 200, body: { outcome: "replay", setupDigest } };
  return held(409, "requester_state_unverified");
}

/**
 * A fixed `limit + 1`-byte accumulator. Each chunk is copied in, never kept, so
 * the request's own (possibly huge) backing buffers are not retained.
 */
export function createBoundedAccumulator(limit: number) {
  const storage = new Uint8Array(limit + 1);
  let size = 0;
  return {
    /** Copy what fits; true once more than `limit` bytes have been offered. */
    absorb(chunk: Uint8Array): boolean {
      const take = Math.min(chunk.byteLength, storage.length - size);
      storage.set(chunk.subarray(0, take), size);
      size += take;
      return size > limit || chunk.byteLength > take;
    },
    bytes(): Uint8Array { return storage.subarray(0, size); },
  };
}

/** Read at most 4 KiB + 1 byte into fixed storage, so an oversized body is rejected without buffering it. */
export async function readBoundedRequestBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const accumulator = createBoundedAccumulator(MAX_BODY_BYTES);
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    const overflow = accumulator.absorb(next.value);
    (next as { value?: Uint8Array }).value = undefined; // drop the only reference to the chunk before awaiting
    if (overflow) { await reader.cancel(); break; }
  }
  return new TextDecoder().decode(accumulator.bytes());
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
    preBodyOwnerAndDb: async () => err("owner_binding_unavailable"),
    verifyRequesterState: async () => ({ verified: false }),
    readBody: readBoundedRequestBody,
    execute: async () => held(409, "command_not_served"),
  };
}

// ── Phase 5: owner binding (AC-E2) ──────────────────────────────────────────

/** Platform roles that grant manage_platform, from the static PERMISSIONS table. */
export const MANAGE_PLATFORM_ROLE_KEYS: readonly string[] = [...PERMISSIONS.manage_platform.roles];
const MANAGE_USERS_ROLE_KEYS: readonly string[] = [...PERMISSIONS.manage_users.roles];


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
  ActionResult<{ ownerPrincipalId: string }>;
/** Every owner-binding failure carries one of these codes as its `error`. */
export type OwnerDecisionCode = OwnerHoldCode | OwnerRefuseCode | OwnerReceiptCode;
const deny = (code: OwnerDecisionCode) => err(code);

/**
 * Pure decision over one snapshot. No superuser fallback: capabilities come
 * only from role keys, so a superuser with no qualifying role is refused.
 */
export function evaluateOwnerSnapshot(snapshot: OwnerSnapshot): OwnerDecision {
  if (snapshot.orgCount === 0) return deny("org_missing");
  if (snapshot.orgCount !== 1) return deny("org_ambiguous");

  let candidate: string;
  if (snapshot.topPrincipalId !== null) {
    const top = snapshot.top;
    if (!top || top.kind !== "human" || top.status !== "active" || top.userAliasCount !== 1 || top.localUserActive !== true) {
      return deny("owner_mapping_invalid");
    }
    candidate = snapshot.topPrincipalId;
  } else {
    if (snapshot.fallback.length !== 1) return deny("owner_candidate_ambiguous");
    candidate = snapshot.fallback[0]!;
  }

  const actor = snapshot.actor;
  if (!actor.userExists || !actor.isActive) return deny("actor_inactive");
  if (actor.automation) return deny("automation_actor");
  if (actor.handedOver) return deny("handed_over_actor");
  if (actor.governedRequester) return deny("requester_actor");
  if (actor.principalId !== candidate) return deny("not_owner");
  const grants = (keys: readonly string[]) => actor.roleKeys.some((role) => keys.includes(role));
  if (!grants(MANAGE_USERS_ROLE_KEYS) || !grants(MANAGE_PLATFORM_ROLE_KEYS)) {
    return deny("owner_capability_missing");
  }
  return ok({ ownerPrincipalId: candidate });
}

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
export async function decideOwnerBinding(sql: RequesterSql, userId: string, receipts: OwnerReceiptPort): Promise<OwnerDecision> {
  const rows = (await sql.query(OWNER_SNAPSHOT_SQL, [userId, [...MANAGE_PLATFORM_ROLE_KEYS]])) as Array<{ snapshot: OwnerSnapshot }>;
  const snapshot = rows[0]?.snapshot;
  if (!snapshot) return deny("org_missing");
  const decision = evaluateOwnerSnapshot(snapshot);
  if (!decision.ok) return decision;
  const receipt = await receipts.readOwnerReceipt(decision.data.ownerPrincipalId);
  if (!receipt) return deny("owner_receipt_missing");
  if (receipt.ownerPrincipalId !== decision.data.ownerPrincipalId || receipt.installationRef !== receipts.installationRef) {
    return deny("owner_receipt_mismatch");
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
export const SETUP_LOCK_PREFIX = "s5rr-enroll:";
/** Read Committed; the transaction timeout deliberately exceeds the 5 s lock wait so a late waiter can still replay. */
export const REQUEST_TRANSACTION_OPTIONS = { isolationLevel: "ReadCommitted", timeout: 15_000, maxWait: 5_000 } as const;
export const SETUP_LOCK_TIMEOUT = "5s";

/** Raw statements on the request's pinned connection. Statements never select a void column. */
export type RequesterSql = { query(sql: string, values?: unknown[]): Promise<Array<Record<string, unknown>>> };
export type RequestScope = { sql: RequesterSql; client: unknown; stage: "pre-hash" | "hashed" };
export type RequesterTransactionRunner = <T>(run: (tx: { sql: RequesterSql; client: unknown }) => Promise<T>) => Promise<T>;

class RequesterRollback extends Error {
  constructor(readonly result: RequesterBoundaryResult, readonly after?: () => Promise<RequesterBoundaryResult>) {
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
  let after: (() => Promise<RequesterBoundaryResult>) | undefined;
  try {
    const result = await transaction(async (tx) => {
      const fence = await tx.sql.query(FENCE_TRY_SHARED_SQL, [REQUESTER_FENCE_KEY]);
      if (fence[0]?.entered !== true) throw new RequesterRollback(held(409, "clone_in_progress"));
      scope = { sql: tx.sql, client: tx.client, stage: "pre-hash" };
      const { commit, after: then, ...decided } = await run(scope);
      if (!commit) throw new RequesterRollback(decided, then);
      commitLost = commit.ifCommitLost;
      after = then;
      return decided;
    });
    return after ? await settleAfter(after, result, log) : result;
  } catch (error) {
    if (error instanceof RequesterRollback) return error.after ? settleAfter(error.after, error.result, log) : error.result;
    if (commitLost) { log("commit_unverified"); return commitLost; }
    if ((scope as RequestScope | null)?.stage === "hashed") { log("create_failed"); return { status: 500, body: { outcome: "create_failed" } }; }
    log("request_failed");
    return held(503, "request_failed");
  }
}

/** A post-transaction step must answer; if it throws, the decided result stands and only the code is logged. */
async function settleAfter(after: () => Promise<RequesterBoundaryResult>, fallback: RequesterBoundaryResult, log: (code: string) => void) {
  try {
    return await after();
  } catch {
    log("after_failed");
    return fallback;
  }
}

/** The served runner: an interactive Prisma transaction with the request options. */
const prismaRequestTransaction: RequesterTransactionRunner = (run) =>
  prisma.$transaction(
    (tx) => run({ sql: prismaRequesterSql(tx), client: tx }),
    REQUEST_TRANSACTION_OPTIONS,
  );

const logRequesterCode = (code: string) => console.warn(`[s5-rehearsal-requester] ${code}`);

/** A label only; the first 16 hex characters of the setup digest. */
export function requesterEmail(setupDigest: string): string {
  return `rehearsal-${setupDigest.slice(0, 16)}@s5-rehearsal.invalid`;
}


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
  commitFences(context: EnrollSetupContext, scope: RequestScope): Promise<ActionResult<{ refs: EnrollmentRefs }>>;
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
  await scope.sql.query(SET_LOCK_TIMEOUT_SQL, [SETUP_LOCK_TIMEOUT]);
  try {
    await scope.sql.query(SETUP_XACT_LOCK_SQL, [SETUP_LOCK_PREFIX + setupDigest]);
  } catch (error) {
    if (isLockTimeout(error)) return held(409, "enroll_busy");
    throw error;
  }
  const owner = await deps.ownerBinding(scope, input.userId);
  if (!owner.ok) return held(409, owner.error);
  const reservation = await deps.currentReservation(context, scope);
  if (reservation !== "matches") return held(409, `reservation_${reservation}`);
  const existing = await scope.sql.query(RECORD_PRESENT_SQL, [setupDigest]);
  const fences = await deps.commitFences(context, scope);
  if (!fences.ok) return held(409, fences.error);
  if (existing.length > 0) return replayOutcome(await deps.verify(setupDigest, context, scope), setupDigest);
  const email = requesterEmail(setupDigest);
  if ((await scope.sql.query(EMAIL_PRESENT_SQL, [email])).length > 0) {
    return held(409, "requester_email_orphan");
  }
  if (passwordPolicyErrors(input.password).length > 0 || Buffer.byteLength(input.password, "utf8") > MAX_PASSWORD_BYTES) {
    return held(400, "password_policy");
  }
  scope.stage = "hashed";
  const passwordHash = await deps.hashPassword(input.password);
  await deps.createRequester(scope, {
    setupDigest, context, refs: fences.data.refs, email, passwordHash, ownerUserId: input.userId, ownerPrincipalId: owner.data.ownerPrincipalId,
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
