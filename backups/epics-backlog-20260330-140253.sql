--
-- PostgreSQL database dump
--

\restrict hWVbuObdg3g3pKsqzTNZYEvMWMshZqeSYMgdWorxn0WgXIVYiuvDOOJ8n4c4hcK

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: Epic; Type: TABLE DATA; Schema: public; Owner: dpf
--

INSERT INTO public."Epic" VALUES ('ep_skill_001_id', 'EP-SKILL-001', 'AI Coworker Skills Marketplace & Continuous Improvement', 'Make skill curation and continuous improvement a first-class platform capability. Integrate external skills marketplaces (SkillsMP, SkillsLLM) and the Agent Skills open standard (SKILL.md) into AI Coworker definitions. Discover, evaluate (via TAK governance), install, track, and improve skills per-coworker across all 46 agents (10 personas, 9 orchestrators, 33 specialists, 4 cross-cutting). Implements a 5-stage loop: Discover > Evaluate > Install > Operate > Improve. Aligns to IT4IT Detect to Correct (SS5.7) for operational improvement and Explore (SS5.2) for capability discovery.', 'in-progress', '2026-03-30 07:53:38.194', '2026-03-30 07:53:48.157', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);


--
-- Data for Name: BacklogItem; Type: TABLE DATA; Schema: public; Owner: dpf
--

INSERT INTO public."BacklogItem" VALUES ('ep_skill_001_s04', 'EP-SKILL-001-004', 'GitHub source connector: fetch skills from configured repositories', 'open', 'product', 'Connector that fetches SKILL.md files from configured GitHub repos (anthropics/skills, hashicorp/agent-skills, formulahendry/agent-skill-code-runner, VoltAgent/awesome-agent-skills). Parses each skill, creates SkillDefinition records with sourceType=github. Supports periodic refresh.', '2026-03-30 07:53:38.194', '2026-03-30 07:53:38.194', 4, NULL, NULL, 'ep_skill_001_id', NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public."BacklogItem" VALUES ('ep_skill_001_s05', 'EP-SKILL-001-005', 'Marketplace crawler: index skills from SkillsMP and SkillsLLM', 'open', 'product', 'Crawler that discovers skills from SkillsMP (500K+ skills, REST API with 500 req/day free tier) and SkillsLLM (1,600+ curated with Caliber Score). Extracts metadata (name, category, stars, author, license) and resolves to source GitHub repos for full SKILL.md content.', '2026-03-30 07:53:38.194', '2026-03-30 07:53:38.194', 5, NULL, NULL, 'ep_skill_001_id', NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public."BacklogItem" VALUES ('ep_skill_001_s06', 'EP-SKILL-001-006', 'TAK evaluation pipeline: auto-score skills using ToolEvaluation extension', 'open', 'product', 'Extend ToolEvaluation model to score skills on: security (30%), license (15%), capability fit (20%), risk band (15%), quality signals (10%), testability (10%). Auto-transition skills from discovered to evaluated. HITL tiers: low-risk auto-approve, medium needs human confirm, high needs admin+security review.', '2026-03-30 07:53:38.194', '2026-03-30 07:53:38.194', 6, NULL, NULL, 'ep_skill_001_id', NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public."BacklogItem" VALUES ('ep_skill_001_s07', 'EP-SKILL-001-007', 'Coworker skills management UI (/admin/agents/:id/skills)', 'open', 'product', 'Per-agent page showing installed skills with enable/disable toggles, available skills matching the agent category constraints, skill effectiveness metrics, and Suggest Skills button. Works across all 3 tiers: personas, orchestrators, and specialists.', '2026-03-30 07:53:38.194', '2026-03-30 07:53:38.194', 7, NULL, NULL, 'ep_skill_001_id', NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public."BacklogItem" VALUES ('ep_skill_001_s08', 'EP-SKILL-001-008', 'Runtime skill injection: load installed skills into agent context at resolution time', 'open', 'product', 'Extend resolveAgentForRoute() in agent-routing.ts to query SkillAssignment for the resolved agent AND its downstream specialists. Load active SkillDefinitions, inject SKILL.md content into context. Respect priority ordering and skill_slots.max_skills. Show skill attribution badges in chat.', '2026-03-30 07:53:38.194', '2026-03-30 07:53:38.194', 8, NULL, NULL, 'ep_skill_001_id', NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public."BacklogItem" VALUES ('ep_skill_001_s09', 'EP-SKILL-001-009', 'Agent registry skill_slots configuration for all 46 agents', 'open', 'product', 'Add skill_slots to agent_registry.json config_profile for all agents: max_skills (int), categories_allowed (string[]), auto_discover (bool), review_required (bool). Orchestrators get coordination skills, specialists get deep domain skills. Update agent-grants.ts to expose skill slot config.', '2026-03-30 07:53:38.194', '2026-03-30 07:53:38.194', 9, NULL, NULL, 'ep_skill_001_id', NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public."BacklogItem" VALUES ('ep_skill_001_s10', 'EP-SKILL-001-010', 'Usage tracking: instrument skill invocations and collect user ratings', 'open', 'product', 'Track each skill invocation per-agent: increment SkillMetric.invocationCount, record success/failure, measure latency. Add thumbs up/down UI in coworker chat when a skill is used (skill attribution badge). Aggregate into weekly/monthly period metrics. Track across all 3 tiers.', '2026-03-30 07:53:38.194', '2026-03-30 07:53:38.194', 10, NULL, NULL, 'ep_skill_001_id', NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public."BacklogItem" VALUES ('ep_skill_001_s11', 'EP-SKILL-001-011', 'Metrics dashboard: per-skill and per-coworker effectiveness views', 'open', 'product', 'Dashboard on /admin/skills showing: skill usage trends over time, user rating distributions, success rates, latency percentiles. Per-agent view showing which skills are most/least effective. Highlight skills with degrading metrics. Show persona-to-specialist skill propagation.', '2026-03-30 07:53:38.194', '2026-03-30 07:53:38.194', 11, NULL, NULL, 'ep_skill_001_id', NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public."BacklogItem" VALUES ('ep_skill_001_s12', 'EP-SKILL-001-012', 'Improvement recommendations engine: detect degradation and propose upgrades', 'open', 'product', 'Background process that analyzes SkillMetric data and triggers: flag skills with >50% usage drop, propose replacements for skills rated below 3.0, detect new versions in source repos, match new marketplace skills to agent capability gaps, propose swaps when one skill outperforms another.', '2026-03-30 07:53:38.194', '2026-03-30 07:53:38.194', 12, NULL, NULL, 'ep_skill_001_id', NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public."BacklogItem" VALUES ('ep_skill_001_s13', 'EP-SKILL-001-013', 'Skill Discovery Agent: automated marketplace scanning and proposal generation', 'open', 'product', 'Dedicated agent assigned to /admin/skills that periodically crawls configured marketplace sources, matches new skills against agent capability gaps across all 46 agents, proposes skill installations through the standard TAK proposal gate, and reports on skill ecosystem trends.', '2026-03-30 07:53:38.194', '2026-03-30 07:53:38.194', 13, NULL, NULL, 'ep_skill_001_id', NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public."BacklogItem" VALUES ('ep_skill_001_s14', 'EP-SKILL-001-014', 'Skill versioning and upgrade workflow', 'open', 'product', 'Track skill versions. When source repos publish updates, detect changes, diff the SKILL.md content, re-run TAK evaluation, and propose upgrade. Support rollback to previous version if new version degrades metrics. Maintain version history per SkillDefinition.', '2026-03-30 07:53:38.194', '2026-03-30 07:53:38.194', 14, NULL, NULL, 'ep_skill_001_id', NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public."BacklogItem" VALUES ('ep_skill_001_s15', 'EP-SKILL-001-015', 'Community sharing: export platform skills as SKILL.md to configured repos', 'open', 'product', 'When the platform develops or refines a skill internally, enable exporting it as a standard SKILL.md package. Generate proper frontmatter, bundle supporting files, and optionally create a PR to a configured GitHub repo for community sharing.', '2026-03-30 07:53:38.194', '2026-03-30 07:53:38.194', 15, NULL, NULL, 'ep_skill_001_id', NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public."BacklogItem" VALUES ('ep_skill_001_s01', 'EP-SKILL-001-001', 'Schema migration: SkillDefinition, SkillAssignment, SkillMetric models', 'done', 'product', 'Create Prisma models for SkillDefinition (skill metadata, SKILL.md content, lifecycle status, source), SkillAssignment (per-agent skill binding with priority and enable/disable across all 46 agents), and SkillMetric (per-skill per-agent period metrics: invocations, success rate, user rating, latency).', '2026-03-30 07:53:38.194', '2026-03-30 07:53:48.157', 1, NULL, NULL, 'ep_skill_001_id', NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public."BacklogItem" VALUES ('ep_skill_001_s02', 'EP-SKILL-001-002', 'Skill ingestion API: parse SKILL.md files, extract metadata, store in DB', 'done', 'product', 'Build a server action that accepts raw SKILL.md content, parses YAML frontmatter (name, description, allowed-tools, context, agent, risk indicators), and creates/updates a SkillDefinition record. Support bulk import from a directory of skills.', '2026-03-30 07:53:38.194', '2026-03-30 07:53:48.157', 2, NULL, NULL, 'ep_skill_001_id', NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public."BacklogItem" VALUES ('ep_skill_001_s03', 'EP-SKILL-001-003', 'Skills catalog page (/admin/skills): browse, search, filter installed and discovered skills', 'done', 'product', 'Admin page showing all SkillDefinitions with lifecycle state badges (discovered, evaluated, approved, installed, active, deprecated). Searchable by name, category, tags. Filterable by source (marketplace, GitHub, internal). Shows assignment count per agent across all 3 tiers.', '2026-03-30 07:53:38.194', '2026-03-30 07:53:48.157', 3, NULL, NULL, 'ep_skill_001_id', NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public."BacklogItem" VALUES ('cmnd9atfu000701l7k3cwvxse', 'BI-OBS-ba36b430', 'User repeated themselves', 'open', 'product', 'User sent a similar message more than once: "Create a hello world feature"
Suggested: Investigate why the agent did not address the user''s request
Source messages: cmncw5b1z00h801p2c1ux4tq2, cmnd984u2000001pf2nj9o9hz', '2026-03-30 14:01:25.386', '2026-03-30 14:01:25.386', 3, 'cmncwf4ai00oe01p27wod0pza', NULL, NULL, 'process_observer', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public."BacklogItem" VALUES ('bl-ep-ops-async-tasks', 'EP-OPS-ASYNC', 'Async Agent Task Dashboard — visibility, cancel, and timeout controls', 'open', 'portfolio', 'When the platform kicks off async agent work (model classification, discovery sync, eval runs, etc.), admins need:

1. A task list/queue visible on the portal (e.g. /platform/ai/tasks or /ops/tasks)
2. Status tracking: pending -> running -> completed/failed, with duration and agent ID
3. Cancel button to stop runaway tasks
4. Configurable timeout per task type (default + admin override)
5. History/audit log of completed tasks with summaries

Triggered by EP-INF-012b (async model classification) but applies to all async agent work. Design should be generic enough to cover: model classification jobs, provider discovery syncs, eval runs, champion/challenger promotions, and future scheduled agent tasks.

This is the operational substrate for any background agent work -- without it, admins are blind to what the platform is doing on their behalf.', '2026-03-30 17:18:37.885', '2026-03-30 17:18:37.885', 3, NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);


--
-- PostgreSQL database dump complete
--

\unrestrict hWVbuObdg3g3pKsqzTNZYEvMWMshZqeSYMgdWorxn0WgXIVYiuvDOOJ8n4c4hcK

