-- BI-8CCF7F13 — rebuild every collation-sensitive btree index so it agrees with
-- the comparator the database actually runs today.
--
-- ROOT CAUSE (this is the migration the six per-table repairs of 2026-07-20 were
-- each a symptom of). The cluster was initdb'd under Alpine/musl, which ships no
-- locale data, so every text column sorted with C semantics regardless of the
-- en_US.utf8 label in pg_database.datcollate. docker/postgres/Dockerfile later
-- moved to a Debian/glibc pgvector base (BI-A35347E4 / BI-4796D52B) — correct on
-- its own terms, but glibc DOES implement en_US.utf8, so the text comparator
-- changed underneath an existing pgdata volume. Every text btree built before
-- that move is ordered by the old comparator and searched by the new one.
--
-- Proof at the value level: Principal_principalId_key physically stores
-- 'PRN-f284...' before 'principal_edge_017...', which is C ordering ('P' < 'p').
-- The live database collation orders them the other way.
--
-- CONSEQUENCE. Lookups descend into the wrong subtree and miss rows that exist in
-- the heap. On a UNIQUE index that means the constraint silently stops rejecting
-- duplicates: an upsert misses the existing row, falls through to CREATE, and the
-- insert is not rejected for the same reason. One seed run produced 17 duplicate
-- AI coworkers over rows first created six weeks earlier. On a non-unique index
-- it means filtered queries silently return incomplete results.
--
-- SCOPE OF THIS MIGRATION. Rebuild only — it changes no data. A REINDEX rebuilds
-- the index with the current comparator, which is exactly the repair needed.
-- Rebuilding an already-healthy index is harmless, so this is deliberately
-- data-driven rather than a hardcoded list: every install has its own corrupted
-- set depending on when its volume was created, and a list would go stale.
--
-- Indexes are filtered to those with at least one collatable key column. A
-- comparator flip cannot affect an index with no text in its key, and on the
-- install where this was diagnosed the correlation was exact: 21 of 1031
-- collatable-key unique indexes corrupted, 0 of 3 non-collatable.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO. A unique index that already holds
-- duplicate rows cannot be rebuilt — the rebuild fails on the duplicate. Those
-- indexes are caught per-index, left alone, and reported as a WARNING naming each
-- one. They need dedupe migrations with per-table judgement about which row wins
-- and what merges, which is emphatically not safe to generalise: Agent carries 23
-- inbound foreign keys, SkillDefinition's four inbound keys reference the natural
-- key rather than the id, and nearly every relation is ON DELETE CASCADE — so
-- deleting a duplicate parent would destroy children belonging to the survivor.
-- Those are tracked separately and follow this migration.
--
-- Fails closed only on genuinely unexpected errors; a duplicate-blocked index is
-- an expected, reported outcome and must not wedge the forward-only chain for the
-- whole fleet.

BEGIN;

DO $$
DECLARE
  target RECORD;
  rebuilt_count int := 0;
  blocked text[] := '{}';
BEGIN
  FOR target IN
    SELECT c.relname AS index_name, t.relname AS table_name, i.indisunique AS is_unique
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND c.relam = (SELECT oid FROM pg_am WHERE amname = 'btree')
      AND i.indisvalid
      AND EXISTS (
        SELECT 1
        FROM pg_attribute a
        WHERE a.attrelid = i.indexrelid
          AND a.attnum > 0
          AND a.attcollation <> 0
      )
    ORDER BY t.relname, c.relname
  LOOP
    BEGIN
      EXECUTE format('REINDEX INDEX public.%I', target.index_name);
      rebuilt_count := rebuilt_count + 1;
    EXCEPTION
      WHEN unique_violation THEN
        -- Expected for a unique index whose broken comparator already let
        -- duplicates in. Report it; a dedupe migration handles the data.
        blocked := blocked || format('%s.%s', target.table_name, target.index_name);
      WHEN others THEN
        RAISE EXCEPTION 'collation-drift rebuild failed on %.%: %',
          target.table_name, target.index_name, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'collation-drift rebuild: % index(es) rebuilt', rebuilt_count;

  IF array_length(blocked, 1) > 0 THEN
    RAISE WARNING
      'collation-drift rebuild: % index(es) still hold duplicate rows and were NOT rebuilt: %. '
      'Until each is deduped and rebuilt, its UNIQUE constraint cannot reject new duplicates. '
      'Read those tables with enable_indexscan=off — an index scan will not show the duplicates.',
      array_length(blocked, 1), array_to_string(blocked, ', ');
  END IF;
END $$;

COMMIT;
