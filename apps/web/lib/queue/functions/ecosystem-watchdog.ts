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

    const outcome = await step.run("bring-the-ecosystem-to-the-room", async () => {
      const { runWeeklyEcosystemWatchdog } = await import("@/lib/ecosystem/watchdog-wiring");
      return runWeeklyEcosystemWatchdog();
    });
    // BI-6ED89EC6: the digest promised to report a missing room "in its run
    // data" and wrote no run data at all. Record every outcome.
    await step.run("record-digest-outcome", async () => {
      const { recordEcosystemJobHeartbeat, digestHeartbeat, WEEKLY_DIGEST_JOB_ID } =
        await import("@/lib/ecosystem/job-heartbeat");
      await recordEcosystemJobHeartbeat(WEEKLY_DIGEST_JOB_ID, digestHeartbeat(outcome as never));
    });
    return outcome;
  },
);
