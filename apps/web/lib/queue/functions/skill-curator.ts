import { cron } from "inngest";
import { inngest } from "../inngest-client";

/**
 * Daily skill curator for Slice 4 of the governed Hermes learning loop.
 * Runs at 07:00 UTC — after the metrics aggregator at 05:00 so the curator
 * sees fresh SkillMetric rows. The 07:00 slot was verified 2026-05-15
 * against live ScheduledJob rows and repo cron seeds (no other job uses it).
 *
 * The curator is idempotent end-to-end: classification is deterministic,
 * signal emission dedupes on (sourceType, sourceId), and a missed tick is
 * recovered automatically on the next run.
 */
export const skillCurator = inngest.createFunction(
  {
    id: "skills/curator",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("0 7 * * *")],
  },
  async ({ step }) => {
    return step.run("run-skill-curator", async () => {
      const { runSkillCurator } = await import("@/lib/skills/curator");
      const result = await runSkillCurator({ invokedByUserId: "system" });
      console.log(
        `[skill-curator] scanned ${result.findings.length} skills; totals=${JSON.stringify(result.totals)}`,
      );
      return result;
    });
  },
);
