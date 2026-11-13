// apps/web/lib/queue/functions/legacy-proposal-expiry-sweep.ts
//
// Daily sweep that expires legacy AgentActionProposal rows still `proposed`
// after the durable approval lifetime (BI-753D69A9, WWMD DI-738A194A7A61).
// The logic lives in lib/coworker/legacy-proposal-expiry.ts; this is the
// gated cron wrapper.

import { cron } from "@/lib/jobs/triggers";
import { prisma } from "@dpf/db";
import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";
import {
  expireLapsedLegacyProposals,
  type LegacyProposalExpiryDb,
} from "@/lib/coworker/legacy-proposal-expiry";

export const legacyProposalExpirySweep = jobs.createFunction(
  {
    id: "ops/legacy-proposal-expiry-sweep",
    retries: 1,
    // Idempotent: each row is a compare-and-set on status "proposed", so an
    // overlapping or retried run finds nothing left to expire.
    triggers: [cron("17 4 * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ops/legacy-proposal-expiry-sweep");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return await step.run("expire-lapsed-legacy-proposals", async () => {
      const result = await expireLapsedLegacyProposals(prisma as unknown as LegacyProposalExpiryDb);
      if (result.expired > 0 || result.failed > 0) {
        console.info(
          `[legacy-proposal-expiry-sweep] expired ${result.expired}, failed ${result.failed}${result.truncated ? " (more remain)" : ""}`,
        );
      }
      return result;
    });
  },
);
