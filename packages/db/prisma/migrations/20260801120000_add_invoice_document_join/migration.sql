-- Binds an immutable document snapshot to the invoice it was produced for.
-- Kernel decision DI-763E5529F491 chose a typed join over a polymorphic owner
-- column on Document, so this carries real foreign keys and cascade semantics.

CREATE TABLE "InvoiceDocument" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'sent-copy',
    "revision" INTEGER NOT NULL,
    "sentToEmail" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceDocument_invoiceId_role_revision_key"
    ON "InvoiceDocument"("invoiceId", "role", "revision");
CREATE INDEX "InvoiceDocument_invoiceId_idx" ON "InvoiceDocument"("invoiceId");
CREATE INDEX "InvoiceDocument_documentVersionId_idx" ON "InvoiceDocument"("documentVersionId");
CREATE INDEX "InvoiceDocument_createdAt_idx" ON "InvoiceDocument"("createdAt");

-- Deleting a draft invoice takes its (empty) snapshot rows with it.
ALTER TABLE "InvoiceDocument" ADD CONSTRAINT "InvoiceDocument_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT, not CASCADE: a snapshot the customer received must not disappear
-- because someone tidied up the document store.
ALTER TABLE "InvoiceDocument" ADD CONSTRAINT "InvoiceDocument_documentVersionId_fkey"
    FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvoiceDocument" ADD CONSTRAINT "InvoiceDocument_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
