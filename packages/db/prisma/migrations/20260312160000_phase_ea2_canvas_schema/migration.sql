-- DropForeignKey
ALTER TABLE "EaViewElement" DROP CONSTRAINT "EaViewElement_viewId_fkey";

-- AlterTable
ALTER TABLE "EaView" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "canvasState" JSONB,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'draft',
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedById" TEXT,
ADD COLUMN     "viewpointId" TEXT;

-- AlterTable
ALTER TABLE "EaViewElement" DROP CONSTRAINT "EaViewElement_pkey",
DROP COLUMN "height",
DROP COLUMN "width",
DROP COLUMN "x",
DROP COLUMN "y",
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'new',
ADD COLUMN     "proposedProperties" JSONB,
ADD CONSTRAINT "EaViewElement_pkey" PRIMARY KEY ("id");

-- CreateTable
CREATE TABLE "ViewpointDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "allowedElementTypeSlugs" TEXT[],
    "allowedRelTypeSlugs" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ViewpointDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaSnapshot" (
    "id" TEXT NOT NULL,
    "viewId" TEXT NOT NULL,
    "approvedById" TEXT,
    "submittedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "changeSummary" TEXT,
    "elementCount" INTEGER NOT NULL,
    "relationshipCount" INTEGER NOT NULL,
    "graphJson" JSONB NOT NULL,

    CONSTRAINT "EaSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ViewpointDefinition_name_key" ON "ViewpointDefinition"("name");

-- CreateIndex
CREATE UNIQUE INDEX "EaViewElement_viewId_elementId_key" ON "EaViewElement"("viewId", "elementId");

-- AddForeignKey
ALTER TABLE "EaView" ADD CONSTRAINT "EaView_viewpointId_fkey" FOREIGN KEY ("viewpointId") REFERENCES "ViewpointDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaViewElement" ADD CONSTRAINT "EaViewElement_viewId_fkey" FOREIGN KEY ("viewId") REFERENCES "EaView"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaSnapshot" ADD CONSTRAINT "EaSnapshot_viewId_fkey" FOREIGN KEY ("viewId") REFERENCES "EaView"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
