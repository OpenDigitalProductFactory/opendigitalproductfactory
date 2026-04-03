-- CreateTable
CREATE TABLE "KnowledgeArticle" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "visibility" TEXT NOT NULL DEFAULT 'internal',
    "authorId" TEXT,
    "authorAgentId" TEXT,
    "reviewIntervalDays" INTEGER NOT NULL DEFAULT 90,
    "lastReviewedAt" TIMESTAMP(3),
    "valueStreams" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeArticleRevision" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "changeSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdByAgentId" TEXT,

    CONSTRAINT "KnowledgeArticleRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeArticleProduct" (
    "articleId" TEXT NOT NULL,
    "digitalProductId" TEXT NOT NULL,

    CONSTRAINT "KnowledgeArticleProduct_pkey" PRIMARY KEY ("articleId","digitalProductId")
);

-- CreateTable
CREATE TABLE "KnowledgeArticlePortfolio" (
    "articleId" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,

    CONSTRAINT "KnowledgeArticlePortfolio_pkey" PRIMARY KEY ("articleId","portfolioId")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeArticle_articleId_key" ON "KnowledgeArticle"("articleId");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_status_idx" ON "KnowledgeArticle"("status");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_category_idx" ON "KnowledgeArticle"("category");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_authorId_idx" ON "KnowledgeArticle"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeArticleRevision_articleId_version_key" ON "KnowledgeArticleRevision"("articleId", "version");

-- CreateIndex
CREATE INDEX "KnowledgeArticleRevision_articleId_idx" ON "KnowledgeArticleRevision"("articleId");

-- AddForeignKey
ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_authorAgentId_fkey" FOREIGN KEY ("authorAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeArticleRevision" ADD CONSTRAINT "KnowledgeArticleRevision_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeArticleRevision" ADD CONSTRAINT "KnowledgeArticleRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeArticleProduct" ADD CONSTRAINT "KnowledgeArticleProduct_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeArticleProduct" ADD CONSTRAINT "KnowledgeArticleProduct_digitalProductId_fkey" FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeArticlePortfolio" ADD CONSTRAINT "KnowledgeArticlePortfolio_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeArticlePortfolio" ADD CONSTRAINT "KnowledgeArticlePortfolio_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
