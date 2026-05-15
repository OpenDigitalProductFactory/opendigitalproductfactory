-- Phase A of the principles-as-wiki-kind plan: add the consumer-archetype axis
-- (§8A) to WikiPage. Two columns plus one index. Back-fill of the existing
-- 42 published principle pages happens via kernel-markdown frontmatter edits
-- and seed re-run, not via DML in this migration.
--
-- Spec: docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md (§8A, §9.2)
-- Plan: docs/superpowers/plans/2026-05-12-principles-as-wiki-kind.md (Phase A, Task A.2)
--
-- Additive only. Existing pages and call sites are unaffected — the new column
-- is nullable and the array column defaults to empty.

-- ─── Consumer-archetype columns ─────────────────────────────────────────────

ALTER TABLE "WikiPage" ADD COLUMN "principleConsumerArchetype" TEXT;
ALTER TABLE "WikiPage" ADD COLUMN "principleConsumerContexts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- ─── Index ──────────────────────────────────────────────────────────────────

CREATE INDEX "WikiPage_principleConsumerArchetype_idx" ON "WikiPage"("principleConsumerArchetype");
