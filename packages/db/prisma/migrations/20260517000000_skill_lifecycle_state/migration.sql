-- AlterTable
ALTER TABLE "SkillDefinition" ADD COLUMN "lifecycleState" TEXT NOT NULL DEFAULT 'active';

-- CreateIndex
CREATE INDEX "SkillDefinition_lifecycleState_idx" ON "SkillDefinition"("lifecycleState");
