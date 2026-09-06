// apps/web/lib/queue/functions/semantic-memory-reconcile.ts
// BI-DG-001 (EP-DATA-GOVERNANCE): nightly orphan-reconciliation for the
// semantic-memory derived copy. Retention purges and ad-hoc deletions propagate to
// the vector store inline (best-effort); this scheduled sweep is the safety net that
// makes any missed source-delete event visible and removes the orphaned vectors so a
// purged conversation turn cannot linger in agent memory (spec §"Derived-data
// contracts": "reconciliation proves no orphan remains"). Idempotent, quiescence-
// gated, and concurrency-limited to one in-flight run.

import { cron } from "inngest";
import { prisma, scrollPoints, QDRANT_COLLECTIONS } from "@dpf/db";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import {
  reconcileOrphanConversationVectors,
  SEMANTIC_MEMORY_SCAN_LIMIT,
  type CleanupEvidence,
} from "@/lib/inference/semantic-memory-cleanup";

/** 05:10 UTC daily — after the 04:00 retention sweep (which purges aged threads),
 *  clear of the 04:20 memory-consolidation and 04:50 MDM-steward slots. */
export const SEMANTIC_MEMORY_RECONCILE_CRON = "10 5 * * *";
export const SEMANTIC_MEMORY_RECONCILE_SCHEDULED_INNGEST_ID =
  "govern/semantic-memory-reconcile-scheduled";
export const SEMANTIC_MEMORY_RECONCILE_REQUESTED_EVENT =
  "govern/semantic-memory-reconcile.requested";
export const SEMANTIC_MEMORY_RECONCILE_REQUESTED_INNGEST_ID =
  "govern/semantic-memory-reconcile-requested";

/**
 * Scroll the agent-memory collection for candidate vectors, then remove any whose
 * source AgentMessage no longer exists. Returns bounded evidence (counts + error
 * codes only). The source-existence check is a batched Postgres lookup.
 */
export async function runSemanticMemoryReconcile(): Promise<
  CleanupEvidence & { orphanMessageIds: string[] }
> {
  const points = await scrollPoints(
    QDRANT_COLLECTIONS.AGENT_MEMORY,
    {},
    SEMANTIC_MEMORY_SCAN_LIMIT,
  );
  const candidateMessageIds = [
    ...new Set(
      points
        .map((p) => String(p.payload["messageId"] ?? ""))
        .filter((id) => id.length > 0),
    ),
  ];

  return reconcileOrphanConversationVectors({
    candidateMessageIds,
    cappedAtScan: points.length >= SEMANTIC_MEMORY_SCAN_LIMIT,
    existsResolver: async (ids) => {
      const rows = await prisma.agentMessage.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      return new Set(rows.map((r) => r.id));
    },
  });
}

export const semanticMemoryReconcileScheduled = inngest.createFunction(
  {
    id: SEMANTIC_MEMORY_RECONCILE_SCHEDULED_INNGEST_ID,
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron(SEMANTIC_MEMORY_RECONCILE_CRON)],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, SEMANTIC_MEMORY_RECONCILE_SCHEDULED_INNGEST_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("semantic-memory-reconcile", async () => runSemanticMemoryReconcile());
  },
);

// Operator "run now" trigger (same reconciliation, on demand).
export const semanticMemoryReconcileRequested = inngest.createFunction(
  {
    id: SEMANTIC_MEMORY_RECONCILE_REQUESTED_INNGEST_ID,
    retries: 1,
    triggers: [{ event: SEMANTIC_MEMORY_RECONCILE_REQUESTED_EVENT }],
  },
  async ({ step }) =>
    step.run("semantic-memory-reconcile-manual", async () => runSemanticMemoryReconcile()),
);
