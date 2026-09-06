import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

/**
 * Daily skill curator for Slice 4 of the governed Hermes learning loop.
 * Runs at 07:00 UTC — after the metrics aggregator at 05:00 so the curator
 * sees fresh SkillMetric rows. The 07:00 slot was verified 2026-05-15
 * against live ScheduledJob rows and repo cron seeds (no other job uses it).
 *
 * The curator is idempotent end-to-end: classification is deterministic,
 * signal emission dedupes on (sourceType, sourceId), and a missed tick is
 * recovered automatically on the next run.
 *
 * Ownership: the proactive TaskRun the curator writes is owned by the
 * bootstrap superuser (HR-000), resolved at run time via
 * resolveScheduledOwnerUserId — the same principal every other proactive cron
 * attributes to. It must never be a hardcoded "system" string: TaskRun.userId
 * is a NOT NULL FK to User, so a sentinel id violates TaskRun_userId_fkey.
 */
export const skillCurator = inngest.createFunction(
  {
    id: "skills/curator",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("0 7 * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "skills/curator");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("run-skill-curator", async () => {
      const { runSkillCurator } = await import("@/lib/skills/curator");
      const { resolveScheduledOwnerUserId } = await import("../scheduled-owner");
      const result = await runSkillCurator({
        invokedByUserId: await resolveScheduledOwnerUserId(),
      });
      console.log(
        `[skill-curator] scanned ${result.findings.length} skills; totals=${JSON.stringify(result.totals)}`,
      );
      return result;
    });
  },
);
