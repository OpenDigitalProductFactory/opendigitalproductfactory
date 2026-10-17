// Scheduled-job source (BI-FD40397B AC-6) — cron-backed ScheduledJob rows whose
// last run failed, plus the inbound issue-intake job when it reports it is not
// commissioned. The sibling scheduled-task source only reads ScheduledAgentTask
// errors, so a failed or partial intake scan was visible on the schedule
// register and nowhere a person would be told about it.
//
// Health comes from the register's own deriveHealth, so this source and
// /admin/scheduled-jobs never disagree about what counts as failing. Items use
// the existing "scheduled-task" source family; no new attention source type.

import {
  INTAKE_CONTROLLER_JOB_ID,
} from "@/lib/operate/scheduled-jobs/intake-controller-commission";
import {
  FAILING_LAST_STATUSES,
  deriveHealth,
  deriveKind,
} from "@/lib/operate/scheduled-jobs/work-model";
import type { AttentionItem } from "../types";

const REGISTER_PATH = "/admin/scheduled-jobs";
const NOT_CONFIGURED = "not-configured";
const NOT_COMMISSIONED_PREFIX = "not commissioned:";
const MAX_CONTEXT = 400;

export type ScheduledJobAttentionRow = {
  jobId: string;
  name: string;
  schedule: string;
  enabled: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
  lastRunSummary: string | null;
};

export type ScheduledJobAttentionDb = {
  scheduledJob: { findMany(args: unknown): Promise<ScheduledJobAttentionRow[]> };
};

function isUncommissionedIntake(row: ScheduledJobAttentionRow): boolean {
  return row.jobId === INTAKE_CONTROLLER_JOB_ID
    && row.lastStatus === NOT_CONFIGURED
    && (row.lastRunSummary ?? "").startsWith(NOT_COMMISSIONED_PREFIX);
}

const clip = (text: string) => (text.length > MAX_CONTEXT ? `${text.slice(0, MAX_CONTEXT - 1)}…` : text);

function baseItem(row: ScheduledJobAttentionRow): Omit<AttentionItem, "title" | "context" | "triage"> {
  return {
    id: `scheduled-job:${row.jobId}`,
    source: "scheduled-task",
    decisionClass: { scorability: "unscorable" },
    riskClass: "unknown",
    createdAtIso: (row.lastRunAt ?? new Date(0)).toISOString(),
    actions: [{ kind: "open-in-context", label: "Review scheduled jobs", href: REGISTER_PATH }],
    deepLink: REGISTER_PATH,
    audience: { operator: true },
  };
}

/** Pure projection. Null when the job does not need a person. */
export function scheduledJobToAttentionItem(row: ScheduledJobAttentionRow, now: Date): AttentionItem | null {
  if (!row.enabled) return null;

  if (isUncommissionedIntake(row)) {
    return {
      ...baseItem(row),
      title: "Issue intake is not commissioned",
      context: clip(
        `${row.name} did not read external submissions because this installation is not the `
        + `commissioned repository controller. ${row.lastRunSummary}`,
      ),
      triage: {
        timeToAct: "none",
        residueReason: "input-required",
        blastRadius: row.name,
        decideEffort: "judgment",
        irreversible: false,
      },
    };
  }

  const { health } = deriveHealth({
    kind: deriveKind(row.schedule),
    enabled: row.enabled,
    schedule: row.schedule,
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt,
    lastStatus: row.lastStatus,
    reportsRunData: true,
  }, now);
  if (health !== "error") return null;

  // lastError is diagnostic text for the register; the attention card carries the
  // owner-facing run summary only.
  return {
    ...baseItem(row),
    title: "Scheduled job needs review",
    context: clip(`${row.name} did not complete its last run.${row.lastRunSummary ? ` ${row.lastRunSummary}` : ""}`),
    triage: {
      timeToAct: "none",
      residueReason: "no-self-heal",
      blastRadius: row.name,
      decideEffort: "review",
      irreversible: false,
    },
  };
}

export async function loadScheduledJobAttentionItems(
  db: ScheduledJobAttentionDb,
  now: Date = new Date(),
): Promise<AttentionItem[]> {
  const rows = await db.scheduledJob.findMany({
    where: { enabled: true, lastStatus: { in: [...FAILING_LAST_STATUSES, NOT_CONFIGURED] } },
    orderBy: { lastRunAt: "desc" },
    take: 50,
    select: {
      jobId: true,
      name: true,
      schedule: true,
      enabled: true,
      lastRunAt: true,
      nextRunAt: true,
      lastStatus: true,
      lastError: true,
      lastRunSummary: true,
    },
  });
  return rows.flatMap((row) => {
    const item = scheduledJobToAttentionItem(row, now);
    return item ? [item] : [];
  });
}
