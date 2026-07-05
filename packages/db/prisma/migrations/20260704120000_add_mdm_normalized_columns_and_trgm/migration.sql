-- MDM write-time dedup foundation (EP-4A12A7CB WG-1, spec
-- docs/superpowers/specs/2026-07-04-mdm-write-time-dedup-and-lifecycle-design.md §5.2).
--
-- Adds persisted normalized identity columns for duplicate-candidate
-- generation, the pg_trgm extension + GIN trigram index for fuzzy name
-- blocking, and the per-account site-name partial unique index.
--
-- Fleet-safety: every ADD COLUMN carries a DEFAULT (no NOT NULL gap); the
-- backfill UPDATEs are idempotent; duplicate site names are remediated BEFORE
-- the partial unique index is created (remediate-before-constraint per
-- AGENTS.md §2). The SQL normalization below is a deliberate approximation of
-- apps/web/lib/mdm/standardize.ts (lowercase, strip punctuation, drop legal
-- suffixes, collapse whitespace); the TS form is canonical and the dedup gate
-- rewrites the column on every create/update, so any residual divergence
-- self-heals as rows are touched.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Columns ──────────────────────────────────────────────────────────────────
ALTER TABLE "CustomerAccount" ADD COLUMN "nameNormalized" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CustomerAccount" ADD COLUMN "domainNormalized" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CustomerSite" ADD COLUMN "nameNormalized" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CustomerContact" ADD COLUMN "nameNormalized" TEXT NOT NULL DEFAULT '';

-- ── Backfill (idempotent; SQL approximation of standardizeName/Domain) ──────
UPDATE "CustomerAccount"
SET "nameNormalized" = btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            replace(lower("name"), '&', ' and '),
            '[.,''"`()\-_/]', ' ', 'g'
          ),
          '\m(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|pty|group|holdings)\M', ' ', 'g'
        ),
        '\s+', ' ', 'g'
      )
    )
WHERE "name" IS NOT NULL;

UPDATE "CustomerAccount"
SET "domainNormalized" = split_part(
      split_part(
        regexp_replace(regexp_replace(lower(btrim("website")), '^[a-z]+://', ''), '^www\.', ''),
        '/', 1
      ),
      '?', 1
    )
WHERE "website" IS NOT NULL AND btrim("website") <> '';

UPDATE "CustomerSite"
SET "nameNormalized" = btrim(
      regexp_replace(
        regexp_replace(replace(lower("name"), '&', ' and '), '[.,''"`()\-_/]', ' ', 'g'),
        '\s+', ' ', 'g'
      )
    )
WHERE "name" IS NOT NULL;

UPDATE "CustomerContact"
SET "nameNormalized" = btrim(
      regexp_replace(
        regexp_replace(
          replace(lower(COALESCE(NULLIF(btrim(concat_ws(' ', "firstName", "lastName")), ''), "name", '')), '&', ' and '),
          '[.,''"`()\-_/]', ' ', 'g'
        ),
        '\s+', ' ', 'g'
      )
    );

-- ── Remediation BEFORE constraint (fleet-safe) ───────────────────────────────
-- Two active sites in one account with the same normalized name would violate
-- the partial unique index below. Suffix later-created duplicates so the
-- constraint applies cleanly on any existing data state; the rename is
-- surfaced in the site name itself (visible, not silent data loss).
DO $$
DECLARE
  dup RECORD;
  n INTEGER;
BEGIN
  FOR dup IN
    SELECT "accountId", "nameNormalized"
    FROM "CustomerSite"
    WHERE "nameNormalized" <> '' AND "status" <> 'superseded'
    GROUP BY "accountId", "nameNormalized"
    HAVING count(*) > 1
  LOOP
    n := 1;
    -- Keep the earliest row untouched; suffix the rest deterministically.
    UPDATE "CustomerSite" s
    SET "name" = s."name" || ' (' || sub.rn || ')',
        "nameNormalized" = s."nameNormalized" || ' ' || sub.rn
    FROM (
      SELECT id, row_number() OVER (ORDER BY "createdAt", id) AS rn
      FROM "CustomerSite"
      WHERE "accountId" = dup."accountId"
        AND "nameNormalized" = dup."nameNormalized"
        AND "status" <> 'superseded'
    ) sub
    WHERE s.id = sub.id AND sub.rn > 1;
  END LOOP;
END $$;

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX "CustomerAccount_nameNormalized_idx" ON "CustomerAccount"("nameNormalized");
CREATE INDEX "CustomerAccount_domainNormalized_idx" ON "CustomerAccount"("domainNormalized");
CREATE INDEX "CustomerContact_nameNormalized_idx" ON "CustomerContact"("nameNormalized");

-- Trigram index for fuzzy candidate generation (similarity() blocking).
CREATE INDEX "CustomerAccount_nameNormalized_trgm" ON "CustomerAccount" USING gin ("nameNormalized" gin_trgm_ops);

-- Per-account active-site name uniqueness (remediated above).
CREATE UNIQUE INDEX "CustomerSite_accountId_nameNormalized_active"
  ON "CustomerSite"("accountId", "nameNormalized")
  WHERE "status" <> 'superseded' AND "nameNormalized" <> '';
