-- BI-AFC178F3: member equity & patronage ledger for member-owned archetypes.
-- Additive table only.

CREATE TABLE "MemberEquityEntry" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberAccountId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "qualified" BOOLEAN NOT NULL DEFAULT false,
    "cashPortion" DECIMAL(14,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberEquityEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MemberEquityEntry_entryId_key" ON "MemberEquityEntry"("entryId");
CREATE INDEX "MemberEquityEntry_organizationId_memberAccountId_idx" ON "MemberEquityEntry"("organizationId", "memberAccountId");
CREATE INDEX "MemberEquityEntry_organizationId_fiscalYear_idx" ON "MemberEquityEntry"("organizationId", "fiscalYear");

ALTER TABLE "MemberEquityEntry" ADD CONSTRAINT "MemberEquityEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemberEquityEntry" ADD CONSTRAINT "MemberEquityEntry_memberAccountId_fkey" FOREIGN KEY ("memberAccountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
