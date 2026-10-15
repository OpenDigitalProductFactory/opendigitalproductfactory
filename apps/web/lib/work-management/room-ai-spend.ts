/**
 * AI spend per Workroom (BI-1737A427, EP-B70E718D F6).
 *
 * Spec: docs/superpowers/specs/2026-10-02-workroom-flow-map-and-measurement-design.md §5.2 (cost).
 *
 * A room's AI work runs on threads whose context key names the room, set by
 * the platform that created them:
 *
 *   scheduled:workroom-<capsuleId>-<shapeKey>          the drive's dispatched stage work
 *   coworker:/workspace/cases/<the room's case key>        the room's own conversation
 *
 * Every inference on those threads is already recorded in AdapterRunTelemetry
 * (the per-thread ledger, BI-CCF1ACBB). Joining the two attributes AI use to a
 * room exactly — no schema change, and no estimate from time overlap. Use on
 * threads that name no room stays unattributed and is reported as such.
 *
 * The figure is the shared AiUse (lib/portfolio/ai-resource.ts): runs, tokens,
 * recorded dollars, and subscription tokens. A subscription records no
 * per-call cost, so its use reads as subscription tokens, never as $0.
 */
import { addAiUse, type AiUse } from "@/lib/portfolio/ai-resource";

const SCHEDULED = /^scheduled:workroom-(WC-[A-Z0-9]+)-/;
const ROOM_CHAT = /^coworker:\/workspace\/cases\/work-capsule(?:%3A|:)(WC-[A-Z0-9]+)$/i;

/** The room a thread belongs to, or null when its context key names none. */
export function roomOfThreadContext(contextKey: string | null | undefined): string | null {
  if (!contextKey) return null;
  return SCHEDULED.exec(contextKey)?.[1] ?? ROOM_CHAT.exec(contextKey)?.[1]?.toUpperCase() ?? null;
}

/** Fold per-thread AI use into per-room AI use. */
export function sumAiUseByRoom(
  threads: readonly { id: string; contextKey: string | null }[],
  useByThread: ReadonlyMap<string, AiUse>,
): Map<string, AiUse> {
  const out = new Map<string, AiUse>();
  for (const thread of threads) {
    const room = roomOfThreadContext(thread.contextKey);
    const use = useByThread.get(thread.id);
    if (!room || !use || use.runs === 0) continue;
    const prior = out.get(room);
    out.set(room, prior ? addAiUse(prior, use) : use);
  }
  return out;
}
