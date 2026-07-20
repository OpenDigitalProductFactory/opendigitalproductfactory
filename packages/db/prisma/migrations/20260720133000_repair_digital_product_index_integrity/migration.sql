-- BI-BCF8A8D5 — restore agreement between the DigitalProduct heap and its
-- canonical unique productId index. Affected installs can contain duplicate
-- heap rows even while pg_index reports the btree as unique/valid/ready.
--
-- Fleet safety: duplicate rows are quarantined, never deleted. ID-based
-- history remains attached to the same DigitalProduct.id. The two natural-key
-- foreign keys are detached before loser renames so ON UPDATE CASCADE cannot
-- move their canonical references to a quarantined row. Clean installs change
-- no data; the migration is idempotent and fails closed if duplicates remain.

BEGIN;

SET LOCAL enable_indexscan = off;
SET LOCAL enable_indexonlyscan = off;
SET LOCAL enable_bitmapscan = off;

ALTER TABLE "CoworkerService"
  DROP CONSTRAINT IF EXISTS "CoworkerService_digitalProductId_fkey";
ALTER TABLE "CoworkerOffer"
  DROP CONSTRAINT IF EXISTS "CoworkerOffer_digitalProductId_fkey";

-- Pick the oldest row as the stable canonical product. Quarantine keys include
-- the loser id and original logical key; the collision loop makes the repair
-- safe even when an install already contains a key in the reserved namespace.
DO $$
DECLARE
  duplicate_row RECORD;
  quarantine_key TEXT;
BEGIN
  FOR duplicate_row IN
    WITH ranked AS MATERIALIZED (
      SELECT
        id,
        "productId",
        row_number() OVER (
          PARTITION BY "productId"
          ORDER BY "createdAt", id
        ) AS duplicate_rank
      FROM "DigitalProduct"
    )
    SELECT id, "productId"
    FROM ranked
    WHERE duplicate_rank > 1
    ORDER BY "productId", id
  LOOP
    quarantine_key := '__dpf_quarantined__' || duplicate_row.id || '__' || duplicate_row."productId";
    WHILE EXISTS (
      SELECT 1
      FROM "DigitalProduct"
      WHERE "productId" = quarantine_key
        AND id <> duplicate_row.id
    ) LOOP
      quarantine_key := quarantine_key || '_';
    END LOOP;

    UPDATE "DigitalProduct"
    SET
      "productId" = quarantine_key,
      "lifecycleStatus" = 'retired',
      "coverageStatus" = 'quarantined',
      "updatedAt" = now()
    WHERE id = duplicate_row.id;
  END LOOP;
END $$;

-- This assertion is heap-grounded because every index scan class is disabled.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "DigitalProduct"
    GROUP BY "productId"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DigitalProduct integrity repair left duplicate productId keys';
  END IF;
END $$;

DROP INDEX IF EXISTS "DigitalProduct_productId_key";
CREATE UNIQUE INDEX "DigitalProduct_productId_key"
  ON "DigitalProduct" ("productId");

-- @migration-safety: data-safe: these same foreign keys were enforced at the
-- start of the transaction. Loser renames preserve each original productId on
-- the canonical survivor, so every existing child value still resolves.
ALTER TABLE "CoworkerService"
  ADD CONSTRAINT "CoworkerService_digitalProductId_fkey"
  FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("productId")
  ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "CoworkerOffer"
  ADD CONSTRAINT "CoworkerOffer_digitalProductId_fkey"
  FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("productId")
  ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

ALTER TABLE "CoworkerService"
  VALIDATE CONSTRAINT "CoworkerService_digitalProductId_fkey";
ALTER TABLE "CoworkerOffer"
  VALIDATE CONSTRAINT "CoworkerOffer_digitalProductId_fkey";

COMMIT;
