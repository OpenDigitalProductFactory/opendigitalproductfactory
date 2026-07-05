-- Customer-domain merge lifecycle (EP-4A12A7CB WG-4, spec §5.3-5.4).
--
-- Adds the merge tombstone pointer to CustomerAccount and CustomerSite. New
-- status values (`superseded`, `archived`) need no migration — status is a
-- string column; the canonical union lives in
-- packages/db/src/customer-lifecycle.ts.
--
-- @migration-safety: data-safe: additive nullable columns + FKs referencing
-- the same table's primary key; no existing row can violate them.

ALTER TABLE "CustomerAccount" ADD COLUMN "mergedIntoId" TEXT;
ALTER TABLE "CustomerSite" ADD COLUMN "mergedIntoId" TEXT;

ALTER TABLE "CustomerAccount"
  ADD CONSTRAINT "CustomerAccount_mergedIntoId_fkey"
  FOREIGN KEY ("mergedIntoId") REFERENCES "CustomerAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CustomerSite"
  ADD CONSTRAINT "CustomerSite_mergedIntoId_fkey"
  FOREIGN KEY ("mergedIntoId") REFERENCES "CustomerSite"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CustomerAccount_mergedIntoId_idx" ON "CustomerAccount"("mergedIntoId");
CREATE INDEX "CustomerSite_mergedIntoId_idx" ON "CustomerSite"("mergedIntoId");
