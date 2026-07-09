// Consolidation parity steward (BI-ED9AC5A6, EP-8DC217EB BET-0b).
//
// Registers the Vertical-Integration consolidation bets as architecture-parity
// targets: each bet with outstanding delivery work is a live EA conformance
// issue (stable key `consolidation-parity:<betKey>`), and the shared
// reconciler auto-resolves the issue when every backlog item delivering the
// bet reaches a terminal state. Duplication thereby becomes a MEASURABLE
// conformance signal that drift-reduces as consolidations land — the same
// contract the projection-unavailable steward already follows.
//
// Runs piggybacked on the scheduled SysML parity sweep (agent-task-scheduler),
// so no new cron/task surface is added.

import { prisma } from "@dpf/db";

import {
  CONSOLIDATION_BETS,
  type ConsolidationBet,
} from "@/lib/optimization/consolidation-bets";
import {
  reconcileConformanceIssues,
  type ConformanceIssueClient,
  type ConformanceIssueReconcileResult,
} from "./conformance-issue-reconciler";

const CONSOLIDATION_STEWARD = "consolidation-parity";
const CONSOLIDATION_OUTSTANDING = "consolidation-outstanding";
const MANAGED_ISSUE_TYPES = [CONSOLIDATION_OUTSTANDING];

/** Statuses that count as "delivery finished" for a bet's backlog item. */
const TERMINAL_STATUSES = new Set(["done", "deferred"]);

export type ConsolidationBacklogClient = {
  backlogItem: {
    findMany(args: {
      where: { itemId: { in: string[] } };
      select: { itemId: true; status: true };
    }): Promise<Array<{ itemId: string; status: string }>>;
  };
};

export type ConsolidationParityStewardClient = ConformanceIssueClient & ConsolidationBacklogClient;

export type ConsolidationParityStewardResult = ConformanceIssueReconcileResult & {
  outstandingBets: string[];
  completedBets: string[];
};

function severityFor(bet: ConsolidationBet): string {
  return bet.leverage === "H" ? "warn" : "info";
}

export async function runConsolidationParitySteward(
  opts: { db?: ConsolidationParityStewardClient } = {},
): Promise<ConsolidationParityStewardResult> {
  const db = opts.db ?? (prisma as unknown as ConsolidationParityStewardClient);

  const allItemIds = CONSOLIDATION_BETS.flatMap((bet) => bet.backlogItemIds);
  const rows = await db.backlogItem.findMany({
    where: { itemId: { in: allItemIds } },
    select: { itemId: true, status: true },
  });
  const statusByItemId = new Map(rows.map((row) => [row.itemId, row.status]));

  const outstandingBets: string[] = [];
  const completedBets: string[] = [];
  const findings = [];

  for (const bet of CONSOLIDATION_BETS) {
    const itemStatuses = bet.backlogItemIds.map((itemId) => ({
      itemId,
      status: statusByItemId.get(itemId) ?? null,
    }));
    // An item id missing from the live backlog counts as outstanding: the
    // registry claims work the backlog does not know about, which is itself
    // a drift worth keeping visible rather than silently marking complete.
    const open = itemStatuses.filter(
      (item) => item.status === null || !TERMINAL_STATUSES.has(item.status),
    );

    if (open.length === 0) {
      completedBets.push(bet.betKey);
      continue;
    }

    outstandingBets.push(bet.betKey);
    const issueKey = `${CONSOLIDATION_STEWARD}:${bet.betKey}`;
    findings.push({
      issueKey,
      issueType: CONSOLIDATION_OUTSTANDING,
      severity: severityFor(bet),
      message: `Consolidation ${bet.betKey} (${bet.title}) has ${open.length} of ${bet.backlogItemIds.length} delivery item(s) outstanding — the duplication it collapses is still live (~${bet.leafEstimate} leaf sites).`,
      detailsJson: {
        issueKey,
        steward: CONSOLIDATION_STEWARD,
        betKey: bet.betKey,
        wave: bet.wave,
        effort: bet.effort,
        leverage: bet.leverage,
        leafEstimate: bet.leafEstimate,
        items: itemStatuses,
        openItemIds: open.map((item) => item.itemId),
      },
    });
  }

  const result = await reconcileConformanceIssues(db, {
    issueTypes: MANAGED_ISSUE_TYPES,
    findings,
  });

  return { ...result, outstandingBets, completedBets };
}
