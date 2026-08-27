// S-TRIG (BI-DC738330) — the shared "open or advance the Bookkeeping Work Room"
// operation both triggers call. The room + its lifecycle grammar landed in S-ROOM
// (BI-F8B6CF81); this is the first production driver of `openWorkroomCycle` for the
// `bookkeeping-period` room kind.
//
// The books loop is a STANDING room (one per install, recurring), so a fresh cycle is
// opened per period rather than a new room per period. The weekly cadence and inbound
// statement/receipt arrival both funnel here, idempotent on the period's cycle key — so
// a duplicate tick or a re-delivered email never double-opens a cycle.
//
// The live reconciled period stays owner-gated: no bank statement, no import — the stop
// conditions below refuse to fabricate transactions. See
// docs/superpowers/specs/2026-08-16-bookkeeping-work-room-design.md.
import { prisma } from "@dpf/db";

import {
  openWorkroomCycle,
  WorkroomCycleStoreError,
  type OpenWorkroomCycleInput,
  type WorkroomCycleStoreDb,
} from "@/lib/work-management/room-cycle-store";
import { prismaWorkroomCycleDb } from "@/lib/work-management/room-cycle-prisma.server";

/** The `bookkeeping-period` room kind, registered in the source registry (S-ROOM). */
export const BOOKKEEPING_ROOM_SOURCE_TYPE = "bookkeeping-period";
/** One standing books room per install — the recurring loop, not a room per period. */
export const BOOKKEEPING_ROOM_SOURCE_ID = "books";
/** Stable per-install books queue id. */
export const BOOKKEEPING_QUEUE_ID = "bookkeeping";

/** Statuses that mean the standing room WorkItem is still live (not a candidate for a fresh one). */
const LIVE_WORK_ITEM_STATUSES = [
  "queued",
  "assigned",
  "in-progress",
  "awaiting-input",
  "awaiting-approval",
  "escalated",
  "deferred",
];

/**
 * ISO-8601 week key (e.g. `"2026-W35"`) — the cycle key the weekly cadence advances.
 * Pure and UTC-based so a tick is deterministic and idempotent within a week.
 */
export function bookkeepingPeriodKey(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7; // Sunday → 7
  d.setUTCDate(d.getUTCDate() + 4 - day); // shift to the week's Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Pure: build the `OpenWorkroomCycleInput` (minus the `db`) for a bookkeeping period cycle.
 * Kept side-effect-free so the trigger contract is unit-testable without a database.
 */
export function buildBookkeepingCycleInput(args: {
  roomWorkItemId: string;
  periodKey: string;
  trigger: string;
  accountablePrincipalRef: string;
  actor: { type: "user" | "agent"; id: string };
  now: Date;
}): Omit<OpenWorkroomCycleInput, "db"> {
  const expectedReviewAt = new Date(args.now.getTime() + 7 * 86_400_000); // review a week out
  return {
    roomWorkItemId: args.roomWorkItemId,
    cycleKey: args.periodKey,
    trigger: args.trigger,
    objective:
      `Reconcile the books for ${args.periodKey}: import statements, categorize and match ` +
      `transactions, surface exceptions, and prepare the period for owner review.`,
    accountablePrincipalRef: args.accountablePrincipalRef,
    expectedReviewAt,
    stopConditions: [
      "Stop if a bank statement is unavailable — the owner's export is required; never fabricate transactions.",
      "Stop if the reconciliation gap cannot be explained by named open items.",
    ],
    measureSummary:
      "Statement imported with provenance; every transaction matched or surfaced as an exception; " +
      "balance reconciled or the gap explained.",
    contextRefs: [{ kind: "evidence", id: `bookkeeping-period:${args.periodKey}` }],
    actor: args.actor,
    idempotencyKey: `bookkeeping-open:${args.periodKey}`,
    policy: {
      caseRef: {
        caseId: `${BOOKKEEPING_ROOM_SOURCE_TYPE}:${BOOKKEEPING_ROOM_SOURCE_ID}`,
        sourceType: BOOKKEEPING_ROOM_SOURCE_TYPE,
        sourceId: BOOKKEEPING_ROOM_SOURCE_ID,
      },
      sourceKey: BOOKKEEPING_ROOM_SOURCE_TYPE,
      currentState: { state: "active", terminal: false },
      envelope: {
        autonomyMode: "autonomous",
        // Consequential books writes carry a governed-action receipt.
        receiptPolicy: { required: true, kind: "governed-action" },
      },
    },
    now: args.now,
  };
}

/**
 * Upsert the single standing bookkeeping room WorkItem. Idempotent — a live room is
 * returned rather than duplicated. Mirrors the source→WorkItem bridge pattern
 * (lib/queue/bridges/booking-bridge.ts).
 */
export async function ensureBookkeepingPeriodRoom(): Promise<string> {
  const existing = await prisma.workItem.findFirst({
    where: {
      sourceType: BOOKKEEPING_ROOM_SOURCE_TYPE,
      sourceId: BOOKKEEPING_ROOM_SOURCE_ID,
      status: { in: LIVE_WORK_ITEM_STATUSES },
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  const queue = await prisma.workQueue.upsert({
    where: { queueId: BOOKKEEPING_QUEUE_ID },
    create: {
      queueId: BOOKKEEPING_QUEUE_ID,
      name: "Bookkeeping",
      queueType: "team",
      routingPolicy: { mode: "manual", considerAvailability: false, considerPerformance: false },
    },
    update: {},
  });

  const room = await prisma.workItem.create({
    data: {
      sourceType: BOOKKEEPING_ROOM_SOURCE_TYPE,
      sourceId: BOOKKEEPING_ROOM_SOURCE_ID,
      title: "Bookkeeping",
      description:
        "The standing books-loop room — statements imported, transactions categorized and " +
        "matched, and the period reconciled for owner review each cycle.",
      urgency: "routine",
      effortClass: "cognitive",
      workerConstraint: { workerType: "agent" },
      queueId: queue.id,
      status: "in-progress",
    },
    select: { id: true },
  });
  return room.id;
}

export interface OpenOrAdvanceBookkeepingResult {
  cycleKey: string;
  /** A new cycle was opened for this period. */
  opened: boolean;
  /** A cycle for this exact period already existed — idempotent no-op. */
  idempotent: boolean;
  /** A different period's cycle is still active — the room is already being worked. */
  alreadyActive: boolean;
  roomWorkItemId: string;
}

/**
 * Open or advance the standing bookkeeping room to the given period's cycle. Idempotent on
 * the period key; a still-open cycle for a PRIOR period is treated as "already being worked"
 * (not an error) so a trigger never crashes the caller. Both triggers (weekly cadence,
 * inbound statement/receipt) call this.
 */
export async function openOrAdvanceBookkeepingPeriod(args: {
  periodKey: string;
  trigger: string;
  accountablePrincipalRef: string;
  actor: { type: "user" | "agent"; id: string };
  now?: Date;
  db?: WorkroomCycleStoreDb;
  roomWorkItemId?: string;
}): Promise<OpenOrAdvanceBookkeepingResult> {
  const now = args.now ?? new Date();
  const roomWorkItemId = args.roomWorkItemId ?? (await ensureBookkeepingPeriodRoom());
  const db = args.db ?? prismaWorkroomCycleDb;
  const input: OpenWorkroomCycleInput = {
    db,
    ...buildBookkeepingCycleInput({
      roomWorkItemId,
      periodKey: args.periodKey,
      trigger: args.trigger,
      accountablePrincipalRef: args.accountablePrincipalRef,
      actor: args.actor,
      now,
    }),
  };
  try {
    const result = await openWorkroomCycle(input);
    return {
      cycleKey: args.periodKey,
      opened: !result.idempotent,
      idempotent: result.idempotent,
      alreadyActive: false,
      roomWorkItemId,
    };
  } catch (err) {
    if (err instanceof WorkroomCycleStoreError && err.reason === "active_cycle_exists") {
      return { cycleKey: args.periodKey, opened: false, idempotent: false, alreadyActive: true, roomWorkItemId };
    }
    throw err;
  }
}
