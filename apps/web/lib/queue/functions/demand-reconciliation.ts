import { cron } from "inngest";

import { envFlagEnabled } from "@/lib/runtime/env-flags";

import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

/** Automatic same-organization demand sync plus durable retry safety-net. */
export const demandReconciliationScheduled = inngest.createFunction(
  {
    id: "federation/demand-reconciliation",
    retries: 1,
    // Preserve a five-minute safety net without joining the minute-zero herd.
    triggers: [cron("1,6,11,16,21,26,31,36,41,46,51,56 * * * *")],
  },
  async ({ step }) => {
    if (!envFlagEnabled(process.env, "DPF_FEDERATION_EXCHANGE_ENABLED")) {
      return { skipped: true, reason: "federation-exchange-disabled" };
    }
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    const demand = await step.run("reconcile-federated-demand", async () => {
      const { runDemandReconciliation } = await import("@/lib/federation/demand-reconciliation");
      return runDemandReconciliation();
    });
    // Same cadence, separate step: pull every same-organization peer's backlog
    // into local mirrors (BI-FF8A57EF). A demand failure never blocks work sync
    // and vice versa.
    const work = await step.run("sync-federated-work", async () => {
      const { runWorkSync } = await import("@/lib/federation/work-sync");
      return runWorkSync();
    });
    return { demand, work };
  },
);
