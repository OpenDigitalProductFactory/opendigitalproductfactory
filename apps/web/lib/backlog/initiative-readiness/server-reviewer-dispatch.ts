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

import type { GovernedExecuteArgs, GovernedExecuteResult } from "@/lib/mcp-governed-execute";
import { findStandingConnection, type StandingConnection } from "@/lib/mcp/standing-connection";

/** A dispatch for the same request is not repeated within this window. */
export const REVIEW_DISPATCH_COOLDOWN_MS = 30 * 60 * 1000;
export const REVIEW_DISPATCH_ACTIVITY_KIND = "reviewer-dispatch";

type RoomAuthor = {
  roomId: string;
  capsuleId: string;
  userId: string | null;
  agentId: string | null;
};

type RouteOutcome = {
  itemId: string;
  capsuleId: string;
  requestKey: string | null;
  outcome: "dispatched" | "refused" | "cooling-down" | "no-author-connection" | "no-author" | "nothing-owed" | "readiness-unavailable";
  detail?: string;
};

type Deps = {
  now?: Date;
  limit?: number;
  findConnection?: (userId: string, agentId: string) => Promise<StandingConnection | null>;
  execute?: (args: GovernedExecuteArgs) => Promise<GovernedExecuteResult>;
  random?: () => number;
  owedRoutes?: (itemId: string, authorAgentId: string) => Promise<Array<{ workroomId: string; requestCoworker: Record<string, unknown> }> | null>;
};

function aliasValue(principal: { aliases: Array<{ aliasValue: string }> } | null | undefined): string | null {
  return principal?.aliases[0]?.aliasValue ?? null;
}

const principalAliases = (aliasType: string) => ({
  select: { kind: true, aliases: { where: { aliasType, issuer: "" }, select: { aliasValue: true }, take: 1 } },
});

/** Who authored the work in a room: the person it was requested for, and their assistant. */
async function loadRoomAuthors(where: { capsuleId?: string; backlogItemId?: { not: null } }): Promise<Array<RoomAuthor & { itemId: string | null }>> {
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
async function loadCandidates(limit: number, random: () => number): Promise<Array<{ itemId: string; room: RoomAuthor }>> {
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
  const candidates = [...newestByItem.entries()].map(([itemId, room]) => ({ itemId, room, order: random() }));
  return candidates.sort((a, b) => a.order - b.order).slice(0, limit).map(({ itemId, room }) => ({ itemId, room }));
}

/** The independent reviewer requests readiness issues for this item right now. */
async function defaultOwedRoutes(itemId: string, authorAgentId: string) {
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

/**
 * Route every independent review a delivered item owes, bounded per call.
 * Runs from mcp/task-run-dispatch-reconciliation; safe to run repeatedly.
 */
export async function dispatchOwedIndependentReviews(deps: Deps = {}): Promise<RouteOutcome[]> {
  const now = deps.now ?? new Date();
  const findConnection = deps.findConnection
    ?? ((userId: string, agentId: string) => findStandingConnection(userId, agentId, "request_coworker", "platform-reviewer-dispatch"));
  const owedRoutes = deps.owedRoutes ?? defaultOwedRoutes;
  const outcomes: RouteOutcome[] = [];
  for (const candidate of await loadCandidates(deps.limit ?? 5, deps.random ?? Math.random)) {
    const base = { itemId: candidate.itemId, capsuleId: candidate.room.capsuleId, requestKey: null };
    const routes = await owedRoutes(candidate.itemId, candidate.room.agentId!).catch(() => null);
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
      if (await recentlyDispatched(room.roomId, requestKey, now)) {
        outcomes.push({ ...at, outcome: "cooling-down" });
        continue;
      }
      const connection = await findConnection(room.userId, room.agentId);
      if (!connection) {
        const outcome: RouteOutcome = { ...at, outcome: "no-author-connection" };
        await record(room, outcome,
          "An independent review is owed, but the author's assistant has no live authorized connection. The author can request it, or reconnect the assistant.");
        outcomes.push(outcome);
        continue;
      }
      const execute = deps.execute ?? (await import("@/lib/mcp-governed-execute")).governedExecuteTool;
      const result = await execute({
        toolName: "request_coworker",
        rawParams: route.requestCoworker,
        userId: connection.token.userId,
        userContext: connection.userContext,
        context: connection.context,
        source: "external-jsonrpc",
      });
      const outcome: RouteOutcome = {
        ...at,
        outcome: result.success ? "dispatched" : "refused",
        ...(result.success ? {} : { detail: result.error ?? result.message }),
      };
      await record(room, outcome, result.success
        ? `The platform asked ${String(route.requestCoworker.targetAgent)} for the independent review this work owes, on the author's connection.`
        : `The platform could not request the independent review this work owes: ${result.message ?? result.error ?? "refused"}.`);
      outcomes.push(outcome);
    }
  }
  return outcomes;
}
