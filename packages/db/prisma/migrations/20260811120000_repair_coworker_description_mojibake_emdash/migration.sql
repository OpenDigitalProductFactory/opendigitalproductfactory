-- Corrective migration: repair the mojibake em-dash in coworker descriptions.
--
-- Root cause: packages/db/data/agent_registry.json stored em-dashes as the
-- CP1252-mangled UTF-8 sequence (JSON-escaped â€”), which seeded
-- the three mojibake code points  U+00E2 (a-circumflex) · U+20AC (euro) ·
-- U+201D (right double quote)  into Agent.description. On the Coworker Identity
-- 360 they render as the garbled run seen in "five build phases <mojibake>
-- Ideate". The registry source is now fixed (that sequence -> —), so NEW
-- installs are clean; this migration repairs the rows that EXISTING installs
-- already seeded, without a re-seed.
--
-- Why this is safe on a customer install (no dataset overwrite):
--   * It edits ONE column (Agent.description) and ONLY the corrupted substring
--     inside it, via REPLACE — it never rewrites a row from the seed, so an
--     operator-edited description keeps its edits.
--   * It touches ONLY rows that still contain the exact mojibake sequence
--     (the WHERE guard), so a clean install — or a description an operator
--     already corrected — matches zero rows.
--   * It is idempotent: after it runs (or on an install that was never
--     corrupted) the sequence is gone, so re-running is a no-op.
--   * chr() code points are used instead of literal bytes so the intended
--     characters are unambiguous regardless of file/editor encoding.
--
-- @migration-safety: data-safe: in-place substring repair of a text column,
-- scoped by a WHERE guard to only the affected rows; no schema change, no
-- deletes, no overwrite of unaffected or operator-edited data; idempotent.

UPDATE "Agent"
SET "description" = REPLACE(
      "description",
      chr(226) || chr(8364) || chr(8221),  -- â € ”  (the mojibake em-dash)
      chr(8212)                             -- —      (U+2014 EM DASH)
    )
WHERE "description" LIKE '%' || chr(226) || chr(8364) || chr(8221) || '%';
