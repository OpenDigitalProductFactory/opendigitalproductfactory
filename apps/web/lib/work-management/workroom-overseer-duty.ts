// The per-room overseer duty (BI-8E1486FA). Pure: the reads and the governed
// writes are in lib/queue/functions/workroom-overseer-run.ts.
//
// Operator, 2026-10-27: "There should be a workroom owner who watches over and
// addresses issues like this per workroom." On the production install that
// month a room whose PR had merged stayed live and refused a later claim on its
// item (WC-A4B7B438), two rooms sat "ready" for days on merged branches with
// expired leases (WC-A2D58814, WC-B9703CBC), and a room held one drive hold for
// 373 ticks on an item that was later sized and delivered (WC-EC0E4382). The
// drive saw all of them every 15 minutes and closed none.
//
// Each drive cycle now applies these rules to every non-standing delivery room,
// first match wins. Rules that resolve a room run before rules that only route
// it, so a merged duplicate is closed rather than reported:
//   R1 item done/retired, and its PR merged or none is open  -> close
//   R2 lease past the resume grace, branch merged             -> close
//   R5 another live room for the same item, this one merged   -> close
//   R3 lease past the grace, authored commits not merged      -> needs resume + one Attention item
//   R4 the same drive hold for HOLD_TICK_BUDGET ticks or more -> conclude the hold + one Attention item
// A raised item clears itself once its condition no longer holds.
// Design: docs/superpowers/specs/2026-09-03-coordinated-workrooms-design.md,
// "October 27 amendment".

import { isRecord } from "@/lib/shared/coerce";
import { WORK_CAPSULE_PAUSE_GRACE_MS } from "@/lib/work-capsules/liveness";

import { deliveryShapeSize, isDeliveryShapeKey } from "./delivery-shapes";
import type { WorkroomDriveHold } from "@dpf/validators/workroom-policy/drive-hold";

export const WORKROOM_OVERSEER_ACTIVITY_KIND = "workroom-overseer";

/** Ticks one hold may last before it is concluded: 12 hours at the 15-minute cadence. */
export const OVERSEER_HOLD_TICK_BUDGET = 48;

/** The resume grace the liveness contract already gives a lease-expired session. */
export const OVERSEER_LEASE_GRACE_MS = WORK_CAPSULE_PAUSE_GRACE_MS;

const STANDING_ROOM_PREFIX = "standing-room:";
const TERMINAL_ITEM_STATUSES: ReadonlySet<string> = new Set(["done", "retired"]);
const TERMINAL_ROOM_STATUSES: ReadonlySet<string> = new Set(["complete", "abandoned", "archived"]);
/** A hold only counts while the drive is waiting on someone; a dispatch or a stood-down room is not held. */
const HELD_ACTIONS: ReadonlySet<string> = new Set(["attention", "pause", "escalate"]);

export type OverseerRule = "R1" | "R2" | "R3" | "R4" | "R5";

export type OverseerAttention = {
  /** The rule and the fact it fired on; an unchanged key is never raised twice. */
  key: string;
  rule: "R3" | "R4";
  title: string;
  context: string;
  raisedAt: string;
  /** The room's Process Overseer, else its accountable participant; null routes to the operator. */
  assigneePrincipalRef: string | null;
};

export type OverseerHoldConclusion = {
  holdKey: string;
  outcome: "derived-size" | "needs-owner";
  /** The size the room's declared delivery shape implies, when that is the fix. */
  derivedSize: string | null;
  ticks: number;
  concludedAt: string;
};

/** `workspaceState.workroomOverseer`: a sibling of the drive's snapshot, which persist replaces whole. */
export type OverseerState = {
  version: 1;
  attention: OverseerAttention | null;
  needsResume: { since: string; leaseExpiredAt: string } | null;
  holdConclusion: OverseerHoldConclusion | null;
};

export const EMPTY_OVERSEER_STATE: OverseerState = { version: 1, attention: null, needsResume: null, holdConclusion: null };

export type OverseerRoom = {
  id: string;
  capsuleId: string;
  status: string;
  idempotencyKey: string | null;
  /** The room's declared work shape key (`delivery-medium`, ...). */
  shapeKey: string | null;
  /** The item's canonical key, the same for a room storing its row id or its BI-* id. */
  itemKey: string | null;
  itemStatus: string | null;
  itemEffortSize: string | null;
  leaseExpiresAt: Date | null;
  /** true merged, false proven not merged, null unknown. Unknown never closes a room. */
  merged: boolean | null;
  openPullRequest: boolean;
  pullRequestNumber: number | null;
  /** The branch carries a head the room authored (not the claim-time base). */
  authoredHead: boolean;
  hold: WorkroomDriveHold | null;
  driveAction: string | null;
  driveReason: string | null;
  assigneePrincipalRef: string | null;
  overseer: OverseerState;
  /** False for a sibling loaded only to count rooms per item (R5); it is never acted on. */
  inScan: boolean;
};

export type OverseerAction =
  | { kind: "close"; rule: "R1" | "R2" | "R5"; room: OverseerRoom; summary: string; facts: Record<string, unknown> }
  | { kind: "route"; rule: "R3" | "R4"; room: OverseerRoom; summary: string; next: OverseerState; facts: Record<string, unknown> }
  | { kind: "clear"; rule: "R3" | "R4"; room: OverseerRoom; summary: string; next: OverseerState; facts: Record<string, unknown> };

export function isStandingRoom(room: Pick<OverseerRoom, "idempotencyKey">): boolean {
  return typeof room.idempotencyKey === "string" && room.idempotencyKey.startsWith(STANDING_ROOM_PREFIX);
}

/** Rooms the duty applies to: live, non-standing, on a delivery shape. */
export function overseenRoom(room: OverseerRoom): boolean {
  return !TERMINAL_ROOM_STATUSES.has(room.status) && !isStandingRoom(room) && isDeliveryShapeKey(room.shapeKey);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Read the stored state; anything unreadable is treated as nothing recorded. */
export function readOverseerState(workspaceState: unknown): OverseerState {
  const raw = isRecord(workspaceState) && isRecord(workspaceState.workroomOverseer) ? workspaceState.workroomOverseer : null;
  if (!raw) return EMPTY_OVERSEER_STATE;
  const attention = isRecord(raw.attention) && text(raw.attention.key) && (raw.attention.rule === "R3" || raw.attention.rule === "R4")
    ? {
      key: String(raw.attention.key), rule: raw.attention.rule, title: text(raw.attention.title) ?? "",
      context: text(raw.attention.context) ?? "", raisedAt: text(raw.attention.raisedAt) ?? "",
      assigneePrincipalRef: text(raw.attention.assigneePrincipalRef),
    } satisfies OverseerAttention
    : null;
  const needsResume = isRecord(raw.needsResume) && text(raw.needsResume.since) && text(raw.needsResume.leaseExpiredAt)
    ? { since: String(raw.needsResume.since), leaseExpiredAt: String(raw.needsResume.leaseExpiredAt) }
    : null;
  const conclusion = isRecord(raw.holdConclusion) && text(raw.holdConclusion.holdKey)
    && (raw.holdConclusion.outcome === "derived-size" || raw.holdConclusion.outcome === "needs-owner")
    ? {
      holdKey: String(raw.holdConclusion.holdKey), outcome: raw.holdConclusion.outcome,
      derivedSize: text(raw.holdConclusion.derivedSize),
      ticks: typeof raw.holdConclusion.ticks === "number" ? raw.holdConclusion.ticks : 0,
      concludedAt: text(raw.holdConclusion.concludedAt) ?? "",
    } satisfies OverseerHoldConclusion
    : null;
  return { version: 1, attention, needsResume, holdConclusion: conclusion };
}

function leasePastGrace(room: OverseerRoom, now: Date): boolean {
  return room.leaseExpiresAt !== null && now.getTime() - room.leaseExpiresAt.getTime() > OVERSEER_LEASE_GRACE_MS;
}

function daysSince(at: Date, now: Date): number {
  return Math.max(1, Math.round((now.getTime() - at.getTime()) / 86_400_000));
}

function prLabel(room: OverseerRoom): string {
  return room.pullRequestNumber ? `PR #${room.pullRequestNumber}` : "its branch";
}

function closeRule(room: OverseerRoom, now: Date, liveRoomsByItem: ReadonlyMap<string, number>): OverseerAction | null {
  const facts = { itemKey: room.itemKey, itemStatus: room.itemStatus, merged: room.merged, openPullRequest: room.openPullRequest,
    pullRequestNumber: room.pullRequestNumber, leaseExpiresAt: room.leaseExpiresAt?.toISOString() ?? null };
  if (room.itemStatus && TERMINAL_ITEM_STATUSES.has(room.itemStatus) && (room.merged === true || !room.openPullRequest)) {
    const because = room.merged === true ? `${prLabel(room)} merged` : "no pull request is open";
    return { kind: "close", rule: "R1", room, facts,
      summary: `Overseer R1: ${room.itemKey ?? "the item"} is ${room.itemStatus} and ${because}; the room is closed and its scope released.` };
  }
  if (room.merged === true && leasePastGrace(room, now)) {
    return { kind: "close", rule: "R2", room, facts,
      summary: `Overseer R2: the lease expired ${daysSince(room.leaseExpiresAt!, now)} day(s) ago and ${prLabel(room)} merged; the room is closed and its scope released.` };
  }
  if (room.merged === true && room.itemKey && (liveRoomsByItem.get(room.itemKey) ?? 0) > 1) {
    return { kind: "close", rule: "R5", room, facts: { ...facts, liveRoomsForItem: liveRoomsByItem.get(room.itemKey) },
      summary: `Overseer R5: another live room delivers ${room.itemKey} and ${prLabel(room)} merged; this room is closed so the other can proceed.` };
  }
  return null;
}

function resumeAttention(room: OverseerRoom, now: Date): OverseerAttention {
  const expired = room.leaseExpiresAt!;
  const mergeState = room.merged === false ? "are not merged" : "have no recorded merge";
  return {
    key: `R3:${expired.toISOString()}`, rule: "R3", raisedAt: now.toISOString(), assigneePrincipalRef: room.assigneePrincipalRef,
    title: `${room.capsuleId} needs its session resumed`,
    context: `${room.capsuleId}${room.itemKey ? ` (${room.itemKey})` : ""}: the lease expired ${daysSince(expired, now)} day(s) ago, `
      + `past the resume grace, and the branch's commits ${mergeState}. Resume the session or hand the room to another executor; `
      + "the overseer will not close unmerged work.",
  };
}

function holdAttention(room: OverseerRoom, hold: WorkroomDriveHold, conclusion: OverseerHoldConclusion, now: Date): OverseerAttention {
  const why = room.driveReason ?? hold.key;
  const fix = conclusion.outcome === "derived-size"
    ? `${room.itemKey} has no size; the room declares ${room.shapeKey}, so its size is ${conclusion.derivedSize}. `
      + "The overseer has no writer for an item's size: record it with size_backlog_item to release the hold."
    : "The overseer cannot derive what clears it, so it needs its owner.";
  return {
    key: `R4:${hold.key}`, rule: "R4", raisedAt: now.toISOString(), assigneePrincipalRef: room.assigneePrincipalRef,
    title: `${room.capsuleId} has been held for ${hold.ticks} drive cycles`,
    context: `${room.capsuleId}${room.itemKey ? ` (${room.itemKey})` : ""} has waited on "${why}" for ${hold.ticks} consecutive cycles `
      + `since ${hold.since}, past the ${OVERSEER_HOLD_TICK_BUDGET}-cycle budget. ${fix}`,
  };
}

function routeRule(room: OverseerRoom, now: Date): OverseerAction | null {
  const state = room.overseer;
  if (leasePastGrace(room, now) && room.merged !== true && room.authoredHead) {
    const attention = resumeAttention(room, now);
    if (state.attention?.key === attention.key) return null;
    return { kind: "route", rule: "R3", room, summary: `Overseer R3: ${attention.context}`,
      next: { ...state, attention, needsResume: { since: now.toISOString(), leaseExpiredAt: room.leaseExpiresAt!.toISOString() } },
      facts: { leaseExpiresAt: room.leaseExpiresAt!.toISOString(), merged: room.merged, assigneePrincipalRef: room.assigneePrincipalRef } };
  }
  const hold = room.hold;
  if (hold && room.driveAction && HELD_ACTIONS.has(room.driveAction) && hold.ticks >= OVERSEER_HOLD_TICK_BUDGET
    && state.holdConclusion?.holdKey !== hold.key) {
    const derivedSize = room.itemKey && !room.itemEffortSize ? deliveryShapeSize(room.shapeKey) : null;
    const conclusion: OverseerHoldConclusion = { holdKey: hold.key, outcome: derivedSize ? "derived-size" : "needs-owner",
      derivedSize, ticks: hold.ticks, concludedAt: now.toISOString() };
    const attention = holdAttention(room, hold, conclusion, now);
    return { kind: "route", rule: "R4", room,
      summary: `Overseer R4: hold concluded (${conclusion.outcome === "derived-size" ? `derived size ${derivedSize}` : "needs owner"}). ${attention.context}`,
      next: { ...state, attention, holdConclusion: conclusion },
      facts: { holdKey: hold.key, ticks: hold.ticks, since: hold.since, outcome: conclusion.outcome, derivedSize } };
  }
  return null;
}

/** A raised item whose condition no longer holds is cleared, so the card leaves with the cause. */
function clearRule(room: OverseerRoom, now: Date): OverseerAction | null {
  const raised = room.overseer.attention;
  if (!raised) return null;
  const stillHolds = raised.rule === "R3"
    ? leasePastGrace(room, now) && room.merged !== true && room.authoredHead
    : room.hold !== null && raised.key === `R4:${room.hold.key}` && room.driveAction !== null && HELD_ACTIONS.has(room.driveAction);
  if (stillHolds) return null;
  const summary = raised.rule === "R3"
    ? `Overseer ${raised.rule}: cleared; the room's session renewed its lease or its work merged.`
    : `Overseer ${raised.rule}: cleared; the drive hold it concluded has moved on.`;
  return { kind: "clear", rule: raised.rule, room, summary,
    next: { ...room.overseer, attention: null, ...(raised.rule === "R3" ? { needsResume: null } : {}) },
    facts: { clearedKey: raised.key } };
}

/** Count eligible delivery rooms per item, over every loaded room (siblings included). */
function liveRoomsPerItem(rooms: readonly OverseerRoom[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const room of rooms) {
    if (!room.itemKey || !overseenRoom(room)) continue;
    counts.set(room.itemKey, (counts.get(room.itemKey) ?? 0) + 1);
  }
  return counts;
}

/** One action at most per room per cycle; rooms with nothing to do produce none. */
export function planOverseerDuty(rooms: readonly OverseerRoom[], now: Date): OverseerAction[] {
  const perItem = liveRoomsPerItem(rooms);
  const actions: OverseerAction[] = [];
  for (const room of rooms) {
    if (!room.inScan || !overseenRoom(room)) continue;
    const action = closeRule(room, now, perItem) ?? routeRule(room, now) ?? clearRule(room, now);
    if (!action) continue;
    actions.push(action);
    // A closed room no longer counts as a live duplicate for the rooms after it.
    if (action.kind === "close" && room.itemKey) perItem.set(room.itemKey, (perItem.get(room.itemKey) ?? 1) - 1);
  }
  return actions;
}

export type OverseerCycleSummary = {
  dryRun: boolean;
  considered: number;
  fired: Record<OverseerRule, number>;
  cleared: number;
  refused: number;
  closedRoomIds: string[];
};

export function emptyOverseerSummary(dryRun: boolean, considered: number): OverseerCycleSummary {
  return { dryRun, considered, fired: { R1: 0, R2: 0, R3: 0, R4: 0, R5: 0 }, cleared: 0, refused: 0, closedRoomIds: [] };
}

export function formatOverseerSummary(summary: OverseerCycleSummary): string {
  const fired = (Object.keys(summary.fired) as OverseerRule[]).map((rule) => `${rule}=${summary.fired[rule]}`).join(" ");
  return `[workroom-overseer]${summary.dryRun ? " dry-run" : ""} considered=${summary.considered} ${fired} cleared=${summary.cleared} refused=${summary.refused}`;
}
