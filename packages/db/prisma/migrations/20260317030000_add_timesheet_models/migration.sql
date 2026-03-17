-- CreateTable: TimesheetPeriod
CREATE TABLE "TimesheetPeriod" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "weekStarting" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "totalHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalBreakMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overtimeThreshold" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TimesheetPeriod_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TimesheetPeriod_periodId_key" ON "TimesheetPeriod"("periodId");
CREATE UNIQUE INDEX "TimesheetPeriod_employeeProfileId_weekStarting_key" ON "TimesheetPeriod"("employeeProfileId", "weekStarting");
CREATE INDEX "TimesheetPeriod_employeeProfileId_idx" ON "TimesheetPeriod"("employeeProfileId");
CREATE INDEX "TimesheetPeriod_status_idx" ON "TimesheetPeriod"("status");
CREATE INDEX "TimesheetPeriod_weekStarting_idx" ON "TimesheetPeriod"("weekStarting");
ALTER TABLE "TimesheetPeriod" ADD CONSTRAINT "TimesheetPeriod_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimesheetPeriod" ADD CONSTRAINT "TimesheetPeriod_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: TimesheetEntry
CREATE TABLE "TimesheetEntry" (
    "id" TEXT NOT NULL,
    "timesheetPeriodId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TimesheetEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TimesheetEntry_timesheetPeriodId_dayOfWeek_key" ON "TimesheetEntry"("timesheetPeriodId", "dayOfWeek");
CREATE INDEX "TimesheetEntry_timesheetPeriodId_idx" ON "TimesheetEntry"("timesheetPeriodId");
ALTER TABLE "TimesheetEntry" ADD CONSTRAINT "TimesheetEntry_timesheetPeriodId_fkey" FOREIGN KEY ("timesheetPeriodId") REFERENCES "TimesheetPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
