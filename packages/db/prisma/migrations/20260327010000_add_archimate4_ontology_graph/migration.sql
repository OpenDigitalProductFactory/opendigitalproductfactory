-- AlterTable EaElement: add ontology refinement fields
ALTER TABLE "EaElement" ADD COLUMN "refinementLevel" TEXT,
                        ADD COLUMN "itValueStream"   TEXT,
                        ADD COLUMN "ontologyRole"    TEXT;

-- AlterTable EaElementType: add extension and ontology category fields
ALTER TABLE "EaElementType" ADD COLUMN "isExtension"         BOOLEAN NOT NULL DEFAULT false,
                             ADD COLUMN "archimateExportSlug" TEXT,
                             ADD COLUMN "ontologyCategory"    TEXT;

-- CreateTable EaTraversalPattern
CREATE TABLE "EaTraversalPattern" (
    "id"                 TEXT NOT NULL,
    "notationId"         TEXT NOT NULL,
    "slug"               TEXT NOT NULL,
    "name"               TEXT NOT NULL,
    "description"        TEXT,
    "patternType"        TEXT NOT NULL,
    "steps"              JSONB NOT NULL,
    "forbiddenShortcuts" JSONB NOT NULL DEFAULT '[]',
    "status"             TEXT NOT NULL DEFAULT 'active',
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EaTraversalPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable EaFrameworkMapping
CREATE TABLE "EaFrameworkMapping" (
    "id"                   TEXT NOT NULL,
    "elementTypeId"        TEXT NOT NULL,
    "frameworkSlug"        TEXT NOT NULL,
    "nativeConceptName"    TEXT NOT NULL,
    "mappingType"          TEXT NOT NULL,
    "semanticDisparity"    TEXT,
    "influenceOpportunity" TEXT,
    "exchangeOpportunity"  BOOLEAN NOT NULL DEFAULT false,
    "notes"                TEXT,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EaFrameworkMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EaTraversalPattern_notationId_slug_key" ON "EaTraversalPattern"("notationId", "slug");
CREATE INDEX "EaTraversalPattern_notationId_patternType_idx" ON "EaTraversalPattern"("notationId", "patternType");

-- CreateIndex
CREATE UNIQUE INDEX "EaFrameworkMapping_elementTypeId_frameworkSlug_key" ON "EaFrameworkMapping"("elementTypeId", "frameworkSlug");
CREATE INDEX "EaFrameworkMapping_frameworkSlug_idx" ON "EaFrameworkMapping"("frameworkSlug");
CREATE INDEX "EaFrameworkMapping_elementTypeId_idx" ON "EaFrameworkMapping"("elementTypeId");

-- AddForeignKey
ALTER TABLE "EaTraversalPattern" ADD CONSTRAINT "EaTraversalPattern_notationId_fkey"
    FOREIGN KEY ("notationId") REFERENCES "EaNotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaFrameworkMapping" ADD CONSTRAINT "EaFrameworkMapping_elementTypeId_fkey"
    FOREIGN KEY ("elementTypeId") REFERENCES "EaElementType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
