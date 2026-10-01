// apps/web/app/(shell)/knowledge/page.tsx
//
// Global knowledge browse/search page with portfolio and product filtering.

import { prisma } from "@dpf/db";
import Link from "next/link";
import { KnowledgeArticleList } from "@/components/knowledge/KnowledgeArticleList";
import type { KnowledgeArticleSummary } from "@/components/knowledge/KnowledgeArticleCard";
import {
  describeEmptyKnowledgeView,
  KNOWLEDGE_STATUS_TABS,
} from "@/components/knowledge/knowledge-status-summary";
import { EmptyState } from "@/components/ui/report-kit/EmptyState";

const PORTFOLIO_PERSONAS: Record<string, { label: string; description: string }> = {
  foundational: {
    label: "Foundational",
    description: "Technical knowledge for engineers and architects",
  },
  manufacturing_and_delivery: {
    label: "Manufacturing & Delivery",
    description: "Operational knowledge for delivery and production teams",
  },
  for_employees: {
    label: "Workforce",
    description: "Knowledge for employees, contractors, AI coworkers, robots, non-human identities, HR, managers, and policy",
  },
  products_and_services_sold: {
    label: "Goods and Services for Sale",
    description: "Business knowledge for product and sales teams",
  },
};

type Props = {
  searchParams: Promise<{ portfolioId?: string; category?: string; status?: string }>;
};

export default async function KnowledgeBrowsePage({ searchParams }: Props) {
  const sp = await searchParams;

  // Build where clause from filters. The status filter is applied separately so
  // the same scope also yields per-status counts for the tabs.
  const scope: Record<string, unknown> = {};
  const statusFilter = sp.status ?? "published";
  if (sp.portfolioId) {
    scope.portfolios = { some: { portfolioId: sp.portfolioId } };
  }
  if (sp.category) {
    scope.category = sp.category;
  }
  const where = statusFilter === "all" ? scope : { ...scope, status: statusFilter };

  const [articles, portfolios, statusGroups] = await Promise.all([
    prisma.knowledgeArticle.findMany({
      where: where as never,
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: {
        id: true,
        articleId: true,
        title: true,
        body: true,
        category: true,
        status: true,
        reviewIntervalDays: true,
        lastReviewedAt: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { email: true } },
        authorAgent: { select: { name: true } },
      },
    }),
    prisma.portfolio.findMany({
      orderBy: { name: "asc" },
      select: { id: true, slug: true, name: true },
    }),
    prisma.knowledgeArticle.groupBy({
      by: ["status"],
      where: scope as never,
      _count: { _all: true },
    }),
  ]);
  const statusCounts: Record<string, number> = Object.fromEntries(
    statusGroups.map((g) => [g.status, g._count._all]),
  );
  const emptyView = describeEmptyKnowledgeView(statusFilter, statusCounts);

  const statusHref = (status: string) => {
    const params = new URLSearchParams();
    if (sp.portfolioId) params.set("portfolioId", sp.portfolioId);
    if (status !== "published") params.set("status", status);
    return `/knowledge${params.toString() ? `?${params.toString()}` : ""}`;
  };

  // Resolve active portfolio for persona banner
  const activePortfolio = sp.portfolioId
    ? portfolios.find((p) => p.id === sp.portfolioId)
    : null;
  const persona = activePortfolio
    ? PORTFOLIO_PERSONAS[activePortfolio.slug]
    : null;

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-[var(--dpf-text)]">Knowledge Base</h1>
        <Link
          href={`/knowledge/new${sp.portfolioId ? `?portfolioId=${sp.portfolioId}` : ""}`}
          className="text-xs px-3 py-1.5 rounded bg-[var(--dpf-accent)] text-[var(--dpf-on-accent)] hover:opacity-90 transition-opacity"
        >
          New Article
        </Link>
      </div>

      {/* Portfolio persona banner */}
      {persona && (
        <div className="mb-4 px-3 py-2 rounded bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
          <span className="text-xs font-medium text-[var(--dpf-text)]">{persona.label}</span>
          <span className="text-xs text-[var(--dpf-muted)] ml-2">{persona.description}</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {/* Portfolio filter */}
        {portfolios.map((p) => {
          const isActive = sp.portfolioId === p.id;
          const href = isActive ? "/knowledge" : `/knowledge?portfolioId=${p.id}`;
          return (
            <Link
              key={p.id}
              href={href}
              className={[
                "text-[10px] px-2 py-1 rounded-full border transition-colors",
                isActive
                  ? "border-[var(--dpf-accent)] text-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)]"
                  : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)]",
              ].join(" ")}
            >
              {p.name}
            </Link>
          );
        })}
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 mb-4 border-b border-[var(--dpf-border)]">
        {KNOWLEDGE_STATUS_TABS.map((tab) => {
          const isActive = statusFilter === tab.value;
          const count = statusCounts[tab.value] ?? 0;
          return (
            <Link
              key={tab.value}
              href={statusHref(tab.value)}
              className={[
                "px-3 py-1.5 text-xs font-medium rounded-t transition-colors",
                isActive
                  ? "text-[var(--dpf-text)] border-b-2 border-[var(--dpf-accent)]"
                  : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
              ].join(" ")}
            >
              {tab.label}
              <span className="ms-1 text-[var(--dpf-muted)]">({count})</span>
            </Link>
          );
        })}
      </div>

      {articles.length === 0 ? (
        <EmptyState
          title={emptyView.title}
          description={emptyView.description}
          action={emptyView.link && (
            <Link
              href={statusHref(emptyView.link.status)}
              className="text-xs text-[var(--dpf-accent)] hover:underline"
            >
              {emptyView.link.label}
            </Link>
          )}
        />
      ) : (
        <KnowledgeArticleList articles={articles as KnowledgeArticleSummary[]} />
      )}
    </div>
  );
}
