// apps/web/lib/queue/functions/embedding-coverage-reconcile.ts
// BI-ED117C82 — embedding coverage self-heals on a schedule, visibly.
//
// The reconcile previously ran only from a boot hook (and before that, from
// nothing at all — it had no caller despite a comment claiming otherwise). A
// boot hook can only retry at restart, and it attempts repair at the moment
// least likely to succeed: local inference is routinely deferred by local-CI
// capacity reservations while other startup work competes for the host.
//
// That matters because the failure is silent and the symptom is not. A
// published stance without a vector degrades stance relevance to lexical, and
// the BI-7E1F128A fail-safe then escalates rather than deciding — so the
// operator experiences it as "my coworkers keep asking me things I already
// decided", with nothing pointing at embeddings.
//
// No operator should ever repair this. Not by restarting a container, not by
// running a maintainer script, not by pressing an admin button — every one of
// those assumes they can connect the symptom to a vector store. It retries on a
// schedule until it succeeds, and reports what it did into the corpus-health
// Workroom so a run is observable without anyone going looking.

import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import {
  EMBEDDING_COVERAGE_CRON,
  EMBEDDING_COVERAGE_INNGEST_ID,
  EMBEDDING_COVERAGE_REQUESTED_EVENT,
  EMBEDDING_COVERAGE_RUN_NOW_INNGEST_ID,
} from "@/lib/wiki/embedding-coverage-constants";
import type { CoverageReport } from "@/lib/wiki/embedding-coverage-workroom";

export async function runEmbeddingCoverageJob(): Promise<CoverageReport> {
  const { prisma } = await import("@dpf/db");
  const { reconcilePublishedWikiEmbeddings } = await import("@/lib/wiki/embedding-reconciliation");
  const { recordCoverageRun } = await import("@/lib/wiki/embedding-coverage-workroom");

  // Full corpus: a bounded scan would let the limit silently decide which pages
  // stay invisible to retrieval.
  const result = await reconcilePublishedWikiEmbeddings({ limit: Number.MAX_SAFE_INTEGER });
  return recordCoverageRun({ db: prisma as never, result });
}

export const embeddingCoverageReconcileScheduled = inngest.createFunction(
  {
    id: EMBEDDING_COVERAGE_INNGEST_ID,
    retries: 1,
    // Serialize with itself: two concurrent reconciles would embed the same
    // missing pages twice and race on the vector upsert.
    concurrency: [{ limit: 1 }],
    triggers: [cron(EMBEDDING_COVERAGE_CRON)],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, EMBEDDING_COVERAGE_INNGEST_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("embedding-coverage-reconcile", () => runEmbeddingCoverageJob());
  },
);

export const embeddingCoverageReconcileRunNow = inngest.createFunction(
  {
    id: EMBEDDING_COVERAGE_RUN_NOW_INNGEST_ID,
    retries: 0,
    concurrency: [{ limit: 1 }],
    triggers: [{ event: EMBEDDING_COVERAGE_REQUESTED_EVENT }],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, EMBEDDING_COVERAGE_RUN_NOW_INNGEST_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("embedding-coverage-reconcile", () => runEmbeddingCoverageJob());
  },
);
