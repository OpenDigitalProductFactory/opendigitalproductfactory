-- CreateTable
CREATE TABLE "EaNotation" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,

    CONSTRAINT "EaNotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaElementType" (
    "id" TEXT NOT NULL,
    "notationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "neoLabel" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "description" TEXT,
    "validLifecycleStages" TEXT[],
    "validLifecycleStatuses" TEXT[],

    CONSTRAINT "EaElementType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaRelationshipType" (
    "id" TEXT NOT NULL,
    "notationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "neoType" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "EaRelationshipType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaRelationshipRule" (
    "id" TEXT NOT NULL,
    "fromElementTypeId" TEXT NOT NULL,
    "toElementTypeId" TEXT NOT NULL,
    "relationshipTypeId" TEXT NOT NULL,

    CONSTRAINT "EaRelationshipRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaDqRule" (
    "id" TEXT NOT NULL,
    "notationId" TEXT NOT NULL,
    "elementTypeId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "lifecycleStage" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'error',
    "rule" JSONB NOT NULL,

    CONSTRAINT "EaDqRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaElement" (
    "id" TEXT NOT NULL,
    "elementTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "lifecycleStage" TEXT NOT NULL DEFAULT 'plan',
    "lifecycleStatus" TEXT NOT NULL DEFAULT 'draft',
    "createdById" TEXT,
    "digitalProductId" TEXT,
    "infraCiKey" TEXT,
    "portfolioId" TEXT,
    "taxonomyNodeId" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EaElement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaRelationship" (
    "id" TEXT NOT NULL,
    "fromElementId" TEXT NOT NULL,
    "toElementId" TEXT NOT NULL,
    "relationshipTypeId" TEXT NOT NULL,
    "notationSlug" TEXT NOT NULL,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EaRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaView" (
    "id" TEXT NOT NULL,
    "notationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "layoutType" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeRef" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EaView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaViewElement" (
    "viewId" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,

    CONSTRAINT "EaViewElement_pkey" PRIMARY KEY ("viewId","elementId")
);

-- CreateIndex
CREATE UNIQUE INDEX "EaNotation_slug_key" ON "EaNotation"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "EaElementType_notationId_slug_key" ON "EaElementType"("notationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "EaRelationshipType_notationId_slug_key" ON "EaRelationshipType"("notationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "EaRelationshipRule_fromElementTypeId_toElementTypeId_relati_key" ON "EaRelationshipRule"("fromElementTypeId", "toElementTypeId", "relationshipTypeId");

-- AddForeignKey
ALTER TABLE "EaElementType" ADD CONSTRAINT "EaElementType_notationId_fkey" FOREIGN KEY ("notationId") REFERENCES "EaNotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaRelationshipType" ADD CONSTRAINT "EaRelationshipType_notationId_fkey" FOREIGN KEY ("notationId") REFERENCES "EaNotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaRelationshipRule" ADD CONSTRAINT "EaRelationshipRule_fromElementTypeId_fkey" FOREIGN KEY ("fromElementTypeId") REFERENCES "EaElementType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaRelationshipRule" ADD CONSTRAINT "EaRelationshipRule_toElementTypeId_fkey" FOREIGN KEY ("toElementTypeId") REFERENCES "EaElementType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaRelationshipRule" ADD CONSTRAINT "EaRelationshipRule_relationshipTypeId_fkey" FOREIGN KEY ("relationshipTypeId") REFERENCES "EaRelationshipType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaDqRule" ADD CONSTRAINT "EaDqRule_notationId_fkey" FOREIGN KEY ("notationId") REFERENCES "EaNotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaDqRule" ADD CONSTRAINT "EaDqRule_elementTypeId_fkey" FOREIGN KEY ("elementTypeId") REFERENCES "EaElementType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaElement" ADD CONSTRAINT "EaElement_elementTypeId_fkey" FOREIGN KEY ("elementTypeId") REFERENCES "EaElementType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaElement" ADD CONSTRAINT "EaElement_digitalProductId_fkey" FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaElement" ADD CONSTRAINT "EaElement_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaElement" ADD CONSTRAINT "EaElement_taxonomyNodeId_fkey" FOREIGN KEY ("taxonomyNodeId") REFERENCES "TaxonomyNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaRelationship" ADD CONSTRAINT "EaRelationship_fromElementId_fkey" FOREIGN KEY ("fromElementId") REFERENCES "EaElement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaRelationship" ADD CONSTRAINT "EaRelationship_toElementId_fkey" FOREIGN KEY ("toElementId") REFERENCES "EaElement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaRelationship" ADD CONSTRAINT "EaRelationship_relationshipTypeId_fkey" FOREIGN KEY ("relationshipTypeId") REFERENCES "EaRelationshipType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaView" ADD CONSTRAINT "EaView_notationId_fkey" FOREIGN KEY ("notationId") REFERENCES "EaNotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaViewElement" ADD CONSTRAINT "EaViewElement_viewId_fkey" FOREIGN KEY ("viewId") REFERENCES "EaView"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaViewElement" ADD CONSTRAINT "EaViewElement_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "EaElement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
