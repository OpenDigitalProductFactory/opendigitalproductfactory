-- @migration-safety: data-safe: creates a new empty table, index, and foreign key; no existing row is tightened or rewritten.

-- CreateTable
CREATE TABLE "OperationalSceneLayout" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "twinTemplate" TEXT NOT NULL,
    "spaceKind" TEXT NOT NULL,
    "locationId" TEXT,
    "label" TEXT NOT NULL,
    "layoutState" JSONB NOT NULL,
    "underlayRef" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationalSceneLayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperationalSceneLayout_orgId_twinTemplate_idx"
ON "OperationalSceneLayout"("orgId", "twinTemplate");

-- AddForeignKey
ALTER TABLE "OperationalSceneLayout"
ADD CONSTRAINT "OperationalSceneLayout_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "Organization"("orgId")
ON DELETE CASCADE ON UPDATE CASCADE;
