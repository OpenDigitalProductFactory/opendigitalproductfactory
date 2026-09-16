import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

// BI-F47386ED — the inbound half of the ecosystem loop. Until this existed the
// platform could only POST an issue upstream; nothing ever read one back, so a
// platform-development install could not see what the ecosystem had submitted.
//
// Weekly, matching the ballot cadence in the ecosystem intake spec. No-ops on
// any install whose purpose is not evolve-dpf.
export const ecosystemInboundTriage = inngest.createFunction(
  { id: "ecosystem/inbound-issue-triage", retries: 2, triggers: [cron("17 6 * * 1")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ecosystem/inbound-issue-triage");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("triage-inbound-ecosystem-items", async () => {
      const { runEcosystemInboundTriage } = await import("@/lib/ecosystem/inbound-triage-runner");
      return runEcosystemInboundTriage();
    });
  },
);
