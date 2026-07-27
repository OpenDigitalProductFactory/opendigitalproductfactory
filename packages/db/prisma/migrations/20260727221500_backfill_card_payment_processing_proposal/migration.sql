-- Backfill the one existing setting with sufficiently explicit processing
-- provenance. This creates a review-only proposal, never legal authorization.
INSERT INTO "DataProcessingActivity" (
  "id",
  "activityId",
  "organizationId",
  "name",
  "purposeKey",
  "ownerRef",
  "status",
  "dataCategories",
  "subjectTypes",
  "authorityRefs",
  "provenance",
  "createdAt",
  "updatedAt"
)
SELECT
  'dpa_backfill_' || substr(md5(bc."organizationId"), 1, 20),
  'DPA-PROPOSED-CARD-PAYMENTS',
  bc."organizationId",
  'Card payment handling (review required)',
  'billing-and-payments',
  'unassigned',
  'review',
  '["financial","identity","contact"]'::jsonb,
  '["customer"]'::jsonb,
  '["REG-PCI-DSS"]'::jsonb,
  jsonb_build_object(
    'source', 'migration-backfill',
    'sourceField', 'BusinessContext.handlesCardPayments',
    'sourceRecordId', bc."id",
    'requiresOwnerConfirmation', true
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "BusinessContext" bc
WHERE bc."handlesCardPayments" = true
ON CONFLICT ("organizationId", "activityId") DO NOTHING;

-- Other industry, jurisdiction, and feature flags lack sufficient accountable
-- owner and purpose provenance. Converting them would silently invent legal
-- authority, so archetype proposals remain an application-level review flow.
