// apps/web/lib/queue/functions/memory-consolidation-nightly.ts
// Sleep-time memory consolidation pass ("autoDream") — BI-907C4327
// (EP-8C706944 Phase 2). Nightly, low-priority reflection that reorganizes the
// memory stores while nobody is waiting: batch-collapse near-duplicate facts and
// notes, then expire entries unused past the retention window. Mirrors Letta's
// sleep-time compute and the generative-agents reflection loop, reusing DPF's
// existing nightly-Inngest + quiescence-gate substrate.
//
// Design: idempotent and additive. Consolidation supersedes near-duplicates
// (provenance preserved); expiry supersedes stale entries (never a hard delete).
// Runs behind the quiescence gate so it never contends with an upgrade.

import { cron } from "inngest";
import { prisma } from "@dpf/db";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import { dedupeCoworkerNotes, dedupeUserFacts } from "@/lib/tak/memory-consolidation-runner";
import {
  expireStaleCoworkerNotes,
  expireStaleUserFacts,
  pruneSummarizedThreadMessages,
} from "@/lib/tak/memory-expiry-runner";

/** 04:20 UTC daily — off-peak, clear of the 03:00 backup + 04:00 retention slots. */
export const MEMORY_CONSOLIDATION_CRON = "20 4 * * *";

export interface MemoryConsolidationResult {
  coworkersSwept: number;
  usersSwept: number;
  notesDeduped: number;
  factsDeduped: number;
  notesExpired: number;
  factsExpired: number;
  threadsPruned: number;
  messagesPruned: number;
}

/**
 * Sweep every coworker's notes and every user's facts: batch-dedupe then expire.
 * Each entity is handled independently; one failure is logged and does not abort
 * the pass.
 */
export async function runMemoryConsolidationSweep(): Promise<MemoryConsolidationResult> {
  const result: MemoryConsolidationResult = {
    coworkersSwept: 0,
    usersSwept: 0,
    notesDeduped: 0,
    factsDeduped: 0,
    notesExpired: 0,
    factsExpired: 0,
    threadsPruned: 0,
    messagesPruned: 0,
  };

  // Coworkers with at least one active note.
  const noteAgents = await prisma.coworkerMemoryNote.findMany({
    where: { supersededAt: null },
    distinct: ["agentId"],
    select: { agentId: true },
  });
  for (const { agentId } of noteAgents) {
    try {
      result.notesDeduped += await dedupeCoworkerNotes(agentId);
      result.notesExpired += await expireStaleCoworkerNotes(agentId);
      result.coworkersSwept += 1;
    } catch (err) {
      console.warn(`[autoDream] coworker ${agentId} sweep failed:`, err);
    }
  }

  // Users with at least one active fact.
  const factUsers = await prisma.userFact.findMany({
    where: { supersededAt: null },
    distinct: ["userId"],
    select: { userId: true },
  });
  for (const { userId } of factUsers) {
    try {
      result.factsDeduped += await dedupeUserFacts(userId);
      result.factsExpired += await expireStaleUserFacts(userId);
      result.usersSwept += 1;
    } catch (err) {
      console.warn(`[autoDream] user ${userId} sweep failed:`, err);
    }
  }

  // Prune raw messages already folded into a durable checkpoint and older than
  // the retention window (BI-153F7E4A). Only threads that HAVE a checkpoint
  // watermark are candidates — the content survives in the summary.
  const checkpointedThreads = await prisma.agentThread.findMany({
    where: { compactionWatermarkAt: { not: null } },
    select: { id: true },
  });
  for (const { id } of checkpointedThreads) {
    try {
      const pruned = await pruneSummarizedThreadMessages(id);
      if (pruned > 0) {
        result.messagesPruned += pruned;
        result.threadsPruned += 1;
      }
    } catch (err) {
      console.warn(`[autoDream] thread ${id} prune failed:`, err);
    }
  }

  return result;
}

export const memoryConsolidationNightly = inngest.createFunction(
  {
    id: "coworker/memory-consolidation-nightly",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron(MEMORY_CONSOLIDATION_CRON)],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    const swept = await step.run("memory-consolidation-sweep", async () =>
      runMemoryConsolidationSweep(),
    );
    return swept;
  },
);
