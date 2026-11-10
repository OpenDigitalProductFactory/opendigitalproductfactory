/**
 * Soak report for the owned Postgres job engine (BI-068BBA33 phase 3 gate,
 * spec 2026-09-25 §7.2). Read-only: it only SELECTs from the engine tables.
 *
 *   DATABASE_URL=... pnpm --filter web exec tsx scripts/job-engine-soak-report.ts [--hours 24] [--json]
 *
 * For each function the engine ran in the window it reports runs by outcome,
 * retries, the slowest finish, and, for cron functions, fires that should
 * have happened but did not. It then applies the §7.2 exit criteria and exits
 * 1 when any is breached, so a scheduled check can alert on it.
 */
import { createJobsPool } from "@/lib/jobs/postgres/pool";
import { JOB_CRON_EVENT_NAME } from "@/lib/jobs/types";
import { computeNextCronFire } from "@/lib/operate/cron-next-run";
import { getErrorMessage } from "@/lib/shared/get-error-message";

type FunctionRow = {
  functionKey: string;
  runs: number;
  completed: number;
  failed: number;
  cancelled: number;
  open: number;
  recovered: number;
  stuck: number;
  p95FinishMs: number | null;
};

type CronRow = { functionKey: string; cron: string; nextFireAt: Date };

/** §7.2 exit criteria. A breach in any window means the soak is not passing. */
export const SOAK_CRITERIA = {
  /** No run may sit `running` past its lease by more than this; lease recovery should have reclaimed it. */
  stuckGraceMs: 10 * 60_000,
  /** Failed runs as a share of finished runs, per function. */
  maxFailureRate: 0.02,
  /** A cron fire counts as missed when no event exists within this slack of its scheduled time. */
  missedFireSlackMs: 5 * 60_000,
} as const;

function parseArgs(argv: string[]): { hours: number; json: boolean } {
  const at = argv.indexOf("--hours");
  const hours = at >= 0 ? Number(argv[at + 1]) : 24;
  if (!Number.isFinite(hours) || hours <= 0) throw new Error("--hours must be a positive number.");
  return { hours, json: argv.includes("--json") };
}

/** Scheduled fire times in [from, to) for one cron expression. */
export function expectedFires(cron: string, from: Date, to: Date): Date[] {
  const fires: Date[] = [];
  let next = computeNextCronFire(cron, new Date(from.getTime() - 1));
  while (next && next < to && fires.length < 10_000) {
    fires.push(next);
    next = computeNextCronFire(cron, next);
  }
  return fires;
}

/** Fires with no recorded event within the slack. `seen` holds the scheduled times the engine recorded. */
export function missedFires(expected: Date[], seen: Date[], slackMs: number): Date[] {
  const times = seen.map((d) => d.getTime()).sort((a, b) => a - b);
  return expected.filter((fire) => !times.some((t) => Math.abs(t - fire.getTime()) <= slackMs));
}

async function main(): Promise<void> {
  const { hours, json } = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required.");
  const pool = createJobsPool(url, 2);
  const now = new Date();
  const since = new Date(now.getTime() - hours * 3_600_000);
  try {
    const { rows: functions } = await pool.query<FunctionRow>(
      `SELECT "functionKey",
              count(*)::int AS runs,
              count(*) FILTER (WHERE status = 'completed')::int AS completed,
              count(*) FILTER (WHERE status = 'failed')::int AS failed,
              count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
              count(*) FILTER (WHERE status IN ('queued', 'running', 'sleeping', 'waiting'))::int AS open,
              count(*) FILTER (WHERE status = 'completed' AND attempt > 0)::int AS recovered,
              count(*) FILTER (WHERE status = 'running' AND "leaseExpiresAt" < now() - make_interval(secs => $2::double precision / 1000))::int AS stuck,
              (percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM ("finishedAt" - "createdAt")) * 1000)
                 FILTER (WHERE "finishedAt" IS NOT NULL))::float AS "p95FinishMs"
       FROM "JobRun" WHERE "createdAt" >= $1
       GROUP BY "functionKey" ORDER BY "functionKey"`,
      [since, SOAK_CRITERIA.stuckGraceMs],
    );
    const { rows: crons } = await pool.query<CronRow>(`SELECT "functionKey", cron, "nextFireAt" FROM "JobCronState" ORDER BY "functionKey"`);
    const { rows: cronEvents } = await pool.query<{ functionKey: string; ts: Date }>(
      `SELECT r."functionKey", e.ts FROM "JobRun" r JOIN "JobEvent" e ON e.id = r."eventId"
       WHERE e.name = $2 AND e.ts >= $1`,
      [since, JOB_CRON_EVENT_NAME],
    );

    const breaches: string[] = [];
    // An empty window proves nothing, so it never passes.
    if (functions.length === 0) breaches.push("no engine runs in the window: is DPF_JOBS_ENGINE set and the portal restarted?");
    for (const fn of functions) {
      const finished = fn.completed + fn.failed;
      if (fn.stuck > 0) breaches.push(`${fn.functionKey}: ${fn.stuck} run(s) running past their lease`);
      if (finished > 0 && fn.failed / finished > SOAK_CRITERIA.maxFailureRate) {
        breaches.push(`${fn.functionKey}: ${fn.failed}/${finished} runs failed`);
      }
    }
    const cronReport = crons.map((c) => {
      // A schedule registered inside the window is judged only from its first recorded fire.
      const seen = cronEvents.filter((e) => e.functionKey === c.functionKey).map((e) => e.ts);
      const first = seen.length ? new Date(Math.min(...seen.map((d) => d.getTime()))) : null;
      const from = first && first > since ? first : since;
      const expected = expectedFires(c.cron, from, new Date(now.getTime() - SOAK_CRITERIA.missedFireSlackMs));
      const missed = first ? missedFires(expected, seen, SOAK_CRITERIA.missedFireSlackMs) : [];
      if (missed.length > 0) breaches.push(`${c.functionKey}: ${missed.length} cron fire(s) missed, first ${missed[0]!.toISOString()}`);
      if (!first && expected.length > 1) breaches.push(`${c.functionKey}: registered but never fired (${expected.length} fires expected)`);
      return { functionKey: c.functionKey, cron: c.cron, expected: expected.length, fired: seen.length, missed: missed.length };
    });

    if (json) {
      console.log(JSON.stringify({ since, now, functions, crons: cronReport, breaches, passing: breaches.length === 0 }, null, 2));
    } else {
      console.log(`Postgres job engine soak report: ${since.toISOString()} → ${now.toISOString()} (${hours} h)`);
      for (const fn of functions) {
        const p95 = fn.p95FinishMs === null ? "-" : `${Math.round(fn.p95FinishMs)} ms`;
        console.log(
          `  ${fn.functionKey.padEnd(48)} runs ${String(fn.runs).padStart(5)}  ok ${String(fn.completed).padStart(5)}  failed ${fn.failed}  open ${fn.open}  recovered ${fn.recovered}  p95 ${p95}`,
        );
      }
      for (const c of cronReport) {
        console.log(`  cron ${c.functionKey.padEnd(43)} ${c.cron.padEnd(22)} expected ${c.expected}  fired ${c.fired}  missed ${c.missed}`);
      }
      console.log(breaches.length === 0 ? "PASSING: no §7.2 criterion breached." : `BREACHED:\n  - ${breaches.join("\n  - ")}`);
    }
    process.exitCode = breaches.length === 0 ? 0 : 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("job-engine-soak-report.ts")) {
  main().catch((error: unknown) => {
    console.error(getErrorMessage(error));
    process.exitCode = 2;
  });
}
