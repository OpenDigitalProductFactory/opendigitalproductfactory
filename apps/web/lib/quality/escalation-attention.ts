// ─── Escalation Attention Feed (BI-0ACD9AB2 — surface convergence) ───────────
// The trusted-escalation design (docs/superpowers/specs/
// 2026-06-20-issue-report-surface-attendance-design.md §5.2, §6.1) holds a
// self-fix escalation in `awaiting_escalation_ack` instead of generic-projecting
// it. This feed surfaces those active escalations in the ONE operator surface
// (/ops) so /admin/issue-reports is no longer a separate queue an operator must
// drain — the admin page becomes the evidence/audit trail, the attention lives
// where the operator already works.

import { prisma } from "@dpf/db";
import { ISSUE_REPORT_STATUS } from "./issue-report-status";
import type { StoredResponderDecision } from "./escalation-responder";

export interface OpenEscalation {
  reportId: string;
  title: string;
  description: string | null;
  severity: string;
  selfFixClass: string | null;
  status: string;
  /** ISO timestamp — serialized for the server→client boundary. */
  createdAt: string;
  /** FeatureBuild public id (FB-*) for the /build deep-link, if linked. */
  buildId: string | null;
  /** Pre-computed WWMD recommendation from the responder sweep (§14), if consulted. */
  responderDecision: StoredResponderDecision | null;
}

/** Human label for a self-fix-feasibility class (escalate-build-to-human's
 *  SELF_FIX_CLASS). Pure — unit-tested. */
export function escalationSelfFixLabel(selfFixClass: string | null | undefined): string {
  switch (selfFixClass) {
    case "needs-human":
      return "Needs human";
    case "needs-external-capability":
      return "Needs external capability";
    case "auto-recoverable":
      return "Auto-recoverable";
    default:
      return "Escalation";
  }
}

/** Compact relative age for an escalation card. Pure (now injected). */
export function escalationAgeLabel(iso: string, nowMs: number): string {
  const ms = nowMs - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * Active self-fix escalations awaiting the responder/operator. An escalation is
 * shaped by `type="build-stall-escalation"` or a non-null `selfFixClass`; it is
 * "active" while still `awaiting_escalation_ack` (the projection guard's hold
 * status, BI-0ACD9AB2 §5.2) or still `open` (legacy rows the cron has not yet
 * held). Resolved / suppressed / already-triaged rows are out — they are no
 * longer awaiting attention.
 */
export async function getOpenEscalations(): Promise<OpenEscalation[]> {
  const rows = await prisma.platformIssueReport.findMany({
    where: {
      AND: [
        { OR: [{ type: "build-stall-escalation" }, { selfFixClass: { not: null } }] },
        {
          status: {
            in: [ISSUE_REPORT_STATUS.AWAITING_ESCALATION_ACK, ISSUE_REPORT_STATUS.OPEN],
          },
        },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      reportId: true,
      title: true,
      description: true,
      severity: true,
      selfFixClass: true,
      status: true,
      createdAt: true,
      featureBuildId: true,
      responderDecision: true,
    },
  });

  // PlatformIssueReport has no `featureBuild` relation (only the scalar FK), so
  // resolve the FB-* public id for the /build deep-link with one extra query.
  const buildPks = Array.from(
    new Set(rows.map((r) => r.featureBuildId).filter((x): x is string => Boolean(x))),
  );
  const builds = buildPks.length
    ? await prisma.featureBuild.findMany({
        where: { id: { in: buildPks } },
        select: { id: true, buildId: true },
      })
    : [];
  const buildIdByPk = new Map(builds.map((b) => [b.id, b.buildId]));

  return rows.map((r) => ({
    reportId: r.reportId,
    title: r.title,
    description: r.description,
    severity: r.severity,
    selfFixClass: r.selfFixClass,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    buildId: r.featureBuildId ? buildIdByPk.get(r.featureBuildId) ?? null : null,
    responderDecision: asStoredResponderDecision(r.responderDecision),
  }));
}

/** Coerce the stored responder JSON back to the display shape. We control the
 *  shape the sweep writes, so a light structural guard is enough. */
function asStoredResponderDecision(value: unknown): StoredResponderDecision | null {
  if (
    value &&
    typeof value === "object" &&
    "status" in value &&
    "operatorActionLabel" in value &&
    "reasonSummary" in value
  ) {
    const o = value as Record<string, unknown>;
    return {
      status: String(o.status),
      operatorActionLabel: String(o.operatorActionLabel),
      reasonSummary: String(o.reasonSummary),
    };
  }
  return null;
}
