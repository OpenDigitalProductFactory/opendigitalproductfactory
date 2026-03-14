"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";

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

function resolvePortfolioSlug(routeContext: string): string | null {
  for (const [prefix, slug] of Object.entries(ROUTE_PORTFOLIO_MAP)) {
    if (routeContext === prefix || routeContext.startsWith(prefix + "/")) {
      return slug;
    }
  }
  return null;
}

export async function reportQualityIssue(input: {
  type: "runtime_error" | "user_report" | "feedback";
  title: string;
  description?: string;
  severity?: string;
  routeContext: string;
  errorStack?: string;
  source?: string;
}): Promise<{ reportId: string } | { error: string }> {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const reportId = "PIR-" + Math.random().toString(36).substring(2, 7).toUpperCase();

  // Best-effort route-to-owner resolution
  let portfolioId: string | null = null;
  const slug = resolvePortfolioSlug(input.routeContext);
  if (slug) {
    const portfolio = await prisma.portfolio.findUnique({
      where: { slug },
      select: { id: true },
    });
    portfolioId = portfolio?.id ?? null;
  }

  try {
    await prisma.platformIssueReport.create({
      data: {
        reportId,
        type: input.type,
        severity: input.severity ?? "medium",
        title: input.title.slice(0, 500),
        description: input.description?.slice(0, 10000) ?? null,
        routeContext: input.routeContext,
        errorStack: input.errorStack?.slice(0, 20000) ?? null,
        reportedById: userId,
        source: input.source ?? "ai_assisted",
        portfolioId,
      },
    });
    return { reportId };
  } catch {
    return { error: "Failed to create report" };
  }
}
