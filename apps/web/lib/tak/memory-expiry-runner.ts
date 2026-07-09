// apps/web/lib/tak/memory-expiry-runner.ts
// Server-side application of the memory expiry policy (BI-153F7E4A). Binds prisma
// to the pure selectors in memory-expiry.ts. Invoked by the nightly sleep-time
// pass (BI-907C4327) and callable ad hoc for a single user/coworker.

import { prisma } from "@dpf/db";
import {
  selectExpirableEntries,
  selectPrunableMessages,
  DEFAULT_MEMORY_UNUSED_DAYS,
  DEFAULT_MESSAGE_RETENTION_DAYS,
  type ExpirableEntry,
} from "./memory-expiry";

/** UserFact categories whose facts must never expire (durable constraints). */
const PROTECTED_FACT_CATEGORIES = new Set(["constraint"]);

export type ExpiryResult = {
  factsExpired: number;
  notesExpired: number;
  messagesPruned: number;
};

/**
 * Bump usage on recall so an entry that is actually used resets its expiry
 * clock. Fire-and-forget from the recall path; batched by id.
 */
export async function bumpUserFactUsage(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.userFact.updateMany({
    where: { id: { in: ids } },
    data: { lastAccessedAt: new Date(), useCount: { increment: 1 } },
  });
}

export async function bumpCoworkerNoteUsage(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.coworkerMemoryNote.updateMany({
    where: { id: { in: ids } },
    data: { lastAccessedAt: new Date(), useCount: { increment: 1 } },
  });
}

/**
 * Expire a user's stale facts by supersession (never a hard delete). Facts in a
 * protected category are kept.
 */
export async function expireStaleUserFacts(
  userId: string,
  opts?: { now?: Date; unusedDays?: number },
): Promise<number> {
  const now = opts?.now ?? new Date();
  const rows = await prisma.userFact.findMany({
    where: { userId, supersededAt: null },
    select: { id: true, category: true, createdAt: true, lastAccessedAt: true },
  });
  const entries: ExpirableEntry[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    lastAccessedAt: r.lastAccessedAt,
    protected: PROTECTED_FACT_CATEGORIES.has(r.category),
  }));
  const expireIds = selectExpirableEntries(entries, {
    now,
    unusedDays: opts?.unusedDays ?? DEFAULT_MEMORY_UNUSED_DAYS,
  });
  if (expireIds.length === 0) return 0;
  await prisma.userFact.updateMany({
    where: { id: { in: expireIds } },
    data: { supersededAt: now },
  });
  return expireIds.length;
}

/** Expire a coworker's stale notes by supersession. */
export async function expireStaleCoworkerNotes(
  agentCuid: string,
  opts?: { now?: Date; unusedDays?: number },
): Promise<number> {
  const now = opts?.now ?? new Date();
  const rows = await prisma.coworkerMemoryNote.findMany({
    where: { agentId: agentCuid, supersededAt: null },
    select: { id: true, createdAt: true, lastAccessedAt: true },
  });
  const expireIds = selectExpirableEntries(rows, {
    now,
    unusedDays: opts?.unusedDays ?? DEFAULT_MEMORY_UNUSED_DAYS,
  });
  if (expireIds.length === 0) return 0;
  await prisma.coworkerMemoryNote.updateMany({
    where: { id: { in: expireIds } },
    data: { supersededAt: now },
  });
  return expireIds.length;
}

/**
 * Prune a thread's raw messages that are already folded into its durable
 * checkpoint AND older than the retention window. Hard delete is safe here —
 * the content survives in the checkpoint summary. No-op when the thread has no
 * checkpoint watermark.
 */
export async function pruneSummarizedThreadMessages(
  threadId: string,
  opts?: { now?: Date; retentionDays?: number },
): Promise<number> {
  const now = opts?.now ?? new Date();
  const thread = await prisma.agentThread.findUnique({
    where: { id: threadId },
    select: { compactionWatermarkAt: true },
  });
  if (!thread?.compactionWatermarkAt) return 0;
  const rows = await prisma.agentMessage.findMany({
    where: {
      threadId,
      role: { in: ["user", "assistant"] },
      createdAt: { lte: thread.compactionWatermarkAt },
    },
    select: { id: true, createdAt: true },
  });
  const pruneIds = selectPrunableMessages(rows, {
    now,
    watermarkAt: thread.compactionWatermarkAt,
    retentionDays: opts?.retentionDays ?? DEFAULT_MESSAGE_RETENTION_DAYS,
  });
  if (pruneIds.length === 0) return 0;
  const res = await prisma.agentMessage.deleteMany({ where: { id: { in: pruneIds } } });
  return res.count;
}
