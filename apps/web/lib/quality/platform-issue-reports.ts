import { prisma } from "@dpf/db";
import { inngest } from "@/lib/queue/inngest-client";
import { ISSUE_REPORT_STATUS, type IssueReportStatus } from "./issue-report-status";

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
 *
 * Privacy / non-identifiability transforms (redactHostnames, secret scan,
 * coworker-synthesized summaries) are intentionally OUT of scope for Phase 0
 * — they live in the upstream-escalation path added in Phase 3.
 */
export async function createPlatformIssueReport(
  input: CreatePlatformIssueReportInput,
): Promise<{ reportId: string }> {
  if (input.status !== undefined && !VALID_STATUSES.has(input.status)) {
    throw new Error(`createPlatformIssueReport: unknown status "${input.status}"`);
  }

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
      dedupeKey: trimTo(input.dedupeKey ?? null, LIMITS.dedupeKey),
      selfFixClass: trimTo(input.selfFixClass ?? null, LIMITS.selfFixClass),
      reportedById: input.reportedById ?? null,
      threadId: input.threadId ?? null,
      agentId: input.agentId ?? null,
      taskRunId: input.taskRunId ?? null,
      featureBuildId: input.featureBuildId ?? null,
      source: input.source.slice(0, LIMITS.source),
      portfolioId,
      digitalProductId,
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });

  // EP-INTAKE-UNIFY Phase 4 (BI-EDFBE081): project OPEN reports into the backlog
  // immediately via a durable event, instead of waiting up to 15 min for the
  // triage cron. Support-flow reports (status !== open) are owned by the support
  // pipeline and skipped. Best-effort — the cron remains the safety net, so a
  // send failure never loses the projection.
  const effectiveStatus = input.status ?? ISSUE_REPORT_STATUS.OPEN;
  if (effectiveStatus === ISSUE_REPORT_STATUS.OPEN) {
    try {
      await inngest.send({ name: "quality/issue-report.created", data: { reportId } });
    } catch (err) {
      console.error("[platform-issue-reports] immediate-projection event send failed", err);
    }
  }

  return { reportId };
}
