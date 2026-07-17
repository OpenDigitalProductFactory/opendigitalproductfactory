-- BI-HEALTHCARE-012 Phase 2B: receptionist review needs organization-wide,
-- payload-minimized visibility while patient self-service remains subject-only.
-- Staff context is set only after employee capability authorization and is
-- bound to an actor principal plus the exact intake-review purpose.
-- @migration-safety: data-safe: adds RLS policies only; no rows or constraints are changed.

DO $$
DECLARE
  table_name TEXT;
  policy_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'CareIntakePacket',
    'CareIntakeResponse',
    'CareIntakeAccessGrant',
    'CareConsentAttestation',
    'CareCoverageEvidence',
    'CareIntakeException',
    'CareIntakeStatusEvent'
  ]
  LOOP
    policy_name := table_name || '_staff_review_select_policy';
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING ('
      || '"organizationId" = NULLIF(current_setting(''app.organization_id'', true), '''') '
      || 'AND NULLIF(current_setting(''app.care_intake_staff_principal_id'', true), '''') IS NOT NULL '
      || 'AND current_setting(''app.care_intake_access_purpose'', true) = ''intake-review'')',
      policy_name,
      table_name
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS "CareIntakeAccessGrant_staff_revoke_update_policy"
  ON "CareIntakeAccessGrant";
CREATE POLICY "CareIntakeAccessGrant_staff_revoke_update_policy"
  ON "CareIntakeAccessGrant"
  FOR UPDATE
  USING (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND NULLIF(current_setting('app.care_intake_staff_principal_id', true), '') IS NOT NULL
    AND current_setting('app.care_intake_access_purpose', true) = 'intake-review'
  )
  WITH CHECK (
    "organizationId" = NULLIF(current_setting('app.organization_id', true), '')
    AND NULLIF(current_setting('app.care_intake_staff_principal_id', true), '') IS NOT NULL
    AND current_setting('app.care_intake_access_purpose', true) = 'intake-review'
  );
