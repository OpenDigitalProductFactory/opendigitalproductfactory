import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

// BI-96EFB042 — the automated half of submission. Escalation already had every
// safety gate; what it lacked was a caller that is not a human finger. On an
// install where nobody holds manage_platform, nothing ever reached the
// ecosystem. This removes the need to REMEMBER, never the need to AGREE:
// without recorded consent the sweep halts and asks once.
//
// Daily rather than weekly: a defect should not wait a week to be heard, and
// the sweep is cheap when there is nothing to send.
export const ecosystemSubmissionSweep = inngest.createFunction(
  { id: "ecosystem/issue-submission-sweep", retries: 2, triggers: [cron("41 5 * * *")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ecosystem/issue-submission-sweep");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("submit-eligible-reports", async () => {
      const { runEcosystemSubmissionSweep } = await import("@/lib/ecosystem/submission-sweep-runner");
      return runEcosystemSubmissionSweep();
    });
  },
);
