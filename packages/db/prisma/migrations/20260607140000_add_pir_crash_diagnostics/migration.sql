-- BI-B4F401B3: crash-boundary diagnostics on PlatformIssueReport.
-- Additive, nullable columns — existing rows are unaffected.
-- errorDigest: Next.js server digest token (stable per real error on a build);
--   lets operators/AI clients grep server logs for the sanitized-away message
--   and lets triage dedup a whole crash incident across routes.
-- deployedSha: git SHA of the running image at crash time; anchors the
--   diagnostic prompt to the exact build that crashed.
ALTER TABLE "PlatformIssueReport" ADD COLUMN "errorDigest" TEXT;
ALTER TABLE "PlatformIssueReport" ADD COLUMN "deployedSha" TEXT;

-- Powers cross-route incident dedup at triage time.
CREATE INDEX "PlatformIssueReport_errorDigest_idx" ON "PlatformIssueReport"("errorDigest");
