import "server-only";

// The platform routes the independent reviewer a delivered item owes
// (BI-A835D300).
//
// Readiness already computes the exact reviewer request a delivered item needs
// (a server-issued `requestCoworker` packet). Until now only the author's
// client could send it, so the review waited on that client: on 2026-09-23 the
// reviewer route was issued and authorized, but the author's client never
// refreshed its tool list, and the review never ran. Platform function must not
// depend on a client.
//
// This sends that same packet on the author's behalf, through the author's own
// live OAuth connection and the same governed `request_coworker` lane the
// client would use. Nothing about authority changes:
//
// - the connection, its consent, and the assistant's grants must be current;
// - the person and the assistant must both be admitted to the exact room;
// - the packet must equal the one readiness issues now (forged or stale ones
//   are refused by the lane itself);
// - the reviewer must be independent of the author (the lane and the receipt
//   both refuse self-review);
// - the request key makes it idempotent: a client dispatch and a server
//   dispatch of the same review are one TaskRun.
//
// A room with no live consent-bound connection is left for its author, and the
// reason is recorded on the room.

import { prisma } from "@dpf/db";

import type { GovernedExecuteArgs, GovernedExecuteResult } from "@/lib/mcp-governed-execute-types";
import { findStandingConnection, findStandingConnectionForUser, type StandingConnection } from "@/lib/mcp/standing-connection";

import { BUILD_STUDIO_ASSISTANT_AGENT_ID, buildStudioOwedRoutes } from "./build-studio-owed-routes";
import type { ReadinessReviewRoute } from "@/lib/work-management/readiness-review-stages";

/** A dispatch for the same request is not repeated within this window. */
export const REVIEW_DISPATCH_COOLDOWN_MS = 30 * 60 * 1000;
export const REVIEW_DISPATCH_ACTIVITY_KIND = "reviewer-dispatch";

type RoomAuthor = {
  roomId: string;
  capsuleId: string;
  userId: string | null;
  agentId: string | null;
};

/**
 * Which readiness decision a candidate owes its reviews on. Delivered items
 * owe the completion decision; a Build Studio build in plan owes its
 * implementation decision (BI-926A7E90).
 */
type CandidateTarget = "completion" | "implementation";

type Candidate = { itemId: string; room: RoomAuthor; target: CandidateTarget };

/** Connections the platform prefers to carry a Build Studio room's request (spec §4). */
export const BUILD_STUDIO_PREFERRED_CARRIER_AGENT_IDS = ["AGT-EXT-CLAUDE", "AGT-EXT-CODEX"] as const;

type RouteOutcome = {
  itemId: string;
  capsuleId: string;
  requestKey: string | null;
  outcome: "dispatched" | "refused" | "cooling-down" | "no-author-connection" | "no-author" | "nothing-owed" | "readiness-unavailable";
  detail?: string;
  /** The assistant whose connection carried the request (a Build Studio room's own assistant holds none). */
  carriedByAgentId?: string;
};

type Deps = {
  now?: Date;
  limit?: number;
  findConnection?: (userId: string, agentId: string) => Promise<StandingConnection | null>;
  /** BI-926A7E90: any live connection of the requesting user, for a Build Studio room. */
  findUserConnection?: (userId: string) => Promise<StandingConnection | null>;
  execute?: (args: GovernedExecuteArgs) => Promise<GovernedExecuteResult>;
  random?: () => number;
  owedRoutes?: (itemId: string, authorAgentId: string, candidate?: Candidate) => Promise<Array<{ workroomId: string; requestCoworker: Record<string, unknown> }> | null>;
};

function aliasValue(principal: { aliases: Array<{ aliasValue: string }> } | null | undefined): string | null {
  return principal?.aliases[0]?.aliasValue ?? null;
}

const principalAliases = (aliasType: string) => ({
  select: { kind: true, aliases: { where: { aliasType, issuer: "" }, select: { aliasValue: true }, take: 1 } },
});

/**
 * Who authored the work in a room: the person it was requested for, and their
 * assistant. Newest room first. The acceptance sweep reads the author the same
 * way, so it never routes acceptance back to them (BI-DF255666).
 */
export async function loadRoomAuthors(where: { capsuleId?: string; backlogItemId?: { not: null } | { in: string[] } }): Promise<Array<RoomAuthor & { itemId: string | null }>> {
  const rooms = await prisma.workroom.findMany({
    where: { ...where, archivedAt: null, status: { notIn: ["abandoned", "archived"] } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      capsuleId: true,
      backlogItemId: true,
      requestedByPrincipal: principalAliases("user"),
      createdByPrincipal: principalAliases("agent"),
      participants: {
        where: { lifecycle: "active", roles: { has: "contributor" } },
        select: { principal: principalAliases("agent") },
      },
    },
  });
  return rooms.map((room) => {
    const participantAgent = room.participants.map((entry) => entry.principal).find((principal) => principal?.kind === "agent");
    return {
      roomId: room.id,
      capsuleId: room.capsuleId,
      itemId: room.backlogItemId,
      userId: aliasValue(room.requestedByPrincipal),
      agentId: aliasValue(room.createdByPrincipal?.kind === "agent" ? room.createdByPrincipal : participantAgent),
    };
  });
}

/**
 * Delivered items that still owe acceptance, each with its most recently active
 * room that an assistant authored for a person. A room a person opened with a
 * personal token names no assistant, so it cannot be the author's connection;
 * an item often has one newer than the room its assistant worked in
 * (BI-D35B85BF on 2026-09-24). Shuffled, so a bounded tick does not re-check
 * the same items forever (111 of 502 awaiting items had a live room).
 */
async function loadAwaitingCandidates(): Promise<Candidate[]> {
  const rooms = await loadRoomAuthors({ backlogItemId: { not: null } });
  const itemIds = [...new Set(rooms.flatMap((room) => (room.itemId ? [room.itemId] : [])))];
  if (itemIds.length === 0) return [];
  const awaiting = new Set((await prisma.backlogItem.findMany({
    where: { itemId: { in: itemIds }, status: "awaiting-acceptance" },
    select: { itemId: true },
  })).map((item) => item.itemId));
  const newestByItem = new Map<string, RoomAuthor>();
  for (const room of rooms) {
    if (!room.itemId || !awaiting.has(room.itemId) || !room.userId || !room.agentId) continue;
    if (!newestByItem.has(room.itemId)) newestByItem.set(room.itemId, room);
  }
  return [...newestByItem.entries()].map(([itemId, room]) => ({ itemId, room, target: "completion" as const }));
}

/**
 * BI-926A7E90: Build Studio rooms whose build is in plan and whose item is still
 * open. Their assistant is the admitted Build Studio coworker; the person is the
 * room's requester. Each room is its own candidate: the build, not the item, is
 * what the reviews unblock.
 */
async function loadBuildStudioCandidates(): Promise<Candidate[]> {
  const rooms = await prisma.workroom.findMany({
    where: {
      executorKind: "build-studio",
      archivedAt: null,
      status: { notIn: ["abandoned", "archived"] },
      backlogItemId: { not: null },
      featureBuild: { is: { phase: "plan" } },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, capsuleId: true, backlogItemId: true,
      requestedByPrincipal: principalAliases("user"),
      // Build Studio attaches its room with no requesting principal; the build
      // itself records who asked for it (119 of 119 plan rooms on 2026-10-02).
      featureBuild: { select: { createdById: true } },
    },
  });
  // A Build Studio room records the item's ROW id in backlogItemId (the
  // attachment writes `backlogItem.id`), where an adopted room records the
  // BI- id. Resolve either to the BI- id the readiness and recovery lanes use.
  const itemRefs = [...new Set(rooms.flatMap((room) => (room.backlogItemId ? [room.backlogItemId] : [])))];
  if (itemRefs.length === 0) return [];
  const openItemIdByRef = new Map<string, string>();
  for (const item of await prisma.backlogItem.findMany({
    where: { OR: [{ itemId: { in: itemRefs } }, { id: { in: itemRefs } }], status: { in: ["open", "in-progress"] } },
    select: { id: true, itemId: true },
  })) {
    openItemIdByRef.set(item.id, item.itemId);
    openItemIdByRef.set(item.itemId, item.itemId);
  }
  return rooms.flatMap((room) => {
    const userId = aliasValue(room.requestedByPrincipal) ?? room.featureBuild?.createdById ?? null;
    const itemId = room.backlogItemId ? openItemIdByRef.get(room.backlogItemId) : undefined;
    if (!itemId || !userId) return [];
    return [{
      itemId,
      room: { roomId: room.id, capsuleId: room.capsuleId, userId, agentId: BUILD_STUDIO_ASSISTANT_AGENT_ID },
      target: "implementation" as const,
    }];
  });
}

async function loadCandidates(limit: number, random: () => number): Promise<Candidate[]> {
  const candidates = [...await loadAwaitingCandidates(), ...await loadBuildStudioCandidates()]
    .map((candidate) => ({ candidate, order: random() }));
  return candidates.sort((a, b) => a.order - b.order).slice(0, limit).map(({ candidate }) => candidate);
}

/** The independent reviewer requests readiness issues for this item right now. */
async function defaultOwedRoutes(itemId: string, authorAgentId: string, candidate?: Candidate) {
  if (candidate?.target === "implementation") {
    const result = await buildStudioOwedRoutes({ itemId, capsuleId: candidate.room.capsuleId, authorAgentId });
    return result.routed ? result.routes : null;
  }
  const { getBacklogItem } = await import("@/lib/mcp/packs/backlog-pack-read-tools");
  const item = await getBacklogItem({ itemId }, authorAgentId);
  const decision = (item.data?.readiness as { decisions?: { completion?: unknown } } | undefined)?.decisions?.completion as
    | import("@/lib/backlog/initiative-readiness").InitiativeReadinessDecision
    | undefined;
  if (!item.success || !decision) return null;
  if (decision.verdict === "allowed") return [];
  const { resolveTerminalInitiativeRecovery } = await import("./terminal-recovery");
  const recovery = await resolveTerminalInitiativeRecovery({ decision, currentAgentId: authorAgentId, refusedWorkroomId: null });
  return recovery.reviewerRoutes
    .filter((route) => route.independent)
    .map((route) => ({ workroomId: route.workroomId, requestCoworker: route.requestCoworker as unknown as Record<string, unknown> }));
}

/**
 * The independent design-phase reviews the item owes now (design-spec,
 * spec-approval, plan-review), from the implementation readiness recovery.
 * Read by the room drive's review stages (BI-2C8750FC). Null when readiness
 * could not be read; empty when nothing independent is owed.
 */
export async function loadDesignPhaseOwedReviewRoutes(itemId: string, authorAgentId: string | null): Promise<ReadinessReviewRoute[] | null> {
  const { getBacklogItem } = await import("@/lib/mcp/packs/backlog-pack-read-tools");
  const item = await getBacklogItem({ itemId }, authorAgentId);
  const decision = (item.data?.readiness as { decisions?: { implementation?: unknown } } | undefined)?.decisions?.implementation as
    | import("@/lib/backlog/initiative-readiness").InitiativeReadinessDecision
    | undefined;
  if (!item.success || !decision) return null;
  if (decision.verdict === "allowed") return [];
  const { designPhaseReviewDecision } = await import("./design-phase-recovery");
  const designPhase = designPhaseReviewDecision(decision);
  if (!designPhase) return [];
  const { resolveTerminalInitiativeRecovery } = await import("./terminal-recovery");
  const recovery = await resolveTerminalInitiativeRecovery({ decision: designPhase, currentAgentId: authorAgentId, refusedWorkroomId: null });
  return recovery.reviewerRoutes
    .filter((route) => route.independent)
    .map((route) => ({
      gate: route.gate,
      accountableRole: route.accountableRole,
      targetAgentId: route.targetAgentId,
      independent: route.independent,
      requestCoworker: route.requestCoworker as unknown as Record<string, unknown>,
    }));
}

async function recentlyDispatched(roomId: string, requestKey: string, now: Date): Promise<boolean> {
  const recent = await prisma.workroomActivity.findFirst({
    where: {
      workCapsuleId: roomId,
      kind: REVIEW_DISPATCH_ACTIVITY_KIND,
      recordedAt: { gte: new Date(now.getTime() - REVIEW_DISPATCH_COOLDOWN_MS) },
      payload: { path: ["requestKey"], equals: requestKey },
    },
    select: { id: true },
  });
  return Boolean(recent);
}

async function record(room: RoomAuthor, outcome: RouteOutcome, summary: string): Promise<void> {
  await prisma.workroomActivity.create({
    data: {
      workCapsuleId: room.roomId,
      kind: REVIEW_DISPATCH_ACTIVITY_KIND,
      summary,
      payload: { ...outcome, source: "platform-reviewer-dispatch" },
    },
  });
}

const BUILD_STUDIO_NO_CONNECTION_SUMMARY =
  "An independent review of this build's design is owed, but the person who requested the build has no live authorized connection the platform may send on. Reconnect an assistant (Claude Code or Codex) to let the platform request it.";

/**
 * Send ONE server-issued reviewer packet on the author's side, idempotently.
 * Shared by the owed-review sweep below and the room drive's review stages
 * (BI-2C8750FC), so both send the same packet through the same governed
 * `request_coworker` lane with the same cooldown and the same room record.
 *
 * `author-assistant` carries it on the authoring assistant's own connection;
 * `requesting-user` on any live connection of the person the work is for (a
 * Build Studio build, or work a person authored with no assistant).
 */
export async function dispatchReviewerRequest(args: {
  room: RoomAuthor;
  itemId: string;
  requestCoworker: Record<string, unknown>;
  carrier: "author-assistant" | "requesting-user";
  workroomId?: string;
  now?: Date;
  /** What the room records when no connection may carry the request. */
  noConnectionSummary?: string;
  deps?: Pick<Deps, "findConnection" | "findUserConnection" | "execute">;
}): Promise<RouteOutcome> {
  const { room, requestCoworker } = args;
  const now = args.now ?? new Date();
  const requestKey = typeof requestCoworker.requestKey === "string" ? requestCoworker.requestKey : null;
  const at = { itemId: args.itemId, capsuleId: args.workroomId ?? room.capsuleId, requestKey };
  if (!requestKey) return { ...at, outcome: "refused", detail: "The reviewer packet carries no request key." };
  if (!room.userId || (args.carrier === "author-assistant" && !room.agentId)) return { ...at, outcome: "no-author" };
  if (await recentlyDispatched(room.roomId, requestKey, now)) return { ...at, outcome: "cooling-down" };
  const findConnection = args.deps?.findConnection
    ?? ((userId: string, agentId: string) => findStandingConnection(userId, agentId, "request_coworker", "platform-reviewer-dispatch"));
  const findUserConnection = args.deps?.findUserConnection
    ?? ((userId: string) => findStandingConnectionForUser(userId, "request_coworker", "platform-reviewer-dispatch", {
      preferAgentIds: BUILD_STUDIO_PREFERRED_CARRIER_AGENT_IDS,
    }));
  const connection = args.carrier === "requesting-user"
    ? await findUserConnection(room.userId)
    : await findConnection(room.userId, room.agentId!);
  if (!connection) {
    const outcome: RouteOutcome = { ...at, outcome: "no-author-connection" };
    await record(room, outcome, args.noConnectionSummary ?? (args.carrier === "requesting-user"
      ? "An independent review of this work is owed, but the person it is for has no live authorized connection the platform may send on. Reconnect an assistant (Claude Code or Codex) to let the platform request it."
      : "An independent review is owed, but the author's assistant has no live authorized connection. The author can request it, or reconnect the assistant."));
    return outcome;
  }
  const execute = args.deps?.execute ?? (await import("@/lib/mcp-governed-execute")).governedExecuteTool;
  const result = await execute({
    toolName: "request_coworker",
    rawParams: requestCoworker,
    userId: connection.token.userId,
    userContext: connection.userContext,
    context: connection.context,
    source: "external-jsonrpc",
  });
  const outcome: RouteOutcome = {
    ...at,
    outcome: result.success ? "dispatched" : "refused",
    ...(result.success ? {} : { detail: result.error ?? result.message }),
    ...(connection.context.agentId ? { carriedByAgentId: connection.context.agentId } : {}),
  };
  await record(room, outcome, result.success
    ? `The platform asked ${String(requestCoworker.targetAgent)} for the independent review this work owes, on the author's connection.`
    : `The platform could not request the independent review this work owes: ${result.message ?? result.error ?? "refused"}.`);
  return outcome;
}

/**
 * Route every independent review a delivered item owes, bounded per call.
 * Runs from mcp/task-run-dispatch-reconciliation; safe to run repeatedly.
 */
export async function dispatchOwedIndependentReviews(deps: Deps = {}): Promise<RouteOutcome[]> {
  const now = deps.now ?? new Date();
  const findConnection = deps.findConnection
    ?? ((userId: string, agentId: string) => findStandingConnection(userId, agentId, "request_coworker", "platform-reviewer-dispatch"));
  const findUserConnection = deps.findUserConnection
    ?? ((userId: string) => findStandingConnectionForUser(userId, "request_coworker", "platform-reviewer-dispatch", {
      preferAgentIds: BUILD_STUDIO_PREFERRED_CARRIER_AGENT_IDS,
    }));
  const owedRoutes = deps.owedRoutes ?? defaultOwedRoutes;
  const outcomes: RouteOutcome[] = [];
  for (const candidate of await loadCandidates(deps.limit ?? 5, deps.random ?? Math.random)) {
    const base = { itemId: candidate.itemId, capsuleId: candidate.room.capsuleId, requestKey: null };
    const routes = await owedRoutes(candidate.itemId, candidate.room.agentId!, candidate).catch(() => null);
    if (routes === null) { outcomes.push({ ...base, outcome: "readiness-unavailable" }); continue; }
    if (routes.length === 0) { outcomes.push({ ...base, outcome: "nothing-owed" }); continue; }
    for (const route of routes) {
      const requestKey = typeof route.requestCoworker.requestKey === "string" ? route.requestCoworker.requestKey : null;
      if (!requestKey) continue;
      // The author is whoever authored the room the review is about.
      const room = route.workroomId === candidate.room.capsuleId
        ? candidate.room
        : (await loadRoomAuthors({ capsuleId: route.workroomId }))[0] ?? null;
      const at = { itemId: candidate.itemId, capsuleId: route.workroomId, requestKey };
      if (!room?.userId || !room.agentId) { outcomes.push({ ...at, outcome: "no-author" }); continue; }
      outcomes.push(await dispatchReviewerRequest({
        room, itemId: candidate.itemId, requestCoworker: route.requestCoworker,
        carrier: candidate.target === "implementation" ? "requesting-user" : "author-assistant",
        workroomId: route.workroomId, now, deps: { ...deps, findConnection, findUserConnection },
        ...(candidate.target === "implementation" ? { noConnectionSummary: BUILD_STUDIO_NO_CONNECTION_SUMMARY } : {}),
      }));
    }
  }
  return outcomes;
}
