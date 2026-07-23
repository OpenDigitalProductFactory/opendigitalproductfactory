-- BI-DE47EC0B (EP-PARTNER-CHANNEL Phase 2) — partner-org account persistence.
--
-- Schema audit outcome (docs/superpowers/specs/2026-07-23-partner-identity-schema-audit.md,
-- kernel decision DI-CD377B58CA99): reuse CustomerAccount as the canonical party
-- row and mark partnership with this thin side table, rather than forking a
-- parallel PartnerAccount. Every shared commercial fact (invoices, quotes,
-- subscriptions, opportunities, sites, tickets) stays on CustomerAccount; only
-- partner-specific attributes live here. The side-table presence IS the
-- partnership flag — no exclusive accountKind discriminator — because a local
-- MSP is routinely BOTH a customer (buys its own install) and a partner
-- (resells and operates installs for local customers).
--
-- Purely additive: a new empty table plus one FK. No backfill, no column
-- rewrite, no destructive change; existing accounts are untouched and remain
-- non-partners until explicitly enrolled.

CREATE TABLE "PartnerProgramEnrollment" (
  "id" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'prospect',
  "tier" TEXT,
  "territory" TEXT,
  "agreementRef" TEXT,
  "marginPercent" DECIMAL(65,30),
  "dealRegistrationEnabled" BOOLEAN NOT NULL DEFAULT false,
  "enrolledAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PartnerProgramEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnerProgramEnrollment_enrollmentId_key"
  ON "PartnerProgramEnrollment"("enrollmentId");

-- 1:1 with the party row — one enrollment per account (the side-table pattern).
CREATE UNIQUE INDEX "PartnerProgramEnrollment_accountId_key"
  ON "PartnerProgramEnrollment"("accountId");

CREATE INDEX "PartnerProgramEnrollment_status_idx"
  ON "PartnerProgramEnrollment"("status");

ALTER TABLE "PartnerProgramEnrollment"
  ADD CONSTRAINT "PartnerProgramEnrollment_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
