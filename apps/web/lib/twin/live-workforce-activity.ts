// apps/web/lib/twin/live-workforce-activity.ts
//
// Live workforce-activity projection for the operating twin (EP-LIVING-BUSINESS-VIZ,
// BI-FB233706). Turns the org's actually-running work — active/working TaskRuns —
// into the presence + attributed-feed shapes TwinView already renders, so the twin
// shows WHICH coworker is active and WHAT each is doing right now, instead of the
// booking-derived placeholder feed. Pure and deterministic (no DB, no clock): the
// loader supplies the rows + `now`.
//
// This is the generalized form of the self-upgrade "which coworker is working?"
// gap (BI-D0F4C6FB): there it was one panel; here it is every coworker's live
// focus, on one plane with humans, across the whole business. The parent spec
// (2026-07-11-living-business-workforce-visualization §4) names this live human+AI
// activity plane as a deferred increment behind the same shapes — this fills it.

import type { WorkforceMember } from "@/lib/workforce/workforce-roster";
import type { FeedEventData, TwinActor, TwinActorKind } from "@/components/twin";
import { TASK_LIVE_STATES } from "@/lib/tak/task-states";

/** One actively-running unit of coworker work (a working/active TaskRun). */
export type ActiveWorkRow = {
  taskRunId: string;
  /** Resolves to WorkforceMember.id (Agent.agentId for agents). */
  currentAgentId: string | null;
  title: string | null;
  startedAt: Date;
  lastHeartbeatAt: Date | null;
};

/**
 * No heartbeat within this window ⇒ the loop is unresponsive. Mirrors the
 * self-upgrade dead-coworker liveness window (quiescence.ts). Stale work is
 * SHOWN and labelled, never hidden — an operator seeing a stuck coworker is the
 * whole point (that was the original cognitive-load failure).
 */
export const STALE_ACTIVITY_MS = 15 * 60 * 1000;

/**
 * Optional classifier: returns true when a roster member is an external
 * partner/reseller rather than staff. Defaults to none — the `partner` actor
 * KIND ships now; wiring a real partner source is a follow-up, so until then no
 * member is classified as a partner (honest: no fabricated partners).
 */
export type PartnerClassifier = (member: WorkforceMember) => boolean;

function actorKind(member: WorkforceMember, isPartner: PartnerClassifier | undefined): TwinActorKind {
  if (isPartner?.(member)) return "partner";
  return member.kind === "agent" ? "ai" : "human";
}

function newestSignal(row: ActiveWorkRow): Date {
  return row.lastHeartbeatAt && row.lastHeartbeatAt.getTime() > row.startedAt.getTime()
    ? row.lastHeartbeatAt
    : row.startedAt;
}

function isStale(row: ActiveWorkRow, now: Date): boolean {
  return now.getTime() - newestSignal(row).getTime() > STALE_ACTIVITY_MS;
}

/**
 * Fail-soft read of the org's actively-running work for the twin projection. The
 * `taskRun` model is optional — degrades to `[]` when absent (older test fakes,
 * or a client without it) so the twin always renders. Kept here with the
 * projection rather than inline in the big loader.
 */
export async function readActiveWork(client: {
  taskRun?: { findMany: (args: unknown) => Promise<unknown> };
}): Promise<ActiveWorkRow[]> {
  try {
    return ((await client.taskRun?.findMany({
      where: { status: { in: [...TASK_LIVE_STATES] } },
      select: {
        taskRunId: true,
        currentAgentId: true,
        title: true,
        startedAt: true,
        lastHeartbeatAt: true,
      },
      orderBy: { startedAt: "desc" },
      take: 25,
    })) ?? []) as ActiveWorkRow[];
  } catch {
    return [];
  }
}

/** currentAgentId → that member's most-recently-started active row. */
function latestByAgent(rows: ActiveWorkRow[]): Map<string, ActiveWorkRow> {
  const byAgent = new Map<string, ActiveWorkRow>();
  for (const r of rows) {
    if (!r.currentAgentId) continue;
    const prev = byAgent.get(r.currentAgentId);
    if (!prev || r.startedAt.getTime() > prev.startedAt.getTime()) byAgent.set(r.currentAgentId, r);
  }
  return byAgent;
}

const isOnShift = (m: WorkforceMember): boolean => {
  const s = m.status.toLowerCase();
  return s !== "archived" && s !== "inactive";
};

export type PresenceOptions = { limit?: number; isPartner?: PartnerClassifier };

/**
 * The presence row, aware of who is actually working. Same on-shift filter and
 * human+AI-on-one-plane doctrine as `rosterToPresence`, but: coworkers with an
 * active TaskRun show WHAT they are doing (the task title) as their focus instead
 * of their static role, are marked when unresponsive, and sort first (active work
 * is what the operator most wants to see). Members with no live work keep their
 * calm base presence — never removed. Pure.
 */
export function activeAwarePresence(
  members: WorkforceMember[],
  rows: ActiveWorkRow[],
  now: Date,
  opts: PresenceOptions = {},
): TwinActor[] {
  const limit = opts.limit ?? 8;
  const byAgent = latestByAgent(rows);
  return members
    .filter(isOnShift)
    .map((m) => ({ m, work: byAgent.get(m.id) }))
    .sort(
      (a, b) =>
        // active workers first, then AI coworkers, then humans
        Number(!!b.work) - Number(!!a.work) ||
        Number(b.m.kind === "agent") - Number(a.m.kind === "agent"),
    )
    .slice(0, limit)
    .map(({ m, work }) => {
      const kind = actorKind(m, opts.isPartner);
      if (!work) return { name: m.displayName, kind, focus: m.role ?? undefined };
      const focus = work.title?.trim() || m.role || undefined;
      return {
        name: m.displayName,
        kind,
        focus: focus && isStale(work, now) ? `${focus} (unresponsive)` : focus,
      };
    });
}

/** Compact relative time, pure. "just now" / "5m" / "2h" / "3d". */
export function relativeTime(from: Date, now: Date): string {
  const minutes = Math.floor(Math.max(0, now.getTime() - from.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export type FeedOptions = { limit?: number; isPartner?: PartnerClassifier };

/**
 * A real coworker-activity feed: one attributed entry per actively-running
 * TaskRun, most-recently-started first, each showing who (human / AI / partner)
 * is doing what. A row with no resolvable member still surfaces (attributed to
 * the agent id) rather than being dropped. Empty in ⇒ empty out — never
 * fabricated. Pure.
 */
export function activeWorkToFeed(
  rows: ActiveWorkRow[],
  members: WorkforceMember[],
  now: Date,
  opts: FeedOptions = {},
): FeedEventData[] {
  const limit = opts.limit ?? 5;
  const memberById = new Map(members.map((m) => [m.id, m]));
  return [...rows]
    .filter((r) => !!r.currentAgentId)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, limit)
    .map((r) => {
      const member = r.currentAgentId ? memberById.get(r.currentAgentId) : undefined;
      const actor: TwinActor = member
        ? { name: member.displayName, kind: actorKind(member, opts.isPartner) }
        : { name: r.currentAgentId ?? "A coworker", kind: "ai" };
      return {
        key: `tr-${r.taskRunId}`,
        actor,
        action: isStale(r, now) ? "is stalled on" : "is working on",
        target: r.title?.trim() || undefined,
        at: relativeTime(r.startedAt, now),
      };
    });
}

/**
 * Compose the twin feed: real coworker activity first (what teammates are doing
 * now), then the existing demand-derived events, capped. When no coworker is
 * active the feed degrades exactly to today's behaviour. Pure.
 */
export function mergeTwinFeed(
  activity: FeedEventData[],
  demand: FeedEventData[],
  limit = 6,
): FeedEventData[] {
  return [...activity, ...demand].slice(0, limit);
}

/**
 * The live workforce facet of the twin snapshot: reads the org's active work and
 * composes the activity-aware presence row + the merged feed (real coworker
 * activity ahead of the demand-derived events). One call for the loader to keep
 * the composition (and the fail-soft read) out of the big projection function.
 */
export async function loadTwinWorkforceView(input: {
  client: { taskRun?: { findMany: (args: unknown) => Promise<unknown> } };
  members: WorkforceMember[];
  demandFeed: FeedEventData[];
  now: Date;
  options?: PresenceOptions & FeedOptions;
}): Promise<{ presence: TwinActor[]; feed: FeedEventData[] }> {
  const activeWork = await readActiveWork(input.client);
  return {
    presence: activeAwarePresence(input.members, activeWork, input.now, input.options),
    feed: mergeTwinFeed(
      activeWorkToFeed(activeWork, input.members, input.now, input.options),
      input.demandFeed,
    ),
  };
}
