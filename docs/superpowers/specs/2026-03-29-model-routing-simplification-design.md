# EP-INF-012: Model Routing Simplification — Tiers, Assignment & Admin Control

**Date:** 2026-03-29
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Epic ID:** EP-INF-012
**IT4IT Alignment:** SS-2 Portfolio Management (resource governance), S2S Service Portfolio (capability catalog)

**Predecessor specs:**

- `2026-03-18-ai-routing-and-profiling-design.md` — EP-INF-001 (original pipeline)
- `2026-03-20-contract-based-selection-design.md` — EP-INF-005a (RequestContract)
- `2026-03-20-adaptive-model-routing-design.md` — EP-INF-003 (master vision)

---

## Problem Statement

The model routing system has grown into 81 TypeScript files, 6 database tables, and 10+ design specs. It is powerful but opaque — even the platform builders cannot explain why a specific model was selected for a given request. Three concrete failures demonstrate the problem:

1. **False precision in model scores.** ModelProfile stores seven dimension scores (codegen, toolFidelity, reasoning, etc.) as integers 0-100. These were manually seeded with guesses — Claude Sonnet scored 92 for codegen, Gemini 2.5 Pro scored 85. Nobody verified these numbers. When Gemini was selected for Build Studio and looped on tool calls, the root cause was that `toolFidelity: 65` was too generous — the model simply cannot do reliable multi-step tool calling. The 0-100 scale creates an illusion of measurement where none exists.

2. **No admin control over model assignment.** When Build Studio failed with Gemini, the fix required a code change (`preferredProviderId: "anthropic-sub"` hardcoded in `agent-routing.ts`). A platform administrator has no UI to say "Build Studio should use a model that's good at tool calling." The AI Workforce page shows agents and providers but offers no way to assign models to agents or set quality requirements.

3. **Too many concepts for a non-technical user.** The routing pipeline uses: ModelProvider, ModelProfile, EndpointManifest, RequestContract, RoutedExecutionPlan, ModelRecipe, PolicyRule, EndpointTaskPerformance, RouteDecisionLog, quality floors, reasoning depth, budget class, sensitivity clearance, capability dimensions, champion/challenger recipes, golden test evaluation. An administrator who wants to answer "which model does my Build Studio use?" must understand at least five of these concepts.

**Verified on 2026-03-29:** A fresh consumer-mode install with Gemini 2.5 Pro configured resulted in Build Studio producing "I got stuck in a loop" on every feature build attempt. The fix required three code changes across two sessions.

---

## Goals

1. An administrator can see which model each AI coworker agent is using and why, in a single admin page.
2. An administrator can change the minimum quality requirement per agent without touching code.
3. Model quality is expressed as a human-readable tier (Frontier, Strong, Adequate, Basic) rather than seven opaque dimension scores.
4. Tiers are derived from industry benchmarks and model family, not manually guessed scores.
5. The existing routing pipeline (contract matching, capability filtering, cost ranking, rate limits) continues to work — this spec simplifies the configuration layer, not the execution layer.
6. The dimension scores remain available internally for fine-grained ranking within a tier, but are not the primary configuration surface.

---

## Non-Goals

1. Rewriting the routing pipeline (pipeline-v2, cost-ranking, execution adapters). These work correctly.
2. Removing ModelProfile or its dimension scores from the database. They remain useful for ranking.
3. Building automated benchmark evaluation (golden tests, champion/challenger). These are separate epics (EP-INF-006).
4. Provider configuration (API keys, OAuth, endpoints). The existing provider pages handle this.

---

## Design Summary

Three changes that together make model selection understandable and configurable:

```text
Model arrives via provider discovery
  ↓
Tier assigned from model family + published benchmarks
  (Frontier / Strong / Adequate / Basic)
  ↓
Agent declares minimum tier (code default, admin-overridable)
  ↓
Admin sees: "Build Studio → Claude Sonnet 4 (Frontier)"
  Can change: minimum tier, or pin a specific model
  ↓
Router filters by tier + capabilities, ranks by cost within tier
```

---

## Section 1: Model Quality Tiers

### 1.1 Tier Definitions

Four tiers replace the seven dimension scores as the primary quality signal:

| Tier | Meaning | Typical models | Tool calling | Code generation |
|------|---------|---------------|--------------|-----------------|
| `frontier` | Best available — handles complex multi-step tool calling, code generation, and reasoning reliably | Claude Opus/Sonnet 4+, GPT-5+ | Excellent | Excellent |
| `strong` | Good for most tasks — reliable tool calling with occasional limitations on complex chains | Gemini 2.5 Pro, GPT-4o, Claude Haiku 4.5 | Good | Good |
| `adequate` | Basic tasks — simple tool calls, conversation, summarisation | Gemini 2.5 Flash, Gemini 2.0 Flash | Limited | Adequate |
| `basic` | Simple conversation only — local models, lightweight cloud models | Llama 3, Phi, Gemma | Unreliable | Basic |

Tiers are stored on `ModelProfile.qualityTier` (new field) alongside the existing `capabilityTier` (which is descriptive and inconsistent — "moderate", "advanced", "restricted", "strong" — no canonical set).

### 1.2 Tier Assignment

Tiers are assigned automatically from **model family baselines**, not from dimension scores:

```typescript
const FAMILY_TIERS: Record<string, QualityTier> = {
  // Anthropic
  "claude-opus-4":    "frontier",
  "claude-sonnet-4":  "frontier",
  "claude-haiku-4":   "strong",
  "claude-3-haiku":   "adequate",
  // OpenAI
  "gpt-5":            "frontier",
  "gpt-4o":           "strong",
  "gpt-4o-mini":      "adequate",
  // Google
  "gemini-2.5-pro":   "strong",    // Good reasoning, limited tool fidelity
  "gemini-2.5-flash": "adequate",
  "gemini-2.0-flash": "adequate",
  "gemma":            "basic",
  // Local
  "llama":            "basic",
  "phi":              "basic",
  "qwen":             "basic",
};
```

**Assignment rules:**

1. On provider sync / model discovery, match `modelId` against `FAMILY_TIERS` using longest prefix match.
2. If no match, default to `"adequate"` (conservative — avoids routing complex work to unknown models).
3. Admin can override the tier per model via the Admin UI (stored on `ModelProfile.qualityTier`).
4. Override is sticky — re-sync does not reset an admin-set tier.

### 1.3 Tier-to-Dimension Mapping

The existing dimension scores are **derived from the tier** for new models, replacing manual seeding:

| Tier | codegen | toolFidelity | reasoning | instructionFollowing |
|------|---------|--------------|-----------|---------------------|
| `frontier` | 90 | 90 | 90 | 90 |
| `strong` | 75 | 75 | 75 | 75 |
| `adequate` | 55 | 55 | 55 | 55 |
| `basic` | 35 | 35 | 35 | 35 |

These are baseline defaults. The existing evaluation infrastructure (golden tests, production feedback) can adjust individual dimensions over time. But the tier remains the human-facing configuration surface — admins never see or edit dimension scores directly.

### 1.4 Integration with Routing Pipeline

The `minimumDimensions` field on `RequestContract` (added today) continues to work. It is now derived from the agent's minimum tier rather than hardcoded in `agent-routing.ts`:

```typescript
const TIER_MINIMUM_DIMENSIONS: Record<QualityTier, Record<string, number>> = {
  frontier: { codegen: 85, toolFidelity: 85, reasoning: 85 },
  strong:   { codegen: 70, toolFidelity: 70, reasoning: 70 },
  adequate: { codegen: 50, toolFidelity: 50, reasoning: 50 },
  basic:    {},  // No minimums — accept anything
};
```

When an agent declares `minimumTier: "frontier"`, the routing pipeline translates this to `minimumDimensions: { codegen: 85, toolFidelity: 85, reasoning: 85 }` and the existing `estimateSuccessProbability` check excludes models below those thresholds.

---

## Section 2: Agent Model Assignment

### 2.1 Schema

New model `AgentModelConfig` replaces hardcoded `modelRequirements` in `agent-routing.ts`:

```prisma
model AgentModelConfig {
  agentId          String    @id       // e.g. "build-specialist", "coo"
  minimumTier      String    @default("adequate")
  // Values: "frontier" | "strong" | "adequate" | "basic"
  pinnedProviderId String?   // Admin override: force this provider
  pinnedModelId    String?   // Admin override: force this model
  budgetClass      String    @default("balanced")
  // Values: "minimize_cost" | "balanced" | "quality_first"
  configuredAt     DateTime  @default(now())
  configuredById   String?
  configuredBy     User?     @relation("AgentModelConfiguredBy", fields: [configuredById], references: [id])
}
```

### 2.2 Default Configuration

When `AgentModelConfig` has no row for an agent, the code defaults are used (defined in `agent-routing.ts`). These are the fallback values:

| Agent | Default minimumTier | Default budgetClass | Rationale |
|-------|-------------------|-------------------|-----------|
| `build-specialist` (Build Studio) | `frontier` | `quality_first` | Multi-step tool calling, code generation |
| `coo` (COO / Workspace) | `strong` | `balanced` | Conversational, occasional tool use |
| `admin-assistant` | `strong` | `balanced` | Configuration tasks, moderate tool use |
| `hr-director` | `adequate` | `balanced` | Conversation-heavy, simple tools |
| `customer-success` | `adequate` | `balanced` | Conversation-heavy |
| `compliance-officer` | `strong` | `balanced` | Analysis, document review |
| `finance-controller` | `strong` | `balanced` | Numerical accuracy, tool use |
| All others | `adequate` | `balanced` | Default safe level |

### 2.3 Loading Agent Config

When `getBuildContextSection()` or `resolveAgentForRoute()` runs, it checks the database first:

```typescript
async function getAgentModelConfig(agentId: string): Promise<AgentModelConfig | null> {
  return prisma.agentModelConfig.findUnique({ where: { agentId } });
}
```

If a database row exists, its `minimumTier` and `budgetClass` override the code defaults. If `pinnedProviderId` or `pinnedModelId` is set, these are passed as `preferredProviderId`/`preferredModelId` to the routing pipeline (existing override mechanism).

### 2.4 Removing Hardcoded Overrides

After this spec is implemented:

1. **Remove** all `modelRequirements` entries from `ROUTE_AGENT_MAP` in `agent-routing.ts` that specify `preferredProviderId`, `preferredModelId`, or `minimumDimensions`.
2. **Replace** with `defaultMinimumTier` and `defaultBudgetClass` on the agent info type (used as fallback when no DB config exists).
3. The `minimumDimensions` field on `RequestContract` remains — it is populated from the tier lookup, not from agent-routing.ts.

---

## Section 3: Admin UI — AI Coworker Model Assignment

### 3.1 Location

New section on the existing **AI Workforce** page at `/platform/ai`, or a dedicated sub-page at `/platform/ai/model-assignment`.

### 3.2 Layout

A table showing every agent with its current model assignment:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ AI Coworker Model Assignment                                          │
│                                                                       │
│ Agent              Minimum Quality    Current Model          Budget    │
│ ─────────────────  ─────────────────  ─────────────────────  ──────── │
│ Software Engineer  [Frontier ▾]       Claude Sonnet 4.6      Quality  │
│ COO                [Strong ▾]         Claude Sonnet 4.6      Balanced │
│ System Admin       [Strong ▾]         Claude Sonnet 4.6      Balanced │
│ HR Director        [Adequate ▾]       Gemini 2.5 Flash       Balanced │
│ Customer Success   [Adequate ▾]       Gemini 2.5 Flash       Balanced │
│ Compliance Officer [Strong ▾]         Claude Haiku 4.5       Balanced │
│ Finance Controller [Strong ▾]         Claude Haiku 4.5       Balanced │
│ Portfolio Manager  [Adequate ▾]       Gemini 2.5 Flash       Balanced │
│                                                                       │
│ "Current Model" shows the model the router selected last time this    │
│  agent was invoked. Change Minimum Quality to influence selection.     │
│                                                                       │
│ [Save]                                                                │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Tier Dropdown

Each agent has a dropdown with four options:

- **Frontier** — Best available. Recommended for Build Studio and complex tasks.
- **Strong** — Good for most tasks. Recommended for admin, compliance, finance.
- **Adequate** — Basic tasks and conversation. Cheapest cloud option.
- **Basic** — Local models only. No cloud cost. Limited capabilities.

### 3.4 Pin Override (Advanced)

An expandable "Advanced" row per agent shows:

- **Pin to provider:** dropdown of active providers (or "Auto")
- **Pin to model:** dropdown of models from the selected provider (or "Auto")
- **Last routing decision:** which model was selected, why, when

When a model is pinned, the tier dropdown is disabled (pin takes precedence).

### 3.5 Capability Gate

The page requires `manage_platform` capability (HR-000 only), consistent with other platform governance settings.

### 3.6 Server Action

```typescript
export async function saveAgentModelConfig(
  agentId: string,
  minimumTier: "frontier" | "strong" | "adequate" | "basic",
  budgetClass: "minimize_cost" | "balanced" | "quality_first",
  pinnedProviderId?: string | null,
  pinnedModelId?: string | null,
) {
  await requireManagePlatform();
  await prisma.agentModelConfig.upsert({
    where: { agentId },
    update: { minimumTier, budgetClass, pinnedProviderId, pinnedModelId, configuredAt: new Date(), configuredById: userId },
    create: { agentId, minimumTier, budgetClass, pinnedProviderId, pinnedModelId, configuredAt: new Date(), configuredById: userId },
  });
  revalidatePath("/platform/ai");
}
```

---

## Section 4: Model Tier Visibility

### 4.1 Provider Page Enhancement

The existing provider detail page (`/platform/ai/providers/[providerId]`) shows models from that provider. Each model gains a **tier badge**:

```
Models from Google Gemini:
  gemini-2.5-pro        [Strong]    $3.50/MT in, $10.50/MT out
  gemini-2.5-flash      [Adequate]  $0.15/MT in, $0.60/MT out
  gemma-3-27b-it        [Basic]     Free (local)
```

### 4.2 Tier Override

On the provider detail page, an admin can override a model's tier. This is a rare operation for when the automatic tier assignment is wrong (e.g., a new model that the family baseline doesn't cover yet).

---

## Section 5: Migration Path

### 5.1 What Changes

| Component | Before | After |
|-----------|--------|-------|
| `agent-routing.ts` `modelRequirements` | `{ preferredProviderId, minimumDimensions }` | `{ defaultMinimumTier, defaultBudgetClass }` |
| Model quality source | Manual dimension scores in seed script | Family-based tier assignment |
| Admin configuration | None (code only) | AgentModelConfig table + UI |
| ModelProfile.qualityTier | Does not exist | New field, auto-populated from family |
| ModelProfile dimensions | Manually seeded 0-100 | Derived from tier baseline, refined by evaluation |

### 5.2 What Stays The Same

| Component | Status |
|-----------|--------|
| RequestContract.minimumDimensions | Kept — populated from tier |
| cost-ranking.ts estimateSuccessProbability | Kept — checks minimumDimensions |
| Pipeline-v2 (filtering, ranking, fallback) | Kept unchanged |
| Execution adapters | Kept unchanged |
| Rate limit tracking | Kept unchanged |
| RouteDecisionLog audit trail | Kept unchanged |
| PolicyRule filtering | Kept unchanged |

### 5.3 Cleanup (Deferred)

These items are technical debt to address in a follow-up:

1. **Legacy pipeline.ts** — remove after confirming pipeline-v2 handles all cases
2. **Redundant dimension fields on ModelProvider** — ModelProvider has `codegen`, `toolFidelity`, etc. duplicated from ModelProfile. Remove from ModelProvider, keep only on ModelProfile.
3. **Inconsistent capabilityTier values** — ModelProfile has "moderate", "advanced", "restricted", "strong", "deprecated" with no canonical set. The new `qualityTier` field supersedes this.

---

## Section 6: Routing Pipeline Stages

The routing pipeline (`pipeline-v2.ts`) selects an endpoint for each request by running the candidate list through a sequence of staged filters and a final ranker. This section documents the full stage sequence as implemented, including the capability floor added by EP-AGENT-CAP-002.

```
Routing pipeline — endpoint selection for a given RequestContract
  ↓
Stage 0: Candidate enumeration
  All EndpointManifest records with status "active" or "degraded"
  ↓
Stage 1: Hard filters — getExclusionReasonV2() per endpoint
  Any endpoint that fails a hard filter is excluded from further consideration.

  1a. Agent capability floor (EP-AGENT-CAP-002, runs FIRST)
      Source: AgentModelConfig.minimumCapabilities (runtime default: { toolUse: true })
      Check: satisfiesMinimumCapabilities(endpoint, contract.minimumCapabilities)
      Exclude if: any declared capability is not satisfied by the endpoint
      Error path: NoEligibleEndpointsError with missingCapability + agentId fields
      Note: This is an AGENT-level predicate — it characterizes what the model must support
            to serve this particular agent, regardless of what the current task requires.

  1b. Status filter — only active/degraded endpoints pass (existing)
  1c. Model class filter (existing)
  1d. Sensitivity clearance (existing)
  1e. Context window minimum (existing, now also enforced via agentMinimumContextTokens)
  1f. Task capability requirements — requiresTools, requiresCodeExecution, etc. (existing)
  ↓
Stage 2: Preference scoring — rank surviving candidates
  Cost estimate × quality tier × budget class preference
  ↓
Stage 3: Selection + fallback
  Pick highest-ranked candidate.
  If zero candidates survive Stage 1: raise NoEligibleEndpointsError
  If all candidates are degraded: raise DegradedServiceError
```

### Agent-level vs task-level capability predicates

The capability floor (1a) is an *agent-level* predicate — it characterizes what the model must
be able to do to serve this particular agent, regardless of what the current task requires.
The task capability requirements (1f) are *task-level* predicates — they reflect what the
current message requires. Both are hard filters; the agent floor runs first because it
eliminates the most endpoints most of the time (all standard coworkers require toolUse).

The capability floor is the primary reason a model is or is not eligible as a coworker —
this is the fundamental routing decision for agentic workflows.

### Local provider types (EP-AGENT-CAP-002-CLEANUP)

The platform supports two local provider configurations, both using the OpenAI-compatible API:

| Provider key | Runtime | API base URL | Notes |
| --- | --- | --- | --- |
| `local` | Docker Model Runner (built into Docker Desktop 4.40+) | `http://model-runner.docker.internal/v1` | Bundled — no separate install |
| `ollama` | Standalone Ollama installation | `http://localhost:11434` | Legacy — used before Docker Model Runner was available |

Both share the same routing adapter (Ollama-compatible wire format). The `"ollama"` provider key is a legacy misnaming from when Ollama was the only local runtime; EP-AGENT-CAP-002-CLEANUP renames it to `"local"` across the DB, adapter, seed, and UI.

---

## What Already Exists (No Changes Required)

| Component | Status |
|-----------|--------|
| `RequestContract` with `minimumDimensions` | Built (today) |
| `estimateSuccessProbability` dimension check | Built (today) |
| `minimumDimensions` passthrough (agentic-loop → routed-inference → contract) | Built (today) |
| Provider configuration UI | Built — `/platform/ai/providers` |
| Route decision audit log | Built — `/platform/ai/routing` |
| Agent workforce page | Built — `/platform/ai` |
| `manage_platform` capability | Built (EP-SELF-DEV-005-005) |

---

## New Backlog Items

| ID | Title | Type | Priority | Depends on |
|----|-------|------|----------|------------|
| EP-INF-012-001 | Add qualityTier field to ModelProfile; family-based tier assignment on sync | portfolio | 1 | — |
| EP-INF-012-002 | Derive dimension baselines from tier; replace manual seed scores | portfolio | 2 | 012-001 |
| EP-INF-012-003 | AgentModelConfig schema + migration; load config in routing pipeline | portfolio | 3 | 012-001 |
| EP-INF-012-004 | Remove hardcoded modelRequirements from agent-routing.ts; use tier defaults | portfolio | 4 | 012-002, 012-003 |
| EP-INF-012-005 | Admin UI: AI Coworker Model Assignment page with tier dropdowns | portfolio | 5 | 012-003 |
| EP-INF-012-006 | Provider detail page: tier badges per model with admin override | portfolio | 6 | 012-001 |

---

## Not in Scope

- Automated benchmark evaluation (golden tests) — EP-INF-006
- Champion/challenger recipe evolution — EP-INF-006
- Provider OAuth configuration — EP-INF-OAUTH
- Rate limit configuration UI — future
- Cost budget/alerting per agent — future
