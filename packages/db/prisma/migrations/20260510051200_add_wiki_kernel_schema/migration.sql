-- EP-WIKI-001 Phase 1a: additive wiki kernel schema
-- Spec: docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md
-- Plan: docs/superpowers/plans/2026-05-09-platform-kernel-wiki.md (Phase 1a)
--
-- Phase 1a is purely additive — `KnowledgeArticle` and its tables are
-- untouched. Phase 1b (later PR) will deprecate `KnowledgeArticle` once
-- kernel content has validated `WikiPage` in real use.

-- ─── RawSource ───────────────────────────────────────────────────────────────

CREATE TABLE "RawSource" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publishedAt" TIMESTAMP(3),
    "url" TEXT,
    "doi" TEXT,
    "locator" JSONB,
    "abstract" TEXT,
    "excerpt" TEXT,
    "fullTextPath" TEXT,
    "license" TEXT,
    "retrievedAt" TIMESTAMP(3),
    "isKernel" BOOLEAN NOT NULL DEFAULT false,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RawSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RawSource_sourceKey_key" ON "RawSource"("sourceKey");
CREATE INDEX "RawSource_sourceType_idx" ON "RawSource"("sourceType");
CREATE INDEX "RawSource_isKernel_idx" ON "RawSource"("isKernel");
CREATE INDEX "RawSource_organizationId_idx" ON "RawSource"("organizationId");

ALTER TABLE "RawSource" ADD CONSTRAINT "RawSource_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── WikiPage ────────────────────────────────────────────────────────────────

CREATE TABLE "WikiPage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pageKind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "isKernel" BOOLEAN NOT NULL DEFAULT false,
    "kernelVersion" TEXT,
    "organizationId" TEXT,
    "kernelPageId" TEXT,
    "derivedFromKernelVersion" TEXT,
    "abstract" TEXT,
    "lastReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WikiPage_pkey" PRIMARY KEY ("id")
);

-- Per-tenant slug uniqueness; kernel rows have organizationId = NULL.
CREATE UNIQUE INDEX "WikiPage_organizationId_slug_key" ON "WikiPage"("organizationId", "slug");
CREATE INDEX "WikiPage_slug_idx" ON "WikiPage"("slug");
CREATE INDEX "WikiPage_pageKind_idx" ON "WikiPage"("pageKind");
CREATE INDEX "WikiPage_status_idx" ON "WikiPage"("status");
CREATE INDEX "WikiPage_kernelPageId_idx" ON "WikiPage"("kernelPageId");
CREATE INDEX "WikiPage_organizationId_idx" ON "WikiPage"("organizationId");
CREATE INDEX "WikiPage_isKernel_idx" ON "WikiPage"("isKernel");

ALTER TABLE "WikiPage" ADD CONSTRAINT "WikiPage_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WikiPage" ADD CONSTRAINT "WikiPage_kernelPageId_fkey"
    FOREIGN KEY ("kernelPageId") REFERENCES "WikiPage"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── WikiPageRevision ───────────────────────────────────────────────────────

CREATE TABLE "WikiPageRevision" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "changeSummary" TEXT,
    "changeKind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdByAgentId" TEXT,

    CONSTRAINT "WikiPageRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WikiPageRevision_pageId_version_key" ON "WikiPageRevision"("pageId", "version");
CREATE INDEX "WikiPageRevision_pageId_idx" ON "WikiPageRevision"("pageId");

ALTER TABLE "WikiPageRevision" ADD CONSTRAINT "WikiPageRevision_pageId_fkey"
    FOREIGN KEY ("pageId") REFERENCES "WikiPage"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WikiPageRevision" ADD CONSTRAINT "WikiPageRevision_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WikiPageRevision" ADD CONSTRAINT "WikiPageRevision_createdByAgentId_fkey"
    FOREIGN KEY ("createdByAgentId") REFERENCES "Agent"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── WikiPageLink ───────────────────────────────────────────────────────────

CREATE TABLE "WikiPageLink" (
    "fromPageId" TEXT NOT NULL,
    "toPageId" TEXT NOT NULL,

    CONSTRAINT "WikiPageLink_pkey" PRIMARY KEY ("fromPageId", "toPageId")
);

CREATE INDEX "WikiPageLink_toPageId_idx" ON "WikiPageLink"("toPageId");

ALTER TABLE "WikiPageLink" ADD CONSTRAINT "WikiPageLink_fromPageId_fkey"
    FOREIGN KEY ("fromPageId") REFERENCES "WikiPage"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WikiPageLink" ADD CONSTRAINT "WikiPageLink_toPageId_fkey"
    FOREIGN KEY ("toPageId") REFERENCES "WikiPage"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── WikiPageSource ─────────────────────────────────────────────────────────

CREATE TABLE "WikiPageSource" (
    "pageId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,

    CONSTRAINT "WikiPageSource_pkey" PRIMARY KEY ("pageId", "sourceId")
);

ALTER TABLE "WikiPageSource" ADD CONSTRAINT "WikiPageSource_pageId_fkey"
    FOREIGN KEY ("pageId") REFERENCES "WikiPage"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WikiPageSource" ADD CONSTRAINT "WikiPageSource_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "RawSource"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── WikiIngestEvent ────────────────────────────────────────────────────────

CREATE TABLE "WikiIngestEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "sourceId" TEXT NOT NULL,
    "touchedPageIds" TEXT[],
    "agentId" TEXT,
    "userId" TEXT,
    "kernelVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WikiIngestEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WikiIngestEvent_sourceId_idx" ON "WikiIngestEvent"("sourceId");
CREATE INDEX "WikiIngestEvent_organizationId_idx" ON "WikiIngestEvent"("organizationId");

ALTER TABLE "WikiIngestEvent" ADD CONSTRAINT "WikiIngestEvent_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WikiIngestEvent" ADD CONSTRAINT "WikiIngestEvent_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WikiIngestEvent" ADD CONSTRAINT "WikiIngestEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── WikiLintFinding ────────────────────────────────────────────────────────

CREATE TABLE "WikiLintFinding" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "pageId" TEXT NOT NULL,
    "findingKind" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WikiLintFinding_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WikiLintFinding_organizationId_idx" ON "WikiLintFinding"("organizationId");
CREATE INDEX "WikiLintFinding_status_idx" ON "WikiLintFinding"("status");
CREATE INDEX "WikiLintFinding_findingKind_idx" ON "WikiLintFinding"("findingKind");

ALTER TABLE "WikiLintFinding" ADD CONSTRAINT "WikiLintFinding_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
