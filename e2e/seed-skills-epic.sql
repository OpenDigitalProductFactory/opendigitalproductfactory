-- Seed EP-SKILL-001: AI Coworker Skills Marketplace & Continuous Improvement
-- Run: MSYS_NO_PATHCONV=1 docker exec -i dpf-postgres-1 psql -U dpf -d dpf < e2e/seed-skills-epic.sql

BEGIN;

-- 1. Create the Epic
INSERT INTO "Epic" (id, "epicId", title, description, status, "createdAt", "updatedAt")
VALUES (
  'ep_skill_001_id',
  'EP-SKILL-001',
  'AI Coworker Skills Marketplace & Continuous Improvement',
  'Make skill curation and continuous improvement a first-class platform capability. Integrate external skills marketplaces (SkillsMP, SkillsLLM) and the Agent Skills open standard (SKILL.md) into AI Coworker definitions. Discover, evaluate (via TAK governance), install, track, and improve skills per-coworker across all 46 agents (10 personas, 9 orchestrators, 33 specialists, 4 cross-cutting). Implements a 5-stage loop: Discover > Evaluate > Install > Operate > Improve. Aligns to IT4IT Detect to Correct (SS5.7) for operational improvement and Explore (SS5.2) for capability discovery.',
  'open',
  NOW(),
  NOW()
)
ON CONFLICT ("epicId") DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  "updatedAt" = NOW();

-- 2. Link to foundational portfolio
INSERT INTO "EpicPortfolio" ("epicId", "portfolioId")
SELECT e.id, p.id
FROM "Epic" e, "Portfolio" p
WHERE e."epicId" = 'EP-SKILL-001' AND p.slug = 'foundational'
ON CONFLICT DO NOTHING;

-- 3. Backlog items (15 stories across 5 phases)

-- Phase 1: Foundation
INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, priority, "epicId", "createdAt", "updatedAt")
SELECT
  'ep_skill_001_s01', 'EP-SKILL-001-001',
  'Schema migration: SkillDefinition, SkillAssignment, SkillMetric models',
  'Create Prisma models for SkillDefinition (skill metadata, SKILL.md content, lifecycle status, source), SkillAssignment (per-agent skill binding with priority and enable/disable across all 46 agents), and SkillMetric (per-skill per-agent period metrics: invocations, success rate, user rating, latency).',
  'product', 'open', 1, e.id, NOW(), NOW()
FROM "Epic" e WHERE e."epicId" = 'EP-SKILL-001'
ON CONFLICT ("itemId") DO NOTHING;

INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, priority, "epicId", "createdAt", "updatedAt")
SELECT
  'ep_skill_001_s02', 'EP-SKILL-001-002',
  'Skill ingestion API: parse SKILL.md files, extract metadata, store in DB',
  'Build a server action that accepts raw SKILL.md content, parses YAML frontmatter (name, description, allowed-tools, context, agent, risk indicators), and creates/updates a SkillDefinition record. Support bulk import from a directory of skills.',
  'product', 'open', 2, e.id, NOW(), NOW()
FROM "Epic" e WHERE e."epicId" = 'EP-SKILL-001'
ON CONFLICT ("itemId") DO NOTHING;

INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, priority, "epicId", "createdAt", "updatedAt")
SELECT
  'ep_skill_001_s03', 'EP-SKILL-001-003',
  'Skills catalog page (/admin/skills): browse, search, filter installed and discovered skills',
  'Admin page showing all SkillDefinitions with lifecycle state badges (discovered, evaluated, approved, installed, active, deprecated). Searchable by name, category, tags. Filterable by source (marketplace, GitHub, internal). Shows assignment count per agent across all 3 tiers.',
  'product', 'open', 3, e.id, NOW(), NOW()
FROM "Epic" e WHERE e."epicId" = 'EP-SKILL-001'
ON CONFLICT ("itemId") DO NOTHING;

-- Phase 2: Marketplace Integration
INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, priority, "epicId", "createdAt", "updatedAt")
SELECT
  'ep_skill_001_s04', 'EP-SKILL-001-004',
  'GitHub source connector: fetch skills from configured repositories',
  'Connector that fetches SKILL.md files from configured GitHub repos (anthropics/skills, hashicorp/agent-skills, formulahendry/agent-skill-code-runner, VoltAgent/awesome-agent-skills). Parses each skill, creates SkillDefinition records with sourceType=github. Supports periodic refresh.',
  'product', 'open', 4, e.id, NOW(), NOW()
FROM "Epic" e WHERE e."epicId" = 'EP-SKILL-001'
ON CONFLICT ("itemId") DO NOTHING;

INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, priority, "epicId", "createdAt", "updatedAt")
SELECT
  'ep_skill_001_s05', 'EP-SKILL-001-005',
  'Marketplace crawler: index skills from SkillsMP and SkillsLLM',
  'Crawler that discovers skills from SkillsMP (500K+ skills, REST API with 500 req/day free tier) and SkillsLLM (1,600+ curated with Caliber Score). Extracts metadata (name, category, stars, author, license) and resolves to source GitHub repos for full SKILL.md content.',
  'product', 'open', 5, e.id, NOW(), NOW()
FROM "Epic" e WHERE e."epicId" = 'EP-SKILL-001'
ON CONFLICT ("itemId") DO NOTHING;

INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, priority, "epicId", "createdAt", "updatedAt")
SELECT
  'ep_skill_001_s06', 'EP-SKILL-001-006',
  'TAK evaluation pipeline: auto-score skills using ToolEvaluation extension',
  'Extend ToolEvaluation model to score skills on: security (30%), license (15%), capability fit (20%), risk band (15%), quality signals (10%), testability (10%). Auto-transition skills from discovered to evaluated. HITL tiers: low-risk auto-approve, medium needs human confirm, high needs admin+security review.',
  'product', 'open', 6, e.id, NOW(), NOW()
FROM "Epic" e WHERE e."epicId" = 'EP-SKILL-001'
ON CONFLICT ("itemId") DO NOTHING;

-- Phase 3: Coworker Assignment
INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, priority, "epicId", "createdAt", "updatedAt")
SELECT
  'ep_skill_001_s07', 'EP-SKILL-001-007',
  'Coworker skills management UI (/admin/agents/:id/skills)',
  'Per-agent page showing installed skills with enable/disable toggles, available skills matching the agent category constraints, skill effectiveness metrics, and Suggest Skills button. Works across all 3 tiers: personas, orchestrators, and specialists.',
  'product', 'open', 7, e.id, NOW(), NOW()
FROM "Epic" e WHERE e."epicId" = 'EP-SKILL-001'
ON CONFLICT ("itemId") DO NOTHING;

INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, priority, "epicId", "createdAt", "updatedAt")
SELECT
  'ep_skill_001_s08', 'EP-SKILL-001-008',
  'Runtime skill injection: load installed skills into agent context at resolution time',
  'Extend resolveAgentForRoute() in agent-routing.ts to query SkillAssignment for the resolved agent AND its downstream specialists. Load active SkillDefinitions, inject SKILL.md content into context. Respect priority ordering and skill_slots.max_skills. Show skill attribution badges in chat.',
  'product', 'open', 8, e.id, NOW(), NOW()
FROM "Epic" e WHERE e."epicId" = 'EP-SKILL-001'
ON CONFLICT ("itemId") DO NOTHING;

INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, priority, "epicId", "createdAt", "updatedAt")
SELECT
  'ep_skill_001_s09', 'EP-SKILL-001-009',
  'Agent registry skill_slots configuration for all 46 agents',
  'Add skill_slots to agent_registry.json config_profile for all agents: max_skills (int), categories_allowed (string[]), auto_discover (bool), review_required (bool). Orchestrators get coordination skills, specialists get deep domain skills. Update agent-grants.ts to expose skill slot config.',
  'product', 'open', 9, e.id, NOW(), NOW()
FROM "Epic" e WHERE e."epicId" = 'EP-SKILL-001'
ON CONFLICT ("itemId") DO NOTHING;

-- Phase 4: Metrics & Continuous Improvement
INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, priority, "epicId", "createdAt", "updatedAt")
SELECT
  'ep_skill_001_s10', 'EP-SKILL-001-010',
  'Usage tracking: instrument skill invocations and collect user ratings',
  'Track each skill invocation per-agent: increment SkillMetric.invocationCount, record success/failure, measure latency. Add thumbs up/down UI in coworker chat when a skill is used (skill attribution badge). Aggregate into weekly/monthly period metrics. Track across all 3 tiers.',
  'product', 'open', 10, e.id, NOW(), NOW()
FROM "Epic" e WHERE e."epicId" = 'EP-SKILL-001'
ON CONFLICT ("itemId") DO NOTHING;

INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, priority, "epicId", "createdAt", "updatedAt")
SELECT
  'ep_skill_001_s11', 'EP-SKILL-001-011',
  'Metrics dashboard: per-skill and per-coworker effectiveness views',
  'Dashboard on /admin/skills showing: skill usage trends over time, user rating distributions, success rates, latency percentiles. Per-agent view showing which skills are most/least effective. Highlight skills with degrading metrics. Show persona-to-specialist skill propagation.',
  'product', 'open', 11, e.id, NOW(), NOW()
FROM "Epic" e WHERE e."epicId" = 'EP-SKILL-001'
ON CONFLICT ("itemId") DO NOTHING;

INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, priority, "epicId", "createdAt", "updatedAt")
SELECT
  'ep_skill_001_s12', 'EP-SKILL-001-012',
  'Improvement recommendations engine: detect degradation and propose upgrades',
  'Background process that analyzes SkillMetric data and triggers: flag skills with >50% usage drop, propose replacements for skills rated below 3.0, detect new versions in source repos, match new marketplace skills to agent capability gaps, propose swaps when one skill outperforms another.',
  'product', 'open', 12, e.id, NOW(), NOW()
FROM "Epic" e WHERE e."epicId" = 'EP-SKILL-001'
ON CONFLICT ("itemId") DO NOTHING;

-- Phase 5: Autonomous Discovery
INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, priority, "epicId", "createdAt", "updatedAt")
SELECT
  'ep_skill_001_s13', 'EP-SKILL-001-013',
  'Skill Discovery Agent: automated marketplace scanning and proposal generation',
  'Dedicated agent assigned to /admin/skills that periodically crawls configured marketplace sources, matches new skills against agent capability gaps across all 46 agents, proposes skill installations through the standard TAK proposal gate, and reports on skill ecosystem trends.',
  'product', 'open', 13, e.id, NOW(), NOW()
FROM "Epic" e WHERE e."epicId" = 'EP-SKILL-001'
ON CONFLICT ("itemId") DO NOTHING;

INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, priority, "epicId", "createdAt", "updatedAt")
SELECT
  'ep_skill_001_s14', 'EP-SKILL-001-014',
  'Skill versioning and upgrade workflow',
  'Track skill versions. When source repos publish updates, detect changes, diff the SKILL.md content, re-run TAK evaluation, and propose upgrade. Support rollback to previous version if new version degrades metrics. Maintain version history per SkillDefinition.',
  'product', 'open', 14, e.id, NOW(), NOW()
FROM "Epic" e WHERE e."epicId" = 'EP-SKILL-001'
ON CONFLICT ("itemId") DO NOTHING;

INSERT INTO "BacklogItem" (id, "itemId", title, body, type, status, priority, "epicId", "createdAt", "updatedAt")
SELECT
  'ep_skill_001_s15', 'EP-SKILL-001-015',
  'Community sharing: export platform skills as SKILL.md to configured repos',
  'When the platform develops or refines a skill internally, enable exporting it as a standard SKILL.md package. Generate proper frontmatter, bundle supporting files, and optionally create a PR to a configured GitHub repo for community sharing.',
  'product', 'open', 15, e.id, NOW(), NOW()
FROM "Epic" e WHERE e."epicId" = 'EP-SKILL-001'
ON CONFLICT ("itemId") DO NOTHING;

COMMIT;

-- Verify
SELECT e."epicId", e.title, COUNT(b.id) AS stories
FROM "Epic" e
LEFT JOIN "BacklogItem" b ON b."epicId" = e.id
WHERE e."epicId" = 'EP-SKILL-001'
GROUP BY e."epicId", e.title;
