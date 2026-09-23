import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import {
  LOCAL_ONLY_SWEEP_CRON,
  LOCAL_ONLY_SWEEP_INNGEST_ID,
  LOCAL_ONLY_SWEEP_JOB_ID,
} from "@/lib/process-spine/local-only-knowledge-sweep";

/**
 * Weekly local-only knowledge sweep (BI-1281A164, EP-HIVE-HARVEST).
 *
 * `learnings-belong-in-the-shared-commons` is enforced by nothing, and the
 * measured result is a book-length corpus with an audience of one install. This
 * reports the findings the platform captured and never routed, and files one
 * standing backlog item when there are enough of them to be a corpus rather
 * than a queue.
 *
 * Server-side on purpose (AGENTS.md §1): a client hook could see more, but the
 * guarantee cannot live in a client, and every install inherits this one.
 */
export const localOnlyKnowledgeSweep = inngest.createFunction(
  { id: LOCAL_ONLY_SWEEP_INNGEST_ID, retries: 1, triggers: [cron(LOCAL_ONLY_SWEEP_CRON)] },
  async ({ step }) => {
    const gate = await gateAtEntry(step, LOCAL_ONLY_SWEEP_INNGEST_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    const result = await step.run("sweep-unrouted-findings", async () => {
      const { prisma } = await import("@dpf/db");
      const { runLocalOnlyKnowledgeSweep } = await import(
        "@/lib/process-spine/local-only-knowledge-sweep"
      );
      const { ingestBacklogItem } = await import("@/lib/operate/backlog-ingest");

      return runLocalOnlyKnowledgeSweep({
        store: prisma as never,
        ingest: async (args) => {
          const ingested = await ingestBacklogItem(args as never);
          return { itemId: ingested.itemId, created: ingested.created };
        },
      });
    });

    await step.run("record-job-run", async () => {
      const { recordJobRun } = await import("@/lib/operate/discovery-scheduler");
      await recordJobRun(LOCAL_ONLY_SWEEP_JOB_ID, "ok");
      return { recorded: true };
    });

    return result;
  },
);
