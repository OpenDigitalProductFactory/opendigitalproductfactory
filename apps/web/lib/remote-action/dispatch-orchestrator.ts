// EP-REMOTE-ACTION · P2 slice 2 — the pull-channel orchestrators (DB-injected).
//
// Spec: docs/superpowers/specs/2026-06-25-convergent-remote-action-execution-design.md.
// Threat model: docs/superpowers/specs/2026-06-25-remote-action-edge-dispatch-threat-model.md.
//
// The channel is PULL: a trusted, action.execute-enabled Edge Node POLLS for the
// queued RemoteActions in its own estate scope (claimActionsForNode), runs them,
// and reports the outcome (recordActionResult). Single-claim is enforced by the
// queued→claimed transition + edgeNodeId binding — a second node racing the same
// action loses the conditional update. The pure eligibility gate lives in
// @dpf/db/remote-action-dispatch; this wraps it with the DB writes.
//
// Nothing here runs until the route layer's DPF_REMOTE_ACTION_DISPATCH_ENABLED flag
// AND the node's action.execute capability are both on. No mutation: P2 is read-only.

import { randomBytes } from "node:crypto";

import {
  canTransitionDispatch,
  claimableActionsForNode,
  DEFAULT_CLAIM_TIMEOUT_MS,
  type ClaimingNodeView,
  type DispatchableActionView,
  type RemoteActionDispatchState,
} from "@dpf/db/remote-action-dispatch";
import {
  EDGE_ACTION_ENVELOPE_VERSION,
  type EdgeActionEnvelope,
  type SignedEdgeActionEnvelope,
} from "@dpf/db/edge-action-envelope";
import {
  isOrganizationJoinActionType,
  parseOrganizationJoinDispatchParameters,
  parseOrganizationJoinPackage,
} from "@dpf/db/organization-join-action";

import { decryptSecret as decryptStoredSecret, encryptSecret as encryptStoredSecret } from "@/lib/govern/credential-crypto";
import { isRecord } from "@/lib/shared/coerce";

const MAX_CLAIM_BATCH = 25;

export interface ClaimableActionRow {
  actionKey: string;
  actionType: string;
  riskClass: string;
  approvalState: string;
  status: string;
  customerAccountId: string | null;
  customerSiteId: string | null;
  edgeNodeId: string | null;
  changeRequestId: string | null;
  parameters: unknown;
}

export interface DispatchOrchestratorDb {
  remoteAction: {
    findMany(args: unknown): Promise<Array<ClaimableActionRow & { result?: unknown }>>;
    updateMany(args: unknown): Promise<{ count: number }>;
    findUnique(args: unknown): Promise<{
      actionKey: string;
      actionType: string;
      status: string;
      edgeNodeId: string | null;
      parameters: unknown;
    } | null>;
    update(args: unknown): Promise<unknown>;
  };
  changeRequest: {
    findMany(args: unknown): Promise<Array<{ id: string; status: string; approvedAt: Date | null; approvedById: string | null }>>;
  };
}

export interface EdgeActionEnvelopeSigner {
  signingKeyId: string;
  sign(envelope: EdgeActionEnvelope): SignedEdgeActionEnvelope;
}

export type ClaimedAction = SignedEdgeActionEnvelope;

export interface ClaimResult {
  claimed: ClaimedAction[];
  /** Eligible-but-lost-the-race (claimed by another node between read and write). */
  skipped: number;
}

/**
 * Pull + atomically claim the read-only RemoteActions this node may run. The DB
 * query is a coarse scope filter; `claimableActionsForNode` is the precise gate
 * (closed allow-list, exact scope, trust, capability, and privileged-action
 * approval/role checks). The claim itself is a
 * guarded conditional update — only an action STILL `queued` flips to `claimed`,
 * so concurrent pollers can't double-claim.
 */
export async function claimActionsForNode(
  db: DispatchOrchestratorDb,
  node: ClaimingNodeView,
  opts: {
    signer: EdgeActionEnvelopeSigner;
    limit?: number;
    now?: Date;
    nonceFactory?: () => string;
    envelopeLifetimeMs?: number;
    decryptSecret?: (value: string) => string | null;
  },
): Promise<ClaimResult> {
  // Belt-and-suspenders: the route already auth-gates trust + capability, but a
  // disabled/untrusted node claims nothing here either.
  if (node.trustState !== "trusted" || !node.actionExecuteEnabled) {
    return { claimed: [], skipped: 0 };
  }
  const take = Math.min(Math.max(1, opts.limit ?? MAX_CLAIM_BATCH), MAX_CLAIM_BATCH);
  const candidates = await db.remoteAction.findMany({
    where: {
      status: "queued",
      approvalState: "approved",
      riskClass: { in: ["read-only", "high"] },
      customerAccountId: node.customerAccountId, // null matches the internal estate
    },
    take,
  });

  const changeRequestIds = candidates
    .filter((candidate) => isOrganizationJoinActionType(candidate.actionType) && candidate.changeRequestId)
    .map((candidate) => candidate.changeRequestId!);
  const approvedChanges = changeRequestIds.length
    ? await db.changeRequest.findMany({
        where: { id: { in: changeRequestIds }, status: "approved", approvedAt: { not: null }, approvedById: { not: null } },
        select: { id: true, status: true, approvedAt: true, approvedById: true },
      })
    : [];
  const approvedChangeIds = new Set(approvedChanges.map((change) => change.id));

  const views: DispatchableActionView[] = candidates.map((c) => ({
    actionKey: c.actionKey,
    actionType: c.actionType,
    riskClass: c.riskClass,
    approvalState: c.approvalState,
    status: c.status,
    customerAccountId: c.customerAccountId,
    customerSiteId: c.customerSiteId,
    edgeNodeId: c.edgeNodeId,
    changeRequestApproved: c.changeRequestId ? approvedChangeIds.has(c.changeRequestId) : false,
  }));
  const eligible = claimableActionsForNode(node, views);

  const now = opts.now ?? new Date();
  const expiresAt = new Date(now.getTime() + Math.min(opts.envelopeLifetimeMs ?? 2 * 60 * 1000, 5 * 60 * 1000));
  const nonceFactory = opts.nonceFactory ?? (() => randomBytes(24).toString("base64url"));
  const claimed: ClaimedAction[] = [];
  for (const e of eligible) {
    const row = candidates.find((c) => c.actionKey === e.actionKey);
    let dispatchParameters = row?.parameters ?? {};
    if (isOrganizationJoinActionType(e.actionType)) {
      if (e.actionType === "organization.join.import") {
        const encrypted = isRecord(row?.parameters) && typeof row.parameters.joinPackageEnc === "string"
          ? row.parameters.joinPackageEnc
          : null;
        const plaintext = encrypted ? (opts.decryptSecret ?? decryptStoredSecret)(encrypted) : null;
        if (!plaintext) {
          await failUndispatchableAction(db, e.actionKey, now, "join-package-decryption-failed");
          continue;
        }
        dispatchParameters = { joinPackage: plaintext };
      }
      const validated = parseOrganizationJoinDispatchParameters(e.actionType, dispatchParameters, now);
      if (!validated.ok) {
        await failUndispatchableAction(db, e.actionKey, now, validated.reason);
        continue;
      }
      dispatchParameters = validated.value;
    }
    const envelope: EdgeActionEnvelope = {
      version: EDGE_ACTION_ENVELOPE_VERSION,
      signingKeyId: opts.signer.signingKeyId,
      actionKey: e.actionKey,
      nodeId: node.nodeId,
      actionType: e.actionType,
      parameters: dispatchParameters,
      nonce: nonceFactory(),
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    const signed = opts.signer.sign(envelope);
    // Single-claim guard: only an action still `queued` is claimable; the first
    // updater wins (count 1), a racing poller sees count 0.
    const res = await db.remoteAction.updateMany({
      where: { actionKey: e.actionKey, status: "queued" },
      data: {
        status: "claimed",
        edgeNodeId: node.edgeNodeId,
        startedAt: now,
        dispatchNonce: signed.nonce,
        dispatchIssuedAt: now,
        dispatchExpiresAt: expiresAt,
        dispatchSigningKeyId: signed.signingKeyId,
        dispatchSignature: signed.signature,
      },
    });
    if (res.count === 1) {
      claimed.push(signed);
    }
  }
  return { claimed, skipped: eligible.length - claimed.length };
}

export interface ActionResultInput {
  actionKey: string;
  /** The reporting node (EdgeNode.id from auth) — must own the claim. */
  edgeNodeRowId: string;
  outcome: "running" | "succeeded" | "failed";
  evidence?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

export type ActionResultResult =
  | { ok: true; status: RemoteActionDispatchState }
  | { ok: false; reason: string };

/**
 * Record a node's report for an action it claimed. Verifies the action exists,
 * is bound to THIS node (claim ownership — a node cannot report another's
 * action), and that the lifecycle transition is legal. Terminal outcomes stamp
 * completedAt + evidence; the node's id is recorded on the evidence so a lying
 * node is attributable.
 */
export async function recordActionResult(
  db: DispatchOrchestratorDb,
  input: ActionResultInput,
  opts: { now?: Date; encryptSecret?: (value: string) => string } = {},
): Promise<ActionResultResult> {
  const row = await db.remoteAction.findUnique({ where: { actionKey: input.actionKey } });
  if (!row) return { ok: false, reason: "action-not-found" };
  if (row.edgeNodeId !== input.edgeNodeRowId) return { ok: false, reason: "not-claimed-by-this-node" };

  const from = row.status as RemoteActionDispatchState;
  const to = input.outcome as RemoteActionDispatchState;
  if (!canTransitionDispatch(from, to)) {
    return { ok: false, reason: `illegal-transition ${from}->${to}` };
  }

  const now = opts.now ?? new Date();
  const terminal = to === "succeeded" || to === "failed";
  let storedResult: Record<string, unknown> = { outcome: to };
  if (terminal && row.actionType === "organization.join.issue" && to === "succeeded") {
    const joinPackage = input.result?.joinPackage;
    if (typeof joinPackage !== "string") return { ok: false, reason: "issued-package-missing" };
    const parsed = parseOrganizationJoinPackage(joinPackage, now);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    const encrypted = (opts.encryptSecret ?? encryptStoredSecret)(joinPackage);
    if (!encrypted.startsWith("enc:")) return { ok: false, reason: "credential-encryption-unavailable" };
    storedResult = { joinPackageEnc: encrypted, expiresAt: parsed.value.expiresAt.toISOString() };
  }
  await db.remoteAction.update({
    where: { actionKey: input.actionKey },
    data: {
      status: to,
      ...(terminal ? { completedAt: now } : {}),
      ...(terminal
        ? {
            result: storedResult as never,
            evidence: {
              ...sanitizeActionEvidence(input.evidence),
              reportedByNode: input.edgeNodeRowId,
              reportedAt: now.toISOString(),
            } as never,
            ...(row.actionType === "organization.join.import"
              ? { parameters: { clearedAt: now.toISOString() } as never }
              : {}),
          }
        : {}),
    },
  });
  return { ok: true, status: to };
}

async function failUndispatchableAction(
  db: DispatchOrchestratorDb,
  actionKey: string,
  now: Date,
  reason: string,
): Promise<void> {
  await db.remoteAction.updateMany({
    where: { actionKey, status: "queued" },
    data: {
      status: "failed",
      completedAt: now,
      parameters: { clearedAt: now.toISOString() },
      evidence: { errorCode: reason, dispatchRejectedAt: now.toISOString() },
    },
  });
}

const REDACTED_EVIDENCE_KEY = /(token|secret|password|credential|private|package|certificatePem|keyPem)/i;

export function sanitizeActionEvidence(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value) return {};
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (REDACTED_EVIDENCE_KEY.test(key)) continue;
    if (typeof item === "string") result[key] = item.slice(0, 512);
    else if (typeof item === "number" || typeof item === "boolean" || item === null) result[key] = item;
    else if (Array.isArray(item)) result[key] = item.slice(0, 50).map((entry) =>
      typeof entry === "string" ? entry.slice(0, 256) : typeof entry === "number" || typeof entry === "boolean" ? entry : null,
    );
    else if (isRecord(item)) result[key] = sanitizeActionEvidence(item);
  }
  return result;
}

/**
 * Time out claimed/running actions that never reached a terminal report within
 * the window — a node that claims then dies (crash, network partition) must not
 * wedge the action in `claimed` forever. Sweeps all scopes; safe to run on a
 * cron. Organization-join imports also clear encrypted package material before
 * the terminal timeout is recorded.
 */
export async function timeoutStaleClaims(
  db: DispatchOrchestratorDb,
  opts: { now?: Date; timeoutMs?: number } = {},
): Promise<{ timedOut: number }> {
  const now = opts.now ?? new Date();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CLAIM_TIMEOUT_MS;
  const cutoff = new Date(now.getTime() - timeoutMs);
  const sensitive = (await db.remoteAction.findMany({
    where: {
      actionType: "organization.join.import",
      status: { in: ["claimed", "running"] },
      startedAt: { lt: cutoff },
    },
    select: { actionKey: true },
  })) ?? [];
  let sensitiveTimedOut = 0;
  for (const action of sensitive) {
    const cleared = await db.remoteAction.updateMany({
      where: { actionKey: action.actionKey, status: { in: ["claimed", "running"] } },
      data: {
        status: "timed-out",
        completedAt: now,
        parameters: { clearedAt: now.toISOString() },
      },
    });
    sensitiveTimedOut += cleared.count;
  }
  const res = await db.remoteAction.updateMany({
    where: {
      actionType: { not: "organization.join.import" },
      status: { in: ["claimed", "running"] },
      startedAt: { lt: cutoff },
    },
    data: { status: "timed-out", completedAt: now },
  });
  return { timedOut: res.count + sensitiveTimedOut };
}

/** Clear issued package ciphertext as soon as its embedded expiry passes, even
 * when no operator ever attempts the one-time download. */
export async function clearExpiredJoinPackageMaterial(
  db: DispatchOrchestratorDb,
  opts: { now?: Date } = {},
): Promise<{ cleared: number }> {
  const now = opts.now ?? new Date();
  const rows = await db.remoteAction.findMany({
    where: { actionType: "organization.join.issue", status: "succeeded" },
    select: { actionKey: true, result: true },
  });
  let cleared = 0;
  for (const row of rows) {
    if (!isRecord(row.result) || typeof row.result.joinPackageEnc !== "string" || typeof row.result.expiresAt !== "string") continue;
    const expiresAt = new Date(row.result.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() > now.getTime()) continue;
    const update = await db.remoteAction.updateMany({
      where: {
        actionKey: row.actionKey,
        status: "succeeded",
        result: { path: ["joinPackageEnc"], equals: row.result.joinPackageEnc },
      },
      data: { result: { expiresAt: row.result.expiresAt, expiredAt: now.toISOString() } },
    });
    cleared += update.count;
  }
  return { cleared };
}
