# EP-INF-001: AI Endpoint Routing and Model Profiling

**Date:** 2026-03-18
**Status:** Superseded by EP-INF-003 through EP-INF-007 (routing redesign, 2026-03-20)
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Epic:** EP-INF-001

**Prerequisites:**
- EP-LLM-LIVE-001 (live LLM conversations) — complete
- AI Provider Registry (2026-03-12) — complete
- Unified MCP Coworker Architecture (2026-03-16) — design complete
- Agent Test Harness (2026-03-17) — design complete

---

## Problem Statement

The platform's AI endpoint routing grew organically and is fragile. The current system has 6+ overlapping routing mechanisms that don't compose predictably, two incompatible capability tier vocabularies, incorrect model profile assignments, and no systematic way to handle the dynamic nature of the AI provider landscape — models appear and disappear, rate limits shift, costs change, and providers silently update model weights.

Specific problems:

1. **Two incompatible tier vocabularies** — the legacy system uses 6 values (`deep-thinker`, `fast-worker`, `specialist`, `budget`, `embedding`, `unknown`), the newer router uses 4 different values (`basic`, `routine`, `analytical`, `deep-thinker`). The DB column is an unvalidated string. Values from one vocabulary silently produce incorrect routing when read by the other system.
2. **Wrong profile assignments** — Haiku is tagged `deep-thinker`, Opus as `fast-worker` in some profiles. The `profileLocalModel` function produces `capabilityTier` values (`fast-cheap`, `strong`, `moderate`) and `instructionFollowing` values (`strong`, `moderate`) that exist in neither vocabulary, defaulting them to incorrect rankings.
3. **Overlapping routing mechanisms** — `buildBootstrapPriority`, `getProviderPriority`, `filterByModelRequirements`, sensitivity filtering, agent `preferredProviderId` shuffle, and `routeWithPerformance` all participate in routing with no clear composition order.
4. **New router doesn't actually route** — the unified path's `routeWithPerformance` result is used only to set a "preferred provider hint" that gets shuffled to the front of the legacy priority list. The legacy `callWithFailover` still drives the actual call.
5. **Task tag mismatch** — `routeWithPerformance` requires `requiredTags: [taskType]`, but only 3 of 9 task type IDs match the tags seeded on providers. The new router silently returns `null` for 6 task types.
6. **No confidential enforcement** — routes tagged `confidential` (`/workspace`, `/employee`, `/customer`, `/platform`) can send data to any cloud provider. Only `restricted` is actually filtered.
7. **OAuth restrictions discovered by trial-and-error** — the Anthropic subscription token can only access Haiku, but this is discovered by getting a 403, not declared upfront.
8. **Coarse capability model** — a single `capabilityTier` string cannot express that a model is excellent at code but poor at structured output, or fast but unreliable at tool-calling.
9. **No systematic change management** — when a provider changes pricing, deprecates a model, or silently updates weights, the system has no way to detect or adapt. Rate-limiting immediately disables the provider for all concurrent requests rather than degrading gracefully.
10. **Black-box routing** — there is no audit trail for why a particular endpoint was selected for a task. Debugging routing decisions requires reading source code.

### Industry Context

Research into production AI routing platforms (Martian, Unify, OpenRouter, NotDiamond) and benchmark frameworks (LMSYS Chatbot Arena, HELM, Berkeley Function-Calling Leaderboard) reveals:

- **No universal model capability schema exists.** OpenRouter's is closest but uses binary flags, not scored dimensions.
- **Provider routing and model routing are separate concerns.** The same model at different providers varies by 3x in cost and significantly in latency (Unify's key insight).
- **Continuous quality evaluation is largely unsolved.** Most platforms use static benchmark snapshots. StageRoute's Upper Confidence Bound approach is the most principled research approach but not yet production-standard.
- **Task requirement contracts are implicit** across all commercial platforms. No platform exposes a structured schema for expressing what a task needs from a model.
- **Multi-dimensional profiling outperforms single-tier ranking.** HELM's 7-metric approach (accuracy, calibration, robustness, fairness, bias, toxicity, efficiency) is the most principled academic framework.

The platform can leapfrog current commercial approaches by combining explicit task requirement contracts with multi-dimensional profiles and full routing explainability — capabilities that regulated industries require but no existing platform provides.

---

## Terminology

- **Endpoint** — the atomic routing unit. A specific product offering from a provider: provider + model + auth method + constraints. Anthropic-via-API-key and Anthropic-via-OAuth are two different endpoints because they have different model access, costs, and constraints — even if the underlying models are the same. Maps to the existing `ModelProvider` row.
- **Endpoint Manifest** — the self-describing declaration of what an endpoint is, can do, and is allowed to see. Stored on the `ModelProvider` row.
- **Capability Profile** — scored dimensions (0–100) describing an endpoint's quality across specific capabilities (reasoning, code generation, tool-calling fidelity, etc.).
- **Task Requirement** — a contract declaring what a task type needs from an endpoint: hard requirements (must have), preferred scores (should have), and operational constraints (cost/latency ceilings).
- **Policy Rule** — an organisation-level routing constraint driven by compliance or internal policy, not capability. Applied before capability-based routing.
- **Route Decision** — the full auditable trace of a routing decision: what was selected, why, what was considered, what was excluded and why.
- **Golden Test Set** — a small set of deterministic eval prompts per endpoint with expected outputs, used for drift detection.
- **Profile Confidence** — how trustworthy a capability profile is: `low` (seed data only), `medium` (< 5 evaluations), `high` (>= 5 evaluations).

---

## Design Summary

Replace all overlapping routing mechanisms with a **schema-first, single-pipeline architecture**. The endpoint manifest declares what each endpoint *is*. The task requirement declares what each task *needs*. The routing function matches supply to demand through a composable filter→score→rank→select pipeline that produces a fully explainable decision trace.

Capability profiles replace the coarse `capabilityTier` string with scored dimensions (0–100) across seven capabilities. Profiles are populated initially via seed data, refined by automated evaluations, and kept current by production observation — a continuous lifecycle that handles providers appearing, disappearing, degrading, and updating.

Users can extend the routing system without developer expertise: defining custom task types, adding policy routing rules, and creating domain-specific evaluation criteria — all through the platform UI with governed approval workflows and full audit trails.

### Key Principles

- **Explainability is a first-class requirement** — every routing decision produces a human-readable trace answerable by a compliance officer, not just an engineer
- **Schema-first, routing follows** — get the data model right and routing becomes a simple function over well-structured data
- **Hard constraints separate from soft scores** — "must support tool-calling" is a gate, "prefers high reasoning" is a preference. They never conflate.
- **Provider = product offering, not company** — different auth methods, pricing tiers, or access products from the same company are distinct endpoints
- **Absorb change gracefully** — the system treats the provider landscape as inherently dynamic. Providers appear, disappear, degrade, and update. The system adapts systematically, not manually.
- **User-extensible with governance** — domain experts can extend routing without writing code, within a governed process appropriate for regulated industries

---

## Section 1: Endpoint Manifest — The Atomic Unit

Each `ModelProvider` row becomes a fully self-describing endpoint manifest. No external lookups are needed to know what this endpoint can and can't do.

### Schema (extends existing `ModelProvider`)

**Identity & Access** (existing fields, no changes):
- `id`, `name`, `slug`
- `baseUrl`, `authMethod`, `authHeader`
- `modelId` — the specific model this endpoint serves
- `endpointType`: `"llm" | "embedding" | "image" | "speech"`

**Hard Constraints** (binary — used for filtering, never scoring):
- `sensitivityClearance`: `SensitivityLevel[]` — what data classification levels this endpoint may see (existing field, enforce correctly)
- `supportedModalities`: `Json` — `{ input: string[], output: string[] }` — text, image, audio, file
- `supportsToolUse`: `Boolean` — can it handle function-calling?
- `supportsStructuredOutput`: `Boolean` — does it reliably produce schema-constrained JSON?
- `supportsStreaming`: `Boolean`
- `maxContextTokens`: `Int` — hard context window limit
- `maxOutputTokens`: `Int` — hard output limit
- `modelRestrictions`: `String[]` — declarative documentation of which models this endpoint's auth method can access. Enforced at registration/seed time: if the endpoint's `modelId` is not in `modelRestrictions` (when the field is non-empty), registration is rejected. This prevents creating an endpoint row for a model the auth method can't reach (e.g., an Anthropic OAuth endpoint claiming to serve Opus when the subscription only covers Haiku). An empty array means no restrictions.

**Capability Profile** (scored 0–100 — used for ranking):
- `reasoning`: `Int` — depth of analytical/logical reasoning
- `codegen`: `Int` — code generation and editing quality
- `toolFidelity`: `Int` — function-calling accuracy (correct schema, correct arguments, correct abstention)
- `instructionFollowing`: `Int` — adherence to system prompt and formatting constraints
- `structuredOutput`: `Int` — reliability of JSON/schema output when requested
- `conversational`: `Int` — natural multi-turn dialog quality
- `contextRetention`: `Int` — quality at long context lengths relative to short
- `customScores`: `Json` — user-defined capability dimensions beyond the built-in seven

**Operational Metrics** (live — updated by the eval loop and production observation):
- `status`: add `"degraded"` to existing values — for rate-limited endpoints that remain routable at lower priority
- `avgLatencyMs`: `Float` — rolling average response time
- `recentFailureRate`: `Float` — failures / attempts over last N calls (0.0–1.0)
- `lastEvalAt`: `DateTime` — when the profile was last validated by automated evaluation
- `lastCallAt`: `DateTime` — when this endpoint was last used for real work
- `costPerInputMToken`: `Float` — current input token cost (USD)
- `costPerOutputMToken`: `Float` — current output token cost (USD)

**Provenance:**
- `profileSource`: `String` — `"seed" | "evaluated" | "production"` — how the current profile was established
- `profileConfidence`: `String` — `"low" | "medium" | "high"` — how trustworthy the profile is
- `evalCount`: `Int` — total evaluations run against this endpoint

**Lifecycle:**
- `catalogVisibility` (existing) — whether it shows in the marketplace
- `retiredAt`: `DateTime?` — soft deprecation, excluded from routing but preserved for audit
- `retiredReason`: `String?` — why the endpoint was retired

### Key Design Decisions

1. **One vocabulary for capability tiers is eliminated entirely.** Instead of `"deep-thinker"` vs `"analytical"` vs `"fast-worker"`, we have scored dimensions. A model with `reasoning: 92, codegen: 45` tells you exactly what it's good at. The `capabilityTier` string column is removed after migration.

2. **Hard constraints are separate from soft scores.** `supportsToolUse: false` means the endpoint is *never* eligible for tool-using tasks — no amount of high scores elsewhere overrides this. This prevents the current bug where a model without tool support could be selected for an agentic task.

3. **`modelRestrictions` makes OAuth limitations declarative.** Instead of discovering that the Claude subscription token can only access Haiku by getting a 403, the manifest says so upfront.

4. **`degraded` status replaces the binary active/inactive toggle.** A rate-limited provider stays in the pool at lower priority rather than being disabled entirely (which currently affects all concurrent requests).

5. **`customScores` enables user-defined dimensions.** A healthcare platform can add `clinicalAccuracy: 85` without schema changes. Custom dimensions participate in routing the same way built-in dimensions do.

### What This Replaces

- `capabilityTier` string on `ModelProvider` — replaced by 7 scored dimensions
- `capabilityTier` string on `ModelProfile` — replaced by endpoint-level profile (one source of truth)
- `TIER_RANK` constant (6 values) — eliminated
- `TIER_ORDER` constant (4 values, defined in 3 places) — eliminated
- `instructionFollowing` and `codingCapability` on `ModelProfile` (3-value strings: `"excellent" | "adequate" | "insufficient"`) — replaced by 0–100 scores
- `ModelProfile` as a separate table — capability data consolidated onto `ModelProvider`

---

## Section 2: Task Requirement Contracts

Each task type declares what it needs from an endpoint. This is the "demand side" — the manifest is the "supply side." Routing is matching supply to demand.

### Contract Schema

```typescript
interface TaskRequirement {
  // Identity
  taskType: string;           // e.g., "tool-action", "reasoning", "greeting"
  description: string;        // human-readable: "Multi-step tool use with external APIs"
  selectionRationale: string; // e.g., "Requires tool-calling fidelity; prefers analytical depth"

  // Hard requirements (endpoint must satisfy ALL or it's excluded)
  requiredCapabilities: {
    supportsToolUse?: boolean;
    supportsStructuredOutput?: boolean;
    supportsStreaming?: boolean;
    minContextTokens?: number;
  };

  // Soft requirements (scored — higher is better, but not disqualifying)
  // Record<string, number> — built-in dimension names (reasoning, codegen, toolFidelity,
  // instructionFollowing, structuredOutput, conversational, contextRetention) plus any
  // custom dimension names defined in CustomEvalDimension. The scoring function iterates
  // all keys, matching each to either a built-in score field or a customScores entry.
  preferredMinScores: Record<string, number>;

  // Operational constraints
  maxLatencyMs?: number;       // latency ceiling (hard filter)
  preferCheap?: boolean;       // when multiple endpoints qualify, prefer lowest cost

  // Default instructions for this task type (used as the canonical reset value when
  // endpoint-specific instruction refinement regresses, and as the starting instructions
  // for newly-profiled endpoints)
  defaultInstructions?: string;

  // Evaluation token limit — how many tokens of the AI response to send to the
  // orchestrator-evaluator for quality scoring (default: 500)
  evaluationTokenLimit?: number;

  // Provenance
  origin: "system" | "user";
  createdBy?: string;          // userId for user-created
  approvedBy?: string;         // userId of approver
  approvedAt?: DateTime;
}
```

### Built-In Task Requirements

| Task Type | Hard Requirements | Key Preferred Scores | Cost Preference | Rationale |
|---|---|---|---|---|
| `greeting` | — | `conversational: 40` | prefer cheap | Simple dialog, any capable model works |
| `status-query` | — | `instructionFollowing: 40` | prefer cheap | Data lookup, needs accuracy not depth |
| `summarization` | — | `instructionFollowing: 50` | prefer cheap | Needs to follow formatting instructions |
| `reasoning` | — | `reasoning: 80` | quality first | Complex analysis needs strong reasoning |
| `data-extraction` | `supportsStructuredOutput` | `structuredOutput: 70` | prefer cheap | Must produce valid structured output |
| `code-gen` | `supportsToolUse` | `codegen: 75, instructionFollowing: 60` | quality first | Code quality is critical |
| `web-search` | `supportsToolUse` | `toolFidelity: 60` | prefer cheap | Must call search tools correctly |
| `creative` | — | `conversational: 60, reasoning: 50` | quality first | Needs both creativity and coherence. Note: current `minCapabilityTier: "routine"` was a hard gate; this migration softens it to a preference — a conscious behavioral change since the preferred scores provide finer control |
| `tool-action` | `supportsToolUse` | `toolFidelity: 70` | quality first | Must call tools accurately and abstain correctly |

### Key Design Decisions

1. **Hard vs soft is explicit.** `supportsToolUse: true` is a hard gate — the endpoint is excluded if it can't do it. `reasoning: 80` is a soft preference — an endpoint scoring 65 can still be selected if nothing better is available. This prevents the current silent degradation where `filterByModelRequirements` returns the unfiltered list when nothing matches.

2. **`selectionRationale` is a human-readable string on the contract itself.** When someone asks "why did it pick this model for my code review?", the answer starts with the contract's rationale.

3. **Cost ceilings are per-task, not global.** A greeting doesn't need the same budget as a complex reasoning chain.

4. **Contracts are data, not code.** They live in a database table (seeded with built-in types, extensible with user-created rows). Adding a new task type means adding a row, not editing routing logic.

5. **User-created task types follow governed process.** `origin: "user"` contracts require `approvedBy` and `approvedAt` before they enter the routing system. This accommodates regulated industry requirements.

### What This Replaces

- `TASK_TYPES` array in `task-types.ts` — replaced by `TaskRequirement` table (seeded with the same 9 types)
- `minCapabilityTier` on task types — replaced by `preferredMinScores` (multi-dimensional)
- `heuristicPatterns` on task types — moved to the task classifier (separate concern)
- `evaluationTokenLimit` on task types — retained on `TaskRequirement` (used by orchestrator-evaluator to truncate responses for grading)
- `defaultInstructions` on task types — retained on `TaskRequirement` as the canonical default; endpoint-specific refinements live on `EndpointTaskPerformance.currentInstructions`

---

## Section 3: The Routing Function — Single Composable Pipeline

One function, five stages, fully explainable. Every stage produces a human-readable trace.

### Pipeline

```
routeEndpoint(endpoints, taskRequirement, sensitivity, policyRules, context) → RouteDecision
```

**Stage 0 — Policy Filter:** Apply organisation-level policy rules before capability-based routing. Each rule can exclude endpoints by ID, by provider, by sensitivity level, or by profile confidence. Policy rules are additive constraints — they can only restrict, never override capability requirements.

Each excluded endpoint gets a policy rejection reason: `"excluded by policy: Financial data stays on-premise"`.

**Stage 1 — Hard Filter:** Remove endpoints that can't possibly serve this task.
- Status not `active` or `degraded`
- Sensitivity level not in `sensitivityClearance`
- Missing any `requiredCapabilities` (e.g., no tool support for a tool-action task)
- Context window too small (`maxContextTokens < minContextTokens`)
- `modelRestrictions` is non-empty and `modelId` is not in the list (registration-time guard; defensive runtime check)
- `retiredAt` is set

Each excluded endpoint gets a rejection reason: `"excluded: no tool support"`, `"excluded: sensitivity clearance insufficient for confidential data"`, etc.

**Stage 2 — Score:** For each surviving endpoint, compute a composite fitness score.

```
fitness = Σ (endpointScore_d × normalizedWeight_d) × statusMultiplier
```

**Weight calculation:** Each dimension mentioned in `preferredMinScores` gets a weight equal to its preferred minimum divided by the sum of all preferred minimums. Dimensions not mentioned get zero weight.

**Worked example — `code-gen` task** (`preferredMinScores: { codegen: 75, instructionFollowing: 60 }`):

| | Endpoint A (Sonnet) | Endpoint B (Llama 3.1) | Endpoint C (Haiku) |
|---|---|---|---|
| `codegen` score | 91 | 65 | 42 |
| `instructionFollowing` score | 88 | 70 | 55 |
| Weight: `codegen` | 75/(75+60) = 0.556 | 0.556 | 0.556 |
| Weight: `instructionFollowing` | 60/(75+60) = 0.444 | 0.444 | 0.444 |
| Fitness (quality) | 91×0.556 + 88×0.444 = **89.7** | 65×0.556 + 70×0.444 = **67.2** | 42×0.556 + 55×0.444 = **47.7** |
| Cost (output $/MToken) | $15.00 | $0.80 | $1.25 |

If `preferCheap: false` (quality-first): rank by fitness. Result: **A → B → C**. Cost is tiebreaker only.

If `preferCheap: true`: cost efficiency is added as a weighted dimension. Normalize cost across pool: `costFactor = 1 - (endpointCost / maxCostInPool)`. With max = $15.00: A gets `1 - 15/15 = 0.0`, B gets `1 - 0.8/15 = 0.947`, C gets `1 - 1.25/15 = 0.917`. Final score = `0.6 × qualityFitness + 0.4 × costFactor × 100`. Result: A = 53.8, B = 78.1, C = 65.3 → **B → C → A**.

**Status multiplier:** `active` = 1.0, `degraded` = 0.7. Applied as a post-score multiplier. A degraded endpoint with fitness 89.7 becomes 62.8, sinking it below non-degraded alternatives but keeping it available.

**Cost basis:** Cost is computed per output megatoken (`costPerOutputMToken`) since output tokens dominate cost in most tasks. Input cost is used as a secondary tiebreaker when output costs are equal.

**Stage 3 — Rank:** Sort by fitness score descending. Tiebreaker chain: lower cost → lower recent failure rate → lower latency.

**Stage 4 — Select & Explain:** Pick the top-ranked endpoint. Produce a `RouteDecision`:

```typescript
interface RouteDecision {
  // Selection
  selectedEndpoint: string;     // endpoint ID
  reason: string;               // human-readable explanation (see below)
  fallbackChain: string[];      // next 2-3 endpoints if the selected one fails

  // Full trace
  candidates: CandidateTrace[];
  excludedCount: number;
  excludedReasons: string[];    // deduplicated rejection reasons
  policyRulesApplied: string[]; // names of policy rules that excluded endpoints

  // Context
  taskType: string;
  sensitivity: string;
  timestamp: DateTime;
}

interface CandidateTrace {
  endpointId: string;
  endpointName: string;
  fitnessScore: number;
  dimensionScores: Record<string, number>;
  costPerCall: number;
  excluded: boolean;
  excludedReason?: string;
}
```

### Human-Readable Explanation

The `reason` field is assembled from human-authored strings, not internal IDs:

> "Selected anthropic-api (claude-sonnet-4-5) for code-gen task: best fitness 84.2. Reasoning: 88, CodeGen: 91, ToolFidelity: 85. Task requires tool support and prefers strong code generation. 2 endpoints excluded (no tool support), 1 excluded by policy (Financial data stays on-premise), 3 candidates scored."

A compliance officer reading this can immediately understand: what was picked, why, what else was considered, what was excluded and why.

### Failover

The `fallbackChain` (2nd, 3rd ranked endpoints) replaces the current cascade loop. If the selected endpoint fails:

| Failure | Action |
|---|---|
| `rate_limit` | Mark endpoint `degraded` (not `disabled`), try next in chain |
| `model_not_found` | Mark endpoint `disabled`, log for human review, try next |
| `timeout` | Try next, increment failure counter on the endpoint |
| `auth_error` | Mark endpoint `disabled`, log for human review, try next |
| All chain exhausted | `NoEndpointAvailableError` with the full `RouteDecision` trace attached |

No silent fallbacks. Every failover step appends to the `RouteDecision` trace.

### Route Decision Persistence

The `RouteDecision` is the regulated audit trail. It must be persisted, not ephemeral.

**Storage:** A new `RouteDecision` table stores the full trace as structured JSON:

| Field | Type | Description |
|---|---|---|
| `id` | `String @id` | Unique decision ID |
| `agentMessageId` | `String` | FK to `AgentMessage` — which conversation turn triggered this decision |
| `selectedEndpointId` | `String` | FK to `ModelProvider` — which endpoint was selected |
| `taskType` | `String` | The classified task type |
| `sensitivity` | `String` | The sensitivity level applied |
| `reason` | `String` | Human-readable explanation |
| `fitnessScore` | `Float` | Winning endpoint's fitness score |
| `candidateTrace` | `Json` | Full `CandidateTrace[]` — all endpoints considered with scores |
| `excludedTrace` | `Json` | All excluded endpoints with reasons |
| `policyRulesApplied` | `String[]` | Policy rules that excluded endpoints |
| `fallbackChain` | `String[]` | Ordered fallback endpoint IDs |
| `fallbacksUsed` | `Json` | If failover occurred: which fallbacks were tried, what errors, what succeeded |
| `createdAt` | `DateTime` | When the decision was made |

**Retention:** Route decisions are retained for the same period as conversation history (configured per organisation). They are queryable from the ops UI: "show me all routing decisions for code-gen tasks in the last 7 days" or "show me every time endpoint X was excluded and why."

**Relationship to existing `RoutingMeta`:** The current `RoutingMeta` type passed to `observeConversation` is replaced by the `RouteDecision` record ID. The observer pipeline reads the full trace from the database rather than receiving a lightweight metadata object.

### Pinned & Blocked Overrides

Before Stage 0, check for administrative overrides:
- **Pinned endpoint** for a task type: skip the pipeline, return the pinned endpoint with `reason: "Pinned by [admin] on [date]: [reason]"`. The trace still shows what the pipeline *would have* selected.
- **Blocked endpoint**: excluded at Stage 1 with `reason: "Blocked by [admin] on [date]: [reason]"`.

Both overrides are time-limited unless explicitly renewed, logged with the administrator's identity, and visible in the ops UI.

### What This Replaces

| Current Mechanism | Replaced By |
|---|---|
| `buildBootstrapPriority` | Stages 1–3 (filter + score + rank) |
| `getProviderPriority` | `routeEndpoint` entry point |
| `filterByModelRequirements` | Stage 1 hard filter |
| `filterProviderPriorityBySensitivity` | Stage 1 sensitivity check |
| Agent `preferredProviderId` shuffle | Pinned endpoint override (before Stage 0) |
| `routeWithPerformance` | Merged into Stage 2 scoring |
| `TIER_RANK` / `TIER_ORDER` (3 definitions) | Eliminated — replaced by dimensional scores |
| `PlatformConfig.provider_priority` JSON blob | Eliminated — routing computed live from manifests |
| `optimizeProviderPriority` weekly job | Eliminated — no static priority list to maintain |
| `callWithFailover` cascade loop | `callWithFallbackChain` iterating `RouteDecision.fallbackChain` |

### `callWithFallbackChain` Responsibilities

The new `callWithFallbackChain` replaces `callWithFailover` and must preserve these existing behaviors:

1. **Call dispatch** — calls `callProvider` (unchanged) for the selected endpoint, then each fallback in order on failure
2. **Status transitions** — marks endpoints `degraded` on rate-limit, `disabled` on persistent/auth failures (replaces the current auto-disable + scheduled re-enable pattern)
3. **Deprecated model handling** — on `model_not_found`, marks the endpoint `disabled` and flags for human review (replaces `retireDeprecatedModel` which deleted `DiscoveredModel` and `ModelProfile` records)
4. **Token usage logging** — calls `logTokenUsage` on the endpoint that actually served the request (unchanged)
5. **Route decision recording** — persists the `RouteDecision` to the database, appending failover attempts to `fallbacksUsed` as they occur
6. **Process observer integration** — passes the `RouteDecision` record ID to `observeConversation` (replaces the current `RoutingMeta` type)
7. **Degraded recovery scheduling** — schedules a targeted eval for degraded endpoints to determine recovery (replaces the current `ScheduledJob` that re-enables after 1 hour regardless of actual recovery)

---

## Section 4: Model Profiling — How Profiles Get Populated and Stay Current

The routing function is only as good as its data. This section defines how capability profiles are established, validated, and kept current over time.

### Three Sources of Profile Data

**Source 1 — Seed Data (day zero)**

When an endpoint is first registered, a human or the onboarding process sets initial capability scores based on known information: published benchmarks, model cards, vendor documentation. These are "good enough to route" — not perfect, but far better than the current state where Haiku gets tagged `deep-thinker`.

Seed profiles are marked `profileSource: "seed"` and `profileConfidence: "low"`. The system knows these are starting estimates.

**Source 2 — Automated Evaluation via EndpointTestRun (periodic)**

A scheduled job runs task-specific evaluations against each active endpoint. This uses the existing `EndpointTestRun` infrastructure with structured eval scenarios per capability dimension:

| Dimension | Eval Method | What's Measured |
|---|---|---|
| `reasoning` | Multi-step logic problems with verifiable answers | Correct conclusions, logical chain quality |
| `codegen` | Generate function → run tests → pass/fail | Code correctness, idiomatic quality |
| `toolFidelity` | Present tool schemas → validate call structure | Correct schema, argument types, correct abstention when no tool fits |
| `instructionFollowing` | Specific formatting/constraint instructions → verify compliance | Adherence to system prompt rules |
| `structuredOutput` | Request JSON conforming to schema → validate against schema | Schema conformance rate |
| `conversational` | Multi-turn coherence check (orchestrator-graded) | Natural dialog flow, context maintenance |
| `contextRetention` | Needle-in-haystack at various context lengths | Retrieval accuracy at 25%, 50%, 75%, 100% of context window |

Each eval produces a score 0–100. The profile dimension is updated as a weighted rolling average: `newScore = 0.7 × evalScore + 0.3 × previousScore`. Recent evaluations matter more, but a single bad run doesn't tank the profile.

Profiles evaluated this way are marked `profileSource: "evaluated"`, `profileConfidence: "medium"` (< 5 evals) or `"high"` (>= 5 evals).

**Source 3 — Production Observation (continuous)**

The orchestrator-evaluator already scores real conversations. These scores feed back into the relevant dimension. A tool-action task where the endpoint produced a malformed tool call lowers `toolFidelity`. A reasoning task scored poorly by the orchestrator lowers `reasoning`.

This is lightweight — no extra inference calls, just using data already produced by the existing quality feedback loop.

### Eval Cadence

| Trigger | What Runs | Why |
|---|---|---|
| **New endpoint registered** | Full eval suite (all dimensions) | Establish baseline profile |
| **Weekly scheduled job** | Full eval suite on all active endpoints | Detect silent model updates, catch drift |
| **Endpoint marked `degraded`** | Targeted eval on failure dimension | Determine if it should be re-promoted or disabled |
| **Manual trigger (ops UI)** | Full or targeted eval | Human-initiated re-profiling |
| **Production score drops below threshold** | Targeted eval on affected dimension | Confirm whether production observations reflect real degradation |

### Drift Detection — Golden Test Set

Each endpoint maintains a small set of deterministic eval prompts (~10) with expected outputs. These run on the weekly schedule. If pass rate drops below a configurable threshold (e.g., from 9/10 to 6/10):

1. Log a `ProfileDriftDetected` event with the before/after pass rates
2. Trigger a full re-evaluation of all dimensions
3. Flag the endpoint in the ops UI for human review
4. Optionally mark the endpoint `degraded` until re-evaluation completes (configurable)

This catches silent model updates — provider changed weights without changing the model name.

### Endpoint Lifecycle States

```
unconfigured → [seed profile] → active → [eval improves profile] → active (high confidence)
                                       → [rate limits] → degraded → [recovery eval] → active
                                       → [persistent failure] → disabled → [human review] → active or retired
                                       → [provider discontinues] → retired
```

- **`active`** — fully routable, normal priority
- **`degraded`** — routable but with penalty multiplier (0.7×). Automatic and temporary. Triggered by rate limits, transient failures, or drift detection. The system periodically re-evaluates degraded endpoints to determine recovery.
- **`disabled`** — excluded from routing. Requires human review before re-enabling. Triggered by persistent failures, auth errors, or model deprecation.
- **`retired`** — permanently excluded from routing. Preserves the record for audit. Triggered by provider discontinuation or administrative decision.
- **`unconfigured`** — registered but not yet profiled. Excluded from routing until seed profile is provided.

### Profile Change Audit Trail

Every profile change is logged with its source:

- `"reasoning score updated: 78 → 82 (source: eval run #47, 2026-03-25)"`
- `"toolFidelity score updated: 85 → 71 (source: production observation, 3 malformed tool calls in last 20 tool-action tasks)"`
- `"drift detected: golden test pass rate dropped from 90% to 60% (2026-03-26)"`
- `"status changed: active → degraded (source: rate_limit response from provider, 2026-03-26 14:32)"`

The ops UI can show score history per dimension over time — a line chart making it obvious when a model updated or degraded.

### What This Replaces

- `ModelProfile` table — capability data consolidated onto `ModelProvider` (one source of truth)
- `ai-profiling.ts:buildProfilingPrompt` (which produces old vocabulary values) — replaced by structured eval scenarios
- `optimizeProviderPriority` weekly re-ranking job — replaced by eval-driven profile updates (no static priority list to maintain)

### `EndpointTaskPerformance` — Retained and Refined

The `EndpointTaskPerformance` table is **retained** because per-task-type performance data is valuable — an endpoint may excel at reasoning tasks but struggle with tool-action tasks. Changes:

| Field | Change |
|---|---|
| `avgOrchestratorScore` / `avgHumanScore` | Retained — composite scores remain useful for task-level performance tracking |
| `recentScores` | Retained — rolling window of recent scores for trend detection |
| `currentInstructions` | Retained — per-endpoint, per-task instruction refinement |
| `instructionPhase` | Renamed to `profileConfidence` with values `"low" | "medium" | "high"` |
| `pinned` / `blocked` | Retained — **per-task-type** overrides. The Section 3 pinned/blocked overrides are per-task-type, keyed by `(endpointId, taskType)` |
| `dimensionScores` | **New** — `Json` field storing per-dimension scores for this specific task type, enabling the production observation feedback loop (Section 4, Source 3) |

The endpoint-level profile on `ModelProvider` is the aggregate across all task types. `EndpointTaskPerformance` holds the per-task-type detail. Production observations update the task-level detail first, then roll up to the endpoint-level profile.

---

## Section 5: User-Extensible Routing — Governed Self-Service

The routing system must be extensible by domain experts who are not AI specialists or developers, while maintaining the governance processes that regulated industries require.

### Three Extension Points

**1. Custom Task Requirements (via UI)**

Users define new task types through a guided form that translates domain-language questions into a `TaskRequirement` contract:

- **"What does this task do?"** → `description` (free text)
- **"Does it need to call tools/APIs?"** → toggles `supportsToolUse` in `requiredCapabilities`
- **"Does it need structured data output?"** → toggles `supportsStructuredOutput`
- **"How important is accuracy vs speed?"** → slider mapping to `preferCheap` and score weights
- **"What kind of thinking does it need most?"** → checkboxes for reasoning, code generation, instruction following, etc. — each maps to a `preferredMinScores` entry with sensible defaults

The user never sees scores or schema. They see domain-language questions. The contract is stored, auditable, and participates in routing like any built-in task type.

When a user-created agent skill is invoked, the platform matches it to its custom task requirement and routes accordingly.

**2. Policy Routing Rules (organisation-level)**

Regulated industries need routing constraints driven by compliance, not capability:

- **"Patient data must not leave our infrastructure"** → policy rule: `if sensitivity >= "confidential" then require endpoint.sensitivityClearance includes "confidential"`
- **"All financial analysis must use validated models"** → policy rule: `if taskType == "financial-analysis" then require endpoint in approvedList`
- **"No unvalidated model in production"** → policy rule: `if profileConfidence == "low" then exclude from routing`

Policy rules execute as Stage 0 in the routing pipeline — **before** capability-based filtering. They are:

- Defined through the ops UI by administrators
- Stored in the database with an audit trail (who created, when, why)
- Versioned — changing a policy creates a new version, old version preserved
- Explainable — the `RouteDecision` includes which policy rules were applied and what they excluded

**3. Custom Evaluation Criteria (domain-specific quality)**

The built-in eval dimensions cover general AI capabilities. Domain-specific quality (clinical accuracy, citation fidelity, regulatory compliance) requires custom evaluation criteria:

- User defines a **custom dimension** (e.g., `clinicalAccuracy`) with a description
- User provides **eval scenarios** — input/expected-output pairs specific to their domain
- The eval loop includes custom scenarios alongside built-in ones
- Custom dimension scores are stored in `ModelProvider.customScores` and available for routing
- Custom dimensions appear in task requirement contracts the same way built-in ones do

### Governance Guardrails

| Action | Required Process |
|---|---|
| Create new task type | Saved as draft → reviewed by admin → activated |
| Modify policy rule | Change logged with justification field → approval workflow if org requires it |
| Add custom eval dimension | Dimension + scenarios reviewed before they enter the eval loop |
| Override routing (pin/block endpoint) | Logged with reason, visible in audit trail, time-limited unless renewed |

Nothing takes effect silently. Every extension has a creator, a timestamp, an approval state, and a reason.

### Database Tables for Extensibility

- `TaskRequirement` — seeded with built-in 9 task types, extensible with user-created rows. Each row has `origin` (`"system" | "user"`), `createdBy`, `approvedBy`, `approvedAt`.
- `PolicyRule` — organisation-scoped routing constraints with versioning. Fields: `name`, `description`, `condition` (structured JSON), `action` (`"exclude"`), `createdBy`, `version`, `effectiveFrom`, `effectiveUntil`.
- `CustomEvalDimension` — user-defined capability dimensions. Fields: `name`, `description`, `evalScenarios` (JSON array of input/expected-output pairs), `createdBy`, `approvedBy`, `status` (`"draft" | "active" | "retired"`).

### Explainability for Non-Experts

When a user asks "why did the AI use this model for my task?", the answer is assembled from human-authored strings in the `RouteDecision`:

> "Your task 'Summarise audit findings' was classified as a summarization task. This requires instruction-following capability. The policy rule 'Financial data stays on-premise' restricted routing to local endpoints. Endpoint 'ollama-llama3.1' was selected — it scored 72 on instruction-following (highest among eligible local endpoints). Two cloud endpoints were excluded by policy."

This is readable by a compliance officer, not just an engineer.

---

## Section 6: Migration Path

The current system works. The migration must not break it.

### Principle: Replace the Data First, Then the Code

The current routing bugs are data bugs (wrong tiers, missing constraints, dual vocabularies). Fix the data model first — even the existing routing code would work better with correct data. Then swap the routing function knowing the data underneath is solid.

### Phase 1 — Schema & Seed (no routing changes)

Add the new fields to `ModelProvider` (capability scores, hard constraint flags, operational metrics). Populate them via a seed migration for all existing providers using known benchmark data and current operational knowledge.

Nothing changes about how routing works. The old `capabilityTier` string stays, `callWithFailover` keeps running. But the correct data is now in the database alongside the old data.

**Validation gate:** Ops UI shows the new profiles. A human can inspect every endpoint and confirm the scores look reasonable before anything else changes.

### Phase 2 — Task Requirement Registry

Create the `TaskRequirement` table. Seed it with contracts for all 9 existing task types. Create the `PolicyRule` table. This is purely additive — no existing code is touched.

**Validation gate:** Each contract can be reviewed in isolation. "Does `tool-action` really need `supportsToolUse: true` and `toolFidelity: 70`?" is a question a human can answer by reading the contract.

### Phase 3 — New Router Function (shadow mode)

Implement `routeEndpoint` as a pure function. Wire it into the call path behind a new feature flag (`USE_MANIFEST_ROUTER`). When enabled:

- `routeEndpoint` produces a `RouteDecision`
- The `RouteDecision` is logged alongside the legacy routing result
- The legacy `callWithFailover` still handles the actual call
- A comparison report shows: "new router would have picked X, legacy picked Y"

**Validation gate:** Run shadow mode for several days. Review routing decision logs. Confirm the new router's selections are at least as good as legacy.

### Phase 4 — Cut Over

Flip the feature flag. The new router's `RouteDecision` drives actual endpoint selection. `callWithFailover` is replaced by `callWithFallbackChain` that iterates the `RouteDecision.fallbackChain` on failure.

**Validation gate:** Monitor routing decisions in the ops UI. Confirm no regressions in conversation quality or error rates.

### Phase 5 — Cleanup

Remove dead code:

- `buildBootstrapPriority`, `getProviderPriority`, `filterByModelRequirements`, `optimizeProviderPriority`
- `TIER_RANK`, `TIER_ORDER` (all three definitions)
- `PlatformConfig.provider_priority` key
- `TaskAwarePriority` type
- `filterProviderPriorityBySensitivity` and `isProviderAllowedForSensitivity` in `agent-sensitivity.ts` (provider filtering — replaced by manifest `sensitivityClearance`). Note: `getRouteSensitivity` (path-to-sensitivity mapping) is retained — the canonical source remains `route-context-map.ts` which already handles this for the unified coworker path
- `capabilityTier` string column on `ModelProvider` and `ModelProfile`
- `USE_UNIFIED_COWORKER` feature flag and old unified path in `agent-coworker.ts`
- `ModelProfile` table (after data migrated to `ModelProvider`)

### Phase 6 — Eval Loop

Enable the automated evaluation scheduler. Start with weekly full evals, daily golden-test drift checks. This is the last phase because it's additive — routing works correctly from Phase 4 with seed data alone. The eval loop makes it better over time.

### What Doesn't Change

- `callProvider` (the raw HTTP dispatch) — already a clean atomic function
- `logTokenUsage` — stays as-is
- `executeTool` — stays as-is
- The agentic loop — calls the new router instead of the old one, but its structure is unchanged
- The `EndpointTestRun` infrastructure — becomes the eval mechanism

### Risk Mitigations

| Risk | Mitigation |
|---|---|
| Seed profiles are inaccurate | Shadow mode (Phase 3) catches bad routing before it affects users |
| New router has a bug | Feature flag allows instant rollback to legacy |
| Missing a task requirement | Contracts are data, not code — add a row, no deployment needed |
| Provider changes pricing | Operational metrics update from production observation, no manual intervention |
| Eval suite doesn't cover a dimension | Start with dimensions we can measure; add evals incrementally |
| Migration breaks running platform | Each phase has a validation gate — proceed only when gate passes |

---

## Appendix A: Research Summary

### Commercial Routing Platforms

| Platform | Key Approach | Routing Controls | Differentiator |
|---|---|---|---|
| **Martian** | Predictive model scoring per-prompt | `max_cost`, `willingness_to_pay` | Cost/quality tradeoff as a formal economic parameter |
| **Unify** | Separate model routing from provider routing | Quality/cost/speed with rolling 10-min updates | Treats endpoint performance as a time-varying signal |
| **OpenRouter** | Unified gateway with provider-level routing | `sort`, `max_price`, `preferred_max_latency` | Largest model catalog (500+), binary capability flags |
| **NotDiamond** | Trained meta-model predicts best LLM per prompt | Quality/cost/latency Pareto optimization | Prompt translation — rewrites prompt for selected model |

### Benchmark Frameworks

| Framework | What It Measures | Relevance to Our Platform |
|---|---|---|
| **LMSYS Chatbot Arena** | Human preference via pairwise voting (Elo/Bradley-Terry) | Good signal for conversational quality; single composite score insufficient for routing |
| **HELM** | 7 metrics × 42 scenarios (accuracy, calibration, robustness, fairness, bias, toxicity, efficiency) | Most principled multi-dimensional approach; calibration dimension critical for regulated industries |
| **BFCL** | Tool/function-calling across 9 categories (simple, parallel, multi-turn, relevance detection) | Critical — our agents use tools heavily. BFCL v4 agentic eval is directly applicable |
| **OpenAI Evals** | Framework for custom evaluations with community registry | Architecture model for our eval loop — scenario + grader pattern |
| **IFEval** | Instruction following with 25 verifiable instruction types | Direct proxy for our `instructionFollowing` dimension |

### Key Research Findings

1. **No universal model capability profile schema exists** — this spec's multi-dimensional manifest is novel in production systems.
2. **Continuous evaluation is the hardest unsolved problem** — StageRoute's UCB approach is theoretically sound but untested in production. Our eval loop is a pragmatic alternative: periodic scheduled evals + production observation + golden test drift detection.
3. **Task requirement contracts are implicit in all commercial platforms** — this spec's explicit, structured contracts are an advancement.
4. **Silent model updates are undetected across the industry** — our golden test set is the recommended practice but rarely implemented.
5. **The structured output dimension is emerging as a primary routing signal** — JSONSchemaBench shows this is increasingly critical as workflows depend on reliable JSON output.

### Sources

Key references used in this research (full list available in research notes):

- Martian RouterBench: github.com/withmartian/routerbench
- OpenRouter Model API Schema: openrouter.ai/docs/api/api-reference/models/get-models
- HELM: arxiv.org/abs/2211.09110
- BFCL: gorilla.cs.berkeley.edu/leaderboard.html
- RouteLLM: arxiv.org/html/2406.18665v1
- StageRoute: arxiv.org/html/2506.17254
- IFEval: arxiv.org/abs/2311.07911
- JSONSchemaBench: arxiv.org/abs/2501.10868

---

## Appendix B: Current Architecture — Files Affected

| File | Current Role | Change |
|---|---|---|
| `lib/ai-inference.ts` | Raw HTTP dispatch | Stays (no changes to callProvider) |
| `lib/ai-provider-priority.ts` | Legacy failover engine | Replaced entirely (Phase 5) |
| `lib/agent-router.ts` | New capability router | Replaced by `routeEndpoint` (Phase 3) |
| `lib/agent-router-types.ts` | Type definitions | Replaced by new types |
| `lib/agent-router-data.ts` | DB hydration | Replaced by manifest loading |
| `lib/task-classifier.ts` | Regex task classification | Retained (classification is separate from routing) |
| `lib/task-types.ts` | Static task type registry | Replaced by `TaskRequirement` table |
| `lib/agent-sensitivity.ts` | Path-based sensitivity | Provider filtering replaced by manifest `sensitivityClearance`; `getRouteSensitivity` retained via `route-context-map.ts` |
| `lib/ai-profiling.ts` | LLM-generated profiles | Replaced by structured eval scenarios |
| `lib/actions/agent-coworker.ts` | Main entry point | Refactored to call `routeEndpoint` |
| `lib/agentic-loop.ts` | Iterative tool-calling loop | Minor change: receives routed endpoint |
| `lib/orchestrator-evaluator.ts` | Quality scoring | Enhanced: feeds per-dimension scores back to profiles |
| `prisma/schema.prisma` | Data model | Extended with new fields on ModelProvider |
