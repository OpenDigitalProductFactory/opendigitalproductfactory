-- BI-HEALTHCARE-012 Phase 2A: the original intake policy constrained rows to
-- the organization but did not consume the repository's patient context.
-- Replace it with an explicit allow-list of patient profile ids. Missing or
-- empty patient context fails closed.
-- @migration-safety: data-safe: replaces RLS policies only; no rows or constraints are changed.

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
    policy_name := table_name || '_context_policy';
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I '
      || 'USING ("organizationId" = NULLIF(current_setting(''app.organization_id'', true), '''') '
      || 'AND "patientProfileId" = ANY(string_to_array(NULLIF(current_setting(''app.patient_profile_ids'', true), ''''), '',''))) '
      || 'WITH CHECK ("organizationId" = NULLIF(current_setting(''app.organization_id'', true), '''') '
      || 'AND "patientProfileId" = ANY(string_to_array(NULLIF(current_setting(''app.patient_profile_ids'', true), ''''), '','')))',
      policy_name,
      table_name
    );
  END LOOP;
END $$;
