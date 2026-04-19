> **⚠️ SUPERSEDED** — this design doc captures an earlier iteration of routing. See [2026-04-20-routing-architecture-current.md](./2026-04-20-routing-architecture-current.md) for the current authoritative architecture.

# EP-INF-003: Adaptive Contract-Based Model Routing

**Date:** 2026-03-20
**Status:** Draft
**Author:** Mark Bodman (CEO) + Codex (design partner)
**Epic:** EP-INF-003

**Prerequisites:**
- EP-INF-001 (AI endpoint routing and profiling) - partially implemented
- EP-INF-002 (model-level routing profiles) - design complete, implementation incomplete
- Agent Test Harness (2026-03-17) - design complete, partial implementation

---

## Problem Statement

The current model routing stack is not selecting the best model for the job at the lowest sustainable cost. It does not reason from a rich request contract, it does not carry provider guidance into execution choices, and it does not adapt safely over time.

Verified repo and live-state problems:

1. **The current router is not truly model-level.** `loadEndpointManifests()` creates one manifest per `ModelProfile`, but assigns `id: mp.providerId`, collapsing all models under a provider onto one routing identity. This breaks overrides, fallback chains, and performance aggregation.
2. **Task classification is too weak.** Routing begins with regex heuristics over message text rather than an explicit request contract. This is insufficient for distinguishing structured extraction, tool use, long-context summarization, deep reasoning, realtime interaction, and multimodal work.
3. **The current requirement schema is too small.** It does not encode modality, determinism, output contract strictness, async/batch eligibility, privacy/residency constraints, exploration eligibility, or provider-specific execution knobs.
4. **Cost optimization is mathematically unsafe.** Null pricing is treated as zero cost, so unknown-cost models look free.
5. **The routing entity drops modality.** The schema stores supported modalities, but the manifest type does not carry them through routing. Text, image, audio, embedding, and video models can therefore share one candidate pool.
6. **The execution layer still treats routing as a hint.** The selected endpoint is passed forward largely as a preferred-provider bias rather than as a full provider + model + execution-plan decision.
7. **The feedback loop is fragmented.** Golden tests, orchestrator scoring, human feedback, and production observations exist, but they do not flow into one coherent champion/challenger evolution system.

### Live DB Snapshot

Verified against the live database on **2026-03-20**:

- Active LLM providers are primarily `openai` and `anthropic-sub`; most others are `inactive` or `unconfigured`.
- Active OpenAI model profiles currently have no stored pricing and no tool-capability flags.
- The active OpenAI model pool includes chat, reasoning, embeddings, image, audio, video, moderation, and speech models together.

That means the present system cannot make trustworthy cost-aware or tool-aware routing decisions even before algorithmic improvements.

### Why This Matters

Provider documentation consistently treats model selection as a constrained optimization problem:

- First determine which models are **actually feasible** for the request.
- Then prefer the model that is **good enough** for the task.
- Then minimize latency and cost using the provider's supported controls.

The platform currently skips the first and third steps and approximates the second.

---

## Goals

1. Route each request to the **lowest-cost feasible model** that clears a task-specific quality floor.
2. Encode model choice as a **request contract**, not as ad hoc regexes and global score weights.
3. Respect provider guidance and limitations **per provider and per enabled model family**.
4. Support gradual, bounded improvement over time through **evaluation-driven exploration**.
5. Keep adaptive behavior mostly invisible to end users while making it fully visible to operators and auditors.
6. Prevent routing thrash: the system should learn organically, but should not swing traffic massively without evidence.

## Non-Goals

1. This spec does not propose autonomous unrestricted prompt rewriting in production.
2. This spec does not propose concurrent multi-persona sessions or user-visible "pick a model" UX.
3. This spec does not require replacing provider SDKs or supported APIs.
4. This spec does not require fine-tuning as the primary optimization path.

---

## Terminology

- **Request Contract** - The normalized declaration of what a request needs from a model call.
- **Routing Target** - The routable unit selected by the router. Initially this is the derived join of `(providerId, modelId)` plus provider constraints and execution capabilities.
- **Execution Recipe** - A versioned invocation strategy for a routing target on a specific contract family. Includes provider-specific parameters, prompt fragments, and tool/response settings.
- **Champion Recipe** - The currently preferred recipe for a contract family.
- **Challenger Recipe** - A bounded experimental variant competing with the champion.
- **Outcome Record** - The measured result of one routed execution, including quality, cost, latency, tool correctness, schema validity, and fallback behavior.
- **Promotion Gate** - The evidence threshold required before a challenger can replace a champion.
- **Drift Event** - A detected capability, pricing, availability, or behavior change that triggers re-evaluation.

---

## Design Summary

Replace the current "pick a provider from weighted scores" approach with a **contract-based routing system** backed by **versioned execution recipes** and a **conservative champion/challenger loop**.

The selection flow becomes:

1. Infer a `RequestContract` from the incoming task and route context.
2. Build feasible routing targets by applying hard filters.
3. Expand feasible targets into one or more execution recipes.
4. Rank recipes by **expected cost per successful outcome**, subject to quality and policy gates.
5. Use the champion recipe for most traffic.
6. Send a small, controlled sample to 1-2 challenger recipes.
7. Grade outcomes using the platform's existing eval assets plus provider-recommended structured evaluation practices.
8. Promote challengers only after they outperform the champion within bounded safety, cost, and latency tolerances.

This gives the system an evolutionary improvement loop without letting it mutate wildly.

---

## Key Principles

- **Feasibility before ranking.** Unsupported models should never enter scoring.
- **Cheapest model above threshold wins.** Cost optimization happens only after hard constraints and minimum quality are satisfied.
- **Provider guidance is part of routing.** Execution knobs such as reasoning effort, tool-choice behavior, strict schema mode, batching, and prompt caching are first-class routing inputs.
- **Recipes evolve, prompts do not self-modify freely.** The adaptive unit is a versioned recipe with bounded deltas.
- **Exploration is conservative.** No more than a small share of traffic should be experimental, and high-risk contracts may disallow live exploration entirely.
- **Invisible to end users, observable to operators.** Users should simply experience improving results; operators should see the full audit trail.
- **Use the platform's existing assets.** Route logs, endpoint tests, orchestrator grading, human feedback, and production observations should feed one loop rather than five partial ones.

---

## Section 1: Canonical Routing Objects

### 1.1 Request Contract

The router should stop deciding directly from raw task text. Every request should be normalized into a `RequestContract`.

```typescript
interface RequestContract {
  contractId: string;
  contractFamily: string; // e.g. "sync.tool_action", "async.data_extraction"
  taskType: string; // existing task type, retained for compatibility

  modality: {
    input: Array<"text" | "image" | "audio" | "file" | "video">;
    output: Array<"text" | "json" | "image" | "audio" | "tool_call">;
  };

  interactionMode: "sync" | "background" | "batch" | "realtime";
  sensitivity: "public" | "internal" | "confidential" | "restricted";

  requiresTools: boolean;
  requiresStrictSchema: boolean;
  requiresStreaming: boolean;
  requiresDeterminism: boolean;

  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  minContextTokens?: number;

  reasoningDepth: "minimal" | "low" | "medium" | "high";
  latencyClass: "interactive" | "standard" | "deferred";
  budgetClass: "minimize_cost" | "balanced" | "quality_first";

  residencyPolicy?: "local_only" | "approved_cloud" | "any_enabled";
  allowedProviders?: string[];
  forbidLiveExploration?: boolean;

  outputSchemaKey?: string;
  toolSetKey?: string;
  routeContextKey?: string;
}
```

### 1.2 Routing Target

The routing target is the atomic selectable unit for routing. In the first implementation phase it should be **derived**, not stored as a separate table:

- `ModelProvider` contributes provider/account/product constraints
- `ModelProfile` contributes model-level capability and cost data
- runtime provider metadata contributes current availability and operational state

Derived identity:

```text
providerId + modelId
```

Operationally this is enough for the immediate design. If later the same model must be routed differently by region, service tier, or gateway path, promote this derived object to a persistent `RoutingTarget` table.

### 1.3 Execution Recipe

Adaptive improvement should happen at the recipe level, not by mutating raw prompts inline.

```typescript
interface ExecutionRecipe {
  recipeId: string;
  providerId: string;
  modelId: string;
  contractFamily: string;
  version: number;
  status: "candidate" | "champion" | "retired" | "blocked";

  providerSettings: Record<string, unknown>;
  systemPromptTemplate: string;
  instructionFragments: string[];
  toolPolicy: {
    toolChoice?: "auto" | "required" | "none" | "specific";
    allowParallelToolCalls?: boolean;
  };
  responsePolicy: {
    strictSchema?: boolean;
    schemaName?: string;
    stream?: boolean;
  };

  origin: "seed" | "manual" | "mutation" | "provider-guided";
  parentRecipeId?: string;
  mutationSummary?: string;
}
```

`ExecutionRecipe` is the unit that evolves over time. A recipe version can change:

- model tier or submodel
- provider-specific parameters
- tool policy
- schema policy
- bounded prompt fragments

It must not change:

- route-context safety block
- approval requirements
- tenant or sensitivity constraints
- tool definitions

### 1.4 Outcome Record

Each routed execution should produce one normalized outcome row.

```typescript
interface RouteOutcome {
  outcomeId: string;
  requestId: string;
  providerId: string;
  modelId: string;
  recipeId: string;
  contractFamily: string;

  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;

  schemaValid: boolean | null;
  toolSuccess: boolean | null;
  fallbackOccurred: boolean;
  providerErrorCode?: string;

  graderScore?: number;      // normalized 0-1
  humanScore?: number;       // normalized 0-1
  businessScore?: number;    // normalized 0-1 when available

  overallReward?: number;    // normalized 0-1
}
```

---

## Section 2: Data Model Changes

### 2.1 Evolve `TaskRequirement` into Contract Templates

Retain `TaskRequirement` as the admin-editable default template for a task type, but extend it to support the richer request-contract shape.

Add fields:

- `supportedInputModalities Json`
- `supportedOutputModalities Json`
- `interactionModeDefault String`
- `reasoningDepthDefault String`
- `latencyClassDefault String`
- `budgetClassDefault String`
- `requiresDeterminism Boolean`
- `forbidLiveExploration Boolean`
- `residencyPolicy String?`
- `outputSchemaKey String?`
- `toolSetKey String?`
- `rewardWeights Json`

### 2.2 New Table: `ExecutionRecipe`

Add a versioned table for provider/model/contract-specific invocation strategies.

Suggested fields:

```prisma
model ExecutionRecipe {
  id                    String   @id @default(cuid())
  recipeId              String   @unique
  providerId            String
  modelId               String
  contractFamily        String
  version               Int
  status                String   @default("candidate")
  origin                String   @default("seed")
  parentRecipeId        String?
  mutationSummary       String?
  providerSettings      Json
  systemPromptTemplate  String
  instructionFragments  Json
  toolPolicy            Json
  responsePolicy        Json
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  promotedAt            DateTime?
  retiredAt             DateTime?

  @@unique([providerId, modelId, contractFamily, version])
  @@index([contractFamily, status])
}
```

### 2.3 New Table: `RecipePerformance`

Do not overload `EndpointTaskPerformance` for the adaptive loop. It should remain useful for high-level endpoint diagnostics, but the evolution loop needs recipe-specific stats.

```prisma
model RecipePerformance {
  id                 String   @id @default(cuid())
  recipeId           String
  contractFamily     String
  sampleCount        Int      @default(0)
  successCount       Int      @default(0)
  avgReward          Float    @default(0)
  avgLatencyMs       Float    @default(0)
  avgCostUsd         Float    @default(0)
  avgSchemaValidRate Float?
  avgToolSuccessRate Float?
  avgHumanScore      Float?
  avgGraderScore     Float?
  ewmaReward         Float    @default(0)
  lastObservedAt     DateTime?

  @@unique([recipeId, contractFamily])
}
```

### 2.4 Expand `RouteDecisionLog`

Add:

- `selectedModelId`
- `selectedRecipeId`
- `contractFamily`
- `estimatedCostUsd`
- `estimatedLatencyMs`
- `explorationMode` (`none | challenger`)
- `challengerRecipeIds Json`

This turns the existing route log into the backbone of explainability for both routing and adaptation.

### 2.5 Future Refactoring

If the same `(providerId, modelId)` combination needs materially different routing behavior by region, compliance mode, or service tier, introduce a canonical `RoutingTarget` table. Do not do that in phase 1 unless real requirements force it.

---

## Section 3: Routing Pipeline

### 3.1 Stage 0 - Contract Inference

Replace regex-only task classification with a two-part contract inference step:

1. **Deterministic extraction** from route context, tool set, explicit output schema, and request metadata
2. **LLM-assisted contract classification** only when the deterministic layer cannot decide confidently

The classifier should output a structured `RequestContract`, not a freeform label.

### 3.2 Stage 1 - Feasibility Filter

Eliminate candidates that fail any hard rule:

- provider not enabled
- model retired or degraded beyond allowed threshold
- sensitivity clearance mismatch
- modality mismatch
- tool support mismatch
- strict schema support mismatch
- context window too small
- latency class impossible
- residency/policy mismatch
- provider guidance conflict

Unknown capability metadata must not be treated as supported. Unknowns are disqualifying for hard requirements.

### 3.3 Stage 2 - Recipe Expansion

For each feasible target, load candidate recipes for the contract family:

- champion recipe
- active challengers eligible for live exploration
- provider-guided fallback recipe if no specialized recipe exists

The router should never synthesize a new prompt or recipe inline for a live request.

### 3.4 Stage 3 - Rank by Expected Cost Per Success

For each recipe:

```text
expected_cost_per_success = expected_cost / max(expected_success_probability, floor)
```

Where:

- `expected_cost` uses estimated tokens, provider pricing, and known execution overhead
- `expected_success_probability` comes from `RecipePerformance`, bootstrapped by model-profile fit and offline evals

Selection rule:

1. Discard recipes below the quality floor for the contract family
2. Among the rest, select the recipe with the lowest expected cost per success
3. Break ties by lower latency, then lower recent failure rate

This is the central behavioral rule of the system.

### 3.5 Stage 4 - Exploration Decision

Most traffic goes to the champion recipe.

Exploration policy:

- default exploration: 2%
- low-risk, high-volume contracts: up to 5%
- confidential/restricted or side-effecting contracts: 0% live exploration unless explicitly approved
- max challengers per request: 2

For live exploration:

- send the user's request to the champion and one challenger
- optionally a second challenger for high-volume low-risk contracts
- score outcomes asynchronously when user-visible latency would otherwise suffer

Exploration must be bounded by global budget caps.

### 3.6 Stage 5 - Execution

The final router output is:

```typescript
interface RoutedExecutionPlan {
  providerId: string;
  modelId: string;
  recipeId: string;
  contract: RequestContract;
  providerSettings: Record<string, unknown>;
  systemPrompt: string;
  tools?: unknown[];
  responsePolicy: Record<string, unknown>;
}
```

The execution layer should stop treating routing as a provider preference hint and should execute this plan directly.

---

## Section 4: Provider-Guided Execution Rules

Provider guidance must be encoded into recipe generation and validation.

### 4.1 OpenAI

Use current OpenAI guidance to drive recipe fields:

- reasoning depth -> map to reasoning effort for reasoning-capable models
- strict schema work -> use structured outputs / strict tool arguments
- tool-calling work -> configure tool-choice deliberately; disable parallel tool calls when strict single-call correctness matters
- repeatable prompts -> use prompt caching where supported
- deferred workloads -> use Batch when the contract is background or batch eligible
- high-risk agents -> prefer stronger instruction-following models and structured data flow

OpenAI docs also make clear that evals, graders, and trace grading should be part of the optimization loop, not a separate afterthought.

### 4.2 Anthropic

Use the Models API and capability documentation to populate hard constraints and recipe choices:

- context and output caps come from model metadata, not model-name guesswork
- structured output recipes should use explicit schema-conformance patterns rather than prompt-only JSON coercion
- tool-use recipes should be distinct from plain conversational recipes

### 4.3 Gemini

Gemini recipes must encode:

- stable vs preview model preference
- thinking level or budget for reasoning-heavy work
- structured output schema mode for extraction tasks
- function-calling mode for tool-heavy tasks

Preview models should never silently become the default champion for a stable contract family without passing promotion gates.

### 4.4 Mistral, Cohere, Groq, OpenRouter, Together, Others

When enabled, each provider needs an adapter that declares:

- supported modalities
- tool-calling semantics
- schema/JSON guarantees
- latency and throughput class
- pricing fields
- routing-specific knobs

OpenRouter deserves special handling:

- it is a router, not just a provider
- its own provider-selection features can be used inside an `ExecutionRecipe`
- platform policy still decides whether OpenRouter is allowed for the contract

No provider should be treated as "OpenAI-compatible enough" for routing logic beyond transport formatting. Capability and control-plane semantics must be declared explicitly.

---

## Section 5: Adaptive Improvement Loop

### 5.1 Inputs to the Loop

The improvement loop should consume:

1. **Golden tests** from the existing endpoint test harness
2. **Trace-grade or orchestrator-grade scores**
3. **Human feedback** already captured in the system
4. **Runtime objective signals**
   - schema validity
   - tool success
   - fallback frequency
   - latency
   - token usage
   - cost
   - provider error class
5. **Route decision logs**
6. **Drift signals**
   - model disappearance
   - price changes
   - failure-rate spikes
   - quality regressions

### 5.2 Reward Function

Each contract family should define reward weights:

```typescript
{
  quality: 0.45,
  schema_or_tool_correctness: 0.25,
  latency: 0.10,
  cost: 0.10,
  human_feedback: 0.10
}
```

This varies by contract family. Example:

- extraction: schema correctness dominates
- tool action: tool correctness dominates
- creative writing: quality and human preference dominate
- background summarization: cost matters more

Any hard failure on safety, policy, or required structure produces reward `0`.

### 5.3 Champion / Challenger Policy

The adaptive loop should use a conservative champion/challenger system:

- one champion recipe per contract family
- up to three active challengers
- challengers receive a bounded traffic sample
- challengers are compared to the champion on matched workloads where possible

Promotion gate:

- minimum sample size per challenger
- no regression on hard metrics
- statistically meaningful improvement on reward
- no material cost blowout unless contract is `quality_first`

This is intentionally slower than a pure contextual bandit. Stability matters more than short-term adaptation speed.

### 5.4 Recipe Mutation

Recipe mutation must be **bounded**.

Allowed mutation types:

- swap to a nearby model tier within the same provider family
- change reasoning budget
- tighten or relax tool-choice settings
- add or remove a small prompt fragment
- add one short example
- turn strict schema mode on or off where supported

Forbidden mutation types:

- rewriting the core system prompt wholesale
- changing route-context safety blocks
- introducing new tools
- changing user-visible semantics without approval

Mutation source:

- failure clustering over recent traces
- provider guidance updates
- prompt optimizer suggestions derived from grader- or human-annotated traces
- human operator proposals

Every mutation creates a new candidate recipe version.

### 5.5 Offline First, Then Canary

Before a candidate recipe is allowed live traffic:

1. Run it against the contract family's golden set
2. Run grader-based evals on historical traces
3. Compare against the current champion
4. Only then allow small live canary traffic

This prevents the system from "learning" directly on users as the first validation step.

---

## Section 6: Changes Over Time

### 6.1 Provider and Model Drift

The system must treat the provider landscape as dynamic:

- refresh discovered model metadata on a schedule
- detect additions, removals, and major metadata changes
- detect pricing changes
- detect provider failures and degradation
- detect model revision changes where exposed

When drift is detected:

- freeze automatic promotion for affected contract families if confidence drops sharply
- enqueue re-evaluation for impacted recipes
- keep the previous champion until a replacement passes gates

### 6.2 Prompt and Recipe Drift

A recipe may degrade even if the model does not.

Detect prompt drift through:

- falling grader scores
- increasing fallback rates
- rising tool/schema failure
- growing divergence between human and grader scores

If drift is detected:

- demote the recipe to candidate
- restore the previous stable champion
- open a mutation cycle using the failure cluster

### 6.3 Anti-Thrash Guardrails

To keep changes organic rather than chaotic:

- maximum one champion promotion per contract family per 24 hours
- minimum live sample size before promotion
- cooldown after failed promotion
- emergency freeze switch for all adaptive promotions
- separate exploration budgets by sensitivity and route context

---

## Section 7: Leveraging Existing Platform Assets

This spec should reuse and unify existing assets already present in the repo.

### 7.1 Reuse Existing Components

- `RouteDecisionLog` becomes the adaptive decision audit trail
- `EndpointTaskPerformance` remains a coarse endpoint-level diagnostic view
- `EndpointTestRun` and the golden-test system remain the offline evaluation backbone
- `orchestrator-evaluator` remains a grader source, but must become recipe-aware
- `production-feedback` remains useful, but should update `RecipePerformance` first and endpoint-level summaries second
- route-context sensitivity remains the policy source for data-classification gating

### 7.2 Tighten the Loop

The loop should look like this:

1. Route a request through a champion or challenger recipe
2. Log the decision
3. Capture runtime signals immediately
4. Grade the trace asynchronously
5. Merge any human feedback later
6. Update `RecipePerformance`
7. Recompute champion/challenger standings nightly or after meaningful new evidence

This is tight enough to learn continuously, but slow enough to stay stable.

---

## Section 8: Operator Experience

End users should not see model-selection mechanics.

Operators should have:

- per-contract-family champion/challenger view
- recent promotions and demotions
- top failure clusters by contract family
- cost vs quality trend
- drift alerts
- freeze/unfreeze controls
- manual promotion / rollback controls

This can extend the existing platform AI routing and provider screens rather than creating a brand-new ops surface.

---

## Section 9: Rollout Plan

### Phase 1 - Make Routing Correct

1. Fix provider/model identity so routing is truly model-aware
2. Carry modality into the manifest and feasibility filter
3. Expand request contracts beyond regex task types
4. Execute concrete provider + model decisions, not provider hints

### Phase 2 - Introduce Recipes

1. Add `ExecutionRecipe`
2. Seed one recipe per feasible provider/model/contract family
3. Add provider adapters for recipe validation
4. Start logging outcomes by recipe

### Phase 3 - Unify the Feedback Loop

1. Add `RecipePerformance`
2. Route offline evals and grader outputs into recipe performance
3. Add reward computation and standings
4. Keep champion-only traffic initially

### Phase 4 - Enable Bounded Exploration

1. Turn on challengers for low-risk contracts
2. Add promotion gates and rollback logic
3. Add drift-triggered re-evaluation

### Phase 5 - Expand Provider Coverage

1. Harden OpenAI and Anthropic first
2. Add Gemini next
3. Then routers and secondary providers as enabled

This matches current live-state reality and avoids over-designing for providers that are not active yet.

---

## Section 10: Testing and Verification

### Required Verification

- unit tests for request-contract inference
- unit tests for feasibility filtering, including modality and policy rules
- unit tests for expected-cost-per-success ranking
- unit tests for promotion gates and anti-thrash guardrails
- integration tests for recipe execution plans on active providers
- regression tests for route decision logging

### Evaluation Requirements

- every contract family has a golden test set
- every promoted recipe has passed offline comparison against the current champion
- every provider adapter has an explicit capability declaration test

---

## Risks and Mitigations

### Risk: Reward Hacking

A challenger may optimize for the grader rather than actual usefulness.

Mitigation:

- combine grader and human feedback
- keep holdout cases
- monitor divergence between grader and human scores
- require non-regression on objective signals such as schema validity and tool success

### Risk: Invisible Regressions

Users may not know the system is adapting.

Mitigation:

- exploration caps
- offline-first validation
- automatic rollback
- operator-visible promotion history

### Risk: Provider Metadata Is Incomplete

Some providers will not expose all capability data.

Mitigation:

- treat unknowns conservatively
- do not allow unknown values to satisfy hard requirements
- use provider adapters with explicit confidence levels

---

## Appendix A: Source-Informed Provider Guidance

This design is grounded in current provider documentation, including:

- OpenAI model, structured-output, function-calling, reasoning, latency, batch, prompt-caching, eval, grader, and trace-grading guidance
- Anthropic model-overview and consistency guidance
- Gemini model-selection, structured-output, function-calling, and thinking guidance
- Cohere and Mistral tool-use guidance
- Groq latency-optimization guidance
- OpenRouter provider-selection guidance

These sources should be treated as the default reference when implementing provider adapters and recipe validators.

### Source Links

- https://developers.openai.com/api/docs/models/all
- https://developers.openai.com/api/docs/guides/function-calling
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/reasoning
- https://developers.openai.com/api/docs/guides/latency-optimization
- https://developers.openai.com/api/docs/guides/batch
- https://developers.openai.com/api/docs/guides/prompt-caching
- https://platform.openai.com/docs/guides/graders/
- https://platform.openai.com/docs/guides/trace-grading
- https://platform.openai.com/docs/guides/evaluation-getting-started
- https://platform.openai.com/docs/guides/prompt-optimizer/
- https://platform.openai.com/docs/guides/agent-builder-safety
- https://platform.claude.com/docs/en/about-claude/models/overview
- https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/increase-consistency
- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/function-calling
- https://ai.google.dev/gemini-api/docs/structured-output
- https://ai.google.dev/gemini-api/docs/thinking
- https://docs.cohere.com/v2/docs/tool-use-usage-patterns
- https://docs.mistral.ai/capabilities/function_calling/
- https://console.groq.com/docs/production-readiness/optimizing-latency
- https://openrouter.ai/docs/guides/routing/provider-selection
