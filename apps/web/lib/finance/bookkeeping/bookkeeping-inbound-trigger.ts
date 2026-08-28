// S-TRIG (BI-DC738330) — the on-arrival trigger. Composes over the room-native inbound
// seam (ingestWorkroomChannelEvent) rather than the marketing email classifier, so a bank
// statement or vendor receipt forwarded to the books room's channel opens or advances the
// period's cycle without coupling bookkeeping into marketing routing.
//
// Idempotent: a re-delivered email never double-opens a cycle (openOrAdvanceBookkeepingPeriod
// keys on the ISO-week period). The actual import stays owner-gated — arrival advances the
// loop; it never fabricates transactions.
import { ingestWorkroomChannelEvent } from "@/lib/work-management/room-channel-ingress";
import type { RoomChannelIngressDb } from "@/lib/work-management/room-channel-ingress";
import type { NormalizedInboundRoomEvent } from "@/lib/work-management/room-channel-continuity";
import type { WorkroomCycleStoreDb } from "@/lib/work-management/room-cycle-store";

import {
  BOOKKEEPING_ROOM_SOURCE_TYPE,
  bookkeepingPeriodKey,
  openOrAdvanceBookkeepingPeriod,
} from "./bookkeeping-period-room";

/** True when an accepted event's room ref targets the standing bookkeeping-period room. */
export function isBookkeepingRoomCaseId(caseId: string): boolean {
  return caseId.startsWith(`${BOOKKEEPING_ROOM_SOURCE_TYPE}:`);
}

export interface BookkeepingInboundResult {
  ingest: NormalizedInboundRoomEvent;
  /** Whether the arrival was routed to the bookkeeping room and its cycle engaged. */
  advanced: boolean;
  /** A NEW cycle was opened for the current period. */
  opened: boolean;
  cycleKey: string | null;
}

type IngestEvent = Omit<Parameters<typeof ingestWorkroomChannelEvent>[0], "db">;

/**
 * On-arrival trigger: ingest a verified inbound channel event through the room-native seam,
 * then — only when it is accepted onto the bookkeeping-period room — open or advance the
 * period's cycle. Non-bookkeeping rooms and non-accepted events pass through untouched.
 */
export async function ingestBookkeepingInbound(input: {
  ingressDb: RoomChannelIngressDb;
  event: IngestEvent;
  now?: Date;
  /** Cycle store to advance; defaults to the prisma-backed store inside the core. */
  cycleDb?: WorkroomCycleStoreDb;
  /** Pre-resolved room WorkItem row id; defaults to the standing room upsert. */
  roomWorkItemId?: string;
}): Promise<BookkeepingInboundResult> {
  const ingest = await ingestWorkroomChannelEvent({ db: input.ingressDb, ...input.event });
  if (ingest.status !== "accepted" || !isBookkeepingRoomCaseId(ingest.room.caseId)) {
    return { ingest, advanced: false, opened: false, cycleKey: null };
  }
  const when = input.now ?? new Date();
  const periodKey = bookkeepingPeriodKey(when);
  const result = await openOrAdvanceBookkeepingPeriod({
    periodKey,
    trigger: `Inbound document arrived: ${ingest.activity.summary}`,
    accountablePrincipalRef: ingest.principalRef,
    actor: { type: "agent", id: "bookkeeper" },
    now: when,
    db: input.cycleDb,
    roomWorkItemId: input.roomWorkItemId,
  });
  return {
    ingest,
    advanced: result.opened || result.idempotent || result.alreadyActive,
    opened: result.opened,
    cycleKey: result.cycleKey,
  };
}
