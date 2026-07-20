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

    return step.run("reconcile-federated-demand", async () => {
      const { runDemandReconciliation } = await import("@/lib/federation/demand-reconciliation");
      return runDemandReconciliation();
    });
  },
);
