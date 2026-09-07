// Edge-node janitor: retire an installer-managed enrollment that a later, live
// enrollment has provably superseded, so the "Enrollment conflict" state heals
// itself instead of waiting for a human to find the obsolete row and click
// Revoke. Hourly, no quiescence gate (coordination records, not portal state).
// The decision rule and its guard-rails live in lib/edge-node/stale-supersession.

import { cron } from "inngest";

import { prisma } from "@dpf/db";

import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import { supersedeStaleInstallerNodes, type StaleSupersessionDb } from "@/lib/edge-node/stale-supersession";

export const edgeNodeJanitor = inngest.createFunction(
  {
    id: "ops/edge-node-janitor",
    retries: 1,
    // Idempotent: a revoked node drops out of the candidate set, so an
    // overlapping trigger finds nothing to do.
    triggers: [cron("33 * * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ops/edge-node-janitor");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    const supersession = await step.run("supersede-stale-installer-nodes", async () => {
      const result = await supersedeStaleInstallerNodes(prisma as unknown as StaleSupersessionDb);
      if (result.revoked.length > 0) {
        console.info(`[edge-node-janitor] retired superseded installer enrollment(s): ${result.revoked.join(", ")}`);
      }
      return result;
    });
    return { supersession };
  },
);
