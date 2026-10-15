-- BI-911840CB (EP-PORTFOLIO-BUDGET-WIP): the contraction that offsets the two
-- models budget slices 3 and 4 added (PortfolioBudgetPeriod, BudgetReservation).
-- Retires two persistent models that no live code reads or writes:
--
--   VoiceTrainingJob  unwritten since the Chatterbox zero-shot cut-over
--                     (docs/superpowers/specs/2026-05-21-chatterbox-tts-self-hosted.md
--                     planned this drop; the schema kept it "for
--                     schema-regression-guard compliance").
--   ExamVoucher       leaf of the course-management schema whose pages and
--                     actions were reverted the night they landed (c2dbf25679);
--                     nothing has read or written it since.
--
-- Applies against any data state (AGENTS.md section 2):
--   * table absent      -> nothing to do;
--   * table empty       -> DROP TABLE;
--   * table holds rows  -> never dropped. Renamed to <name>_retired_bi911840cb,
--     rows intact, with its indexes renamed so the original names are free and a
--     comment recording why. The archive sits outside the Prisma schema, so no
--     application path reads it; an operator can still recover it.
--
-- @migration-safety: data-safe: no row is deleted; a populated table is archived, only an empty one is dropped.

DO $$
DECLARE
  t TEXT;
  archive TEXT;
  has_rows BOOLEAN;
  idx RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY['VoiceTrainingJob', 'ExamVoucher'] LOOP
    IF to_regclass(format('%I', t)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I)', t) INTO has_rows;

    IF NOT has_rows THEN
      EXECUTE format('DROP TABLE %I', t);
      CONTINUE;
    END IF;

    archive := t || '_retired_bi911840cb';
    EXECUTE format('ALTER TABLE %I RENAME TO %I', t, archive);

    FOR idx IN
      SELECT i.relname AS name
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
       WHERE x.indrelid = to_regclass(format('%I', archive))
         AND left(i.relname, length(t) + 1) = t || '_'
    LOOP
      EXECUTE format(
        'ALTER INDEX %I RENAME TO %I',
        idx.name,
        left(archive || substr(idx.name, length(t) + 1), 63)
      );
    END LOOP;

    EXECUTE format(
      'COMMENT ON TABLE %I IS %L',
      archive,
      'Retired by BI-911840CB on 2026-10-06: model ' || t
        || ' left the Prisma schema with rows still present, so they were archived here instead of dropped. No application path reads this table.'
    );
  END LOOP;
END $$;
