// Escalation hygiene sweep (BI-467E8F8D, EP-INTAKE-UNIFY).
//
// Closes the receiving loop's far end: build-stall escalations have a create path
// (escalateBuildToHuman) but no clear path, so they accumulate on /ops. This sweep
// reconciles each open / awaiting-ack escalation against its originating work and
// resolves the ones that are demonstrably no longer a pending human decision
// (originating BI shipped / won't-do, build superseded, or superseded by a newer
// escalation). Resolving sets status=resolved_locally, which frees the per-build
// dedupeKey (partial-unique on non-resolved rows) so a genuine re-stall re-files.
//
// Supersedes the old escalation-responder-runner.ts (the §14 WWMD pre-consult
// sweep): principle_decide is degenerate on the resume/defer/escalate axis (every
// option scores 0.000), so the pre-computed recommendation was noise. The honest
// signal now lives in the card itself (escalation-attention.escalationBlockerSummary);
// the responder's actual job — don't let escalations pile silently — is THIS sweep.
//
// Wired into the 15-minute issue-report-triage cron AND invoked best-effort at
// /ops render, so ghosts clear without waiting for the cron. Idempotent: zero
// writes once converged.
//
// BI-FE034C1E extends the same sweep to the OTHER table with a create path and
// no clear path: build-linked `DecisionInteraction` escalate/defer residue whose
// build has since been abandoned/finished/superseded. Those rows kept telling the
// owner "build FB-XXXXXXXX stays blocked" about dead builds on /workspace/inbox.
// See sweepDecisionResidue below and decision-residue-staleness.ts for the rule.

import { Prisma, prisma } from "@dpf/db";
import { ISSUE_REPORT_STATUS } from "@/lib/quality/issue-report-status";
import {
  selectResolvableEscalations,
  type EscalationStalenessRow,
} from "@/lib/quality/escalation-staleness";
import {
  buildWithdrawnHumanOutcome,
  selectWithdrawableDecisions,
  type DecisionResidueRow,
} from "@/lib/quality/decision-residue-staleness";

const SWEEP_LIMIT = 200;

export type EscalationHygieneResult = {
  scanned: number;
  resolved: number;
  /** Build-linked DecisionInteraction residue rows examined (BI-FE034C1E). */
  decisionsScanned: number;
  /** Residue rows auto-withdrawn because their build's life is over. */
  decisionsWithdrawn: number;
};

export async function runEscalationHygiene(): Promise<EscalationHygieneResult> {
  const reports = await prisma.platformIssueReport.findMany({
    where: {
      status: {
        in: [ISSUE_REPORT_STATUS.AWAITING_ESCALATION_ACK, ISSUE_REPORT_STATUS.OPEN],
      },
      OR: [{ type: "build-stall-escalation" }, { selfFixClass: { not: null } }],
    },
    orderBy: { createdAt: "desc" },
    take: SWEEP_LIMIT,
    select: {
      reportId: true,
      createdAt: true,
      featureBuild: {
        select: { supersededByEpicId: true, originatingBacklogItemId: true, phase: true },
      },
    },
  });

  // Resolve the originating BacklogItem status/outcome for the linked builds in
  // one query (FeatureBuild.originatingBacklogItemId is the BacklogItem cuid).
  const itemPks = Array.from(
    new Set(
      reports
        .map((r) => r.featureBuild?.originatingBacklogItemId)
        .filter((x): x is string => Boolean(x)),
    ),
  );
  const items = itemPks.length
    ? await prisma.backlogItem.findMany({
        where: { id: { in: itemPks } },
        select: { id: true, status: true, triageOutcome: true },
      })
    : [];
  const itemByPk = new Map(items.map((i) => [i.id, i]));

  const rows: EscalationStalenessRow[] = reports.map((r) => {
    const itemPk = r.featureBuild?.originatingBacklogItemId ?? null;
    const item = itemPk ? itemByPk.get(itemPk) : null;
    return {
      reportId: r.reportId,
      createdAt: r.createdAt,
      buildSupersededByEpicId: r.featureBuild?.supersededByEpicId ?? null,
      buildPhase: r.featureBuild?.phase ?? null,
      originatingBacklogItemId: itemPk,
      backlogItemStatus: item?.status ?? null,
      backlogItemTriageOutcome: item?.triageOutcome ?? null,
    };
  });

  const resolvable = selectResolvableEscalations(rows);
  for (const { reportId, reason } of resolvable) {
    try {
      await prisma.platformIssueReport.update({
        where: { reportId },
        data: { status: ISSUE_REPORT_STATUS.RESOLVED_LOCALLY },
      });
    } catch {
      // Best-effort per row — a single failure must not stop the rest of the sweep.
      continue;
    }
    if (process.env.NODE_ENV !== "test") {
      console.log(`[escalation-hygiene] resolved ${reportId} (${reason})`);
    }
  }

  const decisions = await sweepDecisionResidue();

  return {
    scanned: rows.length,
    resolved: resolvable.length,
    decisionsScanned: decisions.scanned,
    decisionsWithdrawn: decisions.withdrawn,
  };
}

/**
 * Withdraw build-linked decision residue whose build's life is over
 * (BI-FE034C1E). Runs in the same sweep as the escalation reconcile because it
 * closes the identical create-path-without-clear-path gap on a different table,
 * and shares its callers: /workspace/inbox render, /ops render, and the 15-min
 * issue-report-triage cron. Idempotent — once withdrawn, `humanOutcome` is no
 * longer null, so the row leaves this query permanently.
 */
async function sweepDecisionResidue(): Promise<{ scanned: number; withdrawn: number }> {
  const rows = await prisma.decisionInteraction.findMany({
    where: {
      outcomeType: { in: ["escalate", "defer"] },
      humanOutcome: { equals: Prisma.DbNull },
      // Only build-linked rows are sweepable; the org-business and profession
      // gates write buildId-null rows that a human answers by hand.
      buildId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: SWEEP_LIMIT,
    select: {
      interactionId: true,
      outcomeType: true,
      buildId: true,
      build: {
        select: { phase: true, supersededByEpicId: true, originatingBacklogItemId: true },
      },
    },
  });

  // Resolve the originating BacklogItem status/outcome for the linked builds in
  // one query (FeatureBuild.originatingBacklogItemId is the BacklogItem cuid).
  const itemPks = Array.from(
    new Set(
      rows
        .map((row) => row.build?.originatingBacklogItemId)
        .filter((x): x is string => Boolean(x)),
    ),
  );
  const items = itemPks.length
    ? await prisma.backlogItem.findMany({
        where: { id: { in: itemPks } },
        select: { id: true, status: true, triageOutcome: true },
      })
    : [];
  const itemByPk = new Map(items.map((i) => [i.id, i]));

  const residue: DecisionResidueRow[] = rows.map((row) => {
    const itemPk = row.build?.originatingBacklogItemId ?? null;
    const item = itemPk ? itemByPk.get(itemPk) : null;
    return {
      interactionId: row.interactionId,
      outcomeType: row.outcomeType,
      buildId: row.buildId,
      buildPhase: row.build?.phase ?? null,
      buildSupersededByEpicId: row.build?.supersededByEpicId ?? null,
      backlogItemStatus: item?.status ?? null,
      backlogItemTriageOutcome: item?.triageOutcome ?? null,
    };
  });

  const withdrawable = selectWithdrawableDecisions(residue);
  const withdrawnAtIso = new Date().toISOString();
  let withdrawn = 0;
  for (const { interactionId, reason } of withdrawable) {
    try {
      await prisma.decisionInteraction.update({
        where: { interactionId },
        data: { humanOutcome: buildWithdrawnHumanOutcome({ reason, withdrawnAtIso }) },
      });
    } catch {
      // Best-effort per row — a single failure must not stop the rest of the sweep.
      continue;
    }
    withdrawn += 1;
    if (process.env.NODE_ENV !== "test") {
      console.log(`[escalation-hygiene] withdrew ${interactionId} (${reason})`);
    }
  }

  return { scanned: residue.length, withdrawn };
}
