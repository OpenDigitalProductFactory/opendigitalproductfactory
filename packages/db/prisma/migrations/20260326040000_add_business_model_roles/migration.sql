-- CreateTable
CREATE TABLE "BusinessModel" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessModelRole" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "authorityDomain" TEXT,
    "it4itAlignment" TEXT,
    "hitlTierDefault" INTEGER NOT NULL DEFAULT 2,
    "escalatesTo" TEXT,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "businessModelId" TEXT NOT NULL,

    CONSTRAINT "BusinessModelRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductBusinessModel" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "businessModelId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductBusinessModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessModelRoleAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessModelRoleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "BusinessModelRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessModel_modelId_key" ON "BusinessModel"("modelId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessModelRole_roleId_key" ON "BusinessModelRole"("roleId");

-- CreateIndex
CREATE INDEX "BusinessModelRole_businessModelId_idx" ON "BusinessModelRole"("businessModelId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductBusinessModel_productId_businessModelId_key" ON "ProductBusinessModel"("productId", "businessModelId");

-- CreateIndex
CREATE INDEX "ProductBusinessModel_businessModelId_idx" ON "ProductBusinessModel"("businessModelId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessModelRoleAssignment_userId_businessModelRoleId_productId_key" ON "BusinessModelRoleAssignment"("userId", "businessModelRoleId", "productId");

-- CreateIndex
CREATE INDEX "BusinessModelRoleAssignment_productId_idx" ON "BusinessModelRoleAssignment"("productId");

-- CreateIndex
CREATE INDEX "BusinessModelRoleAssignment_userId_idx" ON "BusinessModelRoleAssignment"("userId");

-- AddForeignKey
ALTER TABLE "BusinessModelRole" ADD CONSTRAINT "BusinessModelRole_businessModelId_fkey" FOREIGN KEY ("businessModelId") REFERENCES "BusinessModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBusinessModel" ADD CONSTRAINT "ProductBusinessModel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "DigitalProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBusinessModel" ADD CONSTRAINT "ProductBusinessModel_businessModelId_fkey" FOREIGN KEY ("businessModelId") REFERENCES "BusinessModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessModelRoleAssignment" ADD CONSTRAINT "BusinessModelRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessModelRoleAssignment" ADD CONSTRAINT "BusinessModelRoleAssignment_businessModelRoleId_fkey" FOREIGN KEY ("businessModelRoleId") REFERENCES "BusinessModelRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessModelRoleAssignment" ADD CONSTRAINT "BusinessModelRoleAssignment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "DigitalProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
