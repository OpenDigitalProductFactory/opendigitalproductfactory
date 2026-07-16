-- BI-HEALTHCARE-004: canonical patient role, human proxy authority, and consent.
-- @migration-safety: data-safe: all required columns and tightening constraints
-- apply only to newly created empty tables; existing AuthorizationDecisionLog
-- changes are nullable and therefore valid for every existing row.

-- Extend the existing authorization evidence stream rather than creating a
-- healthcare-only audit log.
ALTER TABLE "AuthorizationDecisionLog"
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "patientSubjectPrincipalId" TEXT,
  ADD COLUMN "patientAuthorityId" TEXT,
  ADD COLUMN "patientConsentDirectiveId" TEXT,
  ADD COLUMN "purposeOfUse" TEXT,
  ADD COLUMN "policyVersion" TEXT;

CREATE TABLE "PatientProfile" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "principalId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "minorStatus" TEXT NOT NULL DEFAULT 'unknown',
  "minorStatusAsOf" TIMESTAMP(3),
  "selfAccessAllowed" BOOLEAN NOT NULL DEFAULT false,
  "preferredLanguage" TEXT,
  "accessibilityNeeds" JSONB,
  "communicationPreferences" JSONB,
  "sourceSystem" TEXT,
  "sourceId" TEXT,
  "sourceVersion" TEXT,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedByPrincipalId" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "verifiedByPrincipalId" TEXT,
  "sensitivityLabels" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "retentionClass" TEXT,
  "legalHold" BOOLEAN NOT NULL DEFAULT false,
  "mergedIntoPatientProfileId" TEXT,
  "enteredInErrorAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PatientProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PatientProfile_status_check" CHECK (
    "status" IN ('active', 'inactive', 'identity-review', 'merged', 'entered-in-error')
  ),
  CONSTRAINT "PatientProfile_minorStatus_check" CHECK (
    "minorStatus" IN ('unknown', 'minor', 'adult')
  ),
  CONSTRAINT "PatientProfile_merge_state_check" CHECK (
    ("status" = 'merged' AND "mergedIntoPatientProfileId" IS NOT NULL)
    OR ("status" <> 'merged')
  ),
  CONSTRAINT "PatientProfile_entered_error_state_check" CHECK (
    ("status" = 'entered-in-error' AND "enteredInErrorAt" IS NOT NULL)
    OR ("status" <> 'entered-in-error')
  ),
  CONSTRAINT "PatientProfile_no_self_merge_check" CHECK (
    "mergedIntoPatientProfileId" IS NULL OR "mergedIntoPatientProfileId" <> "id"
  )
);

CREATE TABLE "PatientAuthority" (
  "id" TEXT NOT NULL,
  "authorityId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "patientProfileId" TEXT NOT NULL,
  "granteePrincipalId" TEXT NOT NULL,
  "relationshipType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'proposed',
  "legalBasis" TEXT,
  "purposesOfUse" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "permittedOperations" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "recordCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "locationRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "scopeJson" JSONB,
  "evidenceRef" TEXT,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revokedByPrincipalId" TEXT,
  "revocationReason" TEXT,
  "assertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assertedByPrincipalId" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "verifiedByPrincipalId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "supersedesAuthorityId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PatientAuthority_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PatientAuthority_relationshipType_check" CHECK (
    "relationshipType" IN (
      'guardian', 'caregiver', 'household-member', 'emergency-contact',
      'responsible-party', 'proxy'
    )
  ),
  CONSTRAINT "PatientAuthority_status_check" CHECK (
    "status" IN ('proposed', 'active', 'expired', 'revoked', 'entered-in-error')
  ),
  CONSTRAINT "PatientAuthority_version_check" CHECK ("version" > 0),
  CONSTRAINT "PatientAuthority_effective_window_check" CHECK (
    "expiresAt" IS NULL OR "expiresAt" > "effectiveFrom"
  ),
  CONSTRAINT "PatientAuthority_revoked_state_check" CHECK (
    ("status" = 'revoked' AND "revokedAt" IS NOT NULL)
    OR ("status" <> 'revoked')
  ),
  CONSTRAINT "PatientAuthority_no_self_supersede_check" CHECK (
    "supersedesAuthorityId" IS NULL OR "supersedesAuthorityId" <> "id"
  )
);

CREATE TABLE "PatientConsentDirective" (
  "id" TEXT NOT NULL,
  "directiveId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "patientProfileId" TEXT NOT NULL,
  "directiveType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'proposed',
  "decision" TEXT NOT NULL,
  "purposesOfUse" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "operations" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "recordCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "legalBasis" TEXT,
  "evidenceRef" TEXT,
  "scopeJson" JSONB,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "emergencyOverrideAllowed" BOOLEAN NOT NULL DEFAULT false,
  "revokedAt" TIMESTAMP(3),
  "revokedByPrincipalId" TEXT,
  "revocationReason" TEXT,
  "assertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assertedByPrincipalId" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "verifiedByPrincipalId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "supersedesDirectiveId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PatientConsentDirective_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PatientConsentDirective_type_check" CHECK (
    "directiveType" IN ('consent', 'privacy-restriction')
  ),
  CONSTRAINT "PatientConsentDirective_status_check" CHECK (
    "status" IN ('proposed', 'active', 'expired', 'revoked', 'entered-in-error')
  ),
  CONSTRAINT "PatientConsentDirective_decision_check" CHECK (
    "decision" IN ('permit', 'deny')
  ),
  CONSTRAINT "PatientConsentDirective_version_check" CHECK ("version" > 0),
  CONSTRAINT "PatientConsentDirective_effective_window_check" CHECK (
    "expiresAt" IS NULL OR "expiresAt" > "effectiveFrom"
  ),
  CONSTRAINT "PatientConsentDirective_revoked_state_check" CHECK (
    ("status" = 'revoked' AND "revokedAt" IS NOT NULL)
    OR ("status" <> 'revoked')
  ),
  CONSTRAINT "PatientConsentDirective_no_self_supersede_check" CHECK (
    "supersedesDirectiveId" IS NULL OR "supersedesDirectiveId" <> "id"
  )
);

CREATE UNIQUE INDEX "PatientProfile_patientId_key"
  ON "PatientProfile"("patientId");
CREATE UNIQUE INDEX "PatientProfile_organizationId_principalId_key"
  ON "PatientProfile"("organizationId", "principalId");
CREATE UNIQUE INDEX "PatientProfile_id_organizationId_key"
  ON "PatientProfile"("id", "organizationId");
CREATE UNIQUE INDEX "PatientProfile_organizationId_sourceSystem_sourceId_key"
  ON "PatientProfile"("organizationId", "sourceSystem", "sourceId");
CREATE INDEX "PatientProfile_organizationId_status_idx"
  ON "PatientProfile"("organizationId", "status");
CREATE INDEX "PatientProfile_principalId_idx"
  ON "PatientProfile"("principalId");
CREATE INDEX "PatientProfile_mergedIntoPatientProfileId_idx"
  ON "PatientProfile"("mergedIntoPatientProfileId");

CREATE UNIQUE INDEX "PatientAuthority_authorityId_key"
  ON "PatientAuthority"("authorityId");
CREATE UNIQUE INDEX "PatientAuthority_id_organizationId_patientProfileId_key"
  ON "PatientAuthority"("id", "organizationId", "patientProfileId");
CREATE INDEX "PatientAuthority_organizationId_patientProfileId_status_idx"
  ON "PatientAuthority"("organizationId", "patientProfileId", "status");
CREATE INDEX "PatientAuthority_granteePrincipalId_status_idx"
  ON "PatientAuthority"("granteePrincipalId", "status");
CREATE INDEX "PatientAuthority_expiresAt_idx"
  ON "PatientAuthority"("expiresAt");
CREATE INDEX "PatientAuthority_supersedesAuthorityId_idx"
  ON "PatientAuthority"("supersedesAuthorityId");

CREATE UNIQUE INDEX "PatientConsentDirective_directiveId_key"
  ON "PatientConsentDirective"("directiveId");
CREATE UNIQUE INDEX "PatientConsentDirective_id_organizationId_patientProfileId_key"
  ON "PatientConsentDirective"("id", "organizationId", "patientProfileId");
CREATE INDEX "PatientConsentDirective_organizationId_patientProfileId_sta_idx"
  ON "PatientConsentDirective"("organizationId", "patientProfileId", "status");
CREATE INDEX "PatientConsentDirective_expiresAt_idx"
  ON "PatientConsentDirective"("expiresAt");
CREATE INDEX "PatientConsentDirective_supersedesDirectiveId_idx"
  ON "PatientConsentDirective"("supersedesDirectiveId");

CREATE INDEX "AuthorizationDecisionLog_organizationId_patientSubjectPrinc_idx"
  ON "AuthorizationDecisionLog"(
    "organizationId", "patientSubjectPrincipalId", "createdAt"
  );
CREATE INDEX "AuthorizationDecisionLog_patientAuthorityId_idx"
  ON "AuthorizationDecisionLog"("patientAuthorityId");
CREATE INDEX "AuthorizationDecisionLog_patientConsentDirectiveId_idx"
  ON "AuthorizationDecisionLog"("patientConsentDirectiveId");

ALTER TABLE "PatientProfile"
  ADD CONSTRAINT "PatientProfile_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PatientProfile_principalId_fkey"
  FOREIGN KEY ("principalId") REFERENCES "Principal"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PatientProfile_recordedByPrincipalId_fkey"
  FOREIGN KEY ("recordedByPrincipalId") REFERENCES "Principal"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PatientProfile_verifiedByPrincipalId_fkey"
  FOREIGN KEY ("verifiedByPrincipalId") REFERENCES "Principal"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PatientProfile_mergedIntoPatientProfileId_organizationId_fkey"
  FOREIGN KEY ("mergedIntoPatientProfileId", "organizationId")
  REFERENCES "PatientProfile"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PatientAuthority"
  ADD CONSTRAINT "PatientAuthority_patientProfileId_organizationId_fkey"
  FOREIGN KEY ("patientProfileId", "organizationId")
  REFERENCES "PatientProfile"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PatientAuthority_granteePrincipalId_fkey"
  FOREIGN KEY ("granteePrincipalId") REFERENCES "Principal"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PatientAuthority_assertedByPrincipalId_fkey"
  FOREIGN KEY ("assertedByPrincipalId") REFERENCES "Principal"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PatientAuthority_verifiedByPrincipalId_fkey"
  FOREIGN KEY ("verifiedByPrincipalId") REFERENCES "Principal"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PatientAuthority_revokedByPrincipalId_fkey"
  FOREIGN KEY ("revokedByPrincipalId") REFERENCES "Principal"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PatientAuthority_supersedesAuthorityId_organizationId_pati_fkey"
  FOREIGN KEY ("supersedesAuthorityId", "organizationId", "patientProfileId")
  REFERENCES "PatientAuthority"("id", "organizationId", "patientProfileId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PatientConsentDirective"
  ADD CONSTRAINT "PatientConsentDirective_patientProfileId_organizationId_fkey"
  FOREIGN KEY ("patientProfileId", "organizationId")
  REFERENCES "PatientProfile"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PatientConsentDirective_assertedByPrincipalId_fkey"
  FOREIGN KEY ("assertedByPrincipalId") REFERENCES "Principal"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PatientConsentDirective_verifiedByPrincipalId_fkey"
  FOREIGN KEY ("verifiedByPrincipalId") REFERENCES "Principal"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PatientConsentDirective_revokedByPrincipalId_fkey"
  FOREIGN KEY ("revokedByPrincipalId") REFERENCES "Principal"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PatientConsentDirective_supersedesDirectiveId_organization_fkey"
  FOREIGN KEY ("supersedesDirectiveId", "organizationId", "patientProfileId")
  REFERENCES "PatientConsentDirective"("id", "organizationId", "patientProfileId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuthorizationDecisionLog"
  ADD CONSTRAINT "AuthorizationDecisionLog_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AuthorizationDecisionLog_patientSubjectPrincipalId_fkey"
  FOREIGN KEY ("patientSubjectPrincipalId") REFERENCES "Principal"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AuthorizationDecisionLog_patientAuthorityId_fkey"
  FOREIGN KEY ("patientAuthorityId") REFERENCES "PatientAuthority"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AuthorizationDecisionLog_patientConsentDirectiveId_fkey"
  FOREIGN KEY ("patientConsentDirectiveId") REFERENCES "PatientConsentDirective"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Patient-bearing tables fail closed unless both tenant and patient context are
-- set on the current transaction. Staff and patient repositories must set these
-- with set_config(..., true) before accessing the tables.
ALTER TABLE "PatientProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PatientProfile" FORCE ROW LEVEL SECURITY;
CREATE POLICY "PatientProfile_context_policy" ON "PatientProfile"
  USING (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND "principalId" = ANY(
      string_to_array(
        NULLIF(current_setting('app.patient_principal_ids', true), ''),
        ','
      )
    )
  )
  WITH CHECK (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND "principalId" = ANY(
      string_to_array(
        NULLIF(current_setting('app.patient_principal_ids', true), ''),
        ','
      )
    )
  );

ALTER TABLE "PatientAuthority" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PatientAuthority" FORCE ROW LEVEL SECURITY;
CREATE POLICY "PatientAuthority_context_policy" ON "PatientAuthority"
  USING (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND EXISTS (
      SELECT 1
      FROM "PatientProfile" profile
      WHERE profile."id" = "PatientAuthority"."patientProfileId"
        AND profile."organizationId" = "PatientAuthority"."organizationId"
    )
  )
  WITH CHECK (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND EXISTS (
      SELECT 1
      FROM "PatientProfile" profile
      WHERE profile."id" = "PatientAuthority"."patientProfileId"
        AND profile."organizationId" = "PatientAuthority"."organizationId"
    )
  );

ALTER TABLE "PatientConsentDirective" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PatientConsentDirective" FORCE ROW LEVEL SECURITY;
CREATE POLICY "PatientConsentDirective_context_policy"
  ON "PatientConsentDirective"
  USING (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND EXISTS (
      SELECT 1
      FROM "PatientProfile" profile
      WHERE profile."id" = "PatientConsentDirective"."patientProfileId"
        AND profile."organizationId" = "PatientConsentDirective"."organizationId"
    )
  )
  WITH CHECK (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND EXISTS (
      SELECT 1
      FROM "PatientProfile" profile
      WHERE profile."id" = "PatientConsentDirective"."patientProfileId"
        AND profile."organizationId" = "PatientConsentDirective"."organizationId"
    )
  );
