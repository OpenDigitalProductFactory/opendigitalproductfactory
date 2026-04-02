// apps/web/app/(shell)/portfolio/product/[id]/knowledge/page.tsx
//
// Knowledge tab — knowledge articles linked to this digital product.

import { prisma } from "@dpf/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { KnowledgeArticleList } from "@/components/knowledge/KnowledgeArticleList";
import type { KnowledgeArticleSummary } from "@/components/knowledge/KnowledgeArticleCard";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ProductKnowledgePage({ params }: Props) {
  const { id } = await params;

  const [product, articles] = await Promise.all([
    prisma.digitalProduct.findUnique({
      where: { id },
      select: { id: true, name: true, portfolioId: true },
    }),
    prisma.knowledgeArticle.findMany({
      where: {
        products: { some: { digitalProductId: id } },
        status: { not: "archived" },
      },
      orderBy: { updatedAt: "desc" },
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
  ]);

  if (!product) notFound();

  // Build query params for "New Article" link
  const newParams = new URLSearchParams({ productId: id });
  if (product.portfolioId) newParams.set("portfolioId", product.portfolioId);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div />
        <Link
          href={`/knowledge/new?${newParams.toString()}`}
          className="text-xs px-3 py-1.5 rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
        >
          New Article
        </Link>
      </div>
      <KnowledgeArticleList
        articles={articles as KnowledgeArticleSummary[]}
        emptyMessage={`No knowledge articles yet for ${product.name}. Create the first article to start building your knowledge base.`}
      />
    </div>
  );
}
