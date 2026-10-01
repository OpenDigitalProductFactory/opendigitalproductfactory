// Orphaned-approval source — coworker approvals routed to someone who is not
// there to answer them (BI-61DE8177).
//
// A CoworkerActionEnvelope can be decided only by its delegating user, and only
// that user sees it (coworker-envelope.ts). That isolation stays. The gap was
// that nobody else could tell when that user never comes: on 2026-09-26 every
// approval from the Claude Code connection routed to admin@dpf.local, a setup
// account nobody signs in with, and 193 of them had expired unanswered.
//
// Envelopes live fifteen minutes (AUTHORITY_APPROVAL_TTL_MS), so a single
// envelope is gone long before anyone could notice it. The finding is about the
// PERSON: one item per delegate who is not using the portal, counting the
// approvals that went to them unanswered in the lookback. The item informs a
// superuser and links to where connections are managed; it never offers a
// control that decides someone else's approval. Reassignment is a separate,
// undecided question (BI-D9562C1D).

import type { prisma } from "@dpf/db";

import type { AttentionItem } from "../types";

type Db = typeof prisma;

/** How far back unanswered approvals are counted. */
export const ORPHAN_LOOKBACK_DAYS = 7;
/** A delegate not seen in the portal for this long is treated as absent. */
export const STALE_DELEGATE_DAYS = 3;
/** Envelopes read per load — bounded like every other source. */
export const ORPHAN_SCAN_LIMIT = 1000;

const DAY_MS = 86_400_000;
const MCP_ADMIN_HREF = "/admin/platform-development";
/** Undecided outcomes. Declined, executed, cancelled and failed were answered. */
const UNANSWERED_STATUSES = ["proposed", "expired"] as const;

export type OrphanEnvelopeRow = {
  delegatingUserId: string;
  manifestActionId: string;
  status: string;
  createdAt: Date;
  /** Null when the delegating user row no longer exists. */
  delegate: { email: string; isActive: boolean; lastSeenAt: Date | null } | null;
};

function isAbsent(delegate: OrphanEnvelopeRow["delegate"], now: Date): boolean {
  if (!delegate || !delegate.isActive || !delegate.lastSeenAt) return true;
  return delegate.lastSeenAt.getTime() < now.getTime() - STALE_DELEGATE_DAYS * DAY_MS;
}

function absenceLine(delegate: OrphanEnvelopeRow["delegate"], who: string): string {
  if (!delegate) return `The account ${who} no longer exists.`;
  if (!delegate.isActive) return `The account ${who} is deactivated.`;
  if (!delegate.lastSeenAt) return `${who} has not used the portal since tracking began.`;
  return `${who} has not used the portal since ${delegate.lastSeenAt.toISOString().slice(0, 10)}.`;
}

/** Pure projection: rows → one item per absent delegate with unanswered approvals. */
export function projectOrphanedApprovals(rows: OrphanEnvelopeRow[], now: Date): AttentionItem[] {
  const since = now.getTime() - ORPHAN_LOOKBACK_DAYS * DAY_MS;
  const byDelegate = new Map<string, OrphanEnvelopeRow[]>();
  for (const r of rows) {
    if (!(UNANSWERED_STATUSES as readonly string[]).includes(r.status)) continue;
    if (r.createdAt.getTime() < since) continue;
    if (!isAbsent(r.delegate, now)) continue;
    byDelegate.set(r.delegatingUserId, [...(byDelegate.get(r.delegatingUserId) ?? []), r]);
  }

  return [...byDelegate.entries()].map(([userId, list]) => {
    const delegate = list[0].delegate;
    const who = delegate?.email ?? userId;
    const tools = [...new Set(list.map((r) => r.manifestActionId))].sort();
    const oldest = list.reduce((min, r) => (r.createdAt < min ? r.createdAt : min), list[0].createdAt);
    const noun = list.length === 1 ? "approval request" : "approval requests";
    return {
      id: `orphaned-approval:${userId}`,
      source: "orphaned-approval",
      title: `Approvals are going to ${who}, and nobody is answering`,
      context:
        `${list.length} ${noun} from AI coworkers went to ${who} in the last ${ORPHAN_LOOKBACK_DAYS} days ` +
        `and were not answered (${tools.join(", ")}). ${absenceLine(delegate, who)} ` +
        `Only that account can decide them. If a connection was set up under the wrong account, ` +
        `revoke it and reconnect under the right one.`,
      decisionClass: { scorability: "unscorable" },
      riskClass: "read",
      triage: {
        timeToAct: "none",
        residueReason: "approver-absent",
        blastRadius: "every coworker action that needs this account's approval",
        decideEffort: "judgment",
        irreversible: false,
      },
      createdAtIso: oldest.toISOString(),
      actions: [{ kind: "open-in-context", label: "Review AI connections", href: MCP_ADMIN_HREF }],
      deepLink: MCP_ADMIN_HREF,
      audience: { operator: true },
      portfolio: "for-employees",
    } satisfies AttentionItem;
  });
}

type OrphanDb = {
  coworkerActionEnvelope: Pick<Db["coworkerActionEnvelope"], "findMany">;
  user: Pick<Db["user"], "findMany">;
};

export async function loadOrphanedApprovalItems(db: OrphanDb, now: Date = new Date()): Promise<AttentionItem[]> {
  const envelopes = await db.coworkerActionEnvelope.findMany({
    where: {
      status: { in: [...UNANSWERED_STATUSES] },
      createdAt: { gte: new Date(now.getTime() - ORPHAN_LOOKBACK_DAYS * DAY_MS) },
    },
    select: { delegatingUserId: true, manifestActionId: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: ORPHAN_SCAN_LIMIT,
  });
  if (envelopes.length === 0) return [];
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(envelopes.map((e) => e.delegatingUserId))] } },
    select: { id: true, email: true, isActive: true, lastSeenAt: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return projectOrphanedApprovals(
    envelopes.map((e) => {
      const u = byId.get(e.delegatingUserId);
      return { ...e, delegate: u ? { email: u.email, isActive: u.isActive, lastSeenAt: u.lastSeenAt } : null };
    }),
    now,
  );
}
