import "server-only";

import { createHash } from "node:crypto";

import { prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";

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
