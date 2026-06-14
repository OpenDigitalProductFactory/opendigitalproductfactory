-- Universal Grid & Workbooks — link-to-many (linked records) substrate.
-- See docs/superpowers/plans/2026-06-13-universal-grid-workbooks-link-to-many.md.
-- Additive only: a first-class join table so a (row, column) cell can link to many
-- target records (1-M / M-M). The single-valued `reference` columns on
-- WorkbookCell are untouched.

-- CreateTable
CREATE TABLE "WorkbookCellLink" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkbookCellLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkbookCellLink_columnId_referenceId_idx" ON "WorkbookCellLink"("columnId", "referenceId");

-- CreateIndex
CREATE INDEX "WorkbookCellLink_rowId_columnId_idx" ON "WorkbookCellLink"("rowId", "columnId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkbookCellLink_rowId_columnId_referenceId_key" ON "WorkbookCellLink"("rowId", "columnId", "referenceId");

-- AddForeignKey
ALTER TABLE "WorkbookCellLink" ADD CONSTRAINT "WorkbookCellLink_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "WorkbookRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbookCellLink" ADD CONSTRAINT "WorkbookCellLink_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "WorkbookColumn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
