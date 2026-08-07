// apps/web/lib/coworker-identity/engagements-projection.ts
//
// EP-COWORKER-IDENTITY-360 (spec 2026-08-06) Phase 1 — the "who has engaged it"
// facet. Customers already get an engagements 360; coworkers do not. This
// projects the counterparties who have engaged ONE coworker — people AND other
// agents — from data that exists but is surfaced on no coworker page:
//   • CoworkerEngagement.requestedByUserId  → a person engaged it
//   • CoworkerEngagement.requestedByAgentId → another agent engaged it (A2A)
//   • DelegationGrant.grantorUserId         → a person granted it authority
//
// Zero-schema read-projection. The pure aggregator (aggregateEngagers) is split
// from the fetch so grouping/recency/tone are unit-tested (engagements-projection.test.ts).
//
// Id seam (spec §4.4): CoworkerEngagement.providerAgentId keys on the BUSINESS
// agentId (AGT-*); DelegationGrant.granteeAgentId keys on the Agent.id cuid.
// loadCoworkerEngagements takes BOTH.

import { prisma } from "@dpf/db";
import { resolveAgentRoleLabel } from "@dpf/db/agent-identity";

export type EngagerKind = "person" | "agent";

/** One raw engagement touch, already name-resolved, before aggregation. */
export type EngagerEvent = {
  kind: EngagerKind;
  /** Stable counterparty id (userId or agentId). */
  id: string;
  /** Human-facing counterparty label. */
  label: string;
  /** How they engaged (e.g. "summoned", "A2A delegation", "granted authority"). */
  how: string;
  /** Lifecycle status of this touch (requested|accepted|completed|active|expired…). */
  status: string;
  at: Date;
};

export type EngagerTone = "open" | "done" | "neutral";

export type CoworkerEngager = {
  kind: EngagerKind;
  id: string;
  label: string;
  /** Most-recent "how" summary. */
  how: string;
  status: string;
  tone: EngagerTone;
  /** Number of touches from this counterparty in the window. */
  count: number;
  lastAt: Date;
};

export type CoworkerEngagementsSummary = {
  engagers: CoworkerEngager[];
  totals: {
    total: number;
    people: number;
    agents: number;
    /** counterparties whose most-recent touch is still open (requested/accepted/active). */
    open: number;
  };
};

const OPEN_STATUSES = new Set(["requested", "accepted", "active", "in_progress", "in-progress"]);
const DONE_STATUSES = new Set(["completed", "done", "closed", "fulfilled"]);

function toneFor(status: string): EngagerTone {
  const s = status.toLowerCase();
  if (OPEN_STATUSES.has(s)) return "open";
  if (DONE_STATUSES.has(s)) return "done";
  return "neutral";
}

/**
 * Pure aggregator: collapse per-counterparty touches into one row each, keeping
 * the total count and the most-recent touch's how/status. Deterministic given
 * (events). `maxEngagers` caps the returned list; totals count all distinct.
 */
export function aggregateEngagers(
  events: EngagerEvent[],
  opts?: { maxEngagers?: number },
): CoworkerEngagementsSummary {
  const maxEngagers = opts?.maxEngagers ?? 8;
  const byKey = new Map<string, CoworkerEngager>();

  for (const ev of events) {
    const key = `${ev.kind}:${ev.id}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        kind: ev.kind,
        id: ev.id,
        label: ev.label,
        how: ev.how,
        status: ev.status,
        tone: toneFor(ev.status),
        count: 1,
        lastAt: ev.at,
      });
      continue;
    }
    existing.count += 1;
    if (ev.at.getTime() > existing.lastAt.getTime()) {
      existing.lastAt = ev.at;
      existing.how = ev.how;
      existing.status = ev.status;
      existing.tone = toneFor(ev.status);
      // Prefer a non-empty label from the newer touch.
      if (ev.label) existing.label = ev.label;
    }
  }

  const all = [...byKey.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
  const totals = {
    total: all.length,
    people: all.filter((e) => e.kind === "person").length,
    agents: all.filter((e) => e.kind === "agent").length,
    open: all.filter((e) => e.tone === "open").length,
  };

  return { engagers: all.slice(0, maxEngagers), totals };
}

/**
 * Fetch + aggregate the counterparties that have engaged this coworker.
 * `agentId` = business id (AGT-*); `agentCuid` = Agent.id (for DelegationGrant).
 * Fail-open: returns an empty summary on a read error.
 */
export async function loadCoworkerEngagements(
  agentId: string,
  agentCuid: string,
  opts?: { now?: Date; windowDays?: number },
): Promise<CoworkerEngagementsSummary> {
  const now = opts?.now ?? new Date();
  const windowDays = opts?.windowDays ?? 90;
  const since = new Date(now.getTime() - windowDays * 86_400_000);

  try {
    const [engagements, grants] = await Promise.all([
      prisma.coworkerEngagement.findMany({
        where: { providerAgentId: agentId, createdAt: { gte: since } },
        select: {
          requestedByUserId: true,
          requestedByAgentId: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      prisma.delegationGrant.findMany({
        where: { granteeAgentId: agentCuid, createdAt: { gte: since } },
        select: {
          grantorUserId: true,
          status: true,
          createdAt: true,
          expiresAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    ]);

    // Resolve human display labels for the userIds referenced.
    const userIds = new Set<string>();
    for (const e of engagements) if (e.requestedByUserId) userIds.add(e.requestedByUserId);
    for (const g of grants) if (g.grantorUserId) userIds.add(g.grantorUserId);

    const users = userIds.size
      ? await prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const userLabel = new Map(users.map((u) => [u.id, u.name || u.email || "A teammate"]));

    const events: EngagerEvent[] = [];
    for (const e of engagements) {
      if (e.requestedByAgentId) {
        events.push({
          kind: "agent",
          id: e.requestedByAgentId,
          label: resolveAgentRoleLabel(e.requestedByAgentId),
          how: "A2A engagement",
          status: e.status,
          at: e.createdAt,
        });
      } else if (e.requestedByUserId) {
        events.push({
          kind: "person",
          id: e.requestedByUserId,
          label: userLabel.get(e.requestedByUserId) ?? "A teammate",
          how: "Engaged directly",
          status: e.status,
          at: e.createdAt,
        });
      }
    }
    for (const g of grants) {
      if (!g.grantorUserId) continue;
      const expired = g.expiresAt ? g.expiresAt.getTime() < now.getTime() : false;
      events.push({
        kind: "person",
        id: g.grantorUserId,
        label: userLabel.get(g.grantorUserId) ?? "A teammate",
        how: "Granted authority to act",
        status: expired ? "expired" : g.status,
        at: g.createdAt,
      });
    }

    return aggregateEngagers(events);
  } catch (err) {
    console.warn("[coworker-identity/engagements] failed to load engagements:", err);
    return { engagers: [], totals: { total: 0, people: 0, agents: 0, open: 0 } };
  }
}
