// apps/web/app/(shell)/knowledge/[articleId]/page.tsx
//
// Knowledge article detail — view, publish, confirm review, archive.

import { prisma } from "@dpf/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { KnowledgeCategoryBadge } from "@/components/knowledge/KnowledgeCategoryBadge";
import { StalenessIndicator } from "@/components/knowledge/StalenessIndicator";
import { KnowledgeArticleActions } from "@/components/knowledge/KnowledgeArticleActions";

type Props = {
  params: Promise<{ articleId: string }>;
};

export default async function KnowledgeArticleDetailPage({ params }: Props) {
  const { articleId } = await params;

  const article = await prisma.knowledgeArticle.findUnique({
    where: { articleId },
    select: {
      id: true,
      articleId: true,
      title: true,
      body: true,
      category: true,
      status: true,
      visibility: true,
      reviewIntervalDays: true,
      lastReviewedAt: true,
      valueStreams: true,
      tags: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { email: true } },
      authorAgent: { select: { name: true } },
      products: {
        select: { digitalProduct: { select: { id: true, name: true } } },
      },
      portfolios: {
        select: { portfolio: { select: { id: true, name: true, slug: true } } },
      },
      revisions: {
        orderBy: { version: "desc" },
        select: {
          version: true,
          changeSummary: true,
          createdAt: true,
          createdBy: { select: { email: true } },
        },
      },
    },
  });

  if (!article) notFound();

  const authorName =
    article.author?.email?.split("@")[0] ?? article.authorAgent?.name ?? "Unknown";

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] text-[var(--dpf-muted)]">{article.articleId}</span>
            <KnowledgeCategoryBadge category={article.category} />
            {article.status === "draft" && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: "#8888a022", color: "#8888a0" }}>
                draft
              </span>
            )}
            {article.status === "archived" && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: "#f8717122", color: "#f87171" }}>
                archived
              </span>
            )}
            {article.status === "published" && (
              <StalenessIndicator
                lastReviewedAt={article.lastReviewedAt}
                createdAt={article.createdAt}
                reviewIntervalDays={article.reviewIntervalDays}
              />
            )}
          </div>
          <h1 className="text-lg font-semibold text-[var(--dpf-text)]">{article.title}</h1>
          <div className="flex items-center gap-3 mt-1 text-[10px] text-[var(--dpf-muted)]">
            <span>By {authorName}</span>
            <span>Updated {article.updatedAt.toLocaleDateString()}</span>
            {article.lastReviewedAt && (
              <span>Reviewed {article.lastReviewedAt.toLocaleDateString()}</span>
            )}
          </div>
        </div>
        <KnowledgeArticleActions articleId={article.id} status={article.status} />
      </div>

      {/* Linked products and portfolios */}
      {(article.products.length > 0 || article.portfolios.length > 0) && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {article.portfolios.map((p) => (
            <Link
              key={p.portfolio.id}
              href={`/knowledge?portfolioId=${p.portfolio.id}`}
              className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)]"
            >
              {p.portfolio.name}
            </Link>
          ))}
          {article.products.map((p) => (
            <Link
              key={p.digitalProduct.id}
              href={`/portfolio/product/${p.digitalProduct.id}/knowledge`}
              className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)]"
            >
              {p.digitalProduct.name}
            </Link>
          ))}
        </div>
      )}

      {/* Value streams and tags */}
      {(article.valueStreams.length > 0 || article.tags.length > 0) && (
        <div className="flex flex-wrap gap-1 mb-4">
          {article.valueStreams.map((vs) => (
            <span
              key={vs}
              className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]"
            >
              {vs}
            </span>
          ))}
          {article.tags.map((tag) => (
            <span
              key={tag}
              className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Article body */}
      <div className="prose prose-sm prose-invert max-w-none mb-8 px-4 py-3 rounded bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
        <pre className="whitespace-pre-wrap text-xs text-[var(--dpf-text)] font-sans leading-relaxed">
          {article.body}
        </pre>
      </div>

      {/* Revision history */}
      {article.revisions.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wide mb-2">
            Revision History
          </h2>
          <div className="flex flex-col gap-1">
            {article.revisions.map((rev) => (
              <div
                key={rev.version}
                className="flex items-center gap-3 px-3 py-1.5 rounded bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[10px] text-[var(--dpf-muted)]"
              >
                <span className="font-medium text-[var(--dpf-text)]">v{rev.version}</span>
                <span>{rev.changeSummary ?? "No summary"}</span>
                <span className="ml-auto">{rev.createdBy?.email?.split("@")[0] ?? "system"}</span>
                <span>{rev.createdAt.toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6">
        <Link href="/knowledge" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Back to Knowledge Base
        </Link>
      </div>
    </div>
  );
}
