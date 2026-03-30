# EP-SKILL-001: AI Coworker Skills Marketplace & Continuous Improvement

## Context

The platform's AI Coworkers are defined by route-based agent resolution (`agent-routing.ts`), tool grants (`agent-grants.ts`), governance profiles (TAK), and the agent registry (`agent_registry.json`). Today, coworker capabilities are hard-coded at development time. There is no mechanism for:

1. **Discovering** new skills from external marketplaces or repositories
2. **Evaluating** skills against TAK governance before adoption
3. **Installing** skills into specific coworker definitions
4. **Tracking** skill effectiveness over time and improving them
5. **Sharing** platform-developed skills back to the community

This spec defines an epic to make skill curation and continuous improvement a first-class platform capability.

---

## Research Findings

### Skills Ecosystem Landscape (March 2026)

#### Marketplaces

| Marketplace | Scale | Model | Skill Format | Integration | API |
|-------------|-------|-------|-------------|-------------|-----|
| **[SkillsMP](https://skillsmp.com)** | 500,000+ skills | Free/open-source | SKILL.md (Agent Skills standard) | GitHub repos, community submissions | REST API, 500 req/day free |
| **[SkillsLLM](https://skillsllm.com)** | 1,600+ curated, security-vetted | Free/open-source | agentskills.io standard | CLI install (`clawhub install`, `npx skills add`) | No public API |

**SkillsMP** is the largest aggregator, indexing GitHub repos that follow the Agent Skills open standard (`agentskills.io`). Skills are SKILL.md files with YAML frontmatter. Minimum 2-star filter for quality. **Has a REST API** with keyword + AI-powered semantic search (500 req/day free, rate-limited with quota tracking headers). This API is directly usable for our marketplace crawler.

**SkillsLLM** is a curated, security-vetted directory with a **Caliber Score** system that evaluates config quality without LLM calls, scoring across: Files & Setup (25pts), Quality (25pts), Grounding (20pts), Accuracy (15pts), Freshness & Safety (10pts), Bonus (5pts). Categories include AI Agents, MCP Servers, CLI Tools, IDE Extensions, API Integrations. Supports 20+ AI tools via multi-LLM orchestration layer.

#### Key GitHub Repositories

| Repository | Stars | Content | Relevance |
|-----------|-------|---------|-----------|
| **[anthropics/skills](https://github.com/anthropics/skills)** | 106k | Reference skills + Agent Skills spec + template | Primary source — defines the open standard |
| **[openai/skills](https://github.com/openai/skills)** | 14.6k | Codex skills catalog (system/curated/experimental tiers) | Shows tiered quality model we can adopt |
| **[github/awesome-copilot](https://github.com/github/awesome-copilot)** | — | 175+ agents, 208+ skills, 176+ instructions | Large cross-agent discovery index |
| **[formulahendry/agent-skill-code-runner](https://github.com/formulahendry/agent-skill-code-runner)** | — | Multi-language code execution (35+ langs) | Directly useful for Build Studio |
| **[pytorch/pytorch](https://github.com/pytorch/pytorch)** | 88k | `.claude/skills/` with skill-writer, pr-review | Demonstrates enterprise skill adoption pattern |
| **[agentskills/agentskills](https://github.com/agentskills/agentskills)** | — | Formal Agent Skills specification | Standard reference |
| **[VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills)** | — | 1000+ community-curated skills | Discovery index |
| **[hashicorp/agent-skills](https://github.com/hashicorp/agent-skills)** | — | HashiCorp product skills (Terraform, Vault) | Ops/infrastructure integration |

**Key ecosystem insight:** All repos have converged on the same Agent Skills open standard (SKILL.md). The standard supports **progressive disclosure** — agents read metadata first and only load full instructions when relevant. Skills are portable across Claude Code, GitHub Copilot, OpenAI Codex, and Gemini CLI. OpenAI's tiered model (`.system` auto-installed, `.curated` installable, `.experimental` beta) provides a quality stratification pattern we can adopt for TAK governance bands.

#### The Agent Skills Standard (SKILL.md)

Every skill follows a standard format:

```yaml
---
name: skill-name          # lowercase, hyphens, max 64 chars
description: What and when # max 250 chars, front-load key terms
disable-model-invocation: true/false
user-invocable: true/false
allowed-tools: Read, Grep  # tool restrictions
context: fork              # subagent isolation
agent: Explore             # agent type for fork
model: sonnet              # model override
effort: high               # effort level override
---

Markdown instructions that Claude follows when invoked.
```

Skills can include supporting files (scripts, templates, references) in their directory. The format is tool-agnostic and works across Claude Code, GitHub Copilot, OpenAI Codex CLI, Gemini CLI, and others.

---

## The AI Workforce: Three-Tier Agent Hierarchy

### Overview: 46 Agents, Not 9

Users interact with **10 persona-based coworkers** on the left-panel chat — but behind these personas sits a three-tier workforce of **46 agents** organized by IT4IT value stream. Understanding this hierarchy is essential for skill assignment because skills installed on specialists are invoked when orchestrators delegate work.

### Tier Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  TIER 1: USER-FACING PERSONAS (ROUTE_AGENT_MAP — what users see)           │
│                                                                             │
│  /workspace → COO            /portfolio → Portfolio Analyst                 │
│  /inventory → Product Mgr    /ea → Enterprise Architect                    │
│  /employee → HR Director     /customer → Customer Success Mgr              │
│  /ops → Scrum Master         /platform → AI Ops Engineer                   │
│  /build → Software Engineer  /admin → System Admin                         │
│  /setup → Onboarding COO                                                   │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ delegates to
┌──────────────────────────────────▼──────────────────────────────────────────┐
│  TIER 2: ORCHESTRATORS (9 value stream leaders — agent_registry.json)      │
│                                                                             │
│  AGT-ORCH-000  COO Orchestrator         (cross-cutting)                    │
│  AGT-ORCH-100  Evaluate Orchestrator    (IT4IT SS5.1)                      │
│  AGT-ORCH-200  Explore Orchestrator     (IT4IT SS5.2)                      │
│  AGT-ORCH-300  Integrate Orchestrator   (IT4IT SS5.3)                      │
│  AGT-ORCH-400  Deploy Orchestrator      (IT4IT SS5.4)                      │
│  AGT-ORCH-500  Release Orchestrator     (IT4IT SS5.5)                      │
│  AGT-ORCH-600  Consume Orchestrator     (IT4IT SS5.6)                      │
│  AGT-ORCH-700  Operate Orchestrator     (IT4IT SS5.7)                      │
│  AGT-ORCH-800  Governance Orchestrator  (cross-cutting)                    │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ delegates to
┌──────────────────────────────────▼──────────────────────────────────────────┐
│  TIER 3: SPECIALISTS (33 domain workers) + CROSS-CUTTING (4)               │
│                                                                             │
│  See full table below                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Persona → Orchestrator → Specialist Mapping

This table shows which specialists are ultimately invoked when a user interacts with each persona. This is the **skill propagation path** — a skill installed on a specialist becomes available whenever that specialist is activated through its orchestrator.

| User Persona | Route | Primary Orchestrators | Specialists Behind Them |
|---|---|---|---|
| **COO** | `/workspace` | AGT-ORCH-000 (COO) | policy-enforcement, strategy-alignment, portfolio-backlog |
| **Portfolio Analyst** | `/portfolio` | AGT-ORCH-100 (Evaluate) | portfolio-rationalization, investment-analysis, gap-analysis, scope-agreement, security-auditor |
| **Product Manager** | `/inventory` | AGT-ORCH-200 (Explore) | product-backlog-prioritization, architecture-definition, roadmap-assembly |
| **Enterprise Architect** | `/ea` | AGT-ORCH-800 (Governance) | constraint-validation, architecture-guardrail, evidence-chain |
| **HR Director** | `/employee` | AGT-ORCH-600 (Consume) | consumer-onboarding, order-fulfillment, service-support |
| **Customer Success** | `/customer` | AGT-ORCH-600 (Consume) | consumer-onboarding, order-fulfillment, service-support |
| **Scrum Master** | `/ops` | AGT-ORCH-700 (Operate) | monitoring, incident-detection, incident-resolution |
| **AI Ops Engineer** | `/platform` | AGT-ORCH-000 (COO) + all | All orchestrators accessible (cross-cutting visibility) |
| **Software Engineer** | `/build` | AGT-ORCH-200 (Explore) + AGT-ORCH-300 (Integrate) + AGT-ORCH-400 (Deploy) | product-backlog, architecture-definition, release-planning, sbom-management, deployment-planning, iac-execution |
| **System Admin** | `/admin` | AGT-ORCH-800 (Governance) | constraint-validation, architecture-guardrail, evidence-chain |

### Cross-Cutting Agents (Available to All Personas)

These 4 agents can be invoked by any orchestrator when their domain expertise is needed:

| Agent ID | Name | Domain | Example Skill Opportunity |
|----------|------|--------|--------------------------|
| AGT-900 | finance-agent | Cost allocation, budgets | Financial modeling skills, cost forecasting |
| AGT-901 | architecture-agent | Architecture guardrails | ArchiMate validation, pattern libraries |
| AGT-902 | data-governance-agent | Data quality, compliance | Data classification, PII detection skills |
| AGT-903 | ux-accessibility-agent | UX standards, a11y | WCAG audit skills, design system validation |

### Full Specialist Roster by Value Stream

#### Evaluate Value Stream (IT4IT SS5.1) — Portfolio Analyst

| Agent ID | Specialist | Tool Grants | Skill Categories |
|----------|-----------|-------------|------------------|
| AGT-110 | portfolio-rationalization | 5 | portfolio-analysis, benchmarking |
| AGT-111 | investment-analysis | 7 | financial-modeling, risk-assessment |
| AGT-112 | gap-analysis | 6 | capability-mapping, gap-detection |
| AGT-113 | scope-agreement | 4 | requirements, negotiation |
| AGT-190 | security-auditor | 9 | security-scanning, vulnerability-assessment, compliance |

#### Explore Value Stream (IT4IT SS5.2) — Product Manager, Build Studio

| Agent ID | Specialist | Tool Grants | Skill Categories |
|----------|-----------|-------------|------------------|
| AGT-120 | product-backlog-prioritization | 4 | prioritization, value-scoring |
| AGT-121 | architecture-definition | 7 | design-patterns, architecture, code-review |
| AGT-122 | roadmap-assembly | 5 | planning, dependency-mapping |

#### Integrate Value Stream (IT4IT SS5.3) — Build Studio (Review/Ship phases)

| Agent ID | Specialist | Tool Grants | Skill Categories |
|----------|-----------|-------------|------------------|
| AGT-130 | release-planning | 4 | release-management, scheduling |
| AGT-131 | sbom-management | 8 | dependency-scanning, license-audit, supply-chain |
| AGT-132 | release-acceptance | 5 | testing, quality-gates |

#### Deploy Value Stream (IT4IT SS5.4) — Build Studio (Ship phase)

| Agent ID | Specialist | Tool Grants | Skill Categories |
|----------|-----------|-------------|------------------|
| AGT-140 | deployment-planning | 5 | deployment-strategy, rollback-planning |
| AGT-141 | resource-reservation | 4 | infrastructure, capacity-planning |
| AGT-142 | iac-execution | 5 | devops, infrastructure-as-code, ci-cd |

#### Release Value Stream (IT4IT SS5.5) — Customer-facing service publication

| Agent ID | Specialist | Tool Grants | Skill Categories |
|----------|-----------|-------------|------------------|
| AGT-150 | service-offer-definition | 4 | service-design, catalog-management |
| AGT-151 | catalog-publication | 4 | documentation, publishing |
| AGT-152 | subscription-management | 5 | billing, subscription-logic |

#### Consume Value Stream (IT4IT SS5.6) — HR Director, Customer Success

| Agent ID | Specialist | Tool Grants | Skill Categories |
|----------|-----------|-------------|------------------|
| AGT-160 | consumer-onboarding | 4 | onboarding-workflows, user-experience |
| AGT-161 | order-fulfillment | 4 | workflow-automation, fulfillment |
| AGT-162 | service-support | 5 | helpdesk, knowledge-base, escalation |

#### Operate Value Stream (IT4IT SS5.7) — Scrum Master, Ops

| Agent ID | Specialist | Tool Grants | Skill Categories |
|----------|-----------|-------------|------------------|
| AGT-170 | monitoring | 4 | observability, alerting, dashboards |
| AGT-171 | incident-detection | 5 | anomaly-detection, log-analysis |
| AGT-172 | incident-resolution | 5 | runbooks, auto-remediation, post-mortem |

#### Governance (Cross-cutting) — Enterprise Architect, System Admin

| Agent ID | Specialist | Tool Grants | Skill Categories |
|----------|-----------|-------------|------------------|
| AGT-180 | constraint-validation | 4 | policy-checking, compliance-rules |
| AGT-181 | architecture-guardrail | 7 | architecture-review, anti-pattern-detection |
| AGT-182 | evidence-chain | 4 | audit-trail, provenance, traceability |

#### Strategy to Portfolio (S2P) — COO

| Agent ID | Specialist | Tool Grants | Skill Categories |
|----------|-----------|-------------|------------------|
| AGT-S2P-POL | policy-specialist | 4 | policy-authoring, regulatory-analysis |
| AGT-S2P-PFB | portfolio-backlog-specialist | 4 | strategic-backlog, OKR-alignment |

#### Request to Deploy (R2D) — Scrum Master

| Agent ID | Specialist | Tool Grants | Skill Categories |
|----------|-----------|-------------|------------------|
| AGT-R2D-PB | product-backlog-specialist | 4 | story-writing, acceptance-criteria |

---

## Architecture: How Skills Integrate with DPF Coworkers

### Current State

```
User → Route → ROUTE_AGENT_MAP → AgentInfo { systemPrompt, skills[], modelRequirements }
                                       ↓
                                  AgentSkill { label, description, capability, prompt }
```

The existing `AgentSkill` type in `agent-coworker-types.ts` already models per-agent skills — but they are inline prompt snippets, not the full Agent Skills standard with directories, scripts, and supporting files. There are 10 user-facing personas, but the underlying workforce is 46 agents across 3 tiers.

### Target State: Skill Propagation Through the Hierarchy

```
User → Route → Persona ──→ Orchestrator(s) ──→ Specialist(s)
                  │              │                    │
                  │         skills from           skills from
                  │         orchestrator          specialist
                  │              │                    │
                  ▼              ▼                    ▼
            ┌─────────────────────────────────────────────┐
            │          Merged Skill Context                │
            │  (persona inline + orchestrator SKILL.md     │
            │   + specialist SKILL.md + cross-cutting)     │
            └──────────────────┬──────────────────────────┘
                               ↓
                        SkillRegistry (DB)
                               ↓
                 ┌─────────────┼──────────────┐
                 ↓             ↓              ↓
          SkillSource    SkillEvaluation  SkillMetrics
       (marketplace)    (TAK governance) (usage/quality)
```

**Skill resolution at runtime:**

1. User interacts with a persona (e.g. Scrum Master on `/ops`)
2. Persona resolves its inline skills (from `ROUTE_AGENT_MAP`)
3. If the task requires specialist work, the orchestrator (AGT-ORCH-700 Operate) delegates
4. The specialist (e.g. AGT-172 incident-resolution) loads its own installed SKILL.md skills
5. Cross-cutting agents (finance, architecture, data-gov, ux) contribute skills when invoked
6. All active skills merge into the execution context, filtered by capability grants

**Skill visibility in the UI:**

When a specialist's skill is invoked behind a persona, the coworker panel shows a subtle attribution: "Using incident-resolution skill: auto-remediation runbook" so the user understands what's happening without needing to know the full agent hierarchy.

### Key Design Decisions

1. **Skills are installed per-agent across all three tiers.** A persona gets broad contextual skills. An orchestrator gets coordination skills. A specialist gets deep domain skills. This mirrors how human teams work — the manager delegates, the specialist executes with specialized tools.

2. **Skill categories constrain assignment.** Each agent's `skill_slots.categories_allowed` ensures specialists only receive skills matching their domain. The `iac-execution-agent` gets devops/ci-cd skills, not documentation skills. The `security-auditor-agent` gets vulnerability-assessment skills, not financial-modeling skills.

3. **Every external skill goes through tool evaluation.** The existing `ToolEvaluation` model (EP-GOVERN-002) is extended to cover skills. No skill reaches any agent without security review, license check, and governance scoring.

4. **Skills have a lifecycle:** `discovered → evaluated → approved → installed → active → deprecated`. Only `active` skills are loaded into agent context.

5. **The platform tracks skill effectiveness per-agent.** Usage counts, user feedback, task completion rates, and quality scores feed back into skill ranking. A skill that works well for the security-auditor might not work well for the monitoring-agent — metrics are tracked per (skill, agent) pair.

6. **Skill optimization is visible.** The `/platform/ai` page shows which skills are installed on which agents, their effectiveness scores, and recommendations for improvement. Users can see that "the incident-detection agent got 40% faster at triage after installing the log-analysis skill."

7. **IT4IT alignment:** Skills map to the **Detect to Correct** value stream (SS5.7) for operational improvement, and to the **Explore** value stream (SS5.2) for discovering new capabilities. Each value stream's specialists receive skills aligned to their IT4IT functional components.

### Skill Priority Examples by Persona

To make this concrete, here are example marketplace skills that would benefit each user-facing persona through their specialist chain:

| Persona | High-Value Skill Examples | Target Specialist |
|---------|--------------------------|-------------------|
| **Portfolio Analyst** | Financial scenario modeling, Monte Carlo risk simulation | AGT-111 investment-analysis |
| **Portfolio Analyst** | Competitive landscape scanner (web search skill) | AGT-112 gap-analysis |
| **Product Manager** | User story generator from requirements | AGT-120 product-backlog-prioritization |
| **Product Manager** | Dependency graph visualizer | AGT-122 roadmap-assembly |
| **Enterprise Architect** | ArchiMate model validator | AGT-181 architecture-guardrail |
| **Enterprise Architect** | Technical debt quantifier | AGT-182 evidence-chain |
| **HR Director** | Onboarding checklist generator | AGT-160 consumer-onboarding |
| **Customer Success** | Sentiment analysis on support tickets | AGT-162 service-support |
| **Scrum Master** | Sprint velocity forecaster | AGT-R2D-PB product-backlog-specialist |
| **Scrum Master** | Auto-remediation runbook executor | AGT-172 incident-resolution |
| **AI Ops Engineer** | Model benchmark comparator | Cross-cutting (AGT-901) |
| **Software Engineer** | Code runner (35+ languages) | AGT-142 iac-execution |
| **Software Engineer** | SBOM license auditor | AGT-131 sbom-management |
| **System Admin** | WCAG accessibility auditor | AGT-903 ux-accessibility |
| **COO** | OKR progress tracker | AGT-S2P-PFB portfolio-backlog-specialist |

---

## Data Model

### Existing Model: UserSkill

The platform already has a `UserSkill` model for user-created inline skills (personal/team/org visibility, usage tracking, route hints). The new marketplace models below are complementary — `UserSkill` handles internally authored skills, while `SkillDefinition` handles externally sourced skills. The Skills Catalog UI must present both in a unified view. A future migration may unify these into a single model with a `sourceType` discriminator.

### New Models

```prisma
model SkillDefinition {
  id              String            @id @default(cuid())
  skillId         String            @unique  // e.g. "code-runner", "pr-summary"
  name            String                     // Display name
  description     String                     // What and when
  version         String            @default("1.0.0")
  sourceType      String                     // "marketplace" | "github" | "internal" | "community"
  sourceUrl       String?                    // GitHub repo or marketplace link
  sourceRegistry  String?                    // "skillsmp" | "skillsllm" | "anthropics" | "internal"
  skillMdContent  String                     // Full SKILL.md content
  category        String                     // "ai-agents" | "mcp-servers" | "cli-tools" | etc.
  tags            String[]                   // Searchable tags
  author          String?
  license         String?
  riskBand        String            @default("low")  // "low" | "medium" | "high" | "critical"
  status          String            @default("discovered") // lifecycle state
  evaluationId    String?           // FK to ToolEvaluation
  installedAt     DateTime?
  lastTestedAt    DateTime?
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  assignments     SkillAssignment[]
  metrics         SkillMetric[]
  evaluation      ToolEvaluation?   @relation(fields: [evaluationId], references: [id])
}

model SkillAssignment {
  id              String            @id @default(cuid())
  skillId         String
  agentId         String            // Which coworker gets this skill
  priority        Int               @default(0)  // Higher = loaded first
  enabled         Boolean           @default(true)
  assignedBy      String            // User who approved
  assignedAt      DateTime          @default(now())

  skill           SkillDefinition   @relation(fields: [skillId], references: [id], onDelete: Cascade)

  @@unique([skillId, agentId])
  @@index([agentId])
}

model SkillMetric {
  id              String            @id @default(cuid())
  skillId         String
  agentId         String
  period          String            // "2026-W13", "2026-03"
  invocationCount Int               @default(0)
  successCount    Int               @default(0)
  userRating      Float?            // 1-5 average
  avgLatencyMs    Int?
  feedbackNotes   String?
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  skill           SkillDefinition   @relation(fields: [skillId], references: [id], onDelete: Cascade)

  @@unique([skillId, agentId, period])
  @@index([skillId])
}
```

### Extended Agent Registry

Each agent in `agent_registry.json` gains an optional `skill_slots` configuration:

```json
{
  "agent_id": "AGT-200",
  "config_profile": {
    "tool_grants": ["backlog_write", "sandbox_execute"],
    "skill_slots": {
      "max_skills": 10,
      "categories_allowed": ["code-generation", "testing", "devops"],
      "auto_discover": true,
      "review_required": true
    }
  }
}
```

---

## User Experience

### 1. Skills Catalog Page (`/admin/skills`)

A searchable catalog showing:
- **Discovered skills** from marketplace crawls (with source badges)
- **Evaluated skills** with governance scores
- **Installed skills** with per-coworker assignment matrix
- **Skill metrics** dashboard (usage trends, ratings, effectiveness)

### 2. Coworker Skills Panel (`/admin/agents/:agentId/skills`)

Per-coworker view showing:
- Currently installed skills with enable/disable toggles
- Available skills matching this coworker's category constraints
- Skill effectiveness metrics for this coworker
- "Suggest Skills" button that searches marketplaces based on the coworker's capability domain

### 3. Coworker Panel Integration

When a coworker uses a skill, the chat shows a subtle skill attribution badge. Users can rate skill helpfulness with thumbs up/down, feeding the metrics loop.

### 4. Skill Discovery Agent

A dedicated agent (assigned to `/admin/skills`) that:
- Periodically crawls configured marketplace sources
- Matches new skills against coworker capability gaps
- Proposes skill installations through the standard proposal gate
- Reports on skill ecosystem trends

---

## Continuous Improvement Loop

```
                    ┌──────────────────────────────┐
                    │    1. DISCOVER                │
                    │    Crawl marketplaces,        │
                    │    GitHub repos, community    │
                    └──────────┬───────────────────┘
                               ↓
                    ┌──────────────────────────────┐
                    │    2. EVALUATE                │
                    │    TAK governance review,     │
                    │    security scan, license,    │
                    │    capability fit scoring     │
                    └──────────┬───────────────────┘
                               ↓
                    ┌──────────────────────────────┐
                    │    3. INSTALL                 │
                    │    Assign to coworkers,       │
                    │    configure tool grants,     │
                    │    set priority/context       │
                    └──────────┬───────────────────┘
                               ↓
                    ┌──────────────────────────────┐
                    │    4. OPERATE                 │
                    │    Skills active in agent     │
                    │    context, usage tracking,   │
                    │    user feedback collection   │
                    └──────────┬───────────────────┘
                               ↓
                    ┌──────────────────────────────┐
                    │    5. IMPROVE                 │
                    │    Analyze metrics, refine    │
                    │    prompts, replace poor      │
                    │    performers, share wins     │
                    └──────────┴───────────────────┘
                               ↓ (loops back to 1)
```

### Improvement Triggers

| Trigger | Action |
|---------|--------|
| Skill invocation count drops >50% week-over-week | Flag for review |
| User rating drops below 3.0 | Propose replacement from marketplace |
| New version detected in source repo | Propose upgrade |
| New marketplace skill matches a coworker's domain gap | Propose installation |
| Skill consistently outperforms another for same task | Propose swap |
| Platform creates a novel skill internally | Propose publishing to marketplace |

---

## TAK Governance Integration

### Skill Evaluation Criteria (extends ToolEvaluation)

| Criterion | Weight | Description |
|-----------|--------|-------------|
| **Security** | 30% | No shell injection, no network calls without grant, no credential access |
| **License** | 15% | Compatible with platform license (Apache 2.0, MIT preferred) |
| **Capability Fit** | 20% | Matches coworker's capability domain and tool grants |
| **Risk Band** | 15% | Aligns with agent's governance profile risk band |
| **Quality Signals** | 10% | GitHub stars, maintenance activity, community adoption |
| **Testability** | 10% | Can be validated in sandbox before production |

### HITL Requirements

| Skill Risk Band | HITL Tier | Approval |
|-----------------|-----------|----------|
| Low | Tier 3 (auto) | Auto-install if score > 80% |
| Medium | Tier 2 | Agent proposes, human confirms |
| High | Tier 1 | Requires admin + security review |
| Critical | Tier 0 | Executive sponsor approval |

---

## Epic Decomposition

### Phase 1: Foundation (Weeks 1-2)
- **EP-SKILL-001-001**: Schema migration — `SkillDefinition`, `SkillAssignment`, `SkillMetric` models
- **EP-SKILL-001-002**: Skill ingestion API — parse SKILL.md files, extract metadata, store in DB
- **EP-SKILL-001-003**: Skills catalog page (`/admin/skills`) — browse, search, filter

### Phase 2: Marketplace Integration (Weeks 3-4)
- **EP-SKILL-001-004**: GitHub source connector — fetch skills from configured repos (anthropics/skills, etc.)
- **EP-SKILL-001-005**: Marketplace crawler — index from SkillsMP/SkillsLLM APIs
- **EP-SKILL-001-006**: TAK evaluation pipeline — auto-score skills using ToolEvaluation extension

### Phase 3: Coworker Assignment (Weeks 5-6)
- **EP-SKILL-001-007**: Coworker skills management UI (`/admin/agents/:id/skills`)
- **EP-SKILL-001-008**: Runtime skill injection — load installed skills into agent context at resolution time
- **EP-SKILL-001-009**: Agent registry `skill_slots` configuration

### Phase 4: Metrics & Continuous Improvement (Weeks 7-8)
- **EP-SKILL-001-010**: Usage tracking — instrument skill invocations, collect ratings
- **EP-SKILL-001-011**: Metrics dashboard — per-skill and per-coworker effectiveness views
- **EP-SKILL-001-012**: Improvement recommendations engine — detect degradation, propose upgrades

### Phase 5: Autonomous Discovery (Weeks 9-10)
- **EP-SKILL-001-013**: Skill Discovery Agent — automated marketplace scanning + proposal generation
- **EP-SKILL-001-014**: Skill versioning and upgrade workflow
- **EP-SKILL-001-015**: Community sharing — export platform skills as SKILL.md to configured repos

---

## Sources

- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills)
- [Agent Skills Open Standard](https://github.com/agentskills/agentskills)
- [Anthropic Official Skills](https://github.com/anthropics/skills)
- [SkillsMP Marketplace](https://skillsmp.com)
- [SkillsLLM Marketplace](https://skillsllm.com)
- [formulahendry/agent-skill-code-runner](https://github.com/formulahendry/agent-skill-code-runner)
- [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills)
- [HashiCorp Agent Skills](https://github.com/hashicorp/agent-skills)
