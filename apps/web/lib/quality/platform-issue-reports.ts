import { prisma } from "@dpf/db";
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
  userAgent: 500,
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
  userAgent?: string | null;

  // Identity / linkage
  reportedById?: string | null;
  threadId?: string | null;
  taskRunId?: string | null;
  featureBuildId?: string | null;

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
      userAgent: trimTo(input.userAgent ?? null, LIMITS.userAgent),
      reportedById: input.reportedById ?? null,
      threadId: input.threadId ?? null,
      taskRunId: input.taskRunId ?? null,
      featureBuildId: input.featureBuildId ?? null,
      source: input.source.slice(0, LIMITS.source),
      portfolioId,
      digitalProductId,
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });

  return { reportId };
}
