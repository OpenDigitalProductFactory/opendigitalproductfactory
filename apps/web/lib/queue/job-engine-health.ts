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

export type InngestRegistrationState = {
  ok: boolean;
  at: string; // ISO timestamp of the last registration attempt
  error: string | null;
};

export type JobEngineHealth = {
  status: "healthy" | "degraded" | "unknown";
  detail: string | null;
  checkedAt: string | null;
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

/** Pure classifier — unit-tested without a DB. */
export function classifyJobEngineHealth(
  state: InngestRegistrationState | null,
): JobEngineHealth {
  // No record yet (fresh install, or before the first boot sync): don't alarm.
  if (!state || typeof state.ok !== "boolean") {
    return { status: "unknown", detail: null, checkedAt: null };
  }
  if (state.ok) {
    return { status: "healthy", detail: null, checkedAt: state.at ?? null };
  }
  return {
    status: "degraded",
    detail:
      state.error ??
      "The portal could not register its jobs with Inngest — background jobs will not run.",
    checkedAt: state.at ?? null,
  };
}

export async function getJobEngineHealth(): Promise<JobEngineHealth> {
  // Defensive: a partially-seeded test/dev DB may lack the model.
  if (typeof prisma.platformConfig?.findUnique !== "function") {
    return { status: "unknown", detail: null, checkedAt: null };
  }
  try {
    const row = await prisma.platformConfig.findUnique({
      where: { key: INNGEST_REGISTRATION_CONFIG_KEY },
    });
    return classifyJobEngineHealth(
      (row?.value as InngestRegistrationState | null) ?? null,
    );
  } catch {
    return { status: "unknown", detail: null, checkedAt: null };
  }
}
