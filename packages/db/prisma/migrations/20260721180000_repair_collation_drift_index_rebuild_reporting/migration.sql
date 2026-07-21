-- BI-9C21A7E4 — re-run the collation-drift index rebuild, and REPORT per-index
-- failures instead of aborting the whole migration on the first one.
--
-- WHY THIS EXISTS. 20260720190000_repair_collation_drift_index_rebuild is the
-- right repair with one fatal flaw in its error handling:
--
--     EXCEPTION
--       WHEN unique_violation THEN blocked := blocked || ...;   -- reported
--       WHEN others THEN RAISE EXCEPTION '...';                 -- aborts EVERYTHING
--
-- A single index failing for any reason other than a duplicate key aborts the
-- surrounding transaction. Postgres then rejects every later statement with
-- "current transaction is aborted, commands ignored until end of transaction
-- block" — and THAT is the error Prisma surfaces, from the trailing COMMIT.
-- The RAISE's own message, which names the index and the real SQLSTATE, is
-- never seen. On a live install this wedged the forward-only chain in P3009 and
-- the actual cause stayed invisible for three days while every subsequent
-- self-upgrade failed identically. Its own header says it "must not wedge the
-- forward-only chain for the whole fleet"; the handler defeated that intent.
--
-- Migrations are immutable, so this is a NEW migration rather than an edit.
--
-- WHO NEEDS IT. Any install whose pgdata was initdb'd under Alpine/musl (which
-- ships no locale data, so every text column sorted with C semantics) and is now
-- served by the Debian/glibc pgvector base (BI-A35347E4 / BI-4796D52B), which
-- DOES implement en_US.utf8. Detectable exactly:
--
--     SELECT datcollversion, pg_database_collation_actual_version(oid) FROM pg_database;
--     -- drifted install: stored NULL, actual '2.36'
--
-- This is NOT operating-system specific — it is pgdata lineage. A newer install
-- on any OS, created after the base-image move, has a matching collation version
-- and no corrupt indexes; this migration is then a no-op rebuild. An older
-- install on any OS is exposed. On the install where this was diagnosed the
-- consequence was measurable: 18 duplicate "Agent"."agentId" values sitting
-- behind a UNIQUE index that could no longer reject them, because an upsert's
-- index probe descends the wrong subtree, misses the existing row, and falls
-- through to INSERT.
--
-- SCOPE. Rebuild only — changes no data. Rebuilding an already-healthy index is
-- harmless, so the index set stays data-driven rather than a hardcoded list:
-- every install has its own corrupted subset depending on when its volume was
-- created, and a list would go stale.
--
-- FAILURE POLICY (the whole point of this migration). Every per-index failure is
-- caught, recorded, and reported by name with its SQLSTATE. NOTHING re-raises.
-- A duplicate-blocked unique index is expected (its data needs a dedupe
-- migration with per-table judgement) and must not stop the other 1000 indexes
-- from being repaired. An unexpected error is equally not a reason to wedge the
-- fleet's upgrade chain — it is a reason to tell the operator exactly which
-- index and exactly which error, and let the rest of the repair land.

-- WHAT ACTUALLY FAILED, measured. Re-running the original's loop against the
-- drifted install in a rolled-back transaction (the diagnostic the original made
-- impossible) reported:
--
--     rebuilt=2201  duplicate_blocked=2  unexpected=3
--     DUP-BLOCKED: InventoryEntity_entityKey_key, PlatformIssueReport_dedupeKey_open_key
--     UNEXPECTED:  VoiceProfile_pkey | VoiceProfile_profileId_key | VoiceProfile_status_idx
--                  [40P01: deadlock detected]
--
-- A DEADLOCK. The TTS sidecar writes VoiceProfile while the rebuild holds locks,
-- so three indexes lost a lock race — the single most transient, most retryable
-- error Postgres has. The original turned that momentary contention into a
-- three-day fleet-wide upgrade wedge, because `WHEN others` re-raised it.
--
-- So reporting alone is not enough: deadlock_detected is RETRIED, bounded, with
-- the retry scoped to the one index that lost the race. Only a deadlock that
-- survives every attempt is reported and stepped over.

BEGIN;

DO $$
DECLARE
  target RECORD;
  rebuilt_count int := 0;
  duplicate_blocked text[] := '{}';
  unexpected text[] := '{}';
  attempt int;
  rebuilt_this_index boolean;
  -- Small: a deadlock resolves as soon as the competing writer commits, and each
  -- attempt re-takes the lock. More attempts would extend the lock window for no
  -- benefit — anything still deadlocking after this is contention worth naming.
  max_deadlock_attempts constant int := 3;
BEGIN
  FOR target IN
    SELECT c.relname AS index_name, t.relname AS table_name
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
    rebuilt_this_index := false;
    FOR attempt IN 1..max_deadlock_attempts LOOP
      BEGIN
        EXECUTE format('REINDEX INDEX public.%I', target.index_name);
        rebuilt_count := rebuilt_count + 1;
        rebuilt_this_index := true;
        EXIT;
      EXCEPTION
        WHEN unique_violation THEN
          -- Expected: the broken comparator already let duplicates in, so the
          -- rebuild cannot enforce uniqueness. The data needs a dedupe migration.
          duplicate_blocked := duplicate_blocked
            || format('%s.%s', target.table_name, target.index_name);
          EXIT;
        WHEN deadlock_detected THEN
          -- Measured reality on the drifted install: a concurrent writer (the TTS
          -- sidecar on VoiceProfile) beat the rebuild to the lock. Retry this one
          -- index; the competing transaction has since committed or aborted.
          IF attempt = max_deadlock_attempts THEN
            unexpected := unexpected
              || format('%s.%s [%s after %s attempts: %s]',
                        target.table_name, target.index_name, SQLSTATE, attempt, SQLERRM);
          END IF;
        WHEN others THEN
          -- Deliberately NOT re-raised. This is the line whose absence cost three
          -- days: record which index and which error, then keep going.
          unexpected := unexpected
            || format('%s.%s [%s: %s]', target.table_name, target.index_name, SQLSTATE, SQLERRM);
          EXIT;
      END;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'collation-drift rebuild: % index(es) rebuilt', rebuilt_count;

  IF array_length(duplicate_blocked, 1) > 0 THEN
    RAISE WARNING
      'collation-drift rebuild: % index(es) still hold duplicate rows and were NOT rebuilt: %. '
      'Until each is deduped and rebuilt, its UNIQUE constraint cannot reject new duplicates. '
      'Read those tables with enable_indexscan=off — an index scan will not show the duplicates.',
      array_length(duplicate_blocked, 1), array_to_string(duplicate_blocked, ', ');
  END IF;

  IF array_length(unexpected, 1) > 0 THEN
    RAISE WARNING
      'collation-drift rebuild: % index(es) failed for an UNEXPECTED reason and were NOT rebuilt: %. '
      'The chain is deliberately NOT wedged on these — each is named with its SQLSTATE so it can be '
      'repaired directly. Re-running this rebuild after the fix is safe and idempotent.',
      array_length(unexpected, 1), array_to_string(unexpected, ' | ');
  END IF;
END $$;

COMMIT;
