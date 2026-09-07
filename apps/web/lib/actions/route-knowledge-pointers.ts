// apps/web/lib/actions/route-knowledge-pointers.ts
//
// Route-scoped knowledge pointers for a coworker's prompt: which knowledge
// articles exist for the product or portfolio the panel is attached to, as a
// short index rather than their contents (the coworker fetches details with
// search_knowledge_base when it actually needs them).
//
// Extracted from agent-coworker.ts, which is size-ratcheted: this is a
// self-contained route -> prompt-section lookup with no coupling to the send
// path it used to sit in.

import { prisma } from "@dpf/db";

export async function getKnowledgePointersForRoute(routeContext: string): Promise<string> {
  const productMatch = routeContext.match(/\/portfolio\/product\/([^/]+)/);
  const portfolioMatch = !productMatch && routeContext.match(/\/portfolio\/([^/]+)/);

  if (!productMatch && !portfolioMatch) return "";

  const { searchKnowledgeArticles } = await import("@/lib/semantic-memory");

  if (productMatch) {
    const productId = productMatch[1];
    const product = await prisma.digitalProduct.findUnique({
      where: { id: productId },
      select: { name: true },
    });
    if (!product) return "";

    const articles = await searchKnowledgeArticles({
      query: product.name,
      productId,
      limit: 3,
    });
    if (articles.length === 0) return "";

    // Enrich with utility-generated abstracts from DB when available
    const abstracts = await prisma.knowledgeArticle.findMany({
      where: { articleId: { in: articles.map((a) => a.articleId) } },
      select: { articleId: true, abstract: true },
    });
    const abstractMap = new Map(abstracts.map((a) => [a.articleId, a.abstract]));

    const lines = articles.map((a) => {
      const abs = abstractMap.get(a.articleId);
      return abs ? `- ${a.articleId}: "${a.title}" (${a.category}) — ${abs}` : `- ${a.articleId}: "${a.title}" (${a.category})`;
    });
    return `KNOWLEDGE: ${articles.length} articles for ${product.name} — use search_knowledge_base for details.\n${lines.join("\n")}`;
  }

  if (portfolioMatch) {
    const portfolioSlug = portfolioMatch[1];
    const portfolio = await prisma.portfolio.findUnique({
      where: { slug: portfolioSlug },
      select: { id: true, name: true },
    });
    if (!portfolio) return "";

    const articles = await searchKnowledgeArticles({
      query: portfolio.name,
      portfolioId: portfolio.id,
      limit: 3,
    });
    if (articles.length === 0) return "";

    const abstracts = await prisma.knowledgeArticle.findMany({
      where: { articleId: { in: articles.map((a) => a.articleId) } },
      select: { articleId: true, abstract: true },
    });
    const abstractMap = new Map(abstracts.map((a) => [a.articleId, a.abstract]));

    const lines = articles.map((a) => {
      const abs = abstractMap.get(a.articleId);
      return abs ? `- ${a.articleId}: "${a.title}" (${a.category}) — ${abs}` : `- ${a.articleId}: "${a.title}" (${a.category})`;
    });
    return `KNOWLEDGE: ${articles.length} articles for ${portfolio.name} portfolio — use search_knowledge_base for details.\n${lines.join("\n")}`;
  }

  return "";
}
