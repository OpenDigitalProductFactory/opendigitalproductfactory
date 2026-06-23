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

import { prisma } from "@dpf/db";
import { ISSUE_REPORT_STATUS } from "@/lib/quality/issue-report-status";
import {
  selectResolvableEscalations,
  type EscalationStalenessRow,
} from "@/lib/quality/escalation-staleness";

const SWEEP_LIMIT = 200;

export async function runEscalationHygiene(): Promise<{ scanned: number; resolved: number }> {
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
        select: { supersededByEpicId: true, originatingBacklogItemId: true },
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

  return { scanned: rows.length, resolved: resolvable.length };
}
