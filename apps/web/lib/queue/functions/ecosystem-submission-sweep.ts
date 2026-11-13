import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";

// BI-96EFB042 — the automated half of submission. Escalation already had every
// safety gate; what it lacked was a caller that is not a human finger. On an
// install where nobody holds manage_platform, nothing ever reached the
// ecosystem. This removes the need to REMEMBER, never the need to AGREE:
// without recorded consent the sweep halts and asks once.
//
// Daily rather than weekly: a defect should not wait a week to be heard, and
// the sweep is cheap when there is nothing to send.
export const ecosystemSubmissionSweep = jobs.createFunction(
  { id: "ecosystem/issue-submission-sweep", retries: 2, triggers: [cron("41 5 * * *")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ecosystem/issue-submission-sweep");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    const result = await step.run("submit-eligible-reports", async () => {
      const { runEcosystemSubmissionSweep } = await import("@/lib/ecosystem/submission-sweep-runner");
      return runEcosystemSubmissionSweep();
    });
    // BI-6ED89EC6: record what the run did. Without this the register showed a
    // job that "reports run data" holding none, and a sweep halted for want of
    // consent was visible nowhere.
    await step.run("record-sweep-outcome", async () => {
      const { recordEcosystemJobHeartbeat, sweepHeartbeat, SUBMISSION_SWEEP_JOB_ID } =
        await import("@/lib/ecosystem/job-heartbeat");
      await recordEcosystemJobHeartbeat(SUBMISSION_SWEEP_JOB_ID, sweepHeartbeat(result));
    });
    return result;
  },
);
