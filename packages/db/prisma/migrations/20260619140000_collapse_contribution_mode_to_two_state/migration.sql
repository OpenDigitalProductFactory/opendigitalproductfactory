-- Private/Public Change Segregation (EP-1A78BAE1): collapse the install-level
-- contribution mode from three values (fork_only | selective | contribute_all)
-- to two (private | contributing). Per-change sharing is decided by the
-- FeatureBuild disposition (suggest-then-confirm) in a later migration, not by
-- this mode. Plan:
-- docs/superpowers/plans/2026-06-19-contribution-model-2state-suggest-confirm.md
--
-- Data-only migration: backfills existing rows. The schema field declaration
-- is intentionally unchanged (the schema-regression guard treats a @default
-- value change as a field removal); fresh-install fail-closed is handled
-- explicitly in the seed (contributionMode: "private"), not via the column
-- default. New creation paths set the value explicitly.

UPDATE "PlatformDevConfig"
SET "contributionMode" = CASE
  WHEN "contributionMode" = 'fork_only' THEN 'private'
  ELSE 'contributing'
END
WHERE "contributionMode" IN ('fork_only', 'selective', 'contribute_all');
