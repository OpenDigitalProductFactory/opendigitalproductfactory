-- Public accept-link token for quotes (mirrors Invoice.payToken): possession
-- authorizes the customer to view and accept the quote at /s/quote/[token].
-- Nullable add; the unique index over all-NULL existing rows is trivially satisfied.

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "acceptToken" TEXT;

-- CreateIndex
-- @migration-safety: data-safe: acceptToken is added as a nullable column in this same migration, so every pre-existing Quote row holds NULL; Postgres unique indexes permit any number of NULLs, so the index cannot fail on existing data.
CREATE UNIQUE INDEX "Quote_acceptToken_key" ON "Quote"("acceptToken");
