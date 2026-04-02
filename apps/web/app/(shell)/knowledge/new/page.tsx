// apps/web/app/(shell)/knowledge/new/page.tsx
//
// Create a new knowledge article.

import { prisma } from "@dpf/db";
import { KnowledgeArticleForm } from "@/components/knowledge/KnowledgeArticleForm";

type Props = {
  searchParams: Promise<{ productId?: string; portfolioId?: string }>;
};

export default async function NewKnowledgeArticlePage({ searchParams }: Props) {
  const sp = await searchParams;

  const [products, portfolios] = await Promise.all([
    prisma.digitalProduct.findMany({
      where: { lifecycleStatus: "active" },
      orderBy: { name: "asc" },
      select: { id: true, productId: true, name: true },
    }),
    prisma.portfolio.findMany({
      orderBy: { name: "asc" },
      select: { id: true, slug: true, name: true },
    }),
  ]);

  return (
    <div className="max-w-3xl">
      <h1 className="text-lg font-semibold text-[var(--dpf-text)] mb-4">New Knowledge Article</h1>
      <KnowledgeArticleForm
        products={products}
        portfolios={portfolios}
        defaultProductId={sp.productId}
        defaultPortfolioId={sp.portfolioId}
      />
    </div>
  );
}
