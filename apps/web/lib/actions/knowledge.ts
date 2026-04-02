"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";

// ─── Auth guards ──────────────────────────────────────────────────────────────

async function requireAuth(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user) throw new Error("Unauthorized");
  return user.id;
}

async function requireManageKnowledge(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_backlog")
  ) {
    throw new Error("Unauthorized");
  }
  return user.id;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type KnowledgeArticleInput = {
  title: string;
  body: string;
  category: string;
  visibility?: string;
  reviewIntervalDays?: number;
  valueStreams?: string[];
  tags?: string[];
  productIds?: string[];
  portfolioIds?: string[];
};

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createKnowledgeArticle(input: KnowledgeArticleInput): Promise<string> {
  const userId = await requireManageKnowledge();

  // Generate next articleId
  const lastArticle = await prisma.knowledgeArticle.findFirst({
    orderBy: { createdAt: "desc" },
    select: { articleId: true },
  });
  const nextNum = lastArticle
    ? parseInt(lastArticle.articleId.replace("KA-", ""), 10) + 1
    : 1;
  const articleId = `KA-${String(nextNum).padStart(3, "0")}`;

  const article = await prisma.knowledgeArticle.create({
    data: {
      articleId,
      title: input.title.trim(),
      body: input.body,
      category: input.category,
      status: "draft",
      visibility: input.visibility ?? "internal",
      authorId: userId,
      reviewIntervalDays: input.reviewIntervalDays ?? 90,
      valueStreams: input.valueStreams ?? [],
      tags: input.tags ?? [],
      products: input.productIds?.length
        ? { create: input.productIds.map((id) => ({ digitalProductId: id })) }
        : undefined,
      portfolios: input.portfolioIds?.length
        ? { create: input.portfolioIds.map((id) => ({ portfolioId: id })) }
        : undefined,
      revisions: {
        create: {
          version: 1,
          title: input.title.trim(),
          body: input.body,
          changeSummary: "Initial draft",
          createdById: userId,
        },
      },
    },
  });

  // Index into Qdrant
  const { storeKnowledgeArticle } = await import("@/lib/semantic-memory");
  await storeKnowledgeArticle({
    articleId,
    title: input.title.trim(),
    body: input.body,
    category: input.category,
    status: "draft",
    productIds: input.productIds ?? [],
    portfolioIds: input.portfolioIds ?? [],
    valueStreams: input.valueStreams ?? [],
    tags: input.tags ?? [],
  }).catch((err) => console.error("[qdrant] storeKnowledgeArticle failed:", err));

  revalidatePath("/knowledge");
  revalidatePath("/portfolio");

  return article.id;
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateKnowledgeArticle(
  id: string,
  input: { title: string; body: string; changeSummary: string },
): Promise<void> {
  const userId = await requireManageKnowledge();

  const existing = await prisma.knowledgeArticle.findUnique({
    where: { id },
    select: {
      articleId: true,
      category: true,
      status: true,
      valueStreams: true,
      tags: true,
      products: { select: { digitalProductId: true } },
      portfolios: { select: { portfolioId: true } },
      revisions: { orderBy: { version: "desc" }, take: 1, select: { version: true } },
    },
  });
  if (!existing) throw new Error("Article not found");

  const nextVersion = (existing.revisions[0]?.version ?? 0) + 1;

  await prisma.$transaction([
    prisma.knowledgeArticle.update({
      where: { id },
      data: {
        title: input.title.trim(),
        body: input.body,
        lastReviewedAt: new Date(),
      },
    }),
    prisma.knowledgeArticleRevision.create({
      data: {
        articleId: id,
        version: nextVersion,
        title: input.title.trim(),
        body: input.body,
        changeSummary: input.changeSummary,
        createdById: userId,
      },
    }),
  ]);

  // Re-index in Qdrant
  const { storeKnowledgeArticle } = await import("@/lib/semantic-memory");
  await storeKnowledgeArticle({
    articleId: existing.articleId,
    title: input.title.trim(),
    body: input.body,
    category: existing.category,
    status: existing.status,
    productIds: existing.products.map((p) => p.digitalProductId),
    portfolioIds: existing.portfolios.map((p) => p.portfolioId),
    valueStreams: existing.valueStreams,
    tags: existing.tags,
  }).catch((err) => console.error("[qdrant] storeKnowledgeArticle failed:", err));

  revalidatePath("/knowledge");
  revalidatePath("/portfolio");
}

// ─── Publish ──────────────────────────────────────────────────────────────────

export async function publishKnowledgeArticle(id: string): Promise<void> {
  await requireManageKnowledge();

  const article = await prisma.knowledgeArticle.update({
    where: { id },
    data: { status: "published", lastReviewedAt: new Date() },
    select: {
      articleId: true,
      title: true,
      body: true,
      category: true,
      valueStreams: true,
      tags: true,
      products: { select: { digitalProductId: true } },
      portfolios: { select: { portfolioId: true } },
    },
  });

  const { storeKnowledgeArticle } = await import("@/lib/semantic-memory");
  await storeKnowledgeArticle({
    articleId: article.articleId,
    title: article.title,
    body: article.body,
    category: article.category,
    status: "published",
    productIds: article.products.map((p) => p.digitalProductId),
    portfolioIds: article.portfolios.map((p) => p.portfolioId),
    valueStreams: article.valueStreams,
    tags: article.tags,
  }).catch((err) => console.error("[qdrant] storeKnowledgeArticle failed:", err));

  revalidatePath("/knowledge");
  revalidatePath("/portfolio");
}

// ─── Confirm Review ───────────────────────────────────────────────────────────

export async function confirmKnowledgeArticleReview(id: string): Promise<void> {
  await requireAuth();

  await prisma.knowledgeArticle.update({
    where: { id },
    data: { status: "published", lastReviewedAt: new Date() },
  });

  revalidatePath("/knowledge");
  revalidatePath("/portfolio");
}

// ─── Archive ──────────────────────────────────────────────────────────────────

export async function archiveKnowledgeArticle(id: string): Promise<void> {
  await requireManageKnowledge();

  const article = await prisma.knowledgeArticle.update({
    where: { id },
    data: { status: "archived" },
    select: { articleId: true, title: true, body: true, category: true, valueStreams: true, tags: true, products: { select: { digitalProductId: true } }, portfolios: { select: { portfolioId: true } } },
  });

  const { storeKnowledgeArticle } = await import("@/lib/semantic-memory");
  await storeKnowledgeArticle({
    articleId: article.articleId,
    title: article.title,
    body: article.body,
    category: article.category,
    status: "archived",
    productIds: article.products.map((p) => p.digitalProductId),
    portfolioIds: article.portfolios.map((p) => p.portfolioId),
    valueStreams: article.valueStreams,
    tags: article.tags,
  }).catch((err) => console.error("[qdrant] storeKnowledgeArticle failed:", err));

  revalidatePath("/knowledge");
  revalidatePath("/portfolio");
}
