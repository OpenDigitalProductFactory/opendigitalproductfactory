-- Work-kind discriminator for Build Studio builds (FEATURE_BUILD_KIND_VALUES in
-- apps/web/lib/explore/feature-build-types.ts): "feature" | "fix".
-- Default "feature" backfills every existing and in-flight build, so behavior
-- is byte-identical until a bug-sourced backlog item is promoted as a fix.
ALTER TABLE "FeatureBuild" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'feature';
