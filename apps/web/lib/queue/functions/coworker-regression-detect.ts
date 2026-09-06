import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

/**
 * quality/coworker-regression-detect — runs every 15 minutes alongside the
 * issue-report triage job. Detects coworker turn latency regressions over
 * existing `AdapterRunTelemetry` and files deduplicated `PlatformIssueReport`
 * rows, which the existing triage path then promotes to bug backlog items.
 *
 * Mirrors the cron pattern in `issue-report-triage.ts`: same retries, same
 * quiescence gate, Prisma/detector imported lazily inside the step.
 */
export const coworkerRegressionDetect = inngest.createFunction(
  {
    id: "quality/coworker-regression-detect",
    retries: 2,
    triggers: [cron("6,21,36,51 * * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "quality/coworker-regression-detect");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("detect-coworker-regressions", async () => {
      const { detectCoworkerLatencyRegressions } = await import(
        "@/lib/operate/coworker-regression-detector"
      );
      return detectCoworkerLatencyRegressions();
    });
  },
);
