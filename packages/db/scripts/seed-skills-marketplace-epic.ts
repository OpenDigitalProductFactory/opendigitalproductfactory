// One-off script: seed the AI Coworker Skills Marketplace epic (EP-SKILL-001)
// Run from repo root: pnpm --filter @dpf/db exec tsx scripts/seed-skills-marketplace-epic.ts
import { prisma } from "../src/client";

async function main() {
  const foundational = await prisma.portfolio.findUnique({ where: { slug: "foundational" } });
  if (!foundational) throw new Error("foundational portfolio not seeded");

  // --- Epic ---
  const epic = await prisma.epic.upsert({
    where: { epicId: "EP-SKILL-001" },
    update: {
      title: "AI Coworker Skills Marketplace & Continuous Improvement",
      description:
        "Make skill curation and continuous improvement a first-class platform capability. " +
        "Integrate external skills marketplaces (SkillsMP, SkillsLLM) and the Agent Skills open standard (SKILL.md) " +
        "into AI Coworker definitions. Discover, evaluate (via TAK governance), install, track, and improve skills " +
        "per-coworker. Implements a 5-stage loop: Discover → Evaluate → Install → Operate → Improve. " +
        "Aligns to IT4IT Detect to Correct (SS5.7) for operational improvement and Explore (SS5.2) for capability discovery.",
      status: "open",
    },
    create: {
      epicId: "EP-SKILL-001",
      title: "AI Coworker Skills Marketplace & Continuous Improvement",
      description:
        "Make skill curation and continuous improvement a first-class platform capability. " +
        "Integrate external skills marketplaces (SkillsMP, SkillsLLM) and the Agent Skills open standard (SKILL.md) " +
        "into AI Coworker definitions. Discover, evaluate (via TAK governance), install, track, and improve skills " +
        "per-coworker. Implements a 5-stage loop: Discover → Evaluate → Install → Operate → Improve. " +
        "Aligns to IT4IT Detect to Correct (SS5.7) for operational improvement and Explore (SS5.2) for capability discovery.",
      status: "open",
    },
  });

  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: epic.id, portfolioId: foundational.id } },
    update: {},
    create: { epicId: epic.id, portfolioId: foundational.id },
  });

  // --- Backlog Items (Stories) ---
  const stories = [
    // Phase 1: Foundation
    {
      title: "Schema migration: SkillDefinition, SkillAssignment, SkillMetric models",
      description:
        "Create Prisma models for SkillDefinition (skill metadata, SKILL.md content, lifecycle status, source), " +
        "SkillAssignment (per-coworker skill binding with priority and enable/disable), and SkillMetric " +
        "(per-skill per-coworker period metrics: invocations, success rate, user rating, latency).",
      type: "product" as const,
      status: "open" as const,
      priority: 1,
    },
    {
      title: "Skill ingestion API: parse SKILL.md files, extract metadata, store in DB",
      description:
        "Build a server action that accepts raw SKILL.md content, parses YAML frontmatter (name, description, " +
        "allowed-tools, context, agent, risk indicators), and creates/updates a SkillDefinition record. " +
        "Support bulk import from a directory of skills.",
      type: "product" as const,
      status: "open" as const,
      priority: 2,
    },
    {
      title: "Skills catalog page (/admin/skills): browse, search, filter installed and discovered skills",
      description:
        "Admin page showing all SkillDefinitions with lifecycle state badges (discovered, evaluated, approved, " +
        "installed, active, deprecated). Searchable by name, category, tags. Filterable by source (marketplace, " +
        "GitHub, internal). Shows assignment count per skill.",
      type: "product" as const,
      status: "open" as const,
      priority: 3,
    },
    // Phase 2: Marketplace Integration
    {
      title: "GitHub source connector: fetch skills from configured repositories",
      description:
        "Connector that clones or fetches SKILL.md files from configured GitHub repos (anthropics/skills, " +
        "hashicorp/agent-skills, formulahendry/agent-skill-code-runner, VoltAgent/awesome-agent-skills). " +
        "Parses each skill, creates SkillDefinition records with sourceType='github'. Supports periodic refresh.",
      type: "product" as const,
      status: "open" as const,
      priority: 4,
    },
    {
      title: "Marketplace crawler: index skills from SkillsMP and SkillsLLM",
      description:
        "Crawler that discovers skills from SkillsMP (66,500+ skills) and SkillsLLM (1,792 curated). " +
        "Extracts metadata (name, category, stars, author, license) and resolves to source GitHub repos " +
        "for full SKILL.md content. Creates SkillDefinition records with sourceType='marketplace'.",
      type: "product" as const,
      status: "open" as const,
      priority: 5,
    },
    {
      title: "TAK evaluation pipeline: auto-score skills using ToolEvaluation extension",
      description:
        "Extend ToolEvaluation model to score skills on: security (30%), license (15%), capability fit (20%), " +
        "risk band (15%), quality signals (10%), testability (10%). Auto-transition skills from 'discovered' " +
        "to 'evaluated'. HITL tiers: low-risk auto-approve, medium needs human confirm, high needs admin+security.",
      type: "product" as const,
      status: "open" as const,
      priority: 6,
    },
    // Phase 3: Coworker Assignment
    {
      title: "Coworker skills management UI (/admin/agents/:id/skills)",
      description:
        "Per-coworker page showing installed skills with enable/disable toggles, available skills matching " +
        "the coworker's category constraints, skill effectiveness metrics, and a 'Suggest Skills' button " +
        "that searches marketplaces based on the coworker's capability domain.",
      type: "product" as const,
      status: "open" as const,
      priority: 7,
    },
    {
      title: "Runtime skill injection: load installed skills into agent context at resolution time",
      description:
        "Extend resolveAgentForRoute() in agent-routing.ts to query SkillAssignment for the resolved agent, " +
        "load active SkillDefinitions, and inject their SKILL.md content into the agent context. " +
        "Respect priority ordering and the agent's skill_slots.max_skills limit.",
      type: "product" as const,
      status: "open" as const,
      priority: 8,
    },
    {
      title: "Agent registry skill_slots configuration",
      description:
        "Add skill_slots to agent_registry.json config_profile: max_skills (int), categories_allowed (string[]), " +
        "auto_discover (bool), review_required (bool). Update agent-grants.ts to expose skill slot config. " +
        "Update AgentInfo type to include installedSkills[].",
      type: "product" as const,
      status: "open" as const,
      priority: 9,
    },
    // Phase 4: Metrics & Continuous Improvement
    {
      title: "Usage tracking: instrument skill invocations and collect user ratings",
      description:
        "Track each time a skill is invoked by a coworker: increment SkillMetric.invocationCount, " +
        "record success/failure, measure latency. Add thumbs up/down UI in coworker chat when a skill " +
        "is used (skill attribution badge). Aggregate into weekly/monthly period metrics.",
      type: "product" as const,
      status: "open" as const,
      priority: 10,
    },
    {
      title: "Metrics dashboard: per-skill and per-coworker effectiveness views",
      description:
        "Dashboard on /admin/skills showing: skill usage trends over time, user rating distributions, " +
        "success rates, latency percentiles. Per-coworker view showing which skills are most/least effective. " +
        "Highlight skills with degrading metrics for review.",
      type: "product" as const,
      status: "open" as const,
      priority: 11,
    },
    {
      title: "Improvement recommendations engine: detect degradation and propose upgrades",
      description:
        "Background process that analyzes SkillMetric data and triggers: flag skills with >50% usage drop, " +
        "propose replacements for skills rated below 3.0, detect new versions in source repos, match new " +
        "marketplace skills to coworker capability gaps, propose swaps when one skill outperforms another.",
      type: "product" as const,
      status: "open" as const,
      priority: 12,
    },
    // Phase 5: Autonomous Discovery
    {
      title: "Skill Discovery Agent: automated marketplace scanning and proposal generation",
      description:
        "Dedicated agent assigned to /admin/skills that periodically crawls configured marketplace sources, " +
        "matches new skills against coworker capability gaps, proposes skill installations through the standard " +
        "TAK proposal gate, and reports on skill ecosystem trends.",
      type: "product" as const,
      status: "open" as const,
      priority: 13,
    },
    {
      title: "Skill versioning and upgrade workflow",
      description:
        "Track skill versions. When source repos publish updates, detect changes, diff the SKILL.md content, " +
        "re-run TAK evaluation, and propose upgrade. Support rollback to previous version if new version " +
        "degrades metrics. Maintain version history per SkillDefinition.",
      type: "product" as const,
      status: "open" as const,
      priority: 14,
    },
    {
      title: "Community sharing: export platform skills as SKILL.md to configured repos",
      description:
        "When the platform develops or refines a skill internally, enable exporting it as a standard SKILL.md " +
        "package. Generate proper frontmatter, bundle supporting files, and optionally create a PR to a " +
        "configured GitHub repo for community sharing.",
      type: "product" as const,
      status: "open" as const,
      priority: 15,
    },
  ];

  for (const story of stories) {
    const existing = await prisma.backlogItem.findFirst({
      where: { epicId: epic.id, title: story.title },
    });
    if (existing) {
      console.log(`  [skip] "${story.title}" already exists`);
      continue;
    }
    await prisma.backlogItem.create({
      data: {
        title: story.title,
        description: story.description,
        type: story.type,
        status: story.status,
        priority: story.priority,
        epicId: epic.id,
      },
    });
    console.log(`  [created] "${story.title}"`);
  }

  console.log(`\nSeeded ${epic.epicId}: "${epic.title}" with ${stories.length} stories → foundational portfolio`);
  await prisma.$disconnect();
}

main().catch(console.error);
