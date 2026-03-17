-- CreateTable: CalendarEvent
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "eventType" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'personal',
    "ownerEmployeeId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'team',
    "recurrence" TEXT,
    "recurrenceEnd" TIMESTAMP(3),
    "color" TEXT,
    "syncSource" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CalendarEvent_eventId_key" ON "CalendarEvent"("eventId");
CREATE INDEX "CalendarEvent_ownerEmployeeId_idx" ON "CalendarEvent"("ownerEmployeeId");
CREATE INDEX "CalendarEvent_startAt_endAt_idx" ON "CalendarEvent"("startAt", "endAt");
CREATE INDEX "CalendarEvent_category_idx" ON "CalendarEvent"("category");
CREATE INDEX "CalendarEvent_syncSource_externalId_idx" ON "CalendarEvent"("syncSource", "externalId");
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: CalendarSync
CREATE TABLE "CalendarSync" (
    "id" TEXT NOT NULL,
    "syncId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "connectionData" JSONB NOT NULL,
    "syncDirection" TEXT NOT NULL DEFAULT 'inbound',
    "filterPattern" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CalendarSync_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CalendarSync_syncId_key" ON "CalendarSync"("syncId");
CREATE UNIQUE INDEX "CalendarSync_employeeProfileId_provider_key" ON "CalendarSync"("employeeProfileId", "provider");
CREATE INDEX "CalendarSync_employeeProfileId_idx" ON "CalendarSync"("employeeProfileId");
CREATE INDEX "CalendarSync_status_idx" ON "CalendarSync"("status");
ALTER TABLE "CalendarSync" ADD CONSTRAINT "CalendarSync_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
