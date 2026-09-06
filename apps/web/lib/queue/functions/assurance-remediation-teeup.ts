import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

// Assurance remediation lane P1 (BI-7C121CCF). Hourly poll that, only inside the
// platform off-hours window, promotes a budgeted batch of auto-filed assurance
// findings (PR #2290) into Build Studio remediation builds. Founder rails:
// off-hours/flexible (hourly cron, window-gated — not a fixed slot), incremental
// + budget-capped (per-run cap), and gated on governedBacklogEnabled. NO
// auto-merge here — the resulting PRs wait for P2's WWMD-gated merge.
//
// Cron is :41 (a free minute) to stay off the shared ticks the contention guard
// watches (scheduling-map.test.ts).
export const assuranceRemediationTeeUpScheduled = inngest.createFunction(
  {
    id: "assurance/remediation-tee-up-scheduled",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("41 * * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "assurance/remediation-tee-up-scheduled");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("assurance-remediation-tee-up", async () => {
      const { prisma } = await import("@dpf/db");
      const {
        runAssuranceRemediationTeeUp,
        isAssuranceRemediationWindowOpen,
        resolveRemediationBudget,
      } = await import("@/lib/assurance/remediation-teeup");
      const { dispatchApprovedIdeateBuilds } = await import("@/lib/build/ideate-on-approval");
      const { resolveScheduledOwnerUserId } = await import("../scheduled-owner");

      const now = new Date();
      // Off-hours rail: hourly cron, but only act inside the low-traffic window.
      if (!isAssuranceRemediationWindowOpen(now)) {
        return { skipped: true, reason: "outside-off-hours-window" };
      }

      const userId = await resolveScheduledOwnerUserId();
      const teeUp = await runAssuranceRemediationTeeUp({
        prisma,
        userId,
        budget: resolveRemediationBudget(),
      });

      // Fire Ideate for the drafts this run auto-approved (mirrors the governed
      // tee-up) so promoted remediation builds are not dead-on-arrival at ideate.
      const ideateDispatch =
        teeUp.promotedCount > 0 ? await dispatchApprovedIdeateBuilds({ userId }) : null;

      return { ...teeUp, ideateDispatch };
    });
  },
);
