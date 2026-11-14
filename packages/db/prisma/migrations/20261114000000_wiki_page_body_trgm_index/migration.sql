-- BI-FC5E4832 (EP-0237A305, spec docs/superpowers/specs/2026-10-14-knowledge-linking-design.md §4.3).
--
-- A GIN trigram index on WikiPage.body. The wiki page's "Unlinked mentions"
-- lookup (apps/web/lib/wiki/backlinks.ts loadUnlinkedMentions) runs one
-- case-insensitive contains per mention term, which Prisma compiles to
-- body ILIKE '%term%'. gin_trgm_ops serves ILIKE directly, so the query needs
-- no change; the planner switches from the sequential scan to this index as
-- the wiki grows.
--
-- Fleet-safety: additive index only. No column, constraint or row changes.
-- pg_trgm is already installed by 20260704120000; IF NOT EXISTS keeps both
-- statements safe to re-run. On the dev install (385 pages) the index is
-- about 1 MB and builds in well under a second.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "WikiPage_body_trgm_idx" ON "WikiPage" USING gin ("body" gin_trgm_ops);
