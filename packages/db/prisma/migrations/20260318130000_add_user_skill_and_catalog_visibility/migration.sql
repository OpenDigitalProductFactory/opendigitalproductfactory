-- CreateTable
CREATE TABLE "UserSkill" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "constraints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "routeHint" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'personal',
    "teamId" TEXT,
    "createdById" TEXT NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSkill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSkill_skillId_key" ON "UserSkill"("skillId");

-- CreateIndex
CREATE INDEX "UserSkill_createdById_idx" ON "UserSkill"("createdById");

-- CreateIndex
CREATE INDEX "UserSkill_visibility_idx" ON "UserSkill"("visibility");

-- CreateIndex
CREATE INDEX "UserSkill_routeHint_idx" ON "UserSkill"("routeHint");

-- AddForeignKey
ALTER TABLE "UserSkill" ADD CONSTRAINT "UserSkill_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSkill" ADD CONSTRAINT "UserSkill_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "ModelProvider" ADD COLUMN "catalogVisibility" TEXT NOT NULL DEFAULT 'visible',
ADD COLUMN "catalogEntry" JSONB;
