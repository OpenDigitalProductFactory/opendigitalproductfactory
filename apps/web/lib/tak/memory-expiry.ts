// apps/web/lib/tak/memory-expiry.ts
// Usage-based memory expiry + raw-log retention — BI-153F7E4A (EP-8C706944 P2).
//
// No memory store had a forgetting policy: UserFact / CoworkerMemoryNote
// supersede but never expire, and the raw AgentMessage log grows unbounded.
// Unbounded append-only memory degrades quality at write scale (context rot),
// so every mature system has an expiry gate.
//
// Policy (GitHub Copilot Memory's production model): an entry unused past a
// retention window expires; any successful recall resets the clock
// (lastAccessedAt). Memory entries are expired by SUPERSESSION, never a hard
// delete — the row and its provenance survive, it just stops being injected.
// Only the raw AgentMessage log is actually pruned, and only for messages that
// are BOTH already folded into the durable checkpoint AND older than a generous
// retention window, so nothing unsummarized is ever lost.
//
// Pure and deterministic (time injected) so the selection logic is unit-testable
// without a DB or a clock.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Default: a memory entry unused for this many days is eligible to expire. */
export const DEFAULT_MEMORY_UNUSED_DAYS = 28;

/**
 * Default: raw messages already covered by the checkpoint are pruned only once
 * they are older than this. Generous on purpose — the summary preserves content,
 * this only reclaims very old verbatim rows.
 */
export const DEFAULT_MESSAGE_RETENTION_DAYS = 90;

export type ExpirableEntry = {
  id: string;
  createdAt: Date;
  lastAccessedAt: Date | null;
  /** High-value entries can be protected from expiry (e.g. pinned/constraint). */
  protected?: boolean;
};

/** The effective "last touch" — last access, or creation if never recalled. */
export function lastTouch(entry: ExpirableEntry): Date {
  return entry.lastAccessedAt ?? entry.createdAt;
}

/**
 * Select the ids of entries whose last touch is older than `unusedDays` before
 * `now`. Protected entries are always kept.
 */
export function selectExpirableEntries(
  entries: ExpirableEntry[],
  opts: { now: Date; unusedDays?: number },
): string[] {
  const unusedDays = opts.unusedDays ?? DEFAULT_MEMORY_UNUSED_DAYS;
  const cutoff = opts.now.getTime() - unusedDays * MS_PER_DAY;
  return entries
    .filter((e) => !e.protected && lastTouch(e).getTime() < cutoff)
    .map((e) => e.id);
}

export type RetainableMessage = {
  id: string;
  createdAt: Date;
};

/**
 * Select raw AgentMessage ids that are safe to prune: strictly at/behind the
 * checkpoint watermark (so their content is already in the durable summary) AND
 * older than the retention window. When there is no watermark (no checkpoint
 * yet) nothing is prunable — we never drop unsummarized history.
 */
export function selectPrunableMessages(
  messages: RetainableMessage[],
  opts: { now: Date; watermarkAt: Date | null; retentionDays?: number },
): string[] {
  if (!opts.watermarkAt) return [];
  const retentionDays = opts.retentionDays ?? DEFAULT_MESSAGE_RETENTION_DAYS;
  const cutoff = opts.now.getTime() - retentionDays * MS_PER_DAY;
  const watermark = opts.watermarkAt.getTime();
  return messages
    .filter((m) => m.createdAt.getTime() <= watermark && m.createdAt.getTime() < cutoff)
    .map((m) => m.id);
}
