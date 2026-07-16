import { prisma } from "@dpf/db";
import { inngest } from "@/lib/queue/inngest-client";
import { ISSUE_REPORT_STATUS, type IssueReportStatus } from "./issue-report-status";
import { classifyIssueReportStream, isResponderStream } from "./issue-report-stream";
import { shouldPromoteIssueReport } from "./issue-report-promotion";

// Field length limits — matched to existing writers and Prisma schema column widths.
const LIMITS = {
  type: 50,
  severity: 20,
  source: 30,
  title: 500,
  description: 10_000,
  routeContext: 500,
  errorStack: 20_000,
  errorDigest: 191,
  deployedSha: 64,
  userAgent: 500,
  triggerKind: 100,
  supportSessionId: 191,
  dedupeKey: 191,
  selfFixClass: 40,
} as const;

// Same route → portfolio slug map used today by reportQualityIssue().
// Kept colocated so a future move of the action does not orphan the resolution.
const ROUTE_PORTFOLIO_MAP: Record<string, string> = {
  "/portfolio": "foundational",
  "/ea": "foundational",
  "/inventory": "foundational",
  "/platform": "foundational",
  "/admin": "foundational",
  "/ops": "manufacturing_and_delivery",
  "/employee": "for_employees",
  "/customer": "products_and_services_sold",
};

function resolvePortfolioSlug(routeContext: string | null | undefined): string | null {
  if (!routeContext) return null;
  for (const [prefix, slug] of Object.entries(ROUTE_PORTFOLIO_MAP)) {
    if (routeContext === prefix || routeContext.startsWith(prefix + "/")) return slug;
  }
  return null;
}

function generateReportId(): string {
  return "PIR-" + Math.random().toString(36).substring(2, 7).toUpperCase();
}

/**
 * Record a re-occurrence of an already-open issue report: bump occurrenceCount
 * and refresh lastSeenAt (BI-51F6A428). This is what lets a reach-gated report
 * accrue toward its promotion bar across scan windows instead of being minted
 * into a BI on first sight — and it lets a staged report's aging-out sweep see
 * that it is still recurring. Called by (a) the log-signature scanner when a
 * signature recurs while its report is still open, and (b) the P2002 dedupeKey
 * idempotency race in createPlatformIssueReport.
 */
export async function accrueIssueReportOccurrence(
  reportRowId: string,
  now: () => Date = () => new Date(),
): Promise<void> {
  await prisma.platformIssueReport.update({
    where: { id: reportRowId },
    data: { occurrenceCount: { increment: 1 }, lastSeenAt: now() },
  });
}

const VALID_STATUSES = new Set<string>(Object.values(ISSUE_REPORT_STATUS));

function trimTo(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  return value.slice(0, max);
}

export interface CreatePlatformIssueReportInput {
  // Required
  type: string;
  title: string;
  source: string;

  // Optional with safe defaults
  severity?: string;
  description?: string | null;
  routeContext?: string | null;
  errorStack?: string | null;
  // BI-B4F401B3: crash-boundary diagnostics. errorDigest = Next.js server
  // digest token; deployedSha = running image SHA at crash time.
  errorDigest?: string | null;
  deployedSha?: string | null;
  userAgent?: string | null;
  triggerKind?: string | null;
  supportSessionId?: string | null;
  // BI-5FE8656F: stable idempotency key for automated producers (log scanner).
  dedupeKey?: string | null;
  // BI-3E0EE3BA: self-fix-feasibility class when an autonomous producer escalates
  // (auto-recoverable | needs-human | needs-external-capability).
  selfFixClass?: string | null;

  // Identity / linkage
  reportedById?: string | null;
  threadId?: string | null;
  taskRunId?: string | null;
  featureBuildId?: string | null;
  agentId?: string | null;

  // Ownership — resolved automatically if not provided
  portfolioId?: string | null;
  digitalProductId?: string | null;

  // Status — defaults to schema default ("open") when omitted
  status?: IssueReportStatus;
}

/**
 * The single server-side writer for PlatformIssueReport.
 *
 * All entry points (POST /api/quality/report, reportQualityIssue() server
 * action, report_quality_issue MCP tool handler, crash boundary) MUST go
 * through this function. New entry points should too.
 *
 * Behavior:
 *  - Generates a fresh PIR-XXXXX reportId.
 *  - Applies length limits matched to the Prisma column widths.
 *  - Defaults digitalProductId to the dpf-portal product when not provided.
 *  - Resolves portfolioId from routeContext via ROUTE_PORTFOLIO_MAP when not provided.
 *  - Validates status against ISSUE_REPORT_STATUS; rejects unknown values.
 *  - Leaves status undefined when not provided so the Prisma schema default
 *    ("open") applies — supports cron contract.
 *  - Projection guard (BI-0ACD9AB2 §5.2): a self-fix escalation (build-stall /
 *    selfFixClass) with no pinned status is born in awaiting_escalation_ack so it
 *    is held for the escalation responder, not generic-projected into a BI.
 *
 * Privacy / non-identifiability transforms (redactHostnames, secret scan,
 * coworker-synthesized summaries) are intentionally OUT of scope for Phase 0
 * — they live in the upstream-escalation path added in Phase 3.
 */
export async function createPlatformIssueReport(
  input: CreatePlatformIssueReportInput,
  opts?: { now?: () => Date },
): Promise<{ reportId: string }> {
  if (input.status !== undefined && !VALID_STATUSES.has(input.status)) {
    throw new Error(`createPlatformIssueReport: unknown status "${input.status}"`);
  }

  const now = opts?.now ?? (() => new Date());
  const nowDate = now();

  // Classify the report's handling stream once — reused for the escalation
  // projection guard (below) and the reach-threshold staging gate (BI-51F6A428).
  const stream = classifyIssueReportStream({
    type: input.type,
    source: input.source,
    severity: input.severity,
    selfFixClass: input.selfFixClass,
    errorDigest: input.errorDigest,
  });

  // Projection guard (BI-0ACD9AB2 §5.2 — trusted escalation routing): a self-fix
  // escalation (type="build-stall-escalation" / selfFixClass set) is attended by
  // the escalation responder, never generic-projected into a BI. When the caller
  // did not pin a status, birth it in awaiting_escalation_ack — a non-resolved
  // support-flow status — so it (a) is held for the responder, not the generic
  // projector, (b) never fires the immediate projection event below (status !=
  // open), and (c) is still covered by the per-dedupeKey "one non-resolved
  // report" partial-unique. Every writer is guarded at this one front door.
  const status: IssueReportStatus | undefined =
    input.status ??
    (isResponderStream(stream) ? ISSUE_REPORT_STATUS.AWAITING_ESCALATION_ACK : undefined);

  const digitalProductId =
    input.digitalProductId ??
    (await prisma.digitalProduct
      .findUnique({ where: { productId: "dpf-portal" }, select: { id: true } })
      .then((p) => p?.id ?? null));

  let portfolioId: string | null = input.portfolioId ?? null;
  if (portfolioId == null) {
    const slug = resolvePortfolioSlug(input.routeContext);
    if (slug) {
      const pf = await prisma.portfolio.findUnique({
        where: { slug },
        select: { id: true },
      });
      portfolioId = pf?.id ?? null;
    }
  }

  const reportId = generateReportId();
  const dedupeKey = trimTo(input.dedupeKey ?? null, LIMITS.dedupeKey);

  // Reach-threshold + staging gate (BI-51F6A428). The "noise-digest" stream is
  // the automated log-signature treadmill: a single transient signature must not
  // mint a BI on first sight. An OPEN reach-gated signal is born staged (held,
  // not projected) UNLESS it already clears the promotion bar — high/critical
  // clear it on first occurrence (shouldPromoteIssueReport). Non-gated reports
  // (human/manual, crash-boundary, runtime faults) are never held: they project
  // immediately as before. Support-flow reports (status != open) never project.
  const effectiveStatus = status ?? ISSUE_REPORT_STATUS.OPEN;
  const reachGated = stream === "noise-digest";
  const promoteOnCreate =
    effectiveStatus === ISSUE_REPORT_STATUS.OPEN &&
    (!reachGated ||
      shouldPromoteIssueReport({
        occurrenceCount: 1,
        firstSeenAt: nowDate,
        lastSeenAt: nowDate,
        severity: input.severity ?? "medium",
        now: nowDate,
      }));
  const stagedUntilPromoted =
    effectiveStatus === ISSUE_REPORT_STATUS.OPEN && reachGated && !promoteOnCreate;

  try {
    await prisma.platformIssueReport.create({
      data: {
        reportId,
        type: input.type.slice(0, LIMITS.type),
        severity: (input.severity ?? "medium").slice(0, LIMITS.severity),
        title: input.title.slice(0, LIMITS.title),
        description: trimTo(input.description ?? null, LIMITS.description),
        routeContext: trimTo(input.routeContext ?? null, LIMITS.routeContext),
        errorStack: trimTo(input.errorStack ?? null, LIMITS.errorStack),
        errorDigest: trimTo(input.errorDigest ?? null, LIMITS.errorDigest),
        deployedSha: trimTo(input.deployedSha ?? null, LIMITS.deployedSha),
        userAgent: trimTo(input.userAgent ?? null, LIMITS.userAgent),
        triggerKind: trimTo(input.triggerKind ?? null, LIMITS.triggerKind),
        supportSessionId: trimTo(input.supportSessionId ?? null, LIMITS.supportSessionId),
        dedupeKey,
        selfFixClass: trimTo(input.selfFixClass ?? null, LIMITS.selfFixClass),
        reportedById: input.reportedById ?? null,
        threadId: input.threadId ?? null,
        agentId: input.agentId ?? null,
        taskRunId: input.taskRunId ?? null,
        featureBuildId: input.featureBuildId ?? null,
        source: input.source.slice(0, LIMITS.source),
        portfolioId,
        digitalProductId,
        // BI-51F6A428: seed accrual/staging fields. occurrenceCount defaults to
        // 1 via the schema; firstSeenAt/lastSeenAt anchor the promotion math.
        firstSeenAt: nowDate,
        lastSeenAt: nowDate,
        stagedUntilPromoted,
        ...(status !== undefined ? { status } : {}),
      },
    });
  } catch (err) {
    // BI-PIR-76bf293c — idempotency race on the dedupeKey partial-unique.
    // Two automated producers (e.g. the log-signature scanner firing on
    // overlapping cycles, or the same signature twice within one cycle) can
    // both create the same dedupeKey while a non-resolved report is open,
    // violating PlatformIssueReport_dedupeKey_open_key (UNIQUE WHERE status NOT
    // IN resolved_locally/resolved_upstream/suppressed). Previously that P2002
    // escaped this shared front door, got logged, and was itself re-scanned.
    // Treat it as idempotent success: accrue the re-occurrence onto the surviving
    // open report and return its id. BI-51F6A428: the re-occurrence bumps
    // occurrenceCount + lastSeenAt (instead of being silently swallowed) so a
    // staged signal accrues toward its promotion bar; the triage cron promotes it
    // once it crosses the bar. No re-projection here — a report already above the
    // bar projected when first filed, and a staged one is promoted by the cron.
    const code = (err as { code?: string } | null)?.code;
    const target = JSON.stringify((err as { meta?: { target?: unknown } } | null)?.meta?.target ?? "");
    if (code === "P2002" && dedupeKey && target.includes("dedupeKey")) {
      const existing = await prisma.platformIssueReport.findFirst({
        where: {
          dedupeKey,
          status: { notIn: ["resolved_locally", "resolved_upstream", "suppressed"] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, reportId: true },
      });
      if (existing) {
        await accrueIssueReportOccurrence(existing.id, now);
        return { reportId: existing.reportId };
      }
    }
    throw err;
  }

  // EP-INTAKE-UNIFY Phase 4 (BI-EDFBE081): project OPEN reports into the backlog
  // immediately via a durable event, instead of waiting up to 15 min for the
  // triage cron. Support-flow reports (status !== open) are owned by the support
  // pipeline and skipped. Best-effort — the cron remains the safety net, so a
  // send failure never loses the projection.
  //
  // BI-51F6A428: a reach-gated signal born staged (promoteOnCreate=false) does
  // NOT fire the immediate event — it stays OPEN + stagedUntilPromoted so it can
  // accrue. The 15-min triage cron re-evaluates staged reports and projects them
  // once they cross the bar (or ages out the ones that stopped recurring).
  if (promoteOnCreate) {
    try {
      await inngest.send({ name: "quality/issue-report.created", data: { reportId } });
    } catch (err) {
      console.error("[platform-issue-reports] immediate-projection event send failed", err);
    }
  }

  return { reportId };
}
