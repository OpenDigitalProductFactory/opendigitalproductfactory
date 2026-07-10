// apps/web/lib/tak/memory-consolidation-runner.ts
// Applies the batch dedupe plan to the live stores (BI-907C4327). Binds prisma to
// the pure planner; supersession preserves the provenance chain (loser points at
// the canonical winner). Reused by the nightly sleep-time pass.

import { prisma } from "@dpf/db";
import { planBatchDedupe, type SweepEntry } from "./memory-consolidation-sweep";

/** Collapse a coworker's near-duplicate active notes to one canonical each. */
export async function dedupeCoworkerNotes(agentCuid: string): Promise<number> {
  const notes = await prisma.coworkerMemoryNote.findMany({
    where: { agentId: agentCuid, supersededAt: null },
    select: { id: true, noteKey: true, content: true, createdAt: true, noteKind: true },
  });
  // Dedupe within each noteKind — a technique and a preference are never dupes.
  const byKind = new Map<string, SweepEntry[]>();
  for (const n of notes) {
    const list = byKind.get(n.noteKind) ?? [];
    list.push({ id: n.id, key: n.noteKey, value: n.content, createdAt: n.createdAt });
    byKind.set(n.noteKind, list);
  }
  let superseded = 0;
  for (const entries of byKind.values()) {
    const plan = planBatchDedupe(entries);
    for (const item of plan) {
      await prisma.coworkerMemoryNote.update({
        where: { id: item.loserId },
        data: { supersededAt: new Date(), supersededById: item.winnerId },
      });
      superseded += 1;
    }
  }
  return superseded;
}

/** Collapse a user's near-duplicate active facts (per category) to one canonical each. */
export async function dedupeUserFacts(userId: string): Promise<number> {
  const facts = await prisma.userFact.findMany({
    where: { userId, supersededAt: null },
    select: { id: true, key: true, value: true, createdAt: true, category: true },
  });
  const byCategory = new Map<string, SweepEntry[]>();
  for (const f of facts) {
    const list = byCategory.get(f.category) ?? [];
    list.push({ id: f.id, key: f.key, value: f.value, createdAt: f.createdAt });
    byCategory.set(f.category, list);
  }
  let superseded = 0;
  for (const entries of byCategory.values()) {
    const plan = planBatchDedupe(entries);
    for (const item of plan) {
      await prisma.userFact.update({
        where: { id: item.loserId },
        data: { supersededAt: new Date(), supersededById: item.winnerId },
      });
      superseded += 1;
    }
  }
  return superseded;
}
