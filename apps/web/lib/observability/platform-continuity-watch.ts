// Platform continuity watch (BI-3E2F87FA).
//
// WHY THIS EXISTS: from 2026-11-08 14:48Z to 2026-11-10 04:45Z the platform was
// down twice, about 36 hours in all. The Mac running it restarted for a macOS
// update, the sign-in autostart failed, and the Mac later slept on battery.
// Nothing recorded the downtime and nobody was told, even after it came back.
//
// What it does, every alert-delivery-bridge cycle (5 minutes):
//   1. Reads the last heartbeat from PlatformConfig and writes a new one.
//   2. A gap longer than 30 minutes between beats is downtime. The window runs
//      from the last beat before the gap to the first beat after it.
//   3. The cause is read from what the platform can observe from inside its own
//      containers: a self-upgrade covering the window (planned, recorded by the
//      upgrade itself, so no item here), the Docker VM's boot time (Docker or the
//      computer restarted), Postgres's start time (the containers restarted),
//      platform work recorded inside the window (only the scheduled checks
//      stopped), or none of these (the computer was most likely asleep).
//   4. Unplanned downtime becomes ONE `platform_downtime` monitor row naming the
//      window and the cause, with the host-posture fix steps when the host
//      snapshot shows any. It reaches Needs-you through the platform-health
//      source (owner-routing sends it to the operator) and the bell.
//   5. A downtime record closes itself after 72 hours; the resolved row stays as
//      the record of the window.
//
// The heartbeat runs ahead of the bridge's quiescence gate, so an upgrade drain
// or the job's kill switch never creates a false gap; a real upgrade outage is
// excused by its SelfUpgradeRun / QuiescenceRun window instead.

import { readFile } from "node:fs/promises";

import { formatDuration, formatInstant } from "@/lib/datetime";
import type { HostPostureView } from "@/lib/install/host-posture";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { hostPostureAdvice } from "@/lib/install/host-posture";
import { openMonitorIssue, type MonitorIssueDb } from "./monitor-issue-writer";

export const PLATFORM_DOWNTIME_ISSUE_TYPE = "platform_downtime" as const;
export const CONTINUITY_HEARTBEAT_KEY = "platform.continuity.heartbeat.v1";
/** Six missed 5-minute cycles. A normal self-upgrade swap is excused separately. */
export const DOWNTIME_GAP_MS = 30 * 60_000;
/** How long a downtime record stays open in Needs-you before it closes itself. */
export const DOWNTIME_RECORD_HOLD_MS = 72 * 60 * 60_000;
/** Slack either side of an upgrade window: the drain starts before and the portal returns after. */
export const UPGRADE_SLACK_MS = 20 * 60_000;
/** Work started this close to either edge of the window belongs to the edges, not the gap. */
const EDGE_MARGIN_MS = 5 * 60_000;

export const DOWNTIME_HREF = "/ops/installation#host-posture";

export interface ContinuityHeartbeatV1 {
  schemaVersion: 1;
  beatAt: string;
}

export interface DowntimeWindow {
  startedAt: Date;
  endedAt: Date;
}

export interface DowntimeEvidence {
  postgresStartedAt: Date | null;
  /** When the Linux kernel the containers run on booted: the Docker VM on macOS. */
  runtimeBootedAt: Date | null;
  upgradeWindows: Array<{ startedAt: Date; completedAt: Date | null }>;
  /** Platform work (AI calls) recorded inside the window. */
  workDuringGap: number;
  hostPosture: HostPostureView | null;
}

export type DowntimeCause =
  | "planned-upgrade"
  | "docker-or-host-restart"
  | "containers-restarted"
  | "scheduler-stalled"
  | "host-asleep";

export interface DowntimeClassification {
  cause: DowntimeCause;
  explanation: string;
  /** Host fix steps that need doing, from the latest host snapshot. */
  advice: string[];
}

export interface ContinuityDb extends MonitorIssueDb {
  platformConfig: {
    findUnique(args: { where: { key: string }; select?: unknown }): Promise<{ value: unknown } | null>;
    upsert(args: { where: { key: string }; create: { key: string; value: unknown }; update: { value: unknown } }): Promise<unknown>;
  };
}

function parseHeartbeat(value: unknown): ContinuityHeartbeatV1 | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Partial<ContinuityHeartbeatV1>;
  return raw.schemaVersion === 1 && typeof raw.beatAt === "string" ? { schemaVersion: 1, beatAt: raw.beatAt } : null;
}

/** Pure: is there a gap between the last beat and now? */
export function planContinuityCycle(input: { previous: ContinuityHeartbeatV1 | null; now: Date }): { window: DowntimeWindow | null } {
  const last = input.previous ? Date.parse(input.previous.beatAt) : Number.NaN;
  if (Number.isNaN(last)) return { window: null };
  if (input.now.getTime() - last <= DOWNTIME_GAP_MS) return { window: null };
  return { window: { startedAt: new Date(last), endedAt: input.now } };
}

function coveredByUpgrade(window: DowntimeWindow, upgrades: DowntimeEvidence["upgradeWindows"]): boolean {
  return upgrades.some((upgrade) => {
    const end = (upgrade.completedAt ?? window.endedAt).getTime();
    return upgrade.startedAt.getTime() - UPGRADE_SLACK_MS <= window.startedAt.getTime()
      && end + UPGRADE_SLACK_MS >= window.endedAt.getTime();
  });
}

/** Pure: the likely cause, from evidence the platform can see. Never more certain than that. */
export function classifyDowntime(window: DowntimeWindow, evidence: DowntimeEvidence): DowntimeClassification {
  const advice = hostPostureAdvice(evidence.hostPosture);
  const after = (date: Date | null) => date !== null && date.getTime() > window.startedAt.getTime();
  if (coveredByUpgrade(window, evidence.upgradeWindows)) {
    return { cause: "planned-upgrade", explanation: "A platform upgrade was running during this time.", advice };
  }
  if (after(evidence.runtimeBootedAt)) {
    return {
      cause: "docker-or-host-restart",
      explanation:
        "Docker, or the computer running it, restarted during this time, and the platform did not start again until it came back. After a restart the platform starts only once someone signs in to the computer and Docker Desktop is running.",
      advice,
    };
  }
  if (after(evidence.postgresStartedAt)) {
    return {
      cause: "containers-restarted",
      explanation: "The platform's containers stopped and were started again. Docker itself kept running.",
      advice,
    };
  }
  if (evidence.workDuringGap > 0) {
    return {
      cause: "scheduler-stalled",
      explanation:
        "The platform's scheduled checks stopped running while other work continued, so health checks, alerts and timed jobs were paused.",
      advice: [],
    };
  }
  return {
    cause: "host-asleep",
    explanation:
      "Nothing restarted, so the computer running the platform was most likely asleep or paused. A Mac on battery goes to sleep when idle.",
    advice,
  };
}

function formatUtc(date: Date): string {
  return formatInstant(date, { timeZone: "UTC", withZone: true });
}

/** "The platform was down for 11h 14m (Nov 8, 2026, 2:48 PM UTC to Nov 9, 2026, 2:02 AM UTC)". */
export function describeDowntimeWindow(window: DowntimeWindow): string {
  const length = formatDuration(window.endedAt.getTime() - window.startedAt.getTime());
  return `The platform was down for ${length} (${formatUtc(window.startedAt)} to ${formatUtc(window.endedAt)})`;
}

export function downtimeIssueKey(window: DowntimeWindow): string {
  return `platform-downtime:${window.startedAt.toISOString()}`;
}

export interface ContinuityNotice {
  itemKey: string;
  title: string;
  body: string;
  deepLink: string;
  riskClass: "high-risk" | "bounded-write";
}

export interface ContinuityWatchResult {
  window: { startedAt: string; endedAt: string } | null;
  cause: DowntimeCause | null;
  /** The issue key opened this cycle, if any. */
  recorded: string | null;
  closed: number;
}

/** One watch cycle. Never throws for the evidence reader's sake: a failed read records the window with less cause. */
export async function runPlatformContinuityWatch(
  db: ContinuityDb,
  deps: {
    now?: () => Date;
    readEvidence?: (window: DowntimeWindow) => Promise<DowntimeEvidence>;
    notify?: (notice: ContinuityNotice) => Promise<void>;
  } = {},
): Promise<ContinuityWatchResult> {
  const now = (deps.now ?? (() => new Date()))();
  const row = await db.platformConfig.findUnique({ where: { key: CONTINUITY_HEARTBEAT_KEY }, select: { value: true } });
  const { window } = planContinuityCycle({ previous: parseHeartbeat(row?.value), now });

  let cause: DowntimeCause | null = null;
  let recorded: string | null = null;
  if (window) {
    let evidence: DowntimeEvidence = { postgresStartedAt: null, runtimeBootedAt: null, upgradeWindows: [], workDuringGap: 0, hostPosture: null };
    try {
      evidence = await (deps.readEvidence ?? readDowntimeEvidence)(window);
    } catch (error) {
      console.warn(`[platform-continuity] evidence read failed: ${getErrorMessage(error)}`);
    }
    const classification = classifyDowntime(window, evidence);
    cause = classification.cause;
    if (cause !== "planned-upgrade") {
      const title = describeDowntimeWindow(window);
      recorded = await openMonitorIssue(db, {
        issueKey: downtimeIssueKey(window),
        issueType: PLATFORM_DOWNTIME_ISSUE_TYPE,
        severity: "warn",
        summary: title,
        details: {
          startedAt: window.startedAt.toISOString(),
          endedAt: window.endedAt.toISOString(),
          durationMinutes: Math.round((window.endedAt.getTime() - window.startedAt.getTime()) / 60_000),
          cause,
          explanation: classification.explanation,
          advice: classification.advice,
          evidence: {
            postgresStartedAt: evidence.postgresStartedAt?.toISOString() ?? null,
            runtimeBootedAt: evidence.runtimeBootedAt?.toISOString() ?? null,
            workDuringGap: evidence.workDuringGap,
            hostPostureObservedAt: evidence.hostPosture?.observedAt ?? null,
          },
          actionLabel: "Check how this computer is set up",
          href: DOWNTIME_HREF,
        },
        firstDetectedAt: now,
        now: () => now,
      });
      if (deps.notify) {
        try {
          await deps.notify({
            itemKey: recorded,
            title,
            body: [classification.explanation, ...classification.advice].join(" "),
            deepLink: DOWNTIME_HREF,
            riskClass: "bounded-write",
          });
        } catch (error) {
          console.warn(`[platform-continuity] notification failed: ${getErrorMessage(error)}`);
        }
      }
    }
    console.log(`[platform-continuity] gap ${window.startedAt.toISOString()} to ${window.endedAt.toISOString()} cause=${cause}${recorded ? ` recorded=${recorded}` : ""}`);
  }

  const closed = await db.portfolioQualityIssue.updateMany({
    where: { issueType: PLATFORM_DOWNTIME_ISSUE_TYPE, status: "open", firstDetectedAt: { lt: new Date(now.getTime() - DOWNTIME_RECORD_HOLD_MS) } },
    data: { status: "resolved", resolvedAt: now, lastDetectedAt: now },
  });

  const beat: ContinuityHeartbeatV1 = { schemaVersion: 1, beatAt: now.toISOString() };
  await db.platformConfig.upsert({ where: { key: CONTINUITY_HEARTBEAT_KEY }, create: { key: CONTINUITY_HEARTBEAT_KEY, value: beat }, update: { value: beat } });

  return {
    window: window ? { startedAt: window.startedAt.toISOString(), endedAt: window.endedAt.toISOString() } : null,
    cause,
    recorded,
    closed: closed.count,
  };
}

/** Linux kernel boot time from /proc/uptime; null off Linux or when unreadable. */
async function readRuntimeBootedAt(now: Date): Promise<Date | null> {
  try {
    const seconds = Number.parseFloat((await readFile("/proc/uptime", "utf8")).split(/\s+/)[0] ?? "");
    return Number.isFinite(seconds) ? new Date(now.getTime() - seconds * 1000) : null;
  } catch {
    return null;
  }
}

/** Live evidence for one window. Each part is best-effort; a missing part only weakens the cause. */
export async function readDowntimeEvidence(window: DowntimeWindow): Promise<DowntimeEvidence> {
  const { prisma } = await import("@dpf/db");
  const { readHostPosture } = await import("@/lib/install/host-posture");
  const settle = async <T>(work: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await work();
    } catch {
      return fallback;
    }
  };
  const from = new Date(window.startedAt.getTime() - UPGRADE_SLACK_MS);
  const to = new Date(window.endedAt.getTime() + UPGRADE_SLACK_MS);
  const overlapping = { startedAt: { lte: to }, OR: [{ completedAt: null }, { completedAt: { gte: from } }] };
  const [postgres, runtimeBootedAt, upgrades, quiescence, workDuringGap, hostPosture] = await Promise.all([
    settle(async () => {
      const rows = await prisma.$queryRaw<Array<{ started: Date }>>`SELECT pg_postmaster_start_time() AS started`;
      return rows[0]?.started ?? null;
    }, null as Date | null),
    readRuntimeBootedAt(window.endedAt),
    settle(() => prisma.selfUpgradeRun.findMany({ where: { ...overlapping, startedAt: { not: null, lte: to } }, select: { startedAt: true, completedAt: true } }), []),
    settle(() => prisma.quiescenceRun.findMany({ where: overlapping, select: { startedAt: true, completedAt: true } }), []),
    settle(
      () =>
        prisma.adapterRunTelemetry.count({
          where: {
            startedAt: {
              gt: new Date(window.startedAt.getTime() + EDGE_MARGIN_MS),
              lt: new Date(window.endedAt.getTime() - EDGE_MARGIN_MS),
            },
          },
        }),
      0,
    ),
    settle(() => readHostPosture(), null),
  ]);
  return {
    postgresStartedAt: postgres,
    runtimeBootedAt,
    upgradeWindows: [...upgrades, ...quiescence].flatMap((run) => (run.startedAt ? [{ startedAt: run.startedAt, completedAt: run.completedAt }] : [])),
    workDuringGap,
    hostPosture,
  };
}
