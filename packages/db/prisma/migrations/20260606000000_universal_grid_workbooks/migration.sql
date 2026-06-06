-- CreateTable
CREATE TABLE "Workbook" (
    "id" TEXT NOT NULL,
    "workbookId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "areaSlug" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkbookShare" (
    "id" TEXT NOT NULL,
    "workbookId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkbookShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkbookTable" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "workbookId" TEXT NOT NULL,
    "dataSource" TEXT NOT NULL DEFAULT 'custom',
    "dataSourceFilter" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkbookTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkbookColumn" (
    "id" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "tableId" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "fieldConfig" JSONB,
    "sourceField" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "defaultValue" TEXT,
    "width" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkbookColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkbookRow" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "tableId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkbookRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkbookCell" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "textValue" TEXT,
    "numberValue" DOUBLE PRECISION,
    "dateValue" TIMESTAMP(3),
    "boolValue" BOOLEAN,
    "selectValue" TEXT,
    "multiSelectValue" TEXT[],
    "referenceId" TEXT,
    "referenceType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkbookCell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkbookView" (
    "id" TEXT NOT NULL,
    "viewId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "viewType" TEXT NOT NULL DEFAULT 'grid',
    "config" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkbookView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workbook_workbookId_key" ON "Workbook"("workbookId");

-- CreateIndex
CREATE INDEX "Workbook_createdById_idx" ON "Workbook"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "WorkbookShare_workbookId_userId_key" ON "WorkbookShare"("workbookId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkbookTable_tableId_key" ON "WorkbookTable"("tableId");

-- CreateIndex
CREATE INDEX "WorkbookTable_workbookId_position_idx" ON "WorkbookTable"("workbookId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "WorkbookColumn_columnId_key" ON "WorkbookColumn"("columnId");

-- CreateIndex
CREATE INDEX "WorkbookColumn_tableId_position_idx" ON "WorkbookColumn"("tableId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "WorkbookRow_rowId_key" ON "WorkbookRow"("rowId");

-- CreateIndex
CREATE INDEX "WorkbookRow_tableId_position_idx" ON "WorkbookRow"("tableId", "position");

-- CreateIndex
CREATE INDEX "WorkbookCell_referenceType_referenceId_idx" ON "WorkbookCell"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "WorkbookCell_columnId_textValue_idx" ON "WorkbookCell"("columnId", "textValue");

-- CreateIndex
CREATE INDEX "WorkbookCell_columnId_numberValue_idx" ON "WorkbookCell"("columnId", "numberValue");

-- CreateIndex
CREATE INDEX "WorkbookCell_columnId_dateValue_idx" ON "WorkbookCell"("columnId", "dateValue");

-- CreateIndex
CREATE UNIQUE INDEX "WorkbookCell_rowId_columnId_key" ON "WorkbookCell"("rowId", "columnId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkbookView_viewId_key" ON "WorkbookView"("viewId");

-- CreateIndex
CREATE INDEX "WorkbookView_tableId_createdById_idx" ON "WorkbookView"("tableId", "createdById");

-- AddForeignKey
ALTER TABLE "Workbook" ADD CONSTRAINT "Workbook_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbookShare" ADD CONSTRAINT "WorkbookShare_workbookId_fkey" FOREIGN KEY ("workbookId") REFERENCES "Workbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbookShare" ADD CONSTRAINT "WorkbookShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbookTable" ADD CONSTRAINT "WorkbookTable_workbookId_fkey" FOREIGN KEY ("workbookId") REFERENCES "Workbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbookColumn" ADD CONSTRAINT "WorkbookColumn_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "WorkbookTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbookRow" ADD CONSTRAINT "WorkbookRow_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "WorkbookTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbookRow" ADD CONSTRAINT "WorkbookRow_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbookCell" ADD CONSTRAINT "WorkbookCell_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "WorkbookRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbookCell" ADD CONSTRAINT "WorkbookCell_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "WorkbookColumn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbookView" ADD CONSTRAINT "WorkbookView_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "WorkbookTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkbookView" ADD CONSTRAINT "WorkbookView_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

