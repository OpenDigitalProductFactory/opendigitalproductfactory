-- @migration-safety: data-safe: every FK column here (JobRequisition.positionId/departmentId/workLocationId/employmentTypeId/hiringManagerId/recruiterId and Scorecard.submittedById) is a pre-existing NULLABLE column populated only by native recruiting authoring, which is not yet built; the Greenhouse absorption flow never writes these columns (external refs live in StagedRecord + MasterDataSourceRef). So every existing row holds NULL on these columns, and a NULL foreign key never violates the constraint — no backfill or NOT VALID needed. Indexes are non-unique CREATE INDEX (no data can violate).

-- CreateIndex
CREATE INDEX "JobRequisition_workLocationId_idx" ON "JobRequisition"("workLocationId");

-- CreateIndex
CREATE INDEX "JobRequisition_employmentTypeId_idx" ON "JobRequisition"("employmentTypeId");

-- CreateIndex
CREATE INDEX "JobRequisition_hiringManagerId_idx" ON "JobRequisition"("hiringManagerId");

-- CreateIndex
CREATE INDEX "JobRequisition_recruiterId_idx" ON "JobRequisition"("recruiterId");

-- CreateIndex
CREATE INDEX "Scorecard_submittedById_idx" ON "Scorecard"("submittedById");

-- AddForeignKey
ALTER TABLE "JobRequisition" ADD CONSTRAINT "JobRequisition_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequisition" ADD CONSTRAINT "JobRequisition_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequisition" ADD CONSTRAINT "JobRequisition_workLocationId_fkey" FOREIGN KEY ("workLocationId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequisition" ADD CONSTRAINT "JobRequisition_employmentTypeId_fkey" FOREIGN KEY ("employmentTypeId") REFERENCES "EmploymentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequisition" ADD CONSTRAINT "JobRequisition_hiringManagerId_fkey" FOREIGN KEY ("hiringManagerId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequisition" ADD CONSTRAINT "JobRequisition_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
