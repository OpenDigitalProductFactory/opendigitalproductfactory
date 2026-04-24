-- Add explicit remittance ownership and handoff boundaries to the tax profile.
ALTER TABLE "OrganizationTaxProfile"
ADD COLUMN "filingOwner" TEXT NOT NULL DEFAULT 'business',
ADD COLUMN "handoffMode" TEXT NOT NULL DEFAULT 'dpf_readiness_only';
