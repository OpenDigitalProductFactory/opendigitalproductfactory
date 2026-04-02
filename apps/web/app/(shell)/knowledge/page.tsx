// apps/web/app/(shell)/knowledge/page.tsx
//
// Global knowledge browse/search page with portfolio and product filtering.

import { prisma } from "@dpf/db";
import Link from "next/link";
import { KnowledgeArticleList } from "@/components/knowledge/KnowledgeArticleList";
import type { KnowledgeArticleSummary } from "@/components/knowledge/KnowledgeArticleCard";

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
    label: "For Employees",
    description: "People and policy knowledge for HR and managers",
  },
  products_and_services_sold: {
    label: "Products & Services Sold",
    description: "Business knowledge for product and sales teams",
  },
};

type Props = {
  searchParams: Promise<{ portfolioId?: string; category?: string; status?: string }>;
};

export default async function KnowledgeBrowsePage({ searchParams }: Props) {
  const sp = await searchParams;

  // Build where clause from filters
  const where: Record<string, unknown> = {};

  // Default to non-archived
  const statusFilter = sp.status ?? "published";
  if (statusFilter !== "all") {
    where.status = statusFilter;
  }
  if (sp.portfolioId) {
    where.portfolios = { some: { portfolioId: sp.portfolioId } };
  }
  if (sp.category) {
    where.category = sp.category;
  }

  const [articles, portfolios] = await Promise.all([
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
  ]);

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
          className="text-xs px-3 py-1.5 rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
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
                  ? "border-[var(--dpf-accent)] text-[var(--dpf-accent)] bg-[var(--dpf-accent)]10"
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
        {[
          { label: "Published", value: "published" },
          { label: "Drafts", value: "draft" },
          { label: "Needs Review", value: "review-needed" },
          { label: "Archived", value: "archived" },
        ].map((tab) => {
          const isActive = statusFilter === tab.value;
          const params = new URLSearchParams();
          if (sp.portfolioId) params.set("portfolioId", sp.portfolioId);
          if (tab.value !== "published") params.set("status", tab.value);
          const href = `/knowledge${params.toString() ? `?${params.toString()}` : ""}`;
          return (
            <Link
              key={tab.value}
              href={href}
              className={[
                "px-3 py-1.5 text-xs font-medium rounded-t transition-colors",
                isActive
                  ? "text-[var(--dpf-text)] border-b-2 border-[var(--dpf-accent)]"
                  : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
              ].join(" ")}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <KnowledgeArticleList
        articles={articles as KnowledgeArticleSummary[]}
        emptyMessage="No knowledge articles found. Create the first article to start building your knowledge base."
      />
    </div>
  );
}
