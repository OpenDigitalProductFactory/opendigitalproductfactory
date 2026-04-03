# AI Workforce Consolidation: Unified Agent Lifecycle Management

| Field | Value |
|-------|-------|
| **Epic** | EP-AI-WORKFORCE-001 |
| **IT4IT Alignment** | Cross-cutting: touches all seven IT4IT value streams. Agents ARE the operational workforce mapped to SS5.7 Operate roles. Agent profiles are Digital Products under Foundational/Platform Services portfolio per P1 (product-centric navigation). |
| **Depends On** | EP-NAV-REFACTOR-001 (product-centric navigation), EP-TAK-PATTERNS (agentic architecture patterns), EP-FULL-OBS (operational monitoring) |
| **Predecessor Specs** | Agentic Architecture Patterns Design, Product-Centric Navigation Refactoring, Build Studio Agent Handoff Design |
| **Status** | Draft |
| **Created** | 2026-04-02 |
| **Author** | Claude (Software Engineer) + Mark Bodman (CEO) |

---

## 1. Problem Statement

The platform's AI workforce of 46+ agents has its configuration scattered across 6+ locations with incompatible data models, duplicate records, and critical gaps that prevent unified agent management.

### 1.1 Six Configuration Sources

| Source | Location | What It Holds | Agent Count |
|--------|----------|---------------|-------------|
| Agent Registry JSON | `packages/db/data/agent_registry.json` | 46 agents with AGT-xxx IDs, tier, value_stream, capability_domain, hitl_tier_default, delegates_to, escalates_to, config_profile (model_binding, tool_grants, token_budget, memory) | 46 |
| Route Agent Map | `apps/web/lib/tak/agent-routing.ts` | 11 UI personas with slug IDs, systemPrompt, skills[], modelRequirements, sensitivity | 11 |
| Tool Grants | `apps/web/lib/tak/agent-grants.ts` | TOOL_TO_GRANTS mapping (90+ tools), loaded from agent_registry.json | N/A |
| DB Agent Model | `packages/db/prisma/schema.prisma` | agentId, name, tier (Int), type, description, status, portfolioId, preferredProviderId | Both sets seeded |
| AgentModelConfig | `packages/db/prisma/schema.prisma` | Per-agent routing: minimumTier, pinnedProviderId, pinnedModelId, budgetClass | 11 coworker agents |
| AgentGovernanceProfile | `packages/db/prisma/schema.prisma` | capabilityClassId, directivePolicyClassId, autonomyLevel, hitlPolicy, allowDelegation, maxDelegationRiskBand | Subset |

### 1.2 Incompatibilities

| Gap | Detail | Impact |
|-----|--------|--------|
| **Two ID schemes** | Registry: `AGT-ORCH-000`. Routing: `"coo"`, `"portfolio-advisor"`. No mapping. | Cannot look up a registry agent's routing config or vice versa. |
| **Tier type mismatch** | Prisma `Agent.tier` is Int. Registry `tier` is String ("orchestrator", "specialist"). | Runtime code using Agent.tier cannot interpret registry tiers without duplicating the mapping. |
| **Duplicate AGT-903** | agent_registry.json contains AGT-903 three times with different capability_domains. | Ambiguous canonical definition. |
| **Skills only on UI personas** | Skills defined only in `agent-routing.ts`. 35 of 46 agents have zero skills. | Most agents cannot participate in the unified coworker experience. |
| **Performance per endpoint, not agent** | `EndpointTaskPerformance` keys on (endpointId, taskType). An endpoint is a provider+model, not an agent. | Cannot answer "How is the Portfolio Analyst performing?" |
| **Two authorization models** | Registry: flat `tool_grants` array. Governance: `AgentCapabilityClass` with riskBand. | No unified way to determine what an agent is allowed to do. |
| **Provider assignment split** | `Agent.preferredProviderId` (unused). `AgentModelConfig.pinnedProviderId` (actual). | Changing preferredProviderId in UI has no routing effect. |
| **Sensitivity only on personas** | Sensitivity levels only in `agent-routing.ts`. Registry agents have no classification. | 35 registry agents have no sensitivity-aware routing. |

### 1.3 Consequences

- No single page or API can show a complete agent profile.
- Adding a new agent requires touching 3-5 files with no validation that they are consistent.
- Feature degradation (which features break when a provider is down) cannot be computed.
- The product-centric navigation spec treats agents as digital products but there is no unified model to drive lifecycle tabs.

---

## 2. Design Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| DP1 | **Agent is a Digital Product** | Foundational/Platform Services portfolio. Each agent gets lifecycle tabs. |
| DP2 | **Single canonical ID** | AGT-xxx format from registry. Slug IDs become a `slugId` alias field. |
| DP3 | **DB is runtime source of truth** | agent_registry.json becomes bootstrap-only seed file. |
| DP4 | **Configuration by composition** | Normalized related tables, not monolithic JSON blobs. |
| DP5 | **Pattern compliance** | Full agentic architecture patterns compliance (model routing, prompt composition, tool architecture, safety/audit). |
| DP6 | **Backward compatible migration** | Existing code works during transition via DB-with-fallback pattern. |

---

## 3. Unified Agent Data Model

### 3.1 Core Agent Table (Enhanced)

New fields added to existing `Agent` model:

| Field | Type | Purpose |
|-------|------|---------|
| `slugId` | String? @unique | Backward-compat alias ("coo", "build-specialist") |
| `valueStream` | String? | IT4IT value stream alignment |
| `it4itSections` | String[] | IT4IT section references |
| `sensitivity` | String (default "internal") | Data classification |
| `humanSupervisorId` | String? | HR role supervisor |
| `hitlTierDefault` | Int (default 3) | 0=human-only through 3=autonomous |
| `escalatesTo` | String? | Escalation target |
| `delegatesTo` | String[] | Delegation chain |
| `lifecycleStage` | String (default "production") | "plan"\|"design"\|"build"\|"production"\|"retirement" |
| `updatedAt` | DateTime | Auto-updated timestamp |

### 3.2 New Related Tables

#### AgentExecutionConfig
Replaces `config_profile.model_binding`, `execution_runtime`, `token_budget`, and `memory` from agent_registry.json.

| Field | Type | Purpose |
|-------|------|---------|
| defaultModelId | String? | Fallback model ID |
| temperature | Float (0.3) | Inference temperature |
| maxTokens | Int (4096) | Token limit |
| executionType | String ("in_process") | Runtime type |
| timeoutSeconds | Int (120) | Execution timeout |
| concurrencyLimit | Int (4) | Max parallel executions |
| dailyTokenLimit | Int (200000) | Daily budget |
| perTaskTokenLimit | Int (20000) | Per-task budget |
| memoryType | String ("session") | "none"\|"session"\|"persistent" |
| memoryBackend | String? | Backend for memory storage |

#### AgentSkillAssignment
Makes skills a first-class entity assignable to any agent.

| Field | Type | Purpose |
|-------|------|---------|
| label | String | Skill display name |
| description | String | What the skill does |
| capability | String? | Permission gate |
| prompt | String | Triggered prompt text |
| taskType | String ("conversation") | Task classification |
| sortOrder | Int (0) | Display ordering |

#### AgentToolGrant
Replaces flat `tool_grants` string array with relational model.

| Field | Type | Purpose |
|-------|------|---------|
| grantKey | String | e.g., "registry_read", "backlog_write" |
| grantedAt | DateTime | When granted |
| grantedBy | String? | Who granted (null = seed) |

#### AgentPerformance
Agent-level performance (bridges per-endpoint `EndpointTaskPerformance`).

| Field | Type | Purpose |
|-------|------|---------|
| taskType | String | Task classification |
| evaluationCount | Int | Total evaluations |
| successCount | Int | Count where score >= 3 |
| avgOrchestratorScore | Float | EMA of orchestrator scores |
| avgHumanScore | Float? | EMA of human scores |
| recentScores | Float[] | Sliding window (last 10) |
| instructionPhase | String | "learning"\|"practicing"\|"innate" |
| profileConfidence | String | "low"\|"medium"\|"high" |

#### FeatureDegradationMapping
Maps agent tier requirements to platform features for degradation tracking.

| Field | Type | Purpose |
|-------|------|---------|
| featureRoute | String | e.g., "/build", "/portfolio" |
| featureName | String | Human-readable feature name |
| requiredTier | String | Minimum tier needed |
| degradationMode | String | "disabled"\|"reduced"\|"fallback_agent"\|"manual_only" |
| fallbackAgentId | String? | Agent that takes over |
| userMessage | String? | Shown to user when degraded |

#### AgentPromptContext
Domain context for 7-block prompt composition system.

| Field | Type | Purpose |
|-------|------|---------|
| perspective | String? | Scott Page cognitive diversity frame |
| heuristics | String? | How agent searches for solutions |
| interpretiveModel | String? | What agent optimizes for |
| domainTools | String[] | Tools available in this domain |

### 3.3 ID Reconciliation

- Canonical: `Agent.agentId` = AGT-xxx format (46 registry + 11 new AGT-UI-xxx for coworkers)
- Alias: `Agent.slugId` = slug format for backward compatibility
- `resolveAgent(idOrSlug)` function queries by either field
- `AgentModelConfig` references `Agent.slugId` via relation

---

## 4. Documentation Specialist Agent (AGT-904)

Reference implementation of the consolidated model.

### 4.1 Agent Definition

| Field | Value |
|-------|-------|
| agentId | AGT-904 |
| slugId | doc-specialist |
| name | Documentation Specialist |
| tier | 3 (cross-cutting) |
| valueStream | cross-cutting |
| sensitivity | internal |
| hitlTierDefault | 3 (autonomous) |
| defaultMinimumTier | adequate |
| defaultBudgetClass | balanced |
| lifecycleStage | design |

### 4.2 Capability Domain

Creates, regenerates, and validates Mermaid diagrams across all documentation. Enforces documentation structure and consistency standards. Maintains awareness of Mermaid rendering tool limitations (GitHub vs VS Code vs GitBook). Reviews spec and architecture documents for completeness, cross-reference integrity, and IT4IT alignment.

### 4.3 IT4IT Alignment

Cross-cutting function touching all value stream documentation needs:
- Evaluate: Scope agreement docs, investment proposals
- Explore: ADRs, roadmaps, architecture docs
- Integrate: Release notes, SBOM documentation
- Deploy: Runbooks, rollback plans
- Release: Service catalog docs, offer descriptions
- Consume: Customer-facing docs, support articles
- Operate: Incident reports, post-mortems

### 4.4 Tool Grants

`file_read`, `registry_read`, `backlog_read`, `backlog_write`, `decision_record_create`, `architecture_read`

### 4.5 Skills

| Label | Description |
|-------|-------------|
| Generate diagram | Create Mermaid diagram for a concept |
| Review doc structure | Check document structural issues |
| Regenerate diagrams | Update diagrams to match current state |
| Renderer compatibility | Check diagram renderer compatibility |
| Report an issue | Report bug or give feedback |

### 4.6 Prompt Context

**Perspective**: Documents, diagrams, and cross-references network. Encodes completeness, consistency, accuracy, and renderer compatibility.

**Heuristics**: Structure validation (spec template compliance), cross-reference integrity (links resolve), diagram accuracy (Mermaid renders correctly), renderer awareness (platform-specific syntax), completeness checking (no TODOs/placeholders).

**Interpretive Model**: Optimizes for accuracy, self-containment, and renderability. A document is healthy when a new developer can read it without questions, diagrams render correctly, and cross-references resolve.

### 4.7 Feature Degradation

| Route | Feature | Required Tier | Degradation | Message |
|-------|---------|---------------|-------------|---------|
| /docs | Documentation review | adequate | manual_only | Documentation review temporarily unavailable. |
| /build | Diagram generation | adequate | reduced | Diagram generation running on basic model. |

---

## 5. Feature Degradation Mapping Design

### 5.1 Concept

Feature degradation mapping answers: "When provider X goes down or agent Y's required tier is unavailable, which user-facing features break and how?"

### 5.2 Degradation Modes

| Mode | Behavior |
|------|----------|
| `disabled` | Feature completely unavailable. Button/link disabled with message. |
| `reduced` | Feature available with reduced capability. Warning banner. |
| `fallback_agent` | Different agent handles at lower quality. Notice shown. |
| `manual_only` | AI assistance unavailable. Manual workflow only. |

### 5.3 Integration with Monitoring

When provider health probe detects degradation:
1. Update `ModelProvider.status` to "degraded" or "inactive"
2. Query `FeatureDegradationMapping` for affected agents
3. Emit Prometheus metric `dpf_feature_degraded{route, feature, mode}`
4. Fire alert via existing `PortfolioQualityIssue` pipeline

---

## 6. Migration Strategy

### Phase 1: Schema Extension (Non-breaking)
Add new fields and tables without removing anything. All new fields optional or have defaults.

### Phase 2: Seed Enhancement
Populate new tables from both agent_registry.json and ROUTE_AGENT_MAP data. Assign AGT-UI-xxx IDs to coworker agents. Fix AGT-903 duplication.

### Phase 3: Read Path Migration
Replace runtime reads from JSON/hardcoded maps with DB queries. Maintain fallbacks during transition.

### Phase 4: AGT-904 Reference Implementation
First agent fully defined under the consolidated model.

### Phase 5: UI Enhancement
Agent Detail page with lifecycle tabs. Enhanced agent cards. Degradation indicators. Dependency graph.

### Phase 6: Deprecation
Remove `preferredProviderId`, ROUTE_AGENT_MAP fallback, runtime JSON imports.

---

## 7. Verification Plan

### Data Integrity
- All 46 registry + 11 coworker agents have correct unified DB records
- AGT-903 appears exactly once
- `resolveAgent()` works with both ID schemes
- All agents have AgentExecutionConfig and tool grants

### Behavioral Parity
- `getAgentToolGrants()` returns identical grants from DB as from JSON
- `resolveAgentForRoute()` returns equivalent AgentInfo from DB
- `assembleSystemPrompt()` produces equivalent prompts from AgentPromptContext
- Existing tests pass unchanged during migration

### AGT-904 Specific
- Full profile: 6 grants, 5 skills, execution config, prompt context, 2 degradation mappings
- Resolvable via both "AGT-904" and "doc-specialist"
- Pattern 10 compliance checklist satisfied
