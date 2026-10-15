import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";

// BI-784D20FD — the weekly ecosystem turn. Without this trigger the digest
// builder is a library nobody calls, which is the "merged but never fires"
// failure the platform already named.
//
// Monday morning, before the inbound triage sweep, so an operator's week opens
// with what the ecosystem is asking of them.
export const ecosystemWatchdog = jobs.createFunction(
  { id: "ecosystem/weekly-watchdog", retries: 2, triggers: [cron("5 6 * * 1")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ecosystem/weekly-watchdog");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("bring-the-ecosystem-to-the-room", async () => {
      const { runWeeklyEcosystemWatchdog } = await import("@/lib/ecosystem/watchdog-wiring");
      return runWeeklyEcosystemWatchdog();
    });
  },
);
