-- CreateTable: StorefrontArchetype — archetype templates for storefront types
CREATE TABLE "StorefrontArchetype" (
    "id"               TEXT NOT NULL,
    "archetypeId"      TEXT NOT NULL,
    "name"             TEXT NOT NULL,
    "category"         TEXT NOT NULL,
    "ctaType"          TEXT NOT NULL,
    "itemTemplates"    JSONB NOT NULL,
    "sectionTemplates" JSONB NOT NULL,
    "formSchema"       JSONB NOT NULL,
    "tags"             TEXT[],
    "isActive"         BOOLEAN NOT NULL DEFAULT true,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorefrontArchetype_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontArchetype_archetypeId_key" ON "StorefrontArchetype"("archetypeId");
CREATE INDEX "StorefrontArchetype_category_idx" ON "StorefrontArchetype"("category");
CREATE INDEX "StorefrontArchetype_isActive_idx" ON "StorefrontArchetype"("isActive");

-- CreateTable: StorefrontConfig — per-organisation storefront configuration
CREATE TABLE "StorefrontConfig" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "archetypeId"    TEXT NOT NULL,
    "tagline"        TEXT,
    "description"    TEXT,
    "heroImageUrl"   TEXT,
    "contactEmail"   TEXT,
    "contactPhone"   TEXT,
    "socialLinks"    JSONB,
    "isPublished"    BOOLEAN NOT NULL DEFAULT false,
    "customDomain"   TEXT,
    "portfolioId"    TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorefrontConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontConfig_organizationId_key" ON "StorefrontConfig"("organizationId");

-- AddForeignKey
ALTER TABLE "StorefrontConfig" ADD CONSTRAINT "StorefrontConfig_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StorefrontConfig" ADD CONSTRAINT "StorefrontConfig_archetypeId_fkey"
    FOREIGN KEY ("archetypeId") REFERENCES "StorefrontArchetype"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: StorefrontSection — ordered content sections within a storefront
CREATE TABLE "StorefrontSection" (
    "id"           TEXT NOT NULL,
    "storefrontId" TEXT NOT NULL,
    "type"         TEXT NOT NULL,
    "title"        TEXT,
    "content"      JSONB NOT NULL,
    "sortOrder"    INTEGER NOT NULL DEFAULT 0,
    "isVisible"    BOOLEAN NOT NULL DEFAULT true,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorefrontSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StorefrontSection_storefrontId_sortOrder_idx" ON "StorefrontSection"("storefrontId", "sortOrder");

-- AddForeignKey
ALTER TABLE "StorefrontSection" ADD CONSTRAINT "StorefrontSection_storefrontId_fkey"
    FOREIGN KEY ("storefrontId") REFERENCES "StorefrontConfig"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: StorefrontItem — products/services listed on a storefront
CREATE TABLE "StorefrontItem" (
    "id"            TEXT NOT NULL,
    "itemId"        TEXT NOT NULL,
    "storefrontId"  TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "description"   TEXT,
    "category"      TEXT,
    "priceAmount"   DECIMAL(65,30),
    "priceCurrency" TEXT NOT NULL DEFAULT 'GBP',
    "priceType"     TEXT,
    "imageUrl"      TEXT,
    "ctaType"       TEXT NOT NULL,
    "ctaLabel"      TEXT,
    "bookingConfig" JSONB,
    "isActive"      BOOLEAN NOT NULL DEFAULT true,
    "sortOrder"     INTEGER NOT NULL DEFAULT 0,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorefrontItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontItem_itemId_key" ON "StorefrontItem"("itemId");
CREATE INDEX "StorefrontItem_storefrontId_isActive_sortOrder_idx" ON "StorefrontItem"("storefrontId", "isActive", "sortOrder");

-- AddForeignKey
ALTER TABLE "StorefrontItem" ADD CONSTRAINT "StorefrontItem_storefrontId_fkey"
    FOREIGN KEY ("storefrontId") REFERENCES "StorefrontConfig"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: StorefrontBooking — booking transactions from storefront
CREATE TABLE "StorefrontBooking" (
    "id"                TEXT NOT NULL,
    "bookingRef"        TEXT NOT NULL,
    "storefrontId"      TEXT NOT NULL,
    "itemId"            TEXT NOT NULL,
    "customerContactId" TEXT,
    "customerEmail"     TEXT NOT NULL,
    "customerName"      TEXT NOT NULL,
    "customerPhone"     TEXT,
    "scheduledAt"       TIMESTAMP(3) NOT NULL,
    "durationMinutes"   INTEGER NOT NULL,
    "notes"             TEXT,
    "status"            TEXT NOT NULL DEFAULT 'pending',
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorefrontBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontBooking_bookingRef_key" ON "StorefrontBooking"("bookingRef");
CREATE INDEX "StorefrontBooking_storefrontId_status_idx" ON "StorefrontBooking"("storefrontId", "status");
CREATE INDEX "StorefrontBooking_customerEmail_idx" ON "StorefrontBooking"("customerEmail");
CREATE INDEX "StorefrontBooking_scheduledAt_idx" ON "StorefrontBooking"("scheduledAt");

-- AddForeignKey
ALTER TABLE "StorefrontBooking" ADD CONSTRAINT "StorefrontBooking_storefrontId_fkey"
    FOREIGN KEY ("storefrontId") REFERENCES "StorefrontConfig"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: StorefrontOrder — product/service orders from storefront
CREATE TABLE "StorefrontOrder" (
    "id"                TEXT NOT NULL,
    "orderRef"          TEXT NOT NULL,
    "storefrontId"      TEXT NOT NULL,
    "customerContactId" TEXT,
    "customerEmail"     TEXT NOT NULL,
    "items"             JSONB NOT NULL,
    "totalAmount"       DECIMAL(65,30) NOT NULL,
    "currency"          TEXT NOT NULL DEFAULT 'GBP',
    "status"            TEXT NOT NULL DEFAULT 'pending',
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorefrontOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontOrder_orderRef_key" ON "StorefrontOrder"("orderRef");
CREATE INDEX "StorefrontOrder_storefrontId_status_idx" ON "StorefrontOrder"("storefrontId", "status");
CREATE INDEX "StorefrontOrder_customerEmail_idx" ON "StorefrontOrder"("customerEmail");

-- AddForeignKey
ALTER TABLE "StorefrontOrder" ADD CONSTRAINT "StorefrontOrder_storefrontId_fkey"
    FOREIGN KEY ("storefrontId") REFERENCES "StorefrontConfig"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: StorefrontInquiry — enquiries submitted via storefront
CREATE TABLE "StorefrontInquiry" (
    "id"                TEXT NOT NULL,
    "inquiryRef"        TEXT NOT NULL,
    "storefrontId"      TEXT NOT NULL,
    "itemId"            TEXT,
    "customerContactId" TEXT,
    "customerEmail"     TEXT NOT NULL,
    "customerName"      TEXT NOT NULL,
    "customerPhone"     TEXT,
    "message"           TEXT,
    "formData"          JSONB,
    "status"            TEXT NOT NULL DEFAULT 'new',
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorefrontInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontInquiry_inquiryRef_key" ON "StorefrontInquiry"("inquiryRef");
CREATE INDEX "StorefrontInquiry_storefrontId_status_idx" ON "StorefrontInquiry"("storefrontId", "status");
CREATE INDEX "StorefrontInquiry_customerEmail_idx" ON "StorefrontInquiry"("customerEmail");

-- AddForeignKey
ALTER TABLE "StorefrontInquiry" ADD CONSTRAINT "StorefrontInquiry_storefrontId_fkey"
    FOREIGN KEY ("storefrontId") REFERENCES "StorefrontConfig"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: StorefrontDonation — donations received via storefront
CREATE TABLE "StorefrontDonation" (
    "id"                TEXT NOT NULL,
    "donationRef"       TEXT NOT NULL,
    "storefrontId"      TEXT NOT NULL,
    "customerContactId" TEXT,
    "donorEmail"        TEXT NOT NULL,
    "donorName"         TEXT,
    "amount"            DECIMAL(65,30) NOT NULL,
    "currency"          TEXT NOT NULL DEFAULT 'GBP',
    "campaignId"        TEXT,
    "message"           TEXT,
    "isAnonymous"       BOOLEAN NOT NULL DEFAULT false,
    "status"            TEXT NOT NULL DEFAULT 'pending',
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorefrontDonation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontDonation_donationRef_key" ON "StorefrontDonation"("donationRef");
CREATE INDEX "StorefrontDonation_storefrontId_status_idx" ON "StorefrontDonation"("storefrontId", "status");
CREATE INDEX "StorefrontDonation_donorEmail_idx" ON "StorefrontDonation"("donorEmail");

-- AddForeignKey
ALTER TABLE "StorefrontDonation" ADD CONSTRAINT "StorefrontDonation_storefrontId_fkey"
    FOREIGN KEY ("storefrontId") REFERENCES "StorefrontConfig"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
