-- AddColumn
ALTER TABLE "PerspectiveMaterial" ADD COLUMN "evidenceGrade" TEXT;

-- Backfill
UPDATE "PerspectiveMaterial" SET "evidenceGrade" = 'A' WHERE "evidenceGrade" IS NULL;

-- AlterColumn
ALTER TABLE "PerspectiveMaterial" ALTER COLUMN "evidenceGrade" SET NOT NULL;
ALTER TABLE "PerspectiveMaterial" ALTER COLUMN "evidenceGrade" SET DEFAULT 'A';

-- CreateIndex
CREATE INDEX "PerspectiveMaterial_evidenceGrade_idx" ON "PerspectiveMaterial"("evidenceGrade");

-- AddCheck
ALTER TABLE "PerspectiveMaterial" ADD CONSTRAINT "PerspectiveMaterial_evidenceGrade_check" CHECK ("evidenceGrade" IN ('A', 'B', 'C', 'D'));

-- AddColumn
ALTER TABLE "EscalationCapture" ADD COLUMN "domainClass" TEXT;

-- Backfill
UPDATE "EscalationCapture" SET "domainClass" = 'unknown' WHERE "domainClass" IS NULL;

-- AlterColumn
ALTER TABLE "EscalationCapture" ALTER COLUMN "domainClass" SET NOT NULL;

-- CreateIndex
CREATE INDEX "EscalationCapture_domainClass_idx" ON "EscalationCapture"("domainClass");
