// Shared runner that wires the prisma (and optional LLM) dependencies for
// triageIssueReports. Used by BOTH the 15-minute safety-net cron
// (queue/functions/issue-report-triage.ts) and the per-report immediate
// projection event (queue/functions/issue-report-project.ts), so the two paths
// project identically.
//
// EP-INTAKE-UNIFY Phase 4 / BI-EDFBE081.

import { prisma } from "@dpf/db";

import { ISSUE_REPORT_STATUS } from "@/lib/quality/issue-report-status";
import { classifyIssueReportStream } from "@/lib/quality/issue-report-stream";
import {
  shouldPromoteIssueReport,
  shouldExpireStagedReport,
  MAX_NEW_PROMOTIONS_PER_WINDOW,
} from "@/lib/quality/issue-report-promotion";

import { triageIssueReports } from "./issue-report-triage";
import { escalatePriorityForOccurrences } from "./process-observer-triage";

/**
 * Project OPEN issue reports into the backlog. With no `reportId` this is the
 * batch sweep (up to 100, the cron's behavior). With a `reportId` it projects
 * just that report (the immediate event path) — idempotent: if the report is no
 * longer OPEN (already projected) nothing is selected and it is a no-op.
 */
export async function runIssueReportTriage(opts: { reportId?: string } = {}) {
  // Try a cheap LLM for enhanced triage — local model preferred. Falls back to
  // deterministic logic when no model is available.
  let callLlm:
    | ((messages: Array<{ role: string; content: string }>, systemPrompt: string) => Promise<{ content: string }>)
    | undefined;
  try {
    const { routeAndCall } = await import("@/lib/inference/routed-inference");
    callLlm = async (messages, systemPrompt) => {
      const result = await routeAndCall(
        messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        systemPrompt,
        "internal",
        { taskType: "triage", budgetClass: "minimize_cost", effort: "low", persistDecision: false },
      );
      return { content: result.content };
    };
  } catch {
    console.log("[issue-report-triage] No LLM available, using deterministic triage");
  }

  return triageIssueReports({
    getOpenReports: () =>
      prisma.platformIssueReport.findMany({
        where: {
          status: ISSUE_REPORT_STATUS.OPEN,
          ...(opts.reportId ? { reportId: opts.reportId } : {}),
        },
        orderBy: { createdAt: "asc" },
        take: opts.reportId ? 1 : 100,
        select: {
          id: true,
          reportId: true,
          type: true,
          severity: true,
          title: true,
          description: true,
          routeContext: true,
          errorStack: true,
          source: true,
          errorDigest: true,
          selfFixClass: true,
          // BI-51F6A428: accrual fields the reach gate evaluates.
          occurrenceCount: true,
          firstSeenAt: true,
          lastSeenAt: true,
        },
      }),

    getExistingTitles: async () => {
      // Dedup pool = every bug-class BI regardless of intake origin.
      const items = await prisma.backlogItem.findMany({
        where: { workType: "bug" },
        select: { title: true },
      });
      return items.map((i) => i.title);
    },

    createBacklogItem: async (data) => {
      await prisma.backlogItem.create({ data });
    },

    incrementOccurrence: async (title) => {
      const existing = await prisma.backlogItem.findFirst({
        where: { title: { contains: title, mode: "insensitive" }, workType: "bug" },
      });
      if (existing) {
        // Dedup-on-entry: bump the tally AND escalate priority so a frequently
        // recurring duplicate becomes incrementally higher-priority to look at
        // (operator directive). Monotonic — never lowers urgency below the
        // item's severity-based priority.
        const newCount = (existing.occurrenceCount ?? 0) + 1;
        await prisma.backlogItem.update({
          where: { id: existing.id },
          data: {
            occurrenceCount: { increment: 1 },
            lastSeenAt: new Date(),
            priority: escalatePriorityForOccurrences(existing.priority, newCount),
          },
        });
      }
    },

    acknowledgeReport: async (id) => {
      await prisma.platformIssueReport.update({
        where: { id },
        // BI-51F6A428: clear the staging flag on promotion — the report has left
        // the OPEN pool and been minted, so it is no longer held.
        data: { status: ISSUE_REPORT_STATUS.TRIAGED_LOCAL, stagedUntilPromoted: false },
      });
    },

    // ── Reach-threshold + staging gate wiring (BI-51F6A428) ─────────────────
    // The gate applies ONLY to the reach-gated "noise-digest" stream (the
    // automated log-signature treadmill). Every other stream — human/manual
    // reports, crash-boundary, runtime faults — returns true here and projects
    // immediately, exactly as before. shouldPromoteIssueReport itself always
    // returns true for high/critical, so a loud signal is never held.
    shouldPromote: (report) =>
      classifyIssueReportStream(report) !== "noise-digest" ||
      shouldPromoteIssueReport({
        occurrenceCount: report.occurrenceCount ?? 1,
        firstSeenAt: report.firstSeenAt ?? null,
        lastSeenAt: report.lastSeenAt ?? null,
        severity: report.severity,
        now: new Date(),
      }),

    shouldExpire: (report) =>
      shouldExpireStagedReport({
        firstSeenAt: report.firstSeenAt ?? null,
        lastSeenAt: report.lastSeenAt ?? null,
        now: new Date(),
      }),

    stageReport: async (id) => {
      await prisma.platformIssueReport.update({
        where: { id },
        data: { stagedUntilPromoted: true },
      });
    },

    // Aging-out: a genuinely-stopped one-off is closed WITHOUT a BI. suppressed
    // is the "closed, never became work" terminal status (also excluded from the
    // scanner's open-dedupe check, so a true recurrence later can re-file).
    expireStagedReport: async (id) => {
      await prisma.platformIssueReport.update({
        where: { id },
        data: { status: ISSUE_REPORT_STATUS.SUPPRESSED, stagedUntilPromoted: false },
      });
    },

    maxNewPromotions: MAX_NEW_PROMOTIONS_PER_WINDOW,

    // BI-0ACD9AB2 §5.2: a self-fix escalation is held for the responder, never
    // generic-projected. Move any legacy OPEN self-fix row into the support-flow
    // status so the cron stops re-selecting it and the responder receives it.
    holdForResponder: async (id) => {
      await prisma.platformIssueReport.update({
        where: { id },
        data: { status: ISSUE_REPORT_STATUS.AWAITING_ESCALATION_ACK },
      });
    },

    // BI-B4F401B3: find an existing crash BI that already captured this digest.
    // buildCrashBoundaryItem writes `Error digest: <digest>` into the body, so a
    // body match folds repeat crashes (same real error, any route) into one item.
    findCrashItemTitleByDigest: async (digest) => {
      const existing = await prisma.backlogItem.findFirst({
        where: { workType: "bug", body: { contains: `Error digest: ${digest}` } },
        select: { title: true },
      });
      return existing?.title ?? null;
    },

    resolveTaxonomyNodeByPath: async (path) => {
      const node = await prisma.taxonomyNode.findFirst({
        where: {
          OR: [{ nodeId: path }, { nodeId: { endsWith: `/${path.split("/").pop()}` } }],
        },
        select: { id: true },
      });
      return node?.id ?? null;
    },

    callLlm,
  });
}
