import { prisma } from "@dpf/db";

/**
 * Operator-visible health of the background-job engine (Inngest).
 *
 * The portal registers its function catalog with the self-hosted Inngest server
 * on boot (PUT /api/inngest, see instrumentation.ts). When that registration
 * fails, Inngest silently acks published events with no dispatch target and NO
 * background job runs — self-upgrade, evals, backups, watchdogs, builds. The
 * only prior signal was a single log line, so a dead job engine was invisible
 * for ~4 days (incident 2026-06-14). Persisting the outcome lets the ops UI
 * surface it immediately.
 */
export const INNGEST_REGISTRATION_CONFIG_KEY = "ops.jobEngine.inngestRegistration";
export const INNGEST_WATCHDOG_CONFIG_KEY = "ops.jobEngine.inngestWatchdog";

const DEFAULT_STARVATION_THRESHOLD_MS = 15 * 60 * 1000;
const DEFAULT_RECOVERY_COOLDOWN_MS = 30 * 60 * 1000;

export type InngestRegistrationState = {
  ok: boolean;
  at: string; // ISO timestamp of the last registration attempt
  error: string | null;
};

export type InngestGatewayMethod = "GET" | "POST" | "PUT";

export type InngestWatchdogState = {
  lastGatewayHitAt: string | null;
  lastInvocationAt: string | null;
  lastRegistrationRefreshAt: string | null;
  lastProbeAt: string | null;
  lastRecoveryAttemptAt: string | null;
  lastRecoverySummary: string | null;
  lastRecoveryError: string | null;
};

export type JobEngineHealth = {
  status: "healthy" | "degraded" | "unknown";
  detail: string | null;
  checkedAt: string | null;
  watchdog: {
    status: "healthy" | "degraded" | "unknown";
    detail: string | null;
    lastInvocationAt: string | null;
    lastGatewayHitAt: string | null;
    lastRecoveryAttemptAt: string | null;
    lastRecoverySummary: string | null;
  };
};

/**
 * Record the outcome of the portal's last Inngest registration attempt. Never
 * throws — health recording must not break the boot path.
 */
export async function recordInngestRegistration(
  ok: boolean,
  error: string | null = null,
  now: Date = new Date(),
): Promise<void> {
  const value: InngestRegistrationState = {
    ok,
    at: now.toISOString(),
    error: ok ? null : error,
  };
  try {
    await prisma.platformConfig.upsert({
      where: { key: INNGEST_REGISTRATION_CONFIG_KEY },
      create: { key: INNGEST_REGISTRATION_CONFIG_KEY, value: value as unknown as object },
      update: { value: value as unknown as object },
    });
  } catch {
    // Non-fatal — never let a health write break startup.
  }
}

function emptyWatchdogState(): InngestWatchdogState {
  return {
    lastGatewayHitAt: null,
    lastInvocationAt: null,
    lastRegistrationRefreshAt: null,
    lastProbeAt: null,
    lastRecoveryAttemptAt: null,
    lastRecoverySummary: null,
    lastRecoveryError: null,
  };
}

function coerceWatchdogState(value: unknown): InngestWatchdogState {
  if (!value || typeof value !== "object") return emptyWatchdogState();
  const raw = value as Partial<Record<keyof InngestWatchdogState, unknown>>;
  return {
    lastGatewayHitAt: typeof raw.lastGatewayHitAt === "string" ? raw.lastGatewayHitAt : null,
    lastInvocationAt: typeof raw.lastInvocationAt === "string" ? raw.lastInvocationAt : null,
    lastRegistrationRefreshAt:
      typeof raw.lastRegistrationRefreshAt === "string" ? raw.lastRegistrationRefreshAt : null,
    lastProbeAt: typeof raw.lastProbeAt === "string" ? raw.lastProbeAt : null,
    lastRecoveryAttemptAt:
      typeof raw.lastRecoveryAttemptAt === "string" ? raw.lastRecoveryAttemptAt : null,
    lastRecoverySummary:
      typeof raw.lastRecoverySummary === "string" ? raw.lastRecoverySummary : null,
    lastRecoveryError:
      typeof raw.lastRecoveryError === "string" ? raw.lastRecoveryError : null,
  };
}

async function readInngestRegistrationState(): Promise<InngestRegistrationState | null> {
  if (typeof prisma.platformConfig?.findUnique !== "function") return null;
  const row = await prisma.platformConfig.findUnique({
    where: { key: INNGEST_REGISTRATION_CONFIG_KEY },
  });
  return (row?.value as InngestRegistrationState | null) ?? null;
}

async function readInngestWatchdogState(): Promise<InngestWatchdogState> {
  if (typeof prisma.platformConfig?.findUnique !== "function") return emptyWatchdogState();
  const row = await prisma.platformConfig.findUnique({
    where: { key: INNGEST_WATCHDOG_CONFIG_KEY },
  });
  return coerceWatchdogState(row?.value);
}

async function writeInngestWatchdogState(state: InngestWatchdogState): Promise<void> {
  if (typeof prisma.platformConfig?.upsert !== "function") return;
  await prisma.platformConfig.upsert({
    where: { key: INNGEST_WATCHDOG_CONFIG_KEY },
    create: { key: INNGEST_WATCHDOG_CONFIG_KEY, value: state as unknown as object },
    update: { value: state as unknown as object },
  });
}

/**
 * Record traffic through /api/inngest. POST is the important executor signal:
 * when the self-hosted Inngest server invokes a function, it calls this route.
 * If time passes after healthy registration but POSTs stop arriving, the
 * executor is probably wedged. Best-effort; never throw into the route.
 */
export async function recordInngestGatewayHit(
  method: InngestGatewayMethod,
  now: Date = new Date(),
): Promise<void> {
  try {
    const prior = await readInngestWatchdogState();
    const at = now.toISOString();
    await writeInngestWatchdogState({
      ...prior,
      lastGatewayHitAt: at,
      lastInvocationAt: method === "POST" ? at : prior.lastInvocationAt,
      lastRegistrationRefreshAt:
        method === "PUT" ? at : prior.lastRegistrationRefreshAt,
    });
  } catch {
    // Non-fatal — health recording must not break job dispatch.
  }
}

export function classifyInngestWatchdogHealth(args: {
  registration: InngestRegistrationState | null;
  watchdog: InngestWatchdogState | null;
  now: Date;
  starvationThresholdMs?: number;
}): JobEngineHealth["watchdog"] {
  const thresholdMs = args.starvationThresholdMs ?? DEFAULT_STARVATION_THRESHOLD_MS;
  const watchdog = args.watchdog ? coerceWatchdogState(args.watchdog) : emptyWatchdogState();

  if (!args.registration || typeof args.registration.ok !== "boolean") {
    return {
      status: "unknown",
      detail: "Waiting for the first Inngest registration attempt before judging executor traffic.",
      lastInvocationAt: watchdog.lastInvocationAt,
      lastGatewayHitAt: watchdog.lastGatewayHitAt,
      lastRecoveryAttemptAt: watchdog.lastRecoveryAttemptAt,
      lastRecoverySummary: watchdog.lastRecoverySummary,
    };
  }

  if (!args.registration.ok) {
    return {
      status: "unknown",
      detail: "Registration is already degraded; executor-starvation detection waits for a healthy registration baseline.",
      lastInvocationAt: watchdog.lastInvocationAt,
      lastGatewayHitAt: watchdog.lastGatewayHitAt,
      lastRecoveryAttemptAt: watchdog.lastRecoveryAttemptAt,
      lastRecoverySummary: watchdog.lastRecoverySummary,
    };
  }

  const baseline = watchdog.lastInvocationAt ?? args.registration.at;
  const baselineMs = Date.parse(baseline);
  if (!Number.isFinite(baselineMs)) {
    return {
      status: "unknown",
      detail: "The last Inngest registration timestamp is not parseable.",
      lastInvocationAt: watchdog.lastInvocationAt,
      lastGatewayHitAt: watchdog.lastGatewayHitAt,
      lastRecoveryAttemptAt: watchdog.lastRecoveryAttemptAt,
      lastRecoverySummary: watchdog.lastRecoverySummary,
    };
  }

  const ageMs = args.now.getTime() - baselineMs;
  if (ageMs > thresholdMs) {
    const minutes = Math.floor(ageMs / 60_000);
    return {
      status: "degraded",
      detail:
        `No /api/inngest POST execution has been observed for ${minutes} minute(s) after healthy registration. ` +
        "The executor may be starved or wedged; the portal watchdog can run the non-destructive Inngest orphan-retention sweep.",
      lastInvocationAt: watchdog.lastInvocationAt,
      lastGatewayHitAt: watchdog.lastGatewayHitAt,
      lastRecoveryAttemptAt: watchdog.lastRecoveryAttemptAt,
      lastRecoverySummary: watchdog.lastRecoverySummary,
    };
  }

  return {
    status: "healthy",
    detail: null,
    lastInvocationAt: watchdog.lastInvocationAt,
    lastGatewayHitAt: watchdog.lastGatewayHitAt,
    lastRecoveryAttemptAt: watchdog.lastRecoveryAttemptAt,
    lastRecoverySummary: watchdog.lastRecoverySummary,
  };
}

function summarizeRetentionResult(report: {
  skipped?: boolean;
  skipReason?: string;
  orphansReaped?: number;
  historyTrimmed?: number;
  errorCount?: number;
}): string {
  if (report.skipped) return `retention sweep skipped: ${report.skipReason ?? "unknown"}`;
  return [
    `retention sweep ran`,
    `orphansReaped=${report.orphansReaped ?? 0}`,
    `historyTrimmed=${report.historyTrimmed ?? 0}`,
    `errors=${report.errorCount ?? 0}`,
  ].join(", ");
}

function shouldAttemptRecovery(args: {
  health: JobEngineHealth["watchdog"];
  watchdog: InngestWatchdogState;
  now: Date;
  recoveryCooldownMs: number;
}): boolean {
  if (args.health.status !== "degraded") return false;
  if (!args.watchdog.lastRecoveryAttemptAt) return true;
  const last = Date.parse(args.watchdog.lastRecoveryAttemptAt);
  return !Number.isFinite(last) || args.now.getTime() - last > args.recoveryCooldownMs;
}

/**
 * Portal-side watchdog for Inngest executor starvation. This intentionally does
 * not run as an Inngest cron: if Inngest is wedged, an Inngest cron cannot be
 * trusted to diagnose or recover it. Recovery is non-destructive: it invokes the
 * existing retention/orphan reaper directly and never flushes Redis or restarts
 * containers.
 */
export async function runInngestExecutorWatchdog(opts: {
  now?: Date;
  starvationThresholdMs?: number;
  recoveryCooldownMs?: number;
} = {}): Promise<JobEngineHealth["watchdog"]> {
  const now = opts.now ?? new Date();
  const recoveryCooldownMs = opts.recoveryCooldownMs ?? DEFAULT_RECOVERY_COOLDOWN_MS;
  try {
    const [registration, watchdog] = await Promise.all([
      readInngestRegistrationState(),
      readInngestWatchdogState(),
    ]);
    const probed = { ...watchdog, lastProbeAt: now.toISOString() };
    const health = classifyInngestWatchdogHealth({
      registration,
      watchdog: probed,
      now,
      starvationThresholdMs: opts.starvationThresholdMs,
    });

    if (!shouldAttemptRecovery({ health, watchdog: probed, now, recoveryCooldownMs })) {
      await writeInngestWatchdogState(probed);
      return health;
    }

    const attemptAt = now.toISOString();
    try {
      const { executeScheduledInngestRetentionSweep } = await import(
        "@/lib/operate/inngest-retention/run"
      );
      const report = await executeScheduledInngestRetentionSweep({ dryRun: false, now });
      const summary = summarizeRetentionResult(report);
      await writeInngestWatchdogState({
        ...probed,
        lastRecoveryAttemptAt: attemptAt,
        lastRecoverySummary: summary,
        lastRecoveryError: null,
      });
      return { ...health, lastRecoveryAttemptAt: attemptAt, lastRecoverySummary: summary };
    } catch (err) {
      const error = err instanceof Error ? err.message : "watchdog recovery failed";
      await writeInngestWatchdogState({
        ...probed,
        lastRecoveryAttemptAt: attemptAt,
        lastRecoverySummary: null,
        lastRecoveryError: error,
      });
      return { ...health, lastRecoveryAttemptAt: attemptAt, lastRecoverySummary: error };
    }
  } catch {
    return {
      status: "unknown",
      detail: "Could not read Inngest watchdog state.",
      lastInvocationAt: null,
      lastGatewayHitAt: null,
      lastRecoveryAttemptAt: null,
      lastRecoverySummary: null,
    };
  }
}

/** Pure classifier — unit-tested without a DB. */
export function classifyJobEngineHealth(
  state: InngestRegistrationState | null,
  watchdogState: InngestWatchdogState | null = null,
  now: Date = new Date(),
): JobEngineHealth {
  const watchdog = classifyInngestWatchdogHealth({
    registration: state,
    watchdog: watchdogState,
    now,
  });
  // No record yet (fresh install, or before the first boot sync): don't alarm.
  if (!state || typeof state.ok !== "boolean") {
    return { status: "unknown", detail: null, checkedAt: null, watchdog };
  }
  if (state.ok) {
    return {
      status: watchdog.status === "degraded" ? "degraded" : "healthy",
      detail: watchdog.status === "degraded" ? watchdog.detail : null,
      checkedAt: state.at ?? null,
      watchdog,
    };
  }
  return {
    status: "degraded",
    detail:
      state.error ??
      "The portal could not register its jobs with Inngest — background jobs will not run.",
    checkedAt: state.at ?? null,
    watchdog,
  };
}

export async function getJobEngineHealth(): Promise<JobEngineHealth> {
  // Defensive: a partially-seeded test/dev DB may lack the model.
  if (typeof prisma.platformConfig?.findUnique !== "function") {
    return classifyJobEngineHealth(null);
  }
  try {
    const [registration, watchdog] = await Promise.all([
      readInngestRegistrationState(),
      readInngestWatchdogState(),
    ]);
    return classifyJobEngineHealth(registration, watchdog);
  } catch {
    return {
      status: "unknown",
      detail: null,
      checkedAt: null,
      watchdog: {
        status: "unknown",
        detail: "Could not read Inngest watchdog state.",
        lastInvocationAt: null,
        lastGatewayHitAt: null,
        lastRecoveryAttemptAt: null,
        lastRecoverySummary: null,
      },
    };
  }
}
