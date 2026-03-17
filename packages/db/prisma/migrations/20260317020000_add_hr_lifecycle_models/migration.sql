-- CreateTable: OnboardingChecklist
CREATE TABLE "OnboardingChecklist" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "checklistType" TEXT NOT NULL,
    "departmentId" TEXT,
    "positionId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OnboardingChecklist_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OnboardingChecklist_checklistId_key" ON "OnboardingChecklist"("checklistId");
CREATE INDEX "OnboardingChecklist_checklistType_idx" ON "OnboardingChecklist"("checklistType");

-- CreateTable: OnboardingTask
CREATE TABLE "OnboardingTask" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "checklistType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeRole" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OnboardingTask_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OnboardingTask_taskId_key" ON "OnboardingTask"("taskId");
CREATE INDEX "OnboardingTask_employeeProfileId_idx" ON "OnboardingTask"("employeeProfileId");
CREATE INDEX "OnboardingTask_status_idx" ON "OnboardingTask"("status");
ALTER TABLE "OnboardingTask" ADD CONSTRAINT "OnboardingTask_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: ReviewCycle
CREATE TABLE "ReviewCycle" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReviewCycle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReviewCycle_cycleId_key" ON "ReviewCycle"("cycleId");
CREATE INDEX "ReviewCycle_status_idx" ON "ReviewCycle"("status");

-- CreateTable: ReviewInstance
CREATE TABLE "ReviewInstance" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "reviewerEmployeeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "overallRating" TEXT,
    "managerNarrative" TEXT,
    "employeeNarrative" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "sharedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReviewInstance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReviewInstance_reviewId_key" ON "ReviewInstance"("reviewId");
CREATE UNIQUE INDEX "ReviewInstance_cycleId_employeeProfileId_key" ON "ReviewInstance"("cycleId", "employeeProfileId");
CREATE INDEX "ReviewInstance_cycleId_idx" ON "ReviewInstance"("cycleId");
CREATE INDEX "ReviewInstance_employeeProfileId_idx" ON "ReviewInstance"("employeeProfileId");
CREATE INDEX "ReviewInstance_status_idx" ON "ReviewInstance"("status");
ALTER TABLE "ReviewInstance" ADD CONSTRAINT "ReviewInstance_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ReviewCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReviewInstance" ADD CONSTRAINT "ReviewInstance_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReviewInstance" ADD CONSTRAINT "ReviewInstance_reviewerEmployeeId_fkey" FOREIGN KEY ("reviewerEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: ReviewGoal
CREATE TABLE "ReviewGoal" (
    "id" TEXT NOT NULL,
    "reviewInstanceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "weight" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'active',
    "selfAssessment" TEXT,
    "managerAssessment" TEXT,
    "rating" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReviewGoal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReviewGoal_reviewInstanceId_idx" ON "ReviewGoal"("reviewInstanceId");
ALTER TABLE "ReviewGoal" ADD CONSTRAINT "ReviewGoal_reviewInstanceId_fkey" FOREIGN KEY ("reviewInstanceId") REFERENCES "ReviewInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: FeedbackNote
CREATE TABLE "FeedbackNote" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "fromEmployeeId" TEXT NOT NULL,
    "toEmployeeId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "feedbackType" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedbackNote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FeedbackNote_feedbackId_key" ON "FeedbackNote"("feedbackId");
CREATE INDEX "FeedbackNote_toEmployeeId_idx" ON "FeedbackNote"("toEmployeeId");
CREATE INDEX "FeedbackNote_fromEmployeeId_idx" ON "FeedbackNote"("fromEmployeeId");
ALTER TABLE "FeedbackNote" ADD CONSTRAINT "FeedbackNote_fromEmployeeId_fkey" FOREIGN KEY ("fromEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeedbackNote" ADD CONSTRAINT "FeedbackNote_toEmployeeId_fkey" FOREIGN KEY ("toEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: LeavePolicy
CREATE TABLE "LeavePolicy" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "leaveType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "annualAllocation" DOUBLE PRECISION NOT NULL,
    "accrualRule" TEXT NOT NULL DEFAULT 'annual',
    "carryoverLimit" DOUBLE PRECISION,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "probationDays" INTEGER NOT NULL DEFAULT 0,
    "locationPattern" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeavePolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LeavePolicy_policyId_key" ON "LeavePolicy"("policyId");
CREATE INDEX "LeavePolicy_leaveType_idx" ON "LeavePolicy"("leaveType");
CREATE INDEX "LeavePolicy_status_idx" ON "LeavePolicy"("status");

-- CreateTable: LeaveBalance
CREATE TABLE "LeaveBalance" (
    "id" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "leaveType" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "allocated" DOUBLE PRECISION NOT NULL,
    "used" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carriedOver" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adjustments" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeaveBalance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LeaveBalance_employeeProfileId_leaveType_year_key" ON "LeaveBalance"("employeeProfileId", "leaveType", "year");
CREATE INDEX "LeaveBalance_employeeProfileId_idx" ON "LeaveBalance"("employeeProfileId");
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: LeaveRequest
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "leaveType" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "days" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approverEmployeeId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LeaveRequest_requestId_key" ON "LeaveRequest"("requestId");
CREATE INDEX "LeaveRequest_employeeProfileId_idx" ON "LeaveRequest"("employeeProfileId");
CREATE INDEX "LeaveRequest_status_idx" ON "LeaveRequest"("status");
CREATE INDEX "LeaveRequest_startDate_endDate_idx" ON "LeaveRequest"("startDate", "endDate");
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_approverEmployeeId_fkey" FOREIGN KEY ("approverEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
