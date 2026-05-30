-- Canonicalize legacy issue-report backlog source to the canonical "bug" value.
-- The issue-report triage writers (apps/web/lib/operate/issue-report-triage.ts
-- and apps/web/lib/queue/functions/issue-report-triage.ts) historically wrote
-- source='issue_report', which is NOT a member of BACKLOG_SOURCE_VALUES
-- (apps/web/lib/explore/backlog.ts). "bug" is the canonical value and is what
-- maps to FeatureBuild.kind='fix' at promote time. Data-only migration.
UPDATE "BacklogItem" SET "source" = 'bug' WHERE "source" = 'issue_report';
