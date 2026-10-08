/**
 * AI spend per Workroom (BI-1737A427, EP-B70E718D F6).
 *
 * Spec: docs/superpowers/specs/2026-10-02-workroom-flow-map-and-measurement-design.md §5.2 (cost).
 *
 * A room's AI work runs on threads whose context key names the room, set by
 * the platform that created them:
 *
 *   scheduled:workroom-<capsuleId>-<shapeKey>          the drive's dispatched stage work
 *   coworker:/workspace/cases/work-capsule%3A<capsuleId>  the room's own conversation
 *
 * Every inference on those threads is already costed in AdapterRunTelemetry
 * (the per-thread ledger, BI-CCF1ACBB). Joining the two attributes spend to a
 * room exactly — no schema change, and no estimate from time overlap. Spend on
 * threads that name no room stays unattributed and is reported as such.
 */
const SCHEDULED = /^scheduled:workroom-(WC-[A-Z0-9]+)-/;
const ROOM_CHAT = /^coworker:\/workspace\/cases\/work-capsule(?:%3A|:)(WC-[A-Z0-9]+)$/i;

/** The room a thread belongs to, or null when its context key names none. */
export function roomOfThreadContext(contextKey: string | null | undefined): string | null {
  if (!contextKey) return null;
  return SCHEDULED.exec(contextKey)?.[1] ?? ROOM_CHAT.exec(contextKey)?.[1]?.toUpperCase() ?? null;
}

/** Fold per-thread spend into per-room spend. */
export function sumSpendByRoom(
  threads: readonly { id: string; contextKey: string | null }[],
  spendByThread: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const thread of threads) {
    const room = roomOfThreadContext(thread.contextKey);
    const usd = spendByThread.get(thread.id);
    if (!room || !usd) continue;
    out.set(room, (out.get(room) ?? 0) + usd);
  }
  return out;
}
