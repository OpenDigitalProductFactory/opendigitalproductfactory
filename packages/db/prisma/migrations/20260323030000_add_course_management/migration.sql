-- CreateTable
CREATE TABLE "CourseProduct" (
    "id" TEXT NOT NULL,
    "courseProductId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "standardPriceUsd" DECIMAL(65,30) NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "certificationBody" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseInstance" (
    "id" TEXT NOT NULL,
    "jobCode" TEXT NOT NULL,
    "courseProductId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "trainerName" TEXT,
    "location" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "customerTag" TEXT,
    "maxSeats" INTEGER NOT NULL,
    "currentEnrollment" INTEGER NOT NULL DEFAULT 0,
    "pricePerSeatUsd" DECIMAL(65,30),
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseRegistration" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "courseInstanceId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "company" TEXT,
    "country" TEXT,
    "role" TEXT,
    "netFeeUsd" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "instructorCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "materialsCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "voucherCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "grossProfit" DECIMAL(65,30),
    "paymentStatus" TEXT NOT NULL DEFAULT 'pending',
    "paidDate" TIMESTAMP(3),
    "stripeRef" TEXT,
    "b2cInvoice" TEXT,
    "xeroRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamVoucher" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "ogId" TEXT,
    "voucherType" TEXT,
    "voucherExpiry1" TIMESTAMP(3),
    "voucherExpiry2" TIMESTAMP(3),
    "ogStoreReference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourseProduct_courseProductId_key" ON "CourseProduct"("courseProductId");
CREATE INDEX "CourseProduct_isActive_idx" ON "CourseProduct"("isActive");
CREATE INDEX "CourseProduct_certificationBody_idx" ON "CourseProduct"("certificationBody");

-- CreateIndex
CREATE UNIQUE INDEX "CourseInstance_jobCode_key" ON "CourseInstance"("jobCode");
CREATE INDEX "CourseInstance_courseProductId_status_idx" ON "CourseInstance"("courseProductId", "status");
CREATE INDEX "CourseInstance_startDate_idx" ON "CourseInstance"("startDate");
CREATE INDEX "CourseInstance_isPublic_status_idx" ON "CourseInstance"("isPublic", "status");
CREATE INDEX "CourseInstance_customerTag_idx" ON "CourseInstance"("customerTag");

-- CreateIndex
CREATE UNIQUE INDEX "CourseRegistration_registrationId_key" ON "CourseRegistration"("registrationId");
CREATE INDEX "CourseRegistration_courseInstanceId_paymentStatus_idx" ON "CourseRegistration"("courseInstanceId", "paymentStatus");
CREATE INDEX "CourseRegistration_email_idx" ON "CourseRegistration"("email");
CREATE INDEX "CourseRegistration_xeroRef_idx" ON "CourseRegistration"("xeroRef");
CREATE INDEX "CourseRegistration_stripeRef_idx" ON "CourseRegistration"("stripeRef");

-- CreateIndex
CREATE UNIQUE INDEX "ExamVoucher_registrationId_key" ON "ExamVoucher"("registrationId");
CREATE INDEX "ExamVoucher_status_idx" ON "ExamVoucher"("status");
CREATE INDEX "ExamVoucher_ogId_idx" ON "ExamVoucher"("ogId");

-- AddForeignKey
ALTER TABLE "CourseInstance" ADD CONSTRAINT "CourseInstance_courseProductId_fkey" FOREIGN KEY ("courseProductId") REFERENCES "CourseProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseRegistration" ADD CONSTRAINT "CourseRegistration_courseInstanceId_fkey" FOREIGN KEY ("courseInstanceId") REFERENCES "CourseInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamVoucher" ADD CONSTRAINT "ExamVoucher_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "CourseRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
