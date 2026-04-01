# EP-BUILD-HANDOFF: Build Studio Multi-Agent Handoff

| Field | Value |
|-------|-------|
| **Epic** | EP-BUILD-HANDOFF |
| **IT4IT Alignment** | §5.2 Explore → §5.3 Integrate → §5.4 Deploy → §5.5 Release |
| **Status** | Draft |
| **Created** | 2026-03-31 |
| **Author** | Claude (Software Engineer) + Mark Bodman |

## Problem Statement

The Build Studio currently routes all five phases (ideate, plan, build, review, ship) through a single AI Coworker agent (`build-specialist` / "Software Engineer"). This creates three problems:

1. **Tool overload** — The agent receives 40+ tools but only needs 5-8 per phase. Smaller models get confused by irrelevant tools and call the wrong ones or fail to find the right ones.
2. **Prompt overload** — Each phase has a different system prompt, but the conversation history from earlier phases stays in context, consuming tokens and confusing the model about its current role.
3. **Capability mismatch** — Code generation (build phase) requires a strong coding model. Design review (ideate) needs analytical reasoning. Deployment (ship) needs operational tool calling. One model size does not fit all.

### Evidence from Testing

- Haiku (`claude-haiku-4-5-20251001`) successfully generated code using `write_sandbox_file` in the build phase, but entered tool repetition loops during phase transitions and could not call ship tools (`deploy_feature`, `execute_promotion`).
- The AI repeatedly called `update_lifecycle` with build IDs instead of product IDs — confusing build-phase context with ship-phase operations.
- Ship tools were invisible because the coworker mode defaulted to "advise" (now fixed), but even with "act" mode, the model said "I don't have deploy_feature" because it was overwhelmed by the tool list.
- Opus and Sonnet via API key hit rate limits (30K input tokens/minute on Tier 1) because the full tool list + conversation history consumed ~15K tokens per call.

## Proposed Architecture: Phase-Specific Agent Handoff

### Design Principle

Each build phase is handled by a **specialist agent** with:
- A **focused tool set** (only the tools needed for that phase)
- A **phase-specific system prompt** (no carryover confusion)
- A **model appropriate to the task** (Haiku for simple phases, Sonnet for code generation)
- A **handoff protocol** that passes structured context between phases (not raw conversation history)

### Agent Assignments

| Phase | Agent | IT4IT Role | Model | Tools (count) |
|-------|-------|-----------|-------|---------------|
| **Ideate** | `build-specialist` (Software Engineer) | AGT-ORCH-200 Explore | Haiku | search_project_files, read_project_file, saveBuildEvidence, reviewDesignDoc, save_build_notes (5) |
| **Plan** | `ea-architect` (Enterprise Architect) | AGT-121/130 Architecture + Release Planning | Haiku | saveBuildEvidence, reviewBuildPlan, read_sandbox_file, list_sandbox_files, search_sandbox (5) |
| **Plan** | `data-architect` (Data Architect) | AGT-903 Data Modeling & Schema Design | Haiku | read_sandbox_file, list_sandbox_files, search_sandbox, saveBuildEvidence, reviewBuildPlan (5) |
| **Build** | `build-specialist` (Software Engineer) | AGT-131 Design & Develop | Sonnet | write_sandbox_file, read_sandbox_file, edit_sandbox_file, search_sandbox, list_sandbox_files, run_sandbox_command, run_sandbox_tests, generate_code, iterate_sandbox (9) |
| **Review** | `ops-coordinator` (Scrum Master) | AGT-132 Release Acceptance | Haiku | run_sandbox_tests, generate_ux_test, run_ux_test, saveBuildEvidence, check_deployment_windows, read_sandbox_file (6) |
| **Ship** | `platform-engineer` (AI Ops Engineer) | AGT-ORCH-400/500 Deploy + Release | Haiku | deploy_feature, register_digital_product_from_build, create_build_epic, check_deployment_windows, execute_promotion, schedule_promotion (6) |

### Data Architect Specialist (Plan Phase)

The `data-architect` agent (AGT-903) participates in the **plan phase** alongside the Enterprise Architect. When a build plan involves schema changes (new models, field additions, relation changes), the data architect reviews and designs the Prisma schema modifications before they reach the build phase.

#### DAMA-DMBOK Knowledge Area Alignment

| DAMA-DMBOK Knowledge Area | Agent Responsibility |
|---------------------------|---------------------|
| **Data Modeling & Design** | Review proposed Prisma models for 3rd normal form compliance, proper relationships (`@relation`), field types, and naming conventions (camelCase fields, PascalCase models) |
| **Data Quality** | Enforce constraints (`@unique`, `@default`, `@@index`), required vs optional fields, and data type precision (e.g., `Decimal` for currency, `DateTime` for timestamps) |
| **Metadata Management** | Ensure models carry audit fields (`createdAt`, `updatedAt`), that enum-like string fields document their canonical values, and that migration names are descriptive |
| **Data Governance** | Validate that new data entities align with the existing data model graph, flag PII fields for retention policy, and check that no orphaned tables or redundant models are introduced |
| **Reference & Master Data** | Protect referential integrity of master entities (`Product`, `Organization`, `Agent`), prevent duplication of reference data patterns, and enforce consistent foreign key naming |

#### Diversity of Thought — How Data Architect Differs from Software Engineer

Per the [Diversity of Thought framework](../../Reference/diversity-of-thought-framework.md), each agent must bring a genuinely different cognitive toolbox:

| Component | Software Engineer | Data Architect |
|-----------|------------------|----------------|
| **Perspective** | Sees the problem as *code to write* — components, functions, UI interactions | Sees the problem as *data to model* — entities, relationships, cardinality, lifecycle |
| **Heuristics** | DRY, SOLID, component composition, test coverage | 3NF normalization, referential integrity, index selectivity, DAMA-DMBOK patterns |
| **Interpretive Model** | "Good" = working code that passes tests and renders correctly | "Good" = normalized schema with enforced constraints, no redundancy, migration-safe evolution |

**Superadditivity test:** The Software Engineer might create a `complaints` table with `status VARCHAR` and `assignedTo VARCHAR`. The Data Architect would flag: status should reference the canonical enum pattern (per CLAUDE.md), `assignedTo` should be a foreign key to `Agent` or `User`, and the table needs `createdAt`/`updatedAt` audit fields and an index on `status` for filter queries. Neither agent alone produces the complete solution.

#### Plan Phase Sequencing

When a build involves schema changes:
1. **Enterprise Architect** reviews the overall build plan (architecture fit, component structure)
2. **Data Architect** reviews and refines the schema portion of the plan (Prisma model design)
3. Both agents contribute to the Plan → Build handoff document

When a build has **no schema changes** (e.g., "No database changes" in user preferences), the Data Architect is skipped and the Enterprise Architect handles the plan phase alone.

#### IT4IT Alignment

- **Primary:** §5.2.3 Define Digital Product Architecture (data architecture aspect)
- **Secondary:** §6.1.3 Enterprise Architecture FC (data governance controls)
- **Cross-reference:** Extends `data-governance-agent` (AGT-902) which handles compliance/retention but not structural schema design

#### Agent Registry Entry (proposed for `agent_registry.json`)

```json
{
  "agent_id": "AGT-903",
  "agent_name": "data-architect",
  "tier": "specialist",
  "value_stream": "explore",
  "capability_domain": "Reviews and designs Prisma schema changes during the plan phase; enforces 3NF normalization, referential integrity, index design, naming conventions, and audit field standards; aligned to DAMA-DMBOK knowledge areas (Data Modeling & Design, Data Quality, Metadata Management, Data Governance, Reference & Master Data); §5.2.3 Define Digital Product Architecture (data aspect)",
  "human_supervisor_id": "HR-300",
  "hitl_tier_default": "informed",
  "delegates_to": [],
  "escalates_to": "AGT-121",
  "it4it_sections": ["5.2.3", "6.1.3", "DAMA-DMBOK"],
  "status": "defined",
  "config_profile": {
    "model_binding": {
      "model_id": "claude-haiku-4-5-20251001",
      "temperature": 0.1,
      "max_tokens": 4096,
      "timeout_seconds": 120
    },
    "token_budget": {
      "daily_limit": 200000,
      "per_task_limit": 20000
    },
    "tool_grants": [
      "registry_read",
      "backlog_read",
      "architecture_read",
      "schema_review",
      "decision_record_create",
      "ea_graph_read"
    ],
    "memory": { "type": "session" },
    "concurrency_limit": 4
  }
}
```

### Handoff Protocol

When a phase completes, the current agent produces a **structured handoff document** stored on the `FeatureBuild` record. The next agent reads only this document — not the previous conversation.

```typescript
interface PhaseHandoff {
  fromPhase: BuildPhase;
  toPhase: BuildPhase;
  fromAgent: string;
  summary: string;           // 2-3 sentence plain language summary
  evidence: Record<string, unknown>;  // Phase-specific evidence (designDoc, buildPlan, etc.)
  openIssues: string[];      // Anything the next agent should know
  userPreferences: string[]; // Decisions the user made during this phase
}
```

#### Ideate → Plan Handoff
```
summary: "Customer Complaint Tracker — list view with status badges, submit form, in-memory state. Design approved."
evidence: { designDoc: {...}, designReview: {...} }
openIssues: []
userPreferences: ["No database changes", "In-memory state for demo"]
```

#### Plan → Build Handoff
```
summary: "Single file implementation: apps/web/app/(shell)/complaints/page.tsx. Client component with useState."
evidence: { buildPlan: {...}, planReview: {...}, schemaReview: null }
openIssues: []
userPreferences: ["No database changes"]
```

#### Plan → Build Handoff (with schema changes)

```
summary: "Complaints feature with Prisma model. New Complaint table with status enum, FK to User, indexes on status and createdAt."
evidence: {
  buildPlan: {...},
  planReview: {...},
  schemaReview: {
    reviewedBy: "data-architect",
    normalForm: "3NF",
    models: ["Complaint"],
    relationships: [{ from: "Complaint", to: "User", type: "many-to-one", field: "assignedTo" }],
    indexes: ["@@index([status])", "@@index([createdAt])"],
    auditFields: ["createdAt", "updatedAt"],
    enumCompliance: "status uses canonical pattern per CLAUDE.md",
    issues: []
  }
}
openIssues: []
userPreferences: []
```

#### Build → Review Handoff
```
summary: "Complaints page created. ComplaintsClient.tsx (11KB). No schema changes. Typecheck passes."
evidence: { taskResults: {...}, verificationOut: {...} }
openIssues: ["Typecheck warning on unused import"]
userPreferences: []
```

#### Review → Ship Handoff
```
summary: "All tests pass. 3 UX tests pass. Acceptance criteria met. Deployment window open."
evidence: { acceptanceMet: [...], verificationOut: {...} }
openIssues: []
userPreferences: []
```

### Implementation Steps

#### Phase 1: Tool Filtering (Low Risk)
Filter the tool list per phase before sending to the model. No new agents needed — same `build-specialist` but with phase-appropriate tools.

**Changes:**
- `mcp-tools.ts`: Add `phases?: BuildPhase[]` to `ToolDefinition`. Tag each tool with which phases it belongs to.
- `agent-coworker.ts`: Filter tools by current build phase before passing to the model.

**Result:** Smaller tool lists per phase. Haiku sees 5-9 tools instead of 40+. Immediate improvement.

#### Phase 2: Handoff Document (Medium Risk)
Add structured handoff to phase transitions. Each phase writes a handoff before advancing.

**Changes:**
- `feature-build-types.ts`: Add `PhaseHandoff` type and `phaseHandoffs` field to `FeatureBuild`.
- `build-agent-prompts.ts`: Each phase prompt ends with "save a handoff summary before advancing."
- `agent-coworker.ts`: When phase changes, start new agent context with handoff document instead of full conversation history.

**Result:** Clean context per phase. No token waste on irrelevant history.

#### Phase 3: Agent Routing (Higher Risk)
Route each phase to a different agent with phase-appropriate model.

**Changes:**
- `build-pipeline.ts` or `agent-coworker.ts`: Map phase → agentId. Use `AgentModelConfig` to pick the right model per agent.
- `AgentModelConfig` seeds: Set build-specialist to Sonnet, others to Haiku.
- UI: Show which agent is active per phase (avatar/name changes in the coworker panel).

**Result:** Full specialization. Each agent is an expert in its phase.

### Token Budget Analysis

Current (single agent, all tools):
- System prompt: ~3,000 tokens
- Tool definitions (40+ tools): ~8,000 tokens
- Conversation history (multi-phase): ~5,000+ tokens
- **Total per call: ~16,000+ input tokens**

Proposed (phase-specific agent, filtered tools):
- System prompt: ~1,500 tokens (phase-specific only)
- Tool definitions (5-9 tools): ~1,500-3,000 tokens
- Handoff document: ~500 tokens
- **Total per call: ~3,500-5,000 input tokens**

This is a **3-4x reduction** in input tokens per call, which means:
- 3-4x more calls before hitting rate limits
- 3-4x lower API costs
- Faster response times (less to process)
- More room for actual code content in `write_sandbox_file` calls

### Model Selection Per Phase

| Phase | Why this model |
|-------|---------------|
| Ideate (Haiku) | Simple: search codebase, write design doc. No complex tool reasoning needed. |
| Plan (Haiku) | Simple: structure a plan from the design doc. Read-only sandbox access. |
| Build (Sonnet) | Complex: multi-step tool reasoning, code generation, test-fix loops. Needs strongest model. |
| Review (Haiku) | Simple: run tests, check results, report. Deterministic workflow. |
| Ship (Haiku) | Simple: call 4 tools in sequence. Deterministic workflow. But needs "act" mode for side-effect tools. |

### User Experience

The user sees the same conversation panel but the agent name/avatar changes per phase:

- Ideate: "Software Engineer" (designing)
- Plan: "Enterprise Architect" (planning) → "Data Architect" (schema review, if applicable)
- Build: "Software Engineer" (building)
- Review: "Scrum Master" (reviewing)
- Ship: "AI Ops Engineer" (deploying)

The handoff is transparent: "Handing off to the Enterprise Architect for planning..." The user can still talk to any agent — the routing just changes the default.

### Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Handoff loses context | Structured handoff document captures everything; user preferences preserved |
| User confused by agent switch | Clear UI indication; handoff message in conversation |
| Phase 1 alone doesn't fix Haiku | Phase 1 reduces tool count significantly, which is the primary confusion source |
| Multiple agent configs to maintain | Each agent's tools are tagged in one place (`mcp-tools.ts`) |
| Data architect skipped when needed | Plan phase checks if build plan references schema changes; skips data-architect when user preference is "No database changes" |

### Recommendation

**Start with Phase 1 (tool filtering).** This is the highest-value, lowest-risk change. It can be done in one commit and tested immediately. If Haiku works well with 5-9 tools per phase, Phase 2 and 3 become nice-to-haves rather than blockers.

### Backlog Items

1. **EP-BUILD-HANDOFF-001**: Add `phases` tag to ToolDefinition, filter tools by current build phase
2. **EP-BUILD-HANDOFF-002**: Add PhaseHandoff type and generation to phase transitions
3. **EP-BUILD-HANDOFF-003**: Route phases to different agents with per-agent model config
4. **EP-BUILD-HANDOFF-004**: UI agent name/avatar switch per phase
5. **EP-BUILD-HANDOFF-005**: Token budget monitoring and alerting
6. **EP-BUILD-HANDOFF-006**: Add `data-architect` (AGT-903) to agent registry and seed data; DAMA-DMBOK aligned schema review in plan phase
