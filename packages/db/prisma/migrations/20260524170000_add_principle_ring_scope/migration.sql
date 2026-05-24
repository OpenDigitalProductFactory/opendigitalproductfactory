-- Add principleRingScope column to WikiPage.
--
-- Spec: docs/superpowers/specs/2026-05-24-founder-kernel-evolution-discipline-design.md §3
-- BI:   BI-4AA1074B (Slice 1 — foundation)
-- Parent: BI-746268A1 (closed; merged via PR #1081)
--
-- Additive column add. Pre-existing principle rows default to '{}'
-- (empty array) so no current behavior changes; the Slice 3 backfill BI
-- assigns explicit ring scope to all 58 pre-existing principles.
--
-- Ring-scope values are validated against the closed
-- `PRINCIPLE_RING_SCOPES` enum at the application layer (seed walker +
-- store) — we do NOT add a Postgres CHECK constraint here because the
-- enum may grow via future spec PRs and tightening the DB constraint
-- would force a coordinated migration on every kernel growth. The
-- application-layer check throws on unknown values per
-- make-silent-failures-observable.

ALTER TABLE "WikiPage"
  ADD COLUMN "principleRingScope" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
