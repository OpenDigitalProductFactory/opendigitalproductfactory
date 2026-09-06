import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

/**
 * Weekly canonical-improvement digest (BI-8996BBBB, process-spine §6.5).
 * Batches [reference-doc] ImprovementProposal rows into one doc chore BI for
 * human-approved canonical-source PRs.
 */
export const canonicalImprovementDigest = inngest.createFunction(
  { id: "ops/canonical-improvement-digest", retries: 1, triggers: [cron("17 6 * * 1")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ops/canonical-improvement-digest");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("digest-reference-doc-proposals", async () => {
      const { prisma } = await import("@dpf/db");
      const { runCanonicalImprovementDigest } = await import(
        "@/lib/process-spine/canonical-improvement-digest"
      );
      return runCanonicalImprovementDigest(prisma);
    });
  },
);