-- Seed Build Studio UX Streamlining epic
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/seed-build-ux-streamlining-epic.sql
DO $$
DECLARE
  found_id TEXT;
  epic_id  TEXT;
BEGIN
  SELECT id INTO found_id FROM "Portfolio" WHERE slug = 'foundational';

  INSERT INTO "Epic" (id, "epicId", title, description, status, "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    'EP-' || gen_random_uuid()::text,
    'Build Studio UX Streamlining & Standards Integration',
    'Wire UX evaluation into the AI coworker (axe-core + Playwright page analysis), integrate platform usability standards into the Build Studio pipeline (coding agent prompts, review checklists, Playwright assertions, phase gates), and automate the evidence chain for non-developer users. Dev toggle gates technical depth. Non-devs describe intent in plain language, agent produces all regulatory artifacts autonomously.',
    'open', NOW(), NOW()
  ) RETURNING id INTO epic_id;

  IF found_id IS NOT NULL THEN
    INSERT INTO "EpicPortfolio" ("epicId", "portfolioId")
    VALUES (epic_id, found_id);
  END IF;

  INSERT INTO "BacklogItem" (id, "itemId", title, type, status, priority, "epicId", "createdAt", "updatedAt")
  VALUES
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Add "Evaluate this page" universal skill and evaluate_page MCP tool with axe-core + Playwright page analysis',
     'portfolio', 'open', 1, epic_id, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Create page-evaluator.ts with axe-core accessibility audit, focus order testing, CSS variable compliance checking, and responsive viewport captures',
     'portfolio', 'open', 2, epic_id, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Wire UX standards into coding-agent.ts prompt and build-agent-prompts.ts (semantic HTML, ARIA, keyboard, contrast, color-not-sole-conveyor)',
     'portfolio', 'open', 3, epic_id, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Add accessibility items to design review (item 8) and code review (items 6-7) checklists in build-reviewers.ts',
     'portfolio', 'open', 4, epic_id, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Replace Playwright screenshot skeleton with axe-core assertions, focus visibility checks, and CSS variable compliance in playwright-runner.ts',
     'portfolio', 'open', 5, epic_id, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Add uxTestResults to FeatureBuildRow type and make UX tests a required phase gate for Review to Ship',
     'portfolio', 'open', 6, epic_id, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Update all Build Studio phase prompts for autonomous operation — agent produces artifacts, user confirms intent in plain language, Dev toggle gates technical depth',
     'portfolio', 'open', 7, epic_id, NOW(), NOW());

END $$;
