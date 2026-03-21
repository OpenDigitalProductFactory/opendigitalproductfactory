-- CreateTable
CREATE TABLE "RecurringSchedule" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "nextInvoiceDate" TIMESTAMP(3) NOT NULL,
    "lastInvoicedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "autoSend" BOOLEAN NOT NULL DEFAULT true,
    "templateNotes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringLineItem" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "taxRate" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DunningSequence" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DunningSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DunningStep" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "dayOffset" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "emailTemplate" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'friendly',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DunningStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DunningLog" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "stepId" TEXT,
    "action" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailTo" TEXT,
    "notes" TEXT,

    CONSTRAINT "DunningLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecurringSchedule_scheduleId_key" ON "RecurringSchedule"("scheduleId");

-- CreateIndex
CREATE INDEX "RecurringSchedule_accountId_idx" ON "RecurringSchedule"("accountId");

-- CreateIndex
CREATE INDEX "RecurringSchedule_status_idx" ON "RecurringSchedule"("status");

-- CreateIndex
CREATE INDEX "RecurringSchedule_nextInvoiceDate_idx" ON "RecurringSchedule"("nextInvoiceDate");

-- CreateIndex
CREATE INDEX "RecurringLineItem_scheduleId_idx" ON "RecurringLineItem"("scheduleId");

-- CreateIndex
CREATE INDEX "DunningStep_sequenceId_idx" ON "DunningStep"("sequenceId");

-- CreateIndex
CREATE INDEX "DunningLog_invoiceId_idx" ON "DunningLog"("invoiceId");

-- CreateIndex
CREATE INDEX "DunningLog_sentAt_idx" ON "DunningLog"("sentAt");

-- AddForeignKey
ALTER TABLE "RecurringSchedule" ADD CONSTRAINT "RecurringSchedule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringSchedule" ADD CONSTRAINT "RecurringSchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringLineItem" ADD CONSTRAINT "RecurringLineItem_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "RecurringSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DunningStep" ADD CONSTRAINT "DunningStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "DunningSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DunningLog" ADD CONSTRAINT "DunningLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
