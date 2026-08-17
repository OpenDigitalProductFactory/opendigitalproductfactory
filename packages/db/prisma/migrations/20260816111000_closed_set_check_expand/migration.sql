-- Closed-set CHECK expand (BI-817ED2D4, Simplify & Strengthen W4, architecture
-- pass 2026-08-16 §3.2-a). For the 30 long-lived closed-set String columns
-- where direct enum conversion is NOT provably safe on fleet installs, add a
-- named `<Table>_<column>_closed_set` CHECK constraint, NOT VALID:
--
--   - NEW writes are enforced against the closed set immediately;
--   - existing rows are not validated at migration time, so this can never
--     wedge the forward-only chain on any install's data state;
--   - each set = the canonical vocabulary UNION the legacy values observed on
--     the live reference install 2026-08-16 (e.g. BacklogItem.status
--     'blocked', FeatureBuild.phase 'panicked'). Postgres re-checks NOT VALID
--     constraints on UPDATE, so tolerated legacy vocabulary must be IN the
--     set or updates to old rows would start failing — the contract step
--     (docs/superpowers/plans/2026-08-16-enum-contract-step-proposal.md)
--     normalizes those values and tightens the sets before the enum flip.
--
-- Constraint naming is load-bearing: scripts/check-no-new-closed-set-strings.mjs
-- recognizes a column as governed by matching `ADD CONSTRAINT
-- "<Table>_<column>_closed_set"` in a committed migration.
--
-- @migration-safety: expand-contract: every constraint below is NOT VALID
-- (never validated against existing rows at apply time); the only row
-- mutations are the three unambiguous normalizations at the top (empty-string
-- to NULL, and exact case/abbreviation variants of effort sizes to their
-- canonical spelling), each scoped to exact literal matches.

-- ── Unambiguous legacy normalization (in-file remediation) ───────────────────

-- Empty string is not a vocabulary value on any writer path; NULL is the
-- honest "unset". Observed live: triageOutcome '' x23, source '' x1,
-- effortSize '' x1.
UPDATE "BacklogItem" SET "triageOutcome" = NULL WHERE "triageOutcome" = '';
UPDATE "BacklogItem" SET "source" = NULL WHERE "source" = '';
UPDATE "BacklogItem" SET "effortSize" = NULL WHERE "effortSize" = '';

-- Case/abbreviation variants of the canonical effort sizes (observed live:
-- s/S/m/M/l/L). 'xs'/'XS' are NOT mapped — no canonical 'xs' exists and
-- mapping them to 'small' is a semantic call reserved for the contract step.
UPDATE "BacklogItem" SET "effortSize" = 'small'  WHERE "effortSize" IN ('s', 'S');
UPDATE "BacklogItem" SET "effortSize" = 'medium' WHERE "effortSize" IN ('m', 'M');
UPDATE "BacklogItem" SET "effortSize" = 'large'  WHERE "effortSize" IN ('l', 'L');

-- ── BacklogItem ──────────────────────────────────────────────────────────────

-- 'blocked' is live legacy (4 rows on the reference install); contract step
-- decides its mapping.
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_status_closed_set"
  CHECK ("status" IN ('triaging', 'open', 'in-progress', 'done', 'deferred', 'retired', 'blocked')) NOT VALID;
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_type_closed_set"
  CHECK ("type" IN ('portfolio', 'product')) NOT VALID;
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_workType_closed_set"
  CHECK ("workType" IN ('bug', 'feature', 'chore', 'doc', 'tool', 'skill', 'refactor')) NOT VALID;
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_triageOutcome_closed_set"
  CHECK ("triageOutcome" IN ('build', 'runbook', 'coworker-task', 'defer', 'duplicate', 'discard')) NOT VALID;
-- 'build-failure', 'hive-scout', 'self-upgrade-failure' are live writer
-- vocabulary that never made it into BACKLOG_SOURCE_VALUES — kept here so
-- those writers keep working; the contract step reconciles union vs writers.
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_source_closed_set"
  CHECK ("source" IN ('user-request', 'automated-detection', 'build-failure', 'hive-scout', 'self-upgrade-failure')) NOT VALID;
-- 'xs'/'XS' tolerated pending the contract-step semantic mapping (see above).
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_effortSize_closed_set"
  CHECK ("effortSize" IN ('small', 'medium', 'large', 'xlarge', 'xs', 'XS')) NOT VALID;
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_scopeKind_closed_set"
  CHECK ("scopeKind" IN ('platform', 'common', 'archetype-category', 'archetype-leaf', 'multi-archetype', 'unknown')) NOT VALID;
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_claimStatus_closed_set"
  CHECK ("claimStatus" IN ('active', 'released')) NOT VALID;

-- ── Epic ─────────────────────────────────────────────────────────────────────

ALTER TABLE "Epic" ADD CONSTRAINT "Epic_status_closed_set"
  CHECK ("status" IN ('open', 'in-progress', 'done')) NOT VALID;
ALTER TABLE "Epic" ADD CONSTRAINT "Epic_scopeKind_closed_set"
  CHECK ("scopeKind" IN ('platform', 'common', 'archetype-category', 'archetype-leaf', 'multi-archetype', 'unknown')) NOT VALID;

-- ── Workroom (table "WorkCapsule") ───────────────────────────────────────────

ALTER TABLE "WorkCapsule" ADD CONSTRAINT "WorkCapsule_status_closed_set"
  CHECK ("status" IN ('draft', 'ready', 'working', 'blocked', 'verifying', 'ready-for-review', 'ready-for-promotion', 'complete', 'abandoned', 'archived')) NOT VALID;
ALTER TABLE "WorkCapsule" ADD CONSTRAINT "WorkCapsule_source_closed_set"
  CHECK ("source" IN ('backlog', 'build-studio', 'external-adoption', 'git-promotion', 'manual', 'scheduled-steward')) NOT VALID;

-- ── FeatureBuild ─────────────────────────────────────────────────────────────

-- 'panicked' is retired writer vocabulary still readable in triage
-- (apps/web/lib/ops/operator-triage.ts); rows may hold it on any install.
ALTER TABLE "FeatureBuild" ADD CONSTRAINT "FeatureBuild_phase_closed_set"
  CHECK ("phase" IN ('ideate', 'plan', 'build', 'review', 'ship', 'complete', 'failed', 'abandoned', 'panicked')) NOT VALID;
ALTER TABLE "FeatureBuild" ADD CONSTRAINT "FeatureBuild_claimStatus_closed_set"
  CHECK ("claimStatus" IN ('active', 'released')) NOT VALID;

-- ── Customer master data ─────────────────────────────────────────────────────

ALTER TABLE "CustomerAccount" ADD CONSTRAINT "CustomerAccount_status_closed_set"
  CHECK ("status" IN ('prospect', 'qualified', 'onboarding', 'active', 'at_risk', 'suspended', 'closed', 'superseded', 'archived')) NOT VALID;
ALTER TABLE "CustomerSite" ADD CONSTRAINT "CustomerSite_status_closed_set"
  CHECK ("status" IN ('active', 'planned', 'inactive', 'superseded', 'archived')) NOT VALID;

-- ── Workforce staffing ───────────────────────────────────────────────────────

ALTER TABLE "StaffingDemand" ADD CONSTRAINT "StaffingDemand_demandShape_closed_set"
  CHECK ("demandShape" IN ('coverage_floor', 'forecast_curve', 'fixed_slot', 'task_pipeline', 'census_load')) NOT VALID;
ALTER TABLE "StaffingDemand" ADD CONSTRAINT "StaffingDemand_sourceType_closed_set"
  CHECK ("sourceType" IN ('forecast', 'manual', 'booking', 'work', 'census')) NOT VALID;
ALTER TABLE "StaffingDemand" ADD CONSTRAINT "StaffingDemand_status_closed_set"
  CHECK ("status" IN ('open', 'partially_covered', 'covered', 'cancelled')) NOT VALID;

-- ── Task orchestration ───────────────────────────────────────────────────────

ALTER TABLE "TaskNode" ADD CONSTRAINT "TaskNode_nodeType_closed_set"
  CHECK ("nodeType" IN ('analyze', 'plan', 'execute', 'review', 'skeptical_review', 'activation_proposal', 'approval_gate', 'verify', 'summarize')) NOT VALID;
ALTER TABLE "TaskNode" ADD CONSTRAINT "TaskNode_status_closed_set"
  CHECK ("status" IN ('queued', 'ready', 'running', 'blocked', 'awaiting_human', 'completed', 'failed', 'cancelled', 'superseded')) NOT VALID;
ALTER TABLE "TaskNode" ADD CONSTRAINT "TaskNode_workerRole_closed_set"
  CHECK ("workerRole" IN ('planner', 'researcher', 'executor', 'reviewer', 'skeptical_reviewer', 'verifier', 'activation_analyst', 'summarizer')) NOT VALID;
ALTER TABLE "TaskNode" ADD CONSTRAINT "TaskNode_dependencyMode_closed_set"
  CHECK ("dependencyMode" IN ('all_of', 'any_of', 'after_parent')) NOT VALID;
ALTER TABLE "TaskNode" ADD CONSTRAINT "TaskNode_influenceLevel_closed_set"
  CHECK ("influenceLevel" IN ('none', 'contextual', 'material')) NOT VALID;
ALTER TABLE "TaskNodeEdge" ADD CONSTRAINT "TaskNodeEdge_edgeType_closed_set"
  CHECK ("edgeType" IN ('depends_on', 'informs', 'verifies', 'blocks', 'supersedes')) NOT VALID;

-- ── Knowledge & wiki ─────────────────────────────────────────────────────────

ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_category_closed_set"
  CHECK ("category" IN ('process', 'policy', 'decision', 'how-to', 'reference', 'troubleshooting', 'runbook')) NOT VALID;
ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_status_closed_set"
  CHECK ("status" IN ('draft', 'published', 'review-needed', 'archived')) NOT VALID;
ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_visibility_closed_set"
  CHECK ("visibility" IN ('internal', 'team', 'public')) NOT VALID;
ALTER TABLE "WikiPage" ADD CONSTRAINT "WikiPage_pageKind_closed_set"
  CHECK ("pageKind" IN ('entity', 'summary', 'decision', 'runbook', 'index', 'stance', 'heuristic', 'principle')) NOT VALID;
ALTER TABLE "WikiPage" ADD CONSTRAINT "WikiPage_status_closed_set"
  CHECK ("status" IN ('draft', 'published', 'review-needed', 'archived')) NOT VALID;
