-- Add stewardship metadata so user-created towns/cities are not silently
-- promoted into canonical active reference data.
ALTER TABLE "City"
  ADD COLUMN "nameNormalized" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "localityType" TEXT NOT NULL DEFAULT 'city',
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'seed',
  ADD COLUMN "sourceProvider" TEXT,
  ADD COLUMN "sourceRef" TEXT,
  ADD COLUMN "confidence" DECIMAL(5,4),
  ADD COLUMN "disambiguator" TEXT,
  ADD COLUMN "addedByUserId" TEXT;

UPDATE "City"
SET "nameNormalized" = lower(regexp_replace(trim("name"), '\s+', ' ', 'g'))
WHERE "nameNormalized" = '';

ALTER TABLE "City"
  ADD CONSTRAINT "City_addedByUserId_fkey"
  FOREIGN KEY ("addedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "City_regionId_nameNormalized_idx" ON "City"("regionId", "nameNormalized");
CREATE INDEX "City_source_idx" ON "City"("source");
CREATE INDEX "City_addedByUserId_idx" ON "City"("addedByUserId");

-- Common case: same normalized name cannot appear twice in a region unless a
-- steward explicitly disambiguates the records.
CREATE UNIQUE INDEX "City_regionId_nameNormalized_unique_pending"
  ON "City"("regionId", "nameNormalized")
  WHERE "disambiguator" IS NULL;

CREATE UNIQUE INDEX "City_regionId_nameNormalized_disambiguator_unique"
  ON "City"("regionId", "nameNormalized", "disambiguator")
  WHERE "disambiguator" IS NOT NULL;
