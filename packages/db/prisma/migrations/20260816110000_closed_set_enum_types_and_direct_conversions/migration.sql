-- Closed-set enum adoption, expand step (BI-817ED2D4, Simplify & Strengthen W4,
-- architecture pass 2026-08-16 §3.2-a). Two things happen here:
--
--   1. CREATE TYPE for every vocabulary in the top-40 closed-set cohort. Types
--      in the contract-pending group are created now but not yet bound to a
--      column — the companion migration 20260816111000 adds `*_closed_set`
--      CHECK (NOT VALID) constraints on those columns, and the contract step
--      (docs/superpowers/plans/2026-08-16-enum-contract-step-proposal.md,
--      operator-review-required) flips them to these types later.
--
--   2. Direct String→enum conversion (payroll precedent 20260815200100) for
--      the ten columns where data-safety is provable — see the per-column
--      arguments below.
--
-- @migration-safety: data-safe: every directly-converted column below is cast
-- with USING after a per-column proof that no install can hold an out-of-set
-- value: each column was born with (or behind) a typed TS writer that
-- validates against the same union this type encodes, has never had an
-- untyped writer, and the live reference install was verified 2026-08-16 to
-- hold only in-set (or NULL) values. Columns where that proof could NOT be
-- made (e.g. BacklogItem.status with live legacy 'blocked' rows) are NOT
-- converted here — they take NOT VALID CHECKs in 20260816111000 instead.

-- ── 1. Vocabulary types ──────────────────────────────────────────────────────

-- Group 1: bound to columns by this migration.
CREATE TYPE "BacklogSensitivity" AS ENUM ('public', 'internal', 'confidential', 'restricted');
CREATE TYPE "EstimateSource" AS ENUM ('ai', 'human', 'agreed');
CREATE TYPE "DemandStage" AS ENUM ('raw', 'screened', 'shaped', 'ready');
CREATE TYPE "DemandScoreFramework" AS ENUM ('rice', 'wsjf', 'value_effort', 'weighted');
CREATE TYPE "InvestmentBucket" AS ENUM ('run', 'grow', 'transform');
CREATE TYPE "FeatureBuildKind" AS ENUM ('feature', 'fix', 'chore', 'doc');
CREATE TYPE "ChangeDisposition" AS ENUM ('private', 'shareable');
CREATE TYPE "UxVerificationStatus" AS ENUM ('running', 'complete', 'failed', 'skipped');
CREATE TYPE "DecisionScope" AS ENUM ('wwmd', 'wwwd', 'wsid');
CREATE TYPE "WorkPortfolioRole" AS ENUM ('foundational', 'manufactureAndDeliver', 'forEmployees', 'productsAndServicesSold');

-- Group 2: contract-pending — created now so the contract step is a pure
-- ALTER COLUMN flip; the columns stay TEXT behind `*_closed_set` CHECKs until
-- legacy values are normalized (see the contract proposal).
CREATE TYPE "BacklogItemStatus" AS ENUM ('triaging', 'open', 'in-progress', 'done', 'deferred', 'retired');
CREATE TYPE "BacklogItemType" AS ENUM ('portfolio', 'product');
CREATE TYPE "BacklogWorkType" AS ENUM ('bug', 'feature', 'chore', 'doc', 'tool', 'skill', 'refactor');
CREATE TYPE "BacklogTriageOutcome" AS ENUM ('build', 'runbook', 'coworker-task', 'defer', 'duplicate', 'discard');
CREATE TYPE "BacklogSource" AS ENUM ('user-request', 'automated-detection');
CREATE TYPE "BacklogEffortSize" AS ENUM ('small', 'medium', 'large', 'xlarge');
CREATE TYPE "WorkClaimStatus" AS ENUM ('active', 'released');
CREATE TYPE "EpicStatus" AS ENUM ('open', 'in-progress', 'done');
CREATE TYPE "BacklogScopeKind" AS ENUM ('platform', 'common', 'archetype-category', 'archetype-leaf', 'multi-archetype', 'unknown');
CREATE TYPE "WorkroomStatus" AS ENUM ('draft', 'ready', 'working', 'blocked', 'verifying', 'ready-for-review', 'ready-for-promotion', 'complete', 'abandoned', 'archived');
CREATE TYPE "WorkroomSource" AS ENUM ('backlog', 'build-studio', 'external-adoption', 'git-promotion', 'manual', 'scheduled-steward');
CREATE TYPE "FeatureBuildPhase" AS ENUM ('ideate', 'plan', 'build', 'review', 'ship', 'complete', 'failed', 'abandoned');
CREATE TYPE "CustomerAccountStatus" AS ENUM ('prospect', 'qualified', 'onboarding', 'active', 'at_risk', 'suspended', 'closed', 'superseded', 'archived');
CREATE TYPE "CustomerSiteStatus" AS ENUM ('active', 'planned', 'inactive', 'superseded', 'archived');
CREATE TYPE "StaffingDemandShape" AS ENUM ('coverage_floor', 'forecast_curve', 'fixed_slot', 'task_pipeline', 'census_load');
CREATE TYPE "StaffingDemandSourceType" AS ENUM ('forecast', 'manual', 'booking', 'work', 'census');
CREATE TYPE "StaffingDemandStatus" AS ENUM ('open', 'partially_covered', 'covered', 'cancelled');
CREATE TYPE "TaskNodeType" AS ENUM ('analyze', 'plan', 'execute', 'review', 'skeptical_review', 'activation_proposal', 'approval_gate', 'verify', 'summarize');
CREATE TYPE "TaskNodeStatus" AS ENUM ('queued', 'ready', 'running', 'blocked', 'awaiting_human', 'completed', 'failed', 'cancelled', 'superseded');
CREATE TYPE "TaskNodeWorkerRole" AS ENUM ('planner', 'researcher', 'executor', 'reviewer', 'skeptical_reviewer', 'verifier', 'activation_analyst', 'summarizer');
CREATE TYPE "TaskNodeDependencyMode" AS ENUM ('all_of', 'any_of', 'after_parent');
CREATE TYPE "TaskNodeInfluenceLevel" AS ENUM ('none', 'contextual', 'material');
CREATE TYPE "TaskNodeEdgeType" AS ENUM ('depends_on', 'informs', 'verifies', 'blocks', 'supersedes');
CREATE TYPE "KnowledgeArticleCategory" AS ENUM ('process', 'policy', 'decision', 'how-to', 'reference', 'troubleshooting', 'runbook');
CREATE TYPE "KnowledgeDocStatus" AS ENUM ('draft', 'published', 'review-needed', 'archived');
CREATE TYPE "KnowledgeVisibility" AS ENUM ('internal', 'team', 'public');
CREATE TYPE "WikiPageKind" AS ENUM ('entity', 'summary', 'decision', 'runbook', 'index', 'stance', 'heuristic', 'principle');

-- ── 2. Direct conversions ────────────────────────────────────────────────────

-- BacklogItem.sensitivity: born 20260807234500 with DEFAULT 'internal'; sole
-- write path normalizes through BACKLOG_SENSITIVITY_VALUES
-- (apps/web/lib/federation/cross-org-sharing.ts, fail-closed to 'internal').
-- Live check 2026-08-16: only 'internal'.
ALTER TABLE "BacklogItem"
  ALTER COLUMN "sensitivity" DROP DEFAULT,
  ALTER COLUMN "sensitivity" TYPE "BacklogSensitivity" USING ("sensitivity"::"BacklogSensitivity"),
  ALTER COLUMN "sensitivity" SET DEFAULT 'internal';

-- BacklogItem.estimateSource: born with EP-DELIVERY-FLOW BI-E731A6C1; written
-- only by the record_effort_estimate resolver against ESTIMATE_SOURCE_VALUES
-- (apps/web/lib/demand/estimate-provenance.ts). Live check: all NULL.
-- BacklogItem.demandStage / demandScoreFramework / investmentBucket: born with
-- EP-DEMAND-MGMT; written only by the scoring/transition MCP tools whose input
-- schemas enum-constrain the values (apps/web/lib/explore/backlog.ts unions +
-- backlog-enums.test.ts parity suite). Live check: only in-set or NULL.
ALTER TABLE "BacklogItem"
  ALTER COLUMN "estimateSource" TYPE "EstimateSource" USING ("estimateSource"::"EstimateSource"),
  ALTER COLUMN "demandStage" TYPE "DemandStage" USING ("demandStage"::"DemandStage"),
  ALTER COLUMN "demandScoreFramework" TYPE "DemandScoreFramework" USING ("demandScoreFramework"::"DemandScoreFramework"),
  ALTER COLUMN "investmentBucket" TYPE "InvestmentBucket" USING ("investmentBucket"::"InvestmentBucket");

-- FeatureBuild.kind: born 20260530000100 with DEFAULT 'feature'; derived at
-- promote time from FEATURE_BUILD_KIND_VALUES (typed union). Live check: only
-- 'feature'/'fix'/'doc'.
-- FeatureBuild.disposition: born 20260619150000 with DEFAULT 'private'
-- (fail-closed); the only write door is the set_change_disposition MCP tool
-- whose input schema is enum('private','shareable'). Live check: in-set.
-- FeatureBuild.uxVerificationStatus: born 20260420010000, nullable; writers
-- set only the four literals (e.g. build-review-verification-trigger.ts).
-- Live check: only 'complete'/'skipped'/NULL.
ALTER TABLE "FeatureBuild"
  ALTER COLUMN "kind" DROP DEFAULT,
  ALTER COLUMN "kind" TYPE "FeatureBuildKind" USING ("kind"::"FeatureBuildKind"),
  ALTER COLUMN "kind" SET DEFAULT 'feature',
  ALTER COLUMN "disposition" DROP DEFAULT,
  ALTER COLUMN "disposition" TYPE "ChangeDisposition" USING ("disposition"::"ChangeDisposition"),
  ALTER COLUMN "disposition" SET DEFAULT 'private',
  ALTER COLUMN "uxVerificationStatus" TYPE "UxVerificationStatus" USING ("uxVerificationStatus"::"UxVerificationStatus");

-- Workroom (table "WorkCapsule") decisionScope/portfolioRole: born together in
-- 20260630045000; the only write path runs normalizeDecisionScope /
-- normalizePortfolioRole (apps/web/lib/work-capsules.ts), which THROW on any
-- value outside the union — no unvalidated writer has ever existed. Live
-- check: only in-set or NULL.
ALTER TABLE "WorkCapsule"
  ALTER COLUMN "decisionScope" TYPE "DecisionScope" USING ("decisionScope"::"DecisionScope"),
  ALTER COLUMN "portfolioRole" TYPE "WorkPortfolioRole" USING ("portfolioRole"::"WorkPortfolioRole");
