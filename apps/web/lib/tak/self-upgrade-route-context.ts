// apps/web/lib/tak/self-upgrade-route-context.ts
//
// Route-context provider for /ops/self-upgrade. The page renders platform
// self-upgrade status + background-job (Inngest) engine health; without a
// bespoke provider the coworker fell through to /ops -> getOpsContext and
// answered "what's this background job issue?" with backlog items + epics.
// Same class as the /ops/dev-loop fix (BI-FD7E4D72). Phase 1 of the page-owned
// context contract in
// docs/superpowers/specs/2026-08-05-coworker-page-perception-context-contract-design.md.
//
// Application-boundary note (scripts/application-boundaries.json): the
// agent-runtime (tak) context may only depend on inference/routing — NOT
// `actions` or `queue`. So this provider deliberately does NOT call the
// getSelfUpgradeStatus server action (actions) or getJobEngineHealth (queue).
// It reads the persisted signals directly via prisma, which is also cheaper:
// getSelfUpgradeStatus shells out to `git ls-remote` on every call, which we do
// not want on a per-message coworker path. It presents the raw persisted facts
// and a light orientation, leaving the authoritative health verdict to the page
// and the self-upgrade read tools.

import { prisma } from "@dpf/db";
import { getSelfUpgradeConfig } from "@/lib/self-upgrade/config";

// Mirror of INNGEST_REGISTRATION_CONFIG_KEY / INNGEST_WATCHDOG_CONFIG_KEY in
// apps/web/lib/queue/job-engine-health.ts. They are duplicated as string
// literals because that module lives in the `queue` context, which `tak` may
// not import; kept in sync by this comment + the route-context test.
const INNGEST_REGISTRATION_CONFIG_KEY = "ops.jobEngine.inngestRegistration";
const INNGEST_WATCHDOG_CONFIG_KEY = "ops.jobEngine.inngestWatchdog";
// Mirror of DEFAULT_STARVATION_THRESHOLD_MS (15 min) in the same file: a
// healthy registration with no POST execution for longer than this reads as a
// starved/wedged executor — the "Background jobs need attention" condition.
const STARVATION_THRESHOLD_MINUTES = 15;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function minutesSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? Math.floor((now - parsed) / 60_000) : null;
}

export async function getSelfUpgradeContext(): Promise<string> {
  const now = Date.now();

  const [config, latestRun, registrationRow, watchdogRow] = await Promise.all([
    getSelfUpgradeConfig(),
    prisma.selfUpgradeRun.findFirst({
      orderBy: { createdAt: "desc" },
      select: {
        runId: true,
        status: true,
        trigger: true,
        targetSha: true,
        deployedSha: true,
        createdAt: true,
        completedAt: true,
      },
    }),
    prisma.platformConfig.findUnique({ where: { key: INNGEST_REGISTRATION_CONFIG_KEY } }),
    prisma.platformConfig.findUnique({ where: { key: INNGEST_WATCHDOG_CONFIG_KEY } }),
  ]);

  const registration = asRecord(registrationRow?.value);
  const watchdog = asRecord(watchdogRow?.value);

  const regOk = registration ? registration.ok === true : null;
  const regAt = asString(registration?.at ?? null);
  const regError = asString(registration?.error ?? null);
  const lastInvocationAt = asString(watchdog?.lastInvocationAt ?? null);
  const lastRecoveryAttemptAt = asString(watchdog?.lastRecoveryAttemptAt ?? null);
  const lastRecoverySummary = asString(watchdog?.lastRecoverySummary ?? null);

  // Orientation only — not the authoritative verdict (the page computes that):
  // a healthy registration with no POST execution for the starvation threshold
  // reads as a starved/wedged executor, the "Background jobs need attention"
  // state.
  const invocationBaseline = lastInvocationAt ?? regAt;
  const staleMinutes = minutesSince(invocationBaseline, now);
  const looksStarved =
    regOk === true && staleMinutes !== null && staleMinutes > STARVATION_THRESHOLD_MINUTES;

  const jobEngineLines: string[] = [];
  if (registration === null && watchdog === null) {
    jobEngineLines.push(
      "No Inngest health has been recorded yet (registration/watchdog state absent).",
    );
  } else {
    jobEngineLines.push(
      `Inngest registration: ${regOk === null ? "unknown" : regOk ? "ok" : "FAILED"}` +
        `${regAt ? ` (last attempt ${regAt})` : ""}${regError ? ` — error: ${regError}` : ""}`,
    );
    jobEngineLines.push(
      `Last background-job execution (POST /api/inngest): ${lastInvocationAt ?? "never recorded"}` +
        `${staleMinutes !== null ? ` (~${staleMinutes} min ago)` : ""}`,
    );
    if (looksStarved) {
      jobEngineLines.push(
        `LIKELY DEGRADED: registration is healthy but no job has executed for ~${staleMinutes} min ` +
          `(> ${STARVATION_THRESHOLD_MINUTES} min). The executor may be starved or wedged — this is the ` +
          `"Background jobs need attention" condition.`,
      );
    }
    if (lastRecoveryAttemptAt || lastRecoverySummary) {
      jobEngineLines.push(
        `Last watchdog recovery: ${lastRecoveryAttemptAt ?? "n/a"}` +
          `${lastRecoverySummary ? ` — ${lastRecoverySummary}` : ""}`,
      );
    }
  }

  const runLine = latestRun
    ? `Latest run: ${latestRun.runId} [${latestRun.status}] trigger=${latestRun.trigger}` +
      `${latestRun.targetSha ? ` target=${latestRun.targetSha.slice(0, 8)}` : ""}` +
      `${latestRun.deployedSha ? ` deployed=${latestRun.deployedSha.slice(0, 8)}` : ""}`
    : "Latest run: none recorded.";

  return [
    "\nPAGE DATA — Self-Upgrade (platform update status):",
    "This page shows the platform's self-upgrade status and background-job (Inngest) engine health, NOT the backlog.",
    "",
    `Self-upgrade: ${config.enabled ? "enabled" : "disabled"} (channel: ${config.channel})`,
    runLine,
    "",
    'BACKGROUND JOBS (the "Background jobs need attention" alert):',
    ...jobEngineLines,
    "",
    "Self-upgrade, evals, backups, and watchdogs all depend on the Inngest job engine; the portal retries Inngest registration about every 5 minutes and can run the non-destructive Inngest orphan-retention sweep to recover a wedged executor. For the authoritative live verdict (release batch, quiescence blockers) use the self-upgrade read tools rather than asking the user to paste or screenshot the screen.",
  ].join("\n");
}
