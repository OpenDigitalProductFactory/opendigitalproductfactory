// BI-30EDDB7F — one claim, at the item's home (spec 2026-10-27 §5, DI-B6FFCCFBB541).
//
// Every backlog item has a home: the installation that created it, and the only
// one that may write it (work-sync.ts). The claim follows the same rule. When a
// paired installation wants to work an item homed elsewhere it asks the home,
// over the existing help-offer response; the home runs its ordinary claim check
// and either records a Workroom claim whose executor is the requester, or
// refuses and names the holder. Nothing about who is working on what is kept
// anywhere else, so two installs can never both hold the item.
//
// The requester keeps a local Workroom to do the work in. Until the home has
// answered, that Workroom is marked unconfirmed and the request waits in the
// federation outbox, which holds while the peer is unreachable (§5.3).

import { createHmac } from "node:crypto";

import {
  computeDemandResponseDigest,
  workClaimEnvelopeId,
  type DemandResponseV1,
  type WorkClaimAction,
  type WorkClaimReleaseReason,
} from "@dpf/db/federated-demand-contract";
import {
  hasFederatedWorkOriginMarker,
  parseFederatedWorkOriginMarker,
  type FederatedWorkClaimHolderV1,
} from "@dpf/db/federated-work-contract";

import type { FederationIdentity } from "./demand-identity";
import { scheduleFederationDeliveryJob, type FederationDeliveryQueueDb } from "./delivery-queue";
import { bindPeerInstallationIdentity } from "./peer-installation-identity";
import { claimHolderOf, federatedPeerExecutorRef, federatedPeerWorktreePath, isLapsedPeerClaim } from "./work-claim-ref";

/** The record a claim request travels as in the outbox. */
export const WORK_CLAIM_RECORD_TYPE = "demand-response" as const;

/**
 * How long a claim held for a peer lasts without a renewal. The requester
 * renews it on the federation cadence; one it stops renewing is released seven
 * days after the last renewal (spec §5.2 "Takeover"): this lease plus the
 * standard one-day resume grace every leased Workroom already has
 * (WORK_CAPSULE_PAUSE_GRACE_MS).
 */
export const FEDERATED_CLAIM_LEASE_MS = 6 * 24 * 60 * 60 * 1000;

/** The requester renews at most this often, so a renewal never floods the link. */
export const FEDERATED_CLAIM_RENEW_EVERY_MS = 60 * 60 * 1000;

const TERMINAL_WORKROOM_STATUSES = ["complete", "abandoned", "archived"] as const;

// ─── Decisions ──────────────────────────────────────────────────────────────

export type WorkClaimDecision =
  | { decision: "granted"; homeWorkroomId: string; leaseExpiresAt: string }
  | { decision: "renewed"; homeWorkroomId: string; leaseExpiresAt: string }
  | { decision: "released" }
  | {
      decision: "refused";
      reason: "held-elsewhere" | "not-home" | "link-not-eligible" | "not-claimable" | "stale-request";
      holder: FederatedWorkClaimHolderV1 | null;
      message: string;
    };

export function isWorkClaimDecision(value: unknown): value is WorkClaimDecision {
  if (!value || typeof value !== "object") return false;
  const decision = (value as { decision?: unknown }).decision;
  return decision === "granted" || decision === "renewed" || decision === "released" || decision === "refused";
}

// ─── Home side ──────────────────────────────────────────────────────────────

type HomeRoom = {
  id?: string;
  capsuleId: string;
  backlogItemId: string | null;
  status: string;
  executorKind: string | null;
  executorRef: string | null;
  repositoryFullName: string | null;
  headBranch: string | null;
  leaseExpiresAt: Date | null;
  workspaceState?: unknown;
};

export interface WorkClaimHomeDb {
  federationLink: {
    findUnique(args: unknown): Promise<{
      linkId: string; role: string; linkState: string; revokedAt: Date | null; quarantinedAt: Date | null;
      peerInstallationId: string | null;
    } | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  backlogItem: {
    findFirst(args: unknown): Promise<{ id: string; itemId: string; body: string | null } | null>;
  };
  workroom: {
    findFirst(args: unknown): Promise<HomeRoom | null>;
    update(args: unknown): Promise<unknown>;
  };
  workroomActivity: { create(args: unknown): Promise<unknown> };
}

/** Claim the item for the peer through the install's ordinary claim path. */
export type ClaimForPeer = (input: {
  itemId: string;
  repositoryFullName: string;
  headBranch: string;
  worktreePath: string;
  executorRef: string;
  linkId: string;
}) => Promise<
  | { claimed: true; capsuleId: string }
  | { claimed: false; holders: Array<Pick<HomeRoom, "capsuleId" | "executorKind" | "executorRef" | "leaseExpiresAt">> }
  /** The ordinary claim path refused for another reason (repository, branch,
   *  readiness). That is a decision too: the requester is told, not retried. */
  | { claimed: false; holders?: undefined; refusedReason: string }
>;

/** What the home keeps on the Workroom it holds for a peer: which link asked
 *  and when the newest request it applied was made, so an older request
 *  replayed later can never undo a newer one. */
type PeerClaimRecord = { linkId: string; lastRequestAt: string };

function readPeerClaimRecord(workspaceState: unknown): PeerClaimRecord | null {
  if (!workspaceState || typeof workspaceState !== "object") return null;
  const value = (workspaceState as { federatedPeerClaim?: unknown }).federatedPeerClaim;
  if (!value || typeof value !== "object") return null;
  const { linkId, lastRequestAt } = value as Partial<PeerClaimRecord>;
  return typeof linkId === "string" && typeof lastRequestAt === "string" ? { linkId, lastRequestAt } : null;
}

function withPeerClaimRecord(workspaceState: unknown, record: PeerClaimRecord): Record<string, unknown> {
  const base = workspaceState && typeof workspaceState === "object" ? (workspaceState as Record<string, unknown>) : {};
  return { ...base, federatedPeerClaim: record };
}

function refusal(
  reason: Extract<WorkClaimDecision, { decision: "refused" }>["reason"],
  message: string,
  holder: FederatedWorkClaimHolderV1 | null = null,
): WorkClaimDecision {
  return { decision: "refused", reason, holder, message };
}

/**
 * The home's answer to a claim request. Accepted only over a trusted
 * same-organization link, and only for an item this install owns: a mirror
 * here is someone else's record, and its claim is theirs to decide.
 */
export async function handleIncomingWorkClaimRequest(
  db: WorkClaimHomeDb,
  linkId: string,
  response: DemandResponseV1,
  options: { selfInstallationId: string; claimForPeer: ClaimForPeer; now?: Date },
): Promise<WorkClaimDecision> {
  const now = options.now ?? new Date();
  const request = response.workClaim;
  if (!request) return refusal("not-home", "The request names no item to claim.");
  const link = await db.federationLink.findUnique({ where: { linkId } });
  if (!link || link.role !== "same-org-peer" || link.linkState !== "trusted" || link.revokedAt || link.quarantinedAt) {
    return refusal("link-not-eligible", "Claims are taken only over a trusted connection between installations of the same organization.");
  }
  // The link authenticates one installation. A request may only speak for
  // that installation, so no peer can renew or release another's claim. The
  // link's installation is pinned on first use, as channel demand does.
  if (link.peerInstallationId !== request.requesterInstallationId) {
    if (link.peerInstallationId) {
      return refusal("link-not-eligible", "The request names a different installation than the connection it arrived on.");
    }
    try {
      await bindPeerInstallationIdentity(db, linkId, request.requesterInstallationId);
    } catch {
      return refusal("link-not-eligible", "The request names a different installation than the connection it arrived on.");
    }
  }
  const item = await db.backlogItem.findFirst({
    where: { itemId: request.itemId },
    select: { id: true, itemId: true, body: true },
  });
  if (!item || hasFederatedWorkOriginMarker(item.body)) {
    return refusal("not-home", `${request.itemId} does not live on this installation, so its claim is not decided here.`);
  }

  const executorRef = federatedPeerExecutorRef.format({
    installationId: request.requesterInstallationId,
    workroomId: request.requesterWorkroomId,
  });
  const held = await db.workroom.findFirst({
    where: {
      backlogItemId: { in: [item.itemId, item.id] },
      executorKind: "federated-peer",
      executorRef,
      archivedAt: null,
      status: { notIn: [...TERMINAL_WORKROOM_STATUSES] },
    },
    select: {
      id: true, capsuleId: true, backlogItemId: true, status: true, executorKind: true, executorRef: true,
      repositoryFullName: true, headBranch: true, leaseExpiresAt: true, workspaceState: true,
    },
  });

  // Requests from one Workroom are applied in the order they were made. The
  // outbox only ever sends the newest, so an older one is a replay.
  const applied = held ? readPeerClaimRecord(held.workspaceState) : null;
  if (applied && Date.parse(response.createdAt) <= Date.parse(applied.lastRequestAt)) {
    return refusal("stale-request", "A newer request from this Workroom has already been applied.");
  }
  const record: PeerClaimRecord = { linkId, lastRequestAt: response.createdAt };

  if (request.action === "release") {
    if (held) {
      await db.workroom.update({
        where: { capsuleId: held.capsuleId },
        data: {
          status: request.releaseReason === "finished" ? "archived" : "abandoned",
          leaseExpiresAt: now,
          lastSyncedAt: now,
          workspaceState: withPeerClaimRecord(held.workspaceState, record),
        },
      });
      await recordHomeActivity(db, held, `Released by ${request.requesterInstallationId} (${request.releaseReason ?? "abandoned"}).`, request);
    }
    return { decision: "released" };
  }

  const leaseExpiresAt = new Date(now.getTime() + FEDERATED_CLAIM_LEASE_MS);
  if (held && isLapsedPeerClaim(held, now)) {
    // The requester stopped renewing long enough that the claim lapsed and
    // someone may have taken the item over. Close the lapsed claim and decide
    // this request afresh, like any other.
    await db.workroom.update({
      where: { capsuleId: held.capsuleId },
      data: { status: "abandoned", lastSyncedAt: now, workspaceState: withPeerClaimRecord(held.workspaceState, record) },
    });
    await recordHomeActivity(db, held, `Lapsed: ${request.requesterInstallationId} stopped renewing.`, request);
  } else if (held) {
    // A renewal, or a repeated claim from the same Workroom: the claim is
    // already this requester's. Extending the lease is the whole answer.
    await db.workroom.update({
      where: { capsuleId: held.capsuleId },
      data: { leaseExpiresAt, lastSyncedAt: now, workspaceState: withPeerClaimRecord(held.workspaceState, record) },
    });
    return { decision: request.action === "claim" ? "granted" : "renewed", homeWorkroomId: held.capsuleId, leaseExpiresAt: leaseExpiresAt.toISOString() };
  }

  // No claim held for this Workroom: a first claim, or a renewal after the
  // claim lapsed. Either way it is decided afresh, by the ordinary check.
  const outcome = await options.claimForPeer({
    itemId: item.itemId,
    repositoryFullName: request.repositoryFullName,
    headBranch: request.headBranch,
    worktreePath: federatedPeerWorktreePath({ installationId: request.requesterInstallationId, workroomId: request.requesterWorkroomId }),
    executorRef,
    linkId,
  });
  if (!outcome.claimed && !outcome.holders) {
    return refusal("not-claimable", `${item.itemId} cannot be claimed here: ${outcome.refusedReason}`);
  }
  if (!outcome.claimed) {
    const first = outcome.holders[0];
    const holder = first ? claimHolderOf(first, options.selfInstallationId) : null;
    return refusal(
      "held-elsewhere",
      holder
        ? `${item.itemId} is already being worked by ${holder.installationId === options.selfInstallationId ? "this installation" : holder.installationId} in ${holder.workroomId}.`
        : `${item.itemId} is already being worked.`,
      holder,
    );
  }
  const granted = await db.workroom.findFirst({ where: { capsuleId: outcome.capsuleId }, select: { workspaceState: true } });
  await db.workroom.update({
    where: { capsuleId: outcome.capsuleId },
    data: { leaseExpiresAt, lastSyncedAt: now, workspaceState: withPeerClaimRecord(granted?.workspaceState, record) },
  });
  return { decision: "granted", homeWorkroomId: outcome.capsuleId, leaseExpiresAt: leaseExpiresAt.toISOString() };
}

async function recordHomeActivity(
  db: WorkClaimHomeDb,
  room: HomeRoom,
  summary: string,
  request: NonNullable<DemandResponseV1["workClaim"]>,
): Promise<void> {
  if (!room.id) return;
  await db.workroomActivity.create({
    data: { workCapsuleId: room.id, kind: "federated-claim", summary, payload: { request } },
  });
}

// ─── Requester side ─────────────────────────────────────────────────────────

/** What the requester's Workroom records about its claim at the home. */
export interface FederatedClaimState {
  state: "requested" | "granted" | "refused" | "releasing" | "released";
  federationLinkId: string;
  homeInstallationId: string;
  homeItemId: string;
  lastAction: WorkClaimAction;
  requestedAt: string;
  decidedAt: string | null;
  homeWorkroomId: string | null;
  leaseExpiresAt: string | null;
  holder: FederatedWorkClaimHolderV1 | null;
  message: string | null;
}

export function readFederatedClaimState(workspaceState: unknown): FederatedClaimState | null {
  if (!workspaceState || typeof workspaceState !== "object") return null;
  const value = (workspaceState as { federatedClaim?: unknown }).federatedClaim;
  if (!value || typeof value !== "object") return null;
  const state = (value as { state?: unknown }).state;
  if (state !== "requested" && state !== "granted" && state !== "refused" && state !== "releasing" && state !== "released") return null;
  return value as FederatedClaimState;
}

type RequesterRoom = {
  id: string;
  capsuleId: string;
  backlogItemId: string | null;
  repositoryFullName: string | null;
  headBranch: string | null;
  status: string;
  workspaceState: unknown;
};

export interface WorkClaimRequesterDb extends FederationDeliveryQueueDb {
  workroom: {
    findUnique(args: unknown): Promise<RequesterRoom | null>;
    findMany(args: unknown): Promise<RequesterRoom[]>;
    update(args: unknown): Promise<unknown>;
  };
  workroomActivity: { create(args: unknown): Promise<unknown> };
  backlogItem: { findFirst(args: unknown): Promise<{ id: string; itemId: string; body: string | null } | null> };
  federatedRecordMirror: {
    findFirst(args: unknown): Promise<{ federationLinkId: string } | null>;
    findMany(args: unknown): Promise<Array<{ localRecordRef: string | null }>>;
    findUnique(args: unknown): Promise<{ mirrorId: string } | null>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
}

function workClaimResponseId(identity: FederationIdentity, linkId: string, capsuleId: string, action: WorkClaimAction, at: Date): string {
  return `rsp_${createHmac("sha256", identity.projectionSecret)
    .update(`${linkId}\u0000work-claim\u0000${capsuleId}\u0000${action}\u0000${at.getTime()}`)
    .digest("hex")}`;
}

/**
 * Ask the item's home to claim, renew or release the claim for one local
 * Workroom. The request is queued in the outbox, so it is sent as soon as the
 * home can be reached; each Workroom has one outbox row, and a newer request
 * replaces an undelivered older one.
 */
export async function requestWorkClaim(
  db: WorkClaimRequesterDb,
  input: {
    capsuleId: string;
    action: WorkClaimAction;
    releaseReason?: WorkClaimReleaseReason;
    identity: FederationIdentity;
    now?: Date;
  },
): Promise<{ queued: true; mirrorId: string; responseId: string } | { queued: false; reason: string }> {
  const now = input.now ?? new Date();
  const room = await db.workroom.findUnique({ where: { capsuleId: input.capsuleId } });
  if (!room?.backlogItemId || !room.repositoryFullName || !room.headBranch) {
    return { queued: false, reason: "The Workroom names no item, repository and branch." };
  }
  const item = await db.backlogItem.findFirst({
    where: { OR: [{ itemId: room.backlogItemId }, { id: room.backlogItemId }] },
    select: { id: true, itemId: true, body: true },
  });
  const origin = parseFederatedWorkOriginMarker(item?.body);
  if (!item || !origin) return { queued: false, reason: "The item lives on this installation; its claim is local." };
  const mirror = await db.federatedRecordMirror.findFirst({
    where: { recordType: "backlog-item", canonicalSide: "peer", localRecordRef: item.itemId },
    select: { federationLinkId: true },
  });
  if (!mirror) return { queued: false, reason: "No connection carries this item from its home." };

  const response: DemandResponseV1 = {
    specVersion: "dpf.demand-response/1",
    responseId: workClaimResponseId(input.identity, mirror.federationLinkId, room.capsuleId, input.action, now),
    envelopeId: workClaimEnvelopeId(origin.recordId),
    originInstallationId: origin.originInstallationId,
    originRecordRef: origin.recordId,
    responseKind: "help-offer",
    responderAttribution: "organization",
    workClaim: {
      itemId: origin.recordId,
      action: input.action,
      requesterInstallationId: input.identity.installationId,
      requesterWorkroomId: room.capsuleId,
      repositoryFullName: room.repositoryFullName,
      headBranch: room.headBranch,
      ...(input.action === "release" ? { releaseReason: input.releaseReason ?? "abandoned" } : {}),
    },
    createdAt: now.toISOString(),
    payloadDigest: "sha256:pending",
  };
  response.payloadDigest = computeDemandResponseDigest(response);

  const localRecordRef = `work-claim:${room.capsuleId}`;
  const data = {
    syncStatus: "pending",
    version: now.getTime(),
    payload: { envelope: response, activity: "dpf.demand.help-offered", eventId: response.responseId, queuedAt: now.toISOString() },
    deadLetteredAt: null,
  };
  const existing = await db.federatedRecordMirror.findUnique({
    where: { federationLinkId_recordType_localRecordRef: { federationLinkId: mirror.federationLinkId, recordType: WORK_CLAIM_RECORD_TYPE, localRecordRef } },
  });
  const mirrorId = existing?.mirrorId ?? `fwc_${response.responseId.slice(4, 28)}`;
  if (existing) await db.federatedRecordMirror.update({ where: { mirrorId }, data });
  else {
    await db.federatedRecordMirror.create({ data: {
      mirrorId, federationLinkId: mirror.federationLinkId, recordType: WORK_CLAIM_RECORD_TYPE,
      canonicalSide: "local", localRecordRef, peerRecordRef: null, ...data,
    } });
  }
  await scheduleFederationDeliveryJob(db, mirrorId, now);

  const prior = readFederatedClaimState(room.workspaceState);
  const next: FederatedClaimState = {
    state: input.action === "release" ? "releasing" : prior?.state === "granted" ? "granted" : "requested",
    federationLinkId: mirror.federationLinkId,
    homeInstallationId: origin.originInstallationId,
    homeItemId: origin.recordId,
    lastAction: input.action,
    requestedAt: now.toISOString(),
    decidedAt: prior?.decidedAt ?? null,
    homeWorkroomId: prior?.homeWorkroomId ?? null,
    leaseExpiresAt: prior?.leaseExpiresAt ?? null,
    holder: prior?.holder ?? null,
    message: prior?.message ?? null,
  };
  await writeClaimState(db, room, next);
  return { queued: true, mirrorId, responseId: response.responseId };
}

async function writeClaimState(db: Pick<WorkClaimRequesterDb, "workroom">, room: RequesterRoom, state: FederatedClaimState): Promise<void> {
  const workspaceState = room.workspaceState && typeof room.workspaceState === "object" ? room.workspaceState : {};
  await db.workroom.update({
    where: { capsuleId: room.capsuleId },
    data: { workspaceState: { ...(workspaceState as Record<string, unknown>), federatedClaim: state } },
  });
}

/** Apply the home's answer, which arrives in the delivery acknowledgement. */
export async function applyWorkClaimDecision(
  db: Pick<WorkClaimRequesterDb, "workroom" | "workroomActivity">,
  capsuleId: string,
  decision: WorkClaimDecision,
  now = new Date(),
): Promise<void> {
  const room = await db.workroom.findUnique({ where: { capsuleId } });
  const prior = room ? readFederatedClaimState(room.workspaceState) : null;
  if (!room || !prior) return;
  const next: FederatedClaimState = { ...prior, decidedAt: now.toISOString() };
  if (decision.decision === "granted" || decision.decision === "renewed") {
    Object.assign(next, { state: "granted", homeWorkroomId: decision.homeWorkroomId, leaseExpiresAt: decision.leaseExpiresAt, holder: null, message: null });
  } else if (decision.decision === "released") {
    Object.assign(next, { state: "released", leaseExpiresAt: null });
  } else {
    Object.assign(next, { state: "refused", holder: decision.holder, message: decision.message });
  }
  await writeClaimState(db, room, next);
  if (decision.decision === "refused" && prior.state !== "refused") {
    await db.workroomActivity.create({
      data: {
        workCapsuleId: room.id,
        kind: "federated-claim-refused",
        summary: `The item's home refused this claim: ${decision.message} Stop before opening a pull request.`,
        payload: { decision },
      },
    });
  }
}

/**
 * Keep each claim held at a home current (spec §5.2 step 4): renew a live
 * Workroom's claim on the federation cadence, and release it once the Workroom
 * has ended. Bounded to Workrooms on items mirrored from a peer.
 */
export async function reconcileFederatedWorkClaims(
  db: WorkClaimRequesterDb,
  input: { identity: FederationIdentity; now?: Date; limit?: number },
): Promise<{ renewed: number; released: number }> {
  const now = input.now ?? new Date();
  const mirrored = await db.federatedRecordMirror.findMany({
    where: { recordType: "backlog-item", canonicalSide: "peer", localRecordRef: { not: null } },
    select: { localRecordRef: true },
  });
  const itemIds = mirrored.map((row) => row.localRecordRef).filter((id): id is string => Boolean(id));
  if (itemIds.length === 0) return { renewed: 0, released: 0 };
  const rooms = await db.workroom.findMany({
    where: { backlogItemId: { in: itemIds }, archivedAt: null },
    select: { id: true, capsuleId: true, backlogItemId: true, repositoryFullName: true, headBranch: true, status: true, workspaceState: true },
    take: input.limit ?? 200,
  });
  let renewed = 0;
  let released = 0;
  for (const room of rooms) {
    const claim = readFederatedClaimState(room.workspaceState);
    if (!claim || claim.state === "refused" || claim.state === "released") continue;
    const ended = (TERMINAL_WORKROOM_STATUSES as readonly string[]).includes(room.status);
    if (ended) {
      if (claim.state === "releasing") continue;
      await requestWorkClaim(db, {
        capsuleId: room.capsuleId, action: "release",
        releaseReason: room.status === "abandoned" ? "abandoned" : "finished",
        identity: input.identity, now,
      });
      released++;
      continue;
    }
    if (claim.state !== "granted") continue;
    if (now.getTime() - Date.parse(claim.requestedAt) < FEDERATED_CLAIM_RENEW_EVERY_MS) continue;
    await requestWorkClaim(db, { capsuleId: room.capsuleId, action: "renew", identity: input.identity, now });
    renewed++;
  }
  return { renewed, released };
}
