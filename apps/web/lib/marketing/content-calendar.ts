// Marketing execution loop — editorial content calendar.
//
// Projects MarketingAssetTask rows onto week buckets using the SAME dueWindow
// parsing the scheduler uses (parseDueWindowToDate), so the calendar and the
// auto-scheduler agree on when a piece is due. Read-only aggregation over
// existing asset tasks — no new schema. The Marketing Strategist uses this to
// answer "what's our content calendar / what's due when" and to spot empty
// weeks or channel gaps before they become a pipeline hole.

import { prisma } from "@dpf/db";
import { getMarketingWorkspaceSnapshot } from "../marketing";
import { parseDueWindowToDate } from "./scheduler";

export type CalendarEntry = {
  taskId: string;
  title: string;
  channel: string | null;
  assetType: string;
  status: string;
  campaignId: string | null;
  /** ISO yyyy-mm-dd the piece is due, or null when the dueWindow is unschedulable. */
  dueDate: string | null;
};

export type CalendarWeek = {
  /** ISO yyyy-mm-dd of the Monday that starts this week (UTC). */
  weekStart: string;
  entries: CalendarEntry[];
};

export type ContentCalendar = {
  weeks: CalendarWeek[];
  /** Tasks whose dueWindow couldn't be parsed to a date — surfaced so they aren't silently dropped. */
  unscheduled: CalendarEntry[];
  byChannel: Record<string, number>;
  byStatus: Record<string, number>;
  totalTasks: number;
};

export type CalendarTaskInput = {
  taskId: string;
  title: string;
  channel: string | null;
  assetType: string;
  status: string;
  campaignId: string | null;
  dueWindow: string | null;
  createdAt: Date;
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday 00:00 UTC of the week containing d. */
export function weekStartUtc(d: Date): Date {
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const daysSinceMonday = (monday.getUTCDay() + 6) % 7; // 0=Sun..6=Sat → Mon=0
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
  return monday;
}

/**
 * Pure calendar projection — testable without a DB. Buckets tasks into weeks by
 * their parsed due date; unparseable-due tasks go to `unscheduled`. Every task
 * is counted in byChannel/byStatus regardless of schedulability so the totals
 * always reconcile with totalTasks.
 */
export function buildContentCalendar(tasks: CalendarTaskInput[]): ContentCalendar {
  const byChannel: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const weekMap = new Map<string, CalendarEntry[]>();
  const unscheduled: CalendarEntry[] = [];

  for (const t of tasks) {
    const channelKey = t.channel ?? "unassigned";
    byChannel[channelKey] = (byChannel[channelKey] ?? 0) + 1;
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;

    const due = t.dueWindow ? parseDueWindowToDate(t.dueWindow, t.createdAt) : null;
    const entry: CalendarEntry = {
      taskId: t.taskId,
      title: t.title,
      channel: t.channel,
      assetType: t.assetType,
      status: t.status,
      campaignId: t.campaignId,
      dueDate: due ? isoDate(due) : null,
    };
    if (!due) {
      unscheduled.push(entry);
      continue;
    }
    const wk = isoDate(weekStartUtc(due));
    const bucket = weekMap.get(wk);
    if (bucket) bucket.push(entry);
    else weekMap.set(wk, [entry]);
  }

  const weeks: CalendarWeek[] = Array.from(weekMap.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([weekStart, entries]) => ({
      weekStart,
      entries: entries.sort(
        (x, y) =>
          (x.dueDate ?? "").localeCompare(y.dueDate ?? "") || x.title.localeCompare(y.title),
      ),
    }));

  return { weeks, unscheduled, byChannel, byStatus, totalTasks: tasks.length };
}

/**
 * Resolve the org's marketing workspace and project its asset tasks (optionally
 * scoped to one campaign) into a content calendar. Returns an error shape when
 * no marketing workspace is configured, mirroring the other campaign readers.
 */
export async function getContentCalendar(input: {
  campaignId?: string | null;
} = {}): Promise<
  | { message: string; data: ContentCalendar }
  | { error: string; message: string }
> {
  const snapshot = await getMarketingWorkspaceSnapshot();
  if (!snapshot) {
    return {
      error: "no-workspace",
      message: "No configured marketing workspace; there is no content calendar yet.",
    };
  }

  const tasks = await prisma.marketingAssetTask.findMany({
    where: {
      organizationId: snapshot.organization.id,
      ...(input.campaignId ? { campaignId: input.campaignId } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: {
      taskId: true,
      title: true,
      channel: true,
      assetType: true,
      status: true,
      campaignId: true,
      dueWindow: true,
      createdAt: true,
    },
  });

  const calendar = buildContentCalendar(tasks);
  const scope = input.campaignId ? "campaign" : "workspace";
  const message =
    calendar.totalTasks === 0
      ? `No asset tasks in this ${scope} yet — create campaign asset tasks to populate the content calendar.`
      : `Content calendar for this ${scope}: ${calendar.totalTasks} asset task(s) across ${calendar.weeks.length} week(s)` +
        (calendar.unscheduled.length > 0
          ? `, ${calendar.unscheduled.length} without a schedulable due window.`
          : ".");
  return { message, data: calendar };
}
