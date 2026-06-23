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
  /** Originating BacklogItem semantic id (BI-*) for legibility, if resolvable. */
  backlogItemId: string | null;
  /** Originating BacklogItem status (e.g. deferred / in-progress / done), if resolvable. */
  backlogItemStatus: string | null;
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

const BLOCKER_SUMMARY_MAX = 180;

/**
 * Distil the one honest line an operator needs from an escalation's description:
 * the top unresolved blocking issue if the report listed any, else the
 * what-was-attempted sentence. Replaces the degenerate WWMD "composite 0.000"
 * recommendation that made every card say the same thing (BI-8DE13577). Pure —
 * parses the structured description that escalateBuildToHuman.formatEscalationReport
 * writes; returns null when nothing useful can be extracted. */
export function escalationBlockerSummary(description: string | null | undefined): string | null {
  if (!description) return null;
  const lines = description
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const clip = (s: string): string =>
    s.length > BLOCKER_SUMMARY_MAX ? `${s.slice(0, BLOCKER_SUMMARY_MAX - 1).trimEnd()}…` : s;

  // Prefer the first concrete blocking issue under the root-cause header.
  const issueHeader = lines.findIndex((l) => l.toLowerCase().startsWith("unresolved blocking issues"));
  if (issueHeader >= 0) {
    const firstIssue = lines
      .slice(issueHeader + 1)
      .find((l) => l.startsWith("- ") && !l.toLowerCase().includes("no structured blocking issues"));
    if (firstIssue) return clip(firstIssue.replace(/^-\s*/, ""));
  }

  // Else the what-was-attempted sentence (e.g. "attempted N plan revision round(s)…").
  const attemptHeader = lines.findIndex((l) => l.toLowerCase().startsWith("what was attempted"));
  if (attemptHeader >= 0 && lines[attemptHeader + 1]) return clip(lines[attemptHeader + 1]);

  return null;
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
    },
  });

  // PlatformIssueReport carries only the scalar build FK, so resolve the FB-*
  // public id (for the /build deep-link) and the originating BacklogItem (for the
  // legibility chip) with two small follow-up queries.
  const buildPks = Array.from(
    new Set(rows.map((r) => r.featureBuildId).filter((x): x is string => Boolean(x))),
  );
  const builds = buildPks.length
    ? await prisma.featureBuild.findMany({
        where: { id: { in: buildPks } },
        select: { id: true, buildId: true, originatingBacklogItemId: true },
      })
    : [];
  const buildByPk = new Map(builds.map((b) => [b.id, b]));

  const itemPks = Array.from(
    new Set(builds.map((b) => b.originatingBacklogItemId).filter((x): x is string => Boolean(x))),
  );
  const items = itemPks.length
    ? await prisma.backlogItem.findMany({
        where: { id: { in: itemPks } },
        select: { id: true, itemId: true, status: true },
      })
    : [];
  const itemByPk = new Map(items.map((i) => [i.id, i]));

  return rows.map((r) => {
    const build = r.featureBuildId ? buildByPk.get(r.featureBuildId) ?? null : null;
    const item = build?.originatingBacklogItemId
      ? itemByPk.get(build.originatingBacklogItemId) ?? null
      : null;
    return {
      reportId: r.reportId,
      title: r.title,
      description: r.description,
      severity: r.severity,
      selfFixClass: r.selfFixClass,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      buildId: build?.buildId ?? null,
      backlogItemId: item?.itemId ?? null,
      backlogItemStatus: item?.status ?? null,
    };
  });
}
