-- E-signature (Phase 1): in-platform signature capture for invoices.
-- Adds the signature requirement gate + captured-signature fields to Invoice.
-- All additive and backward-compatible: existing invoices default to
-- signatureRequired = false (unchanged "no-signature" flow).

ALTER TABLE "Invoice" ADD COLUMN "signatureRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Invoice" ADD COLUMN "signedAt" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN "signedByName" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "signedByEmail" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "signatureDataUrl" TEXT;
