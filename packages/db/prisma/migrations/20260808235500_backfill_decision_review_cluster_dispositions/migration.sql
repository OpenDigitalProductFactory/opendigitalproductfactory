-- BI-76EEDEE8: prior WWWD capture updated only the selected ledger row. An
-- older exact occurrence then remained in "Waiting on your call", making the
-- completed review appear not to work. Preserve every audit row, but carry a
-- proven owner disposition to still-open rows with the same conservative
-- review identity: profile + domain + normalized question.
--
-- Do not use similarity or domain alone: a business answer may never be
-- assigned to a merely related decision without the operator's involvement.
WITH resolved_source AS (
  SELECT DISTINCT ON (
    "profileId",
    "domainClass",
    lower(regexp_replace(trim(question), '[[:space:]]+', ' ', 'g'))
  )
    "profileId",
    "domainClass",
    lower(regexp_replace(trim(question), '[[:space:]]+', ' ', 'g')) AS normalized_question,
    "interactionId" AS source_interaction_id,
    "humanOutcome" AS source_outcome
  FROM "DecisionInteraction"
  WHERE "buildId" IS NULL
    AND "routeContext" = '/coworker-business'
    AND "outcomeType" IN ('defer', 'escalate')
    AND "humanOutcome" IS NOT NULL
    AND trim(question) <> ''
  ORDER BY
    "profileId",
    "domainClass",
    lower(regexp_replace(trim(question), '[[:space:]]+', ' ', 'g')),
    CASE
      WHEN "humanOutcome"->>'type' IN ('escalation', 'deferral') THEN 0
      ELSE 1
    END,
    "createdAt" DESC
), inherited_disposition AS (
  SELECT
    open_row.id,
    source.source_outcome
      || jsonb_build_object(
        'resolvedVia', 'review-cluster-backfill',
        'sourceInteractionId', source.source_interaction_id
      ) AS inherited_outcome
  FROM "DecisionInteraction" AS open_row
  JOIN resolved_source AS source
    ON source."profileId" = open_row."profileId"
   AND source."domainClass" = open_row."domainClass"
   AND source.normalized_question = lower(regexp_replace(trim(open_row.question), '[[:space:]]+', ' ', 'g'))
  WHERE open_row."buildId" IS NULL
    AND open_row."routeContext" = '/coworker-business'
    AND open_row."outcomeType" IN ('defer', 'escalate')
    AND open_row."humanOutcome" IS NULL
    AND trim(open_row.question) <> ''
)
UPDATE "DecisionInteraction" AS target
SET "humanOutcome" = inherited_disposition.inherited_outcome,
    "updatedAt" = CURRENT_TIMESTAMP
FROM inherited_disposition
WHERE target.id = inherited_disposition.id
  AND target."humanOutcome" IS NULL;
