CREATE TABLE "EmploymentType" (
    "id" TEXT NOT NULL,
    "employmentTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmploymentType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "jobFamily" TEXT,
    "jobLevel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkLocation" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationType" TEXT NOT NULL,
    "timezone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parentDepartmentId" TEXT,
    "headEmployeeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmployeeProfile" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "userId" TEXT,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "workEmail" TEXT,
    "personalEmail" TEXT,
    "phoneNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'onboarding',
    "employmentTypeId" TEXT,
    "departmentId" TEXT,
    "positionId" TEXT,
    "managerEmployeeId" TEXT,
    "dottedLineManagerId" TEXT,
    "workLocationId" TEXT,
    "timezone" TEXT,
    "startDate" TIMESTAMP(3),
    "confirmationDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmploymentEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "actorUserId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmploymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TerminationRecord" (
    "id" TEXT NOT NULL,
    "terminationId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "terminationDate" TIMESTAMP(3) NOT NULL,
    "terminationReason" TEXT,
    "notes" TEXT,
    "exitInterviewDone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TerminationRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmploymentType_employmentTypeId_key" ON "EmploymentType"("employmentTypeId");
CREATE INDEX "EmploymentType_status_idx" ON "EmploymentType"("status");

CREATE UNIQUE INDEX "Position_positionId_key" ON "Position"("positionId");
CREATE INDEX "Position_status_idx" ON "Position"("status");

CREATE UNIQUE INDEX "WorkLocation_locationId_key" ON "WorkLocation"("locationId");
CREATE INDEX "WorkLocation_status_idx" ON "WorkLocation"("status");

CREATE UNIQUE INDEX "Department_departmentId_key" ON "Department"("departmentId");
CREATE UNIQUE INDEX "Department_slug_key" ON "Department"("slug");
CREATE INDEX "Department_parentDepartmentId_idx" ON "Department"("parentDepartmentId");
CREATE INDEX "Department_headEmployeeId_idx" ON "Department"("headEmployeeId");
CREATE INDEX "Department_status_idx" ON "Department"("status");

CREATE UNIQUE INDEX "EmployeeProfile_employeeId_key" ON "EmployeeProfile"("employeeId");
CREATE UNIQUE INDEX "EmployeeProfile_userId_key" ON "EmployeeProfile"("userId");
CREATE INDEX "EmployeeProfile_status_idx" ON "EmployeeProfile"("status");
CREATE INDEX "EmployeeProfile_departmentId_idx" ON "EmployeeProfile"("departmentId");
CREATE INDEX "EmployeeProfile_managerEmployeeId_idx" ON "EmployeeProfile"("managerEmployeeId");
CREATE INDEX "EmployeeProfile_employmentTypeId_idx" ON "EmployeeProfile"("employmentTypeId");
CREATE INDEX "EmployeeProfile_positionId_idx" ON "EmployeeProfile"("positionId");
CREATE INDEX "EmployeeProfile_workLocationId_idx" ON "EmployeeProfile"("workLocationId");

CREATE UNIQUE INDEX "EmploymentEvent_eventId_key" ON "EmploymentEvent"("eventId");
CREATE INDEX "EmploymentEvent_employeeProfileId_idx" ON "EmploymentEvent"("employeeProfileId");
CREATE INDEX "EmploymentEvent_effectiveAt_idx" ON "EmploymentEvent"("effectiveAt");
CREATE INDEX "EmploymentEvent_eventType_idx" ON "EmploymentEvent"("eventType");

CREATE UNIQUE INDEX "TerminationRecord_terminationId_key" ON "TerminationRecord"("terminationId");
CREATE UNIQUE INDEX "TerminationRecord_employeeProfileId_key" ON "TerminationRecord"("employeeProfileId");
CREATE INDEX "TerminationRecord_terminationDate_idx" ON "TerminationRecord"("terminationDate");

ALTER TABLE "Department"
    ADD CONSTRAINT "Department_parentDepartmentId_fkey"
    FOREIGN KEY ("parentDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Department"
    ADD CONSTRAINT "Department_headEmployeeId_fkey"
    FOREIGN KEY ("headEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmployeeProfile"
    ADD CONSTRAINT "EmployeeProfile_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmployeeProfile"
    ADD CONSTRAINT "EmployeeProfile_employmentTypeId_fkey"
    FOREIGN KEY ("employmentTypeId") REFERENCES "EmploymentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmployeeProfile"
    ADD CONSTRAINT "EmployeeProfile_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmployeeProfile"
    ADD CONSTRAINT "EmployeeProfile_positionId_fkey"
    FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmployeeProfile"
    ADD CONSTRAINT "EmployeeProfile_managerEmployeeId_fkey"
    FOREIGN KEY ("managerEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmployeeProfile"
    ADD CONSTRAINT "EmployeeProfile_dottedLineManagerId_fkey"
    FOREIGN KEY ("dottedLineManagerId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmployeeProfile"
    ADD CONSTRAINT "EmployeeProfile_workLocationId_fkey"
    FOREIGN KEY ("workLocationId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmploymentEvent"
    ADD CONSTRAINT "EmploymentEvent_employeeProfileId_fkey"
    FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmploymentEvent"
    ADD CONSTRAINT "EmploymentEvent_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TerminationRecord"
    ADD CONSTRAINT "TerminationRecord_employeeProfileId_fkey"
    FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
