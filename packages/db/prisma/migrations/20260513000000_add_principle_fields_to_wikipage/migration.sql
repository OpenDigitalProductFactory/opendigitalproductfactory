-- Phase 0 of the principles-as-wiki-kind plan: extend WikiPage with the
-- nullable principle-only fields, two indexes for retrieval filters, and a
-- partial unique index that closes the kernel slug uniqueness gap (NULL
-- organizationId rows previously allowed duplicate slugs because Postgres
-- treats NULLs as distinct under the default composite unique constraint).
--
-- Spec: docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md (§9)
-- Plan: docs/superpowers/plans/2026-05-12-principles-as-wiki-kind.md (Phase 0 Task 0.3)
--
-- Additive only. Existing pages and call sites are unaffected.

-- ─── Principle-only columns ─────────────────────────────────────────────────

ALTER TABLE "WikiPage" ADD COLUMN "principleTier" TEXT;
ALTER TABLE "WikiPage" ADD COLUMN "principleDirection" TEXT;
ALTER TABLE "WikiPage" ADD COLUMN "principleWeight" DOUBLE PRECISION;
ALTER TABLE "WikiPage" ADD COLUMN "principleWeightRationale" TEXT;
ALTER TABLE "WikiPage" ADD COLUMN "principleDimensionVector" JSONB;
ALTER TABLE "WikiPage" ADD COLUMN "principleDimensions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "WikiPage" ADD COLUMN "principleAppliesTo" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "WikiPage" ADD COLUMN "principlePublic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WikiPage" ADD COLUMN "principlePublicRationale" TEXT;

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX "WikiPage_principleTier_idx" ON "WikiPage"("principleTier");
CREATE INDEX "WikiPage_principlePublic_idx" ON "WikiPage"("principlePublic");

-- ─── Kernel slug uniqueness guard (Prisma-invisible — managed only here) ────
--
-- @@unique([organizationId, slug]) does not prevent duplicate slugs when
-- organizationId IS NULL because Postgres treats NULLs as distinct under
-- composite unique constraints. The application code already guards against
-- this at the helper layer (see wiki-store.ts upsertWikiPage), but any code
-- path that bypasses the helper could still insert duplicate kernel rows.
-- This partial unique index makes the duplicate impossible at the DB level
-- regardless of which code path performs the write.
--
-- Prisma's schema language cannot model partial indexes, so this stays a
-- hand-managed migration artifact. Schema drift detection on this index is
-- accepted intentionally; do not let `prisma migrate dev` "remove" it.
CREATE UNIQUE INDEX "WikiPage_kernel_slug_key"
    ON "WikiPage"("slug")
    WHERE "organizationId" IS NULL;
