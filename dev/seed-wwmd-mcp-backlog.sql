-- Seed Epic EP-WWMD-MCP + 12 child BacklogItem stories
-- Idempotent: ON CONFLICT clauses make this re-runnable.
-- Spec: docs/superpowers/specs/2026-05-19-wwmd-mcp-exposure-design.md
-- Plan: docs/superpowers/plans/2026-05-19-wwmd-mcp-exposure.md
-- PR:   opendigitalproductfactory#813

BEGIN;

-- Epic
INSERT INTO "Epic" (id, "epicId", title, description, status, priority, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'EP-WWMD-MCP',
  'WWMD MCP Exposure — Sprint 1',
  E'Expose the existing WWMD decision-perspective evaluator as two MCP tools (wwmd_evaluate, wwmd_record_outcome) so external agent sessions (Claude Code, Codex CLI) can consult Mark''s decision substrate before asking him recurring micro-decisions.\n\nSpec: docs/superpowers/specs/2026-05-19-wwmd-mcp-exposure-design.md\nPlan: docs/superpowers/plans/2026-05-19-wwmd-mcp-exposure.md\nPR: opendigitalproductfactory#813',
  'open',
  5,
  NOW(),
  NOW()
)
ON CONFLICT ("epicId") DO UPDATE
  SET title = EXCLUDED.title,
      description = EXCLUDED.description,
      status = EXCLUDED.status,
      priority = EXCLUDED.priority,
      "updatedAt" = NOW();

-- Resolve the Epic's cuid (Prisma uses id, not epicId, as the FK target for BacklogItem.epicId per project_backlog_epic_fk_pitfall)
DO $$
DECLARE
  epic_cuid TEXT;
BEGIN
  SELECT id INTO epic_cuid FROM "Epic" WHERE "epicId" = 'EP-WWMD-MCP';

  -- Story 01
  INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, "triageOutcome", "effortSize", source, "epicId", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, 'BI-WWMD-MCP-01',
    'Task 1 — Module skeleton & registration scaffold',
    E'Create apps/web/lib/mcp-tools-wwmd.ts + .test.ts. Export WWMD_TOOLS: ToolDefinition[] = []; stub handlers wwmdEvaluateMcpHandler and wwmdRecordOutcomeMcpHandler. Wire into apps/web/lib/mcp-tools.ts alongside DELIBERATION_TOOLS. TDD per plan Task 1.',
    'product', 'open', 'build', 'small', 'spec', epic_cuid, NOW(), NOW())
  ON CONFLICT ("itemId") DO UPDATE SET title=EXCLUDED.title, body=EXCLUDED.body, type=EXCLUDED.type, status=EXCLUDED.status, "triageOutcome"=EXCLUDED."triageOutcome", "effortSize"=EXCLUDED."effortSize", source=EXCLUDED.source, "epicId"=EXCLUDED."epicId", "updatedAt"=NOW();

  -- Story 02
  INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, "triageOutcome", "effortSize", source, "epicId", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, 'BI-WWMD-MCP-02',
    'Task 2 — Question fingerprint utility',
    E'Create apps/web/lib/decision-perspective/fingerprint.ts exporting computeQuestionFingerprint. Normalization: lowercase + collapse whitespace + strip trailing punctuation, options sorted, sha256 → first 32 hex chars, output ''QF-<hash>''. Pure function. TDD per plan Task 2.',
    'product', 'open', 'build', 'small', 'spec', epic_cuid, NOW(), NOW())
  ON CONFLICT ("itemId") DO UPDATE SET title=EXCLUDED.title, body=EXCLUDED.body, "effortSize"=EXCLUDED."effortSize", "epicId"=EXCLUDED."epicId", "updatedAt"=NOW();

  -- Story 03
  INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, "triageOutcome", "effortSize", source, "epicId", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, 'BI-WWMD-MCP-03',
    'Task 3 — Schema migration: questionFingerprint column on DecisionInteraction',
    E'Add VARCHAR(64) NOT NULL DEFAULT '''' column and composite index (profileId, questionFingerprint, createdAt desc) to DecisionInteraction. Empty sentinel for legacy rows; dedupe ignores empty fingerprints. Per plan Task 3.',
    'product', 'open', 'build', 'small', 'spec', epic_cuid, NOW(), NOW())
  ON CONFLICT ("itemId") DO UPDATE SET title=EXCLUDED.title, body=EXCLUDED.body, "effortSize"=EXCLUDED."effortSize", "epicId"=EXCLUDED."epicId", "updatedAt"=NOW();

  -- Story 04
  INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, "triageOutcome", "effortSize", source, "epicId", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, 'BI-WWMD-MCP-04',
    'Task 4 — Persist fingerprint on write',
    E'Update persistDecisionInteraction (apps/web/lib/decision-perspective/persistence.ts) to accept optional questionFingerprint and default-compute from evaluation fields. Non-breaking for existing build-studio-gate caller. TDD per plan Task 4.',
    'product', 'open', 'build', 'small', 'spec', epic_cuid, NOW(), NOW())
  ON CONFLICT ("itemId") DO UPDATE SET title=EXCLUDED.title, body=EXCLUDED.body, "effortSize"=EXCLUDED."effortSize", "epicId"=EXCLUDED."epicId", "updatedAt"=NOW();

  -- Story 05
  INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, "triageOutcome", "effortSize", source, "epicId", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, 'BI-WWMD-MCP-05',
    'Task 5 — Fingerprint dedup lookup',
    E'Add findDecisionInteractionByFingerprint to persistence.ts. Returns most recent match within withinDays (default 30); null on empty fingerprint or cleared interactions. TDD per plan Task 5.',
    'product', 'open', 'build', 'small', 'spec', epic_cuid, NOW(), NOW())
  ON CONFLICT ("itemId") DO UPDATE SET title=EXCLUDED.title, body=EXCLUDED.body, "effortSize"=EXCLUDED."effortSize", "epicId"=EXCLUDED."epicId", "updatedAt"=NOW();

  -- Story 06
  INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, "triageOutcome", "effortSize", source, "epicId", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, 'BI-WWMD-MCP-06',
    'Task 6 — wwmd_evaluate handler',
    E'Implement wwmdEvaluateMcpHandler in mcp-tools-wwmd.ts. Flow: validate → fingerprint → dedupe lookup → resolveProfileMaterial → evaluateDecisionPerspective → persist → return DecisionResult + recommendedOption + interactionId + operatorMessage. Coverage-gap path writes NO record. Widens persistDecisionInteraction signature (optional routeContext/phaseFrom/phaseTo) without breaking existing callers. TDD per plan Task 6.',
    'product', 'open', 'build', 'medium', 'spec', epic_cuid, NOW(), NOW())
  ON CONFLICT ("itemId") DO UPDATE SET title=EXCLUDED.title, body=EXCLUDED.body, "effortSize"=EXCLUDED."effortSize", "epicId"=EXCLUDED."epicId", "updatedAt"=NOW();

  -- Story 07
  INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, "triageOutcome", "effortSize", source, "epicId", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, 'BI-WWMD-MCP-07',
    'Task 7 — wwmd_evaluate ToolDefinition registration',
    E'Add ToolDefinition for wwmd_evaluate to WWMD_TOOLS. sideEffect:false, executionMode:immediate, readOnlyHint:true, idempotentHint:true. Required inputs: question, options (min 2), domainClass, riskTier. Optional: profileId, evidence, routeContext, agentId. TDD per plan Task 7.',
    'product', 'open', 'build', 'small', 'spec', epic_cuid, NOW(), NOW())
  ON CONFLICT ("itemId") DO UPDATE SET title=EXCLUDED.title, body=EXCLUDED.body, "effortSize"=EXCLUDED."effortSize", "epicId"=EXCLUDED."epicId", "updatedAt"=NOW();

  -- Story 08
  INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, "triageOutcome", "effortSize", source, "epicId", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, 'BI-WWMD-MCP-08',
    'Task 8 — wwmd_record_outcome handler',
    E'Implement wwmdRecordOutcomeMcpHandler. Validate → load interaction → enforce 20-per-agent-per-24h rate limit → create PerspectiveMaterial(sourceType:''interaction-outcome'', reviewStatus:''draft'', promotionState:''candidate'', evidenceGrade:''C'', confidenceWeight:0.5) → append humanOutcome to source DecisionInteraction. NON-NEGOTIABLE: draft/candidate regardless of caller identity (spec §3.3). TDD per plan Task 8.',
    'product', 'open', 'build', 'medium', 'spec', epic_cuid, NOW(), NOW())
  ON CONFLICT ("itemId") DO UPDATE SET title=EXCLUDED.title, body=EXCLUDED.body, "effortSize"=EXCLUDED."effortSize", "epicId"=EXCLUDED."epicId", "updatedAt"=NOW();

  -- Story 09
  INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, "triageOutcome", "effortSize", source, "epicId", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, 'BI-WWMD-MCP-09',
    'Task 9 — wwmd_record_outcome ToolDefinition registration',
    E'Add ToolDefinition for wwmd_record_outcome. sideEffect:true, destructiveHint:false (additive write). Required: interactionId, chosenOption, rationale, overrodeRecommendation. TDD per plan Task 9.',
    'product', 'open', 'build', 'small', 'spec', epic_cuid, NOW(), NOW())
  ON CONFLICT ("itemId") DO UPDATE SET title=EXCLUDED.title, body=EXCLUDED.body, "effortSize"=EXCLUDED."effortSize", "epicId"=EXCLUDED."epicId", "updatedAt"=NOW();

  -- Story 10
  INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, "triageOutcome", "effortSize", source, "epicId", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, 'BI-WWMD-MCP-10',
    'Task 10 — [wwmd-trace] durable logging',
    E'Add console.log(''[wwmd-trace] ...'') statements at evaluate-entry, dedup-hit, evaluate-exit, coverage-gap, record-entry, rate-limited, record-ok. Mirrors the [tool-trace] convention from PR #140. TDD with vi.spyOn(console,''log''). Per plan Task 10.',
    'product', 'open', 'build', 'small', 'spec', epic_cuid, NOW(), NOW())
  ON CONFLICT ("itemId") DO UPDATE SET title=EXCLUDED.title, body=EXCLUDED.body, "effortSize"=EXCLUDED."effortSize", "epicId"=EXCLUDED."epicId", "updatedAt"=NOW();

  -- Story 11
  INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, "triageOutcome", "effortSize", source, "epicId", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, 'BI-WWMD-MCP-11',
    'Task 11 — Golden-path integration test',
    E'Create apps/web/lib/mcp-tools-wwmd.golden.test.ts. Seed MARK_DPF_PLATFORM_PROFILE + spec-commit-plan principle material → call wwmd_evaluate with the literal recurring question, assert recommend/arbitrate + confidence ≥ 0.55. Second call dedupes. wwmd_record_outcome lands as draft/candidate. 21st record call returns rate_limited. Coverage-gap call produces zero state mutations. Per spec §3.1 + plan Task 11.',
    'product', 'open', 'build', 'medium', 'spec', epic_cuid, NOW(), NOW())
  ON CONFLICT ("itemId") DO UPDATE SET title=EXCLUDED.title, body=EXCLUDED.body, "effortSize"=EXCLUDED."effortSize", "epicId"=EXCLUDED."epicId", "updatedAt"=NOW();

  -- Story 12
  INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, "triageOutcome", "effortSize", source, "epicId", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, 'BI-WWMD-MCP-12',
    'Task 12 — Operator-facing documentation',
    E'Create docs/operators/wwmd-mcp-quickstart.md covering: what wwmd_evaluate does, when to call from Claude Code / Codex, outcome→behavior table (from spec §5), wwmd_record_outcome worked example using the commit-spec-plan question, 20/24h rate cap, draft-only invariant, link to existing review surface. Cross-link from spec. Per plan Task 12.',
    'product', 'open', 'build', 'small', 'spec', epic_cuid, NOW(), NOW())
  ON CONFLICT ("itemId") DO UPDATE SET title=EXCLUDED.title, body=EXCLUDED.body, "effortSize"=EXCLUDED."effortSize", "epicId"=EXCLUDED."epicId", "updatedAt"=NOW();
END $$;

COMMIT;

-- Verification
SELECT 'EPIC' AS kind, "epicId" AS id, status, priority FROM "Epic" WHERE "epicId" = 'EP-WWMD-MCP';
SELECT 'STORY' AS kind, b."itemId" AS id, b.status, b."triageOutcome" AS triage, b."effortSize" AS effort
  FROM "BacklogItem" b
  JOIN "Epic" e ON b."epicId" = e.id
  WHERE e."epicId" = 'EP-WWMD-MCP'
  ORDER BY b."itemId";
