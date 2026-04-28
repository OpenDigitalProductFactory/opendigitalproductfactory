# Routing Architecture: Control Plane / Data Plane — Design Spec

| Field | Value |
|-------|-------|
| **Epic** | Platform Infrastructure / Routing Substrate |
| **Status** | Draft |
| **Created** | 2026-04-27 |
| **Author** | Claude Opus 4.7 for Mark Bodman |
| **Scope** | `apps/web/lib/routing/`, `apps/web/lib/inference/routed-inference.ts`, `apps/web/lib/tak/agent-router*.ts`, `packages/db/prisma/schema.prisma` (additive), `apps/web/lib/govern/activate-provider.ts` |
| **Aligns with** | [2026-03-29-model-routing-simplification-design.md](./2026-03-29-model-routing-simplification-design.md), [2026-03-20-adaptive-model-routing-design.md](./2026-03-20-adaptive-model-routing-design.md), [2026-03-20-contract-based-selection-design.md](./2026-03-20-contract-based-selection-design.md), [2026-04-20-routing-architecture-current.md](./2026-04-20-routing-architecture-current.md) |
| **Replaces, in part** | The in-call route-recompute pattern in [pipeline-v2.ts](../../apps/web/lib/routing/pipeline-v2.ts) — kept as the scoring engine, but moved off the request hot path |
| **Distinct from** | A2A AgentCard adoption (separate concern: capability advertisement between agents). Provenance / artifact integrity (separate concern: tool-call receipts as evidence). |
| **Primary Goal** | Eliminate the seed/runtime drift class of bugs in routing by separating the catalog, observed reality, and policy into independent layers, and by moving the routing decision off the per-request path into a continuously-maintained compiled lookup table. |

---

## 1. Problem Statement

The platform's routing subsystem decides which LLM endpoint serves each agent call. The decision factors in capability, tier, sensitivity, cost, recent success, current rate-limit budget, and policy. The current implementation makes this decision *inline on every coworker request* by reading raw provider/model/profile rows, applying filters and scoring, and producing a `RouteDecision` per call.

This produces a recurring, well-attested failure pattern. Concrete examples observed in the install during a single evening's debugging session on 2026-04-27:

1. A configured Anthropic OAuth subscription was active in the DB for ~50 minutes before its first coworker call routed to it. Earlier calls during that window routed to the bundled local gemma instead. The activation event did not invalidate any cached routing input; it merely changed a column the next routing call would *eventually* read.
2. A `disabled` provider (`codex`, no credential) was selected as the primary endpoint by `routeEndpointV2` and only failed at dispatch time, with the audit log claiming the disabled provider had won. The audit row says "Selected GPT-5.3 Codex (codex)" while the actual call ran on gemma after fallback.
3. An Anthropic rate-limit response (one `429` from the `anthropic-sub` provider) caused the next routing call to mark the entire provider degraded and fall through to gemma — including for models on the *same* provider that may not have been individually rate-limited.
4. The router selected `claude-opus-4-1-20250805` over `claude-opus-4-7` despite both being tagged `frontier`, because the tiebreaker fell to first-found alphabetical order rather than recency. The platform's strongest model was demoted on a fresh install with no eval data to override the tiebreaker.
5. A "Test connection" check on the provider configuration page returned green while real coworker traffic on the same provider was being silently throttled. The diagnostic surface and the actual call path used different code paths and reached different conclusions about provider health.

Each instance is a different symptom of the same architectural problem: **the routing decision treats configuration intent and observed reality as the same kind of input, stored in the same tables, read by the same functions, on the same request cadence**. There is no separation between "what the operator configured" and "what's actually happening at this instant." Drift is structurally invisible.

This spec proposes adopting the **control plane / data plane separation** that network routing has used for thirty-five years, adapted to the LLM-routing parameter set. The pattern is well-understood, has proven scaling characteristics, and addresses each of the bug classes above by construction.

## 2. Non-Goals

- **Replacing the scoring math.** The cost-per-success ranking in [cost-ranking.ts](../../apps/web/lib/routing/cost-ranking.ts) and the contract-derived scoring in [pipeline-v2.ts](../../apps/web/lib/routing/pipeline-v2.ts) stay. They become inputs to the control plane's compilation step instead of running per-request.
- **Adopting a network protocol literally.** This spec borrows networking *patterns* (control/data plane, RIB/FIB, probes, dampening, ECMP). It does not introduce OSPF, BGP, or any wire protocol. The patterns translate; the protocols are inappropriate for an in-process call to a same-process registry.
- **Capability advertisement between agents.** A2A AgentCard adoption is a complementary, separate concern. Agents declare what *they* can do; routing decides *which endpoint* serves each call. Both are needed; this spec covers only routing.
- **Artifact provenance / fakery prevention.** The "agent fabricated `verificationOut`" problem is real and important, but it lives at the artifact-acceptance layer (state machine guards on `saveBuildEvidence`), not at the routing layer. Out of scope here, on the followup list.
- **Provider catalog content.** The seed continues to declare which providers exist, what auth schemes they support, and what the per-provider implementation file is. This spec changes how runtime *state* about those providers is maintained, not how providers themselves are catalogued.
- **Dynamic capability-derived grants.** The grant model overhaul (capability-first instead of static role-pinned) is its own design. This spec assumes the existing grant model continues to function, and ensures the routing layer's outputs feed the grant layer cleanly.
- **Replacing budget classes (`minimize_cost`, `quality_first`, `balanced`).** They remain as scoring inputs.
- **NOT non-goals (in scope):** proactive anomaly detection and watchdog, formal rate-limit recovery semantics with dampening, and end-to-end cost / quota capture across all dispatch paths. These were initially deferred but are now part of the architecture (see §11, §12, §13). The architecture is incomplete without them: the control plane is unobservable in production without a watchdog, recovery is unsafe without dampening, and the platform is unbillable without cost capture closing the CLI-adapter gap.

## 3. Architectural Model

The routing subsystem is split into four concerns, each with one job and a clean interface to the next: control plane, data plane, watchdog, cost ledger.

```
       ┌────────────────────────────────────────────────────┐
       │                  Control Plane                     │
       │                                                    │
       │   ┌───────────┐   ┌───────────┐   ┌────────────┐   │
       │   │  Catalog  │   │  Probes   │   │   Policy   │   │
       │   │   (seed)  │   │ (live)    │   │  (admin)   │   │
       │   └─────┬─────┘   └─────┬─────┘   └─────┬──────┘   │
       │         │               │               │          │
       │         ▼               ▼               ▼          │
       │   ┌────────────────────────────────────────┐       │
       │   │   RIB — Routing Information Base       │       │
       │   │   (full endpoint state, per provider)  │       │
       │   └────────────────────┬───────────────────┘       │
       │                        │ compile                   │
       │                        ▼                           │
       │   ┌────────────────────────────────────────┐       │
       │   │   FIB — Forwarding Information Base    │       │
       │   │   (compiled lookup: criteria → chain)  │       │
       │   └────────────────────┬───────────────────┘       │
       └────────────────────────┼───────────────────────────┘
                                │ atomic publish
                                ▼
       ┌────────────────────────────────────────────────────┐
       │                  Data Plane                        │
       │                                                    │
       │  per-request:  criteria  →  FIB lookup  →  chain   │
       │                                                    │
       │  on completion: outcome event → control plane      │
       │                 cost event    → cost ledger        │
       └────────────────┬───────────────────┬───────────────┘
                        │                   │
                        ▼                   ▼
       ┌──────────────────────────┐  ┌──────────────────────┐
       │       Watchdog           │  │     Cost Ledger      │
       │ (anomaly detector,       │  │ (per-call, per-agent,│
       │  uses cheapest non-rate- │  │  per-build, per-     │
       │  limited route for its   │  │  provider, per-      │
       │  own observation calls)  │  │  subscription window)│
       │                          │  │                      │
       │ emits AnomalyEvent ─────►│  │ emits BudgetAlarm ──►│
       │ to operator surface      │  │ to operator surface  │
       └──────────────────────────┘  └──────────────────────┘
```

### 3.1 Control Plane

The control plane is a long-running, *in-process* coordinator. It maintains the **RIB** (Routing Information Base) — full per-endpoint state with metadata — and compiles it into the **FIB** (Forwarding Information Base) — a flat lookup table indexed by request criteria.

The control plane has three input sources:

- **Catalog**: read-mostly, hand-maintained provider declarations from the seed and `agent_registry.json`. Refreshes on deploy. This is the *intent layer*.
- **Probes**: live observations from background health checks, recent call outcomes, and explicit credential-validation events. Refreshes continuously. This is the *reality layer*.
- **Policy**: admin-set rules — pinned endpoints, blocked endpoints, residency requirements, tier minimums per task type. Refreshes on admin change. This is the *operator preference layer*.

Each input source is a separate **Repository** with its own freshness cadence and its own write path. None of them is allowed to write directly to the FIB; the FIB is always the output of the compile step.

### 3.2 RIB — Routing Information Base

The RIB is the union of catalog + probe state + policy, materialized as a typed in-memory structure. One entry per `(providerId, modelId)` pair. Each entry carries:

- **Identity**: `endpointId`, `providerId`, `modelId`, `friendlyName`
- **Catalog facts**: `capabilities` (toolUse, structuredOutput, streaming, modalities, etc.), `qualityTier`, `costPerOutputMToken`, `costPerInputMToken`, `maxContextTokens`, `supportedAuthSchemes`, `sensitivityClearance`
- **Lifecycle state**: one of `unconfigured | configured | probed | active | degraded | rate_limited | recovering | retired` (state machine, see §3.3)
- **Observation metadata**: `lastProbeAt`, `lastProbeOutcome`, `recentSuccessRate`, `recentLatencyMs`, `consecutiveFailures`, `rateLimitResetAt`, `dampeningMultiplier`
- **Policy overlay**: `pinnedForTaskTypes[]`, `blockedForTaskTypes[]`, `tierFloor`, `costCeiling`
- **Provider-shared state**: `quotaBudgetRemaining` (links to other endpoints sharing the same provider quota — see §6.4)

The RIB is the *complete* truth about the routing topology. It is never read directly by a request; only by the compile step.

### 3.3 Endpoint Lifecycle State Machine

Each endpoint moves through an explicit state machine. Transitions are *only* triggered by specific events; no state column is written from arbitrary code paths.

```
   ┌──────────────┐
   │ unconfigured │ ◄──── catalog says exists, no creds yet
   └──────┬───────┘
          │ creds_saved
          ▼
   ┌──────────────┐
   │  configured  │ ◄──── creds present, probe pending
   └──────┬───────┘
          │ probe_succeeded
          ▼
   ┌──────────────┐
   │    probed    │ ◄──── healthy, not yet promoted to candidate pool
   └──────┬───────┘
          │ N consecutive successful probes (default: 1)
          ▼
   ┌──────────────┐         consecutive_failures >= K
   │    active    │ ──────────────────────────────────►  ┌────────────┐
   │              │ ◄────── probe_succeeded               │  degraded  │
   └──┬───────┬───┘                                       └─────┬──────┘
      │       │                                                 │
      │       │ rate_limit_received                             │ probe_failed
      │       ▼                                                 │ consecutive >= K2
      │ ┌──────────────┐                                        ▼
      │ │ rate_limited │                                  ┌────────────┐
      │ │              │                                  │  retired   │
      │ └──────┬───────┘                                  └────────────┘
      │        │ cooldown_expired                          (terminal until
      │        ▼                                           operator action)
      │ ┌──────────────┐
      │ │  recovering  │
      │ └──────┬───────┘
      │        │ N successful probes (with dampening)
      │        ▼
      └────► active
```

State transition rules:

- **`creds_saved`** is fired by the credential save path (e.g., `activate-provider.ts`). It moves `unconfigured → configured`.
- **`probe_succeeded`** is fired by the probe daemon. It moves `configured → probed`, `degraded → active`, `recovering → active` (after N).
- **`probe_failed`** is fired by the probe daemon. It moves `active → degraded`, `degraded → retired` after K2 consecutive.
- **`rate_limit_received`** is fired by the data plane when a 429 is observed. It moves `active → rate_limited`. The cooldown timer is set from the response's `Retry-After` header if present, else a default (60s).
- **`cooldown_expired`** is a timer event. It moves `rate_limited → recovering`.
- **`creds_revoked`** moves any state → `unconfigured`.
- **`operator_disable`** moves any state → `retired`.
- **`operator_enable`** moves `retired` → `configured` (then proceeds through the normal probe path). Without this transition, an accidental disable requires DB surgery to reverse — a known operability trap. The transition is gated on credentials still being present; if creds were revoked while retired, it moves to `unconfigured` instead.

Only `active` and `degraded` endpoints enter the FIB candidate pool. `degraded` endpoints carry a fitness penalty (default 0.7×) but are still selectable.

The state machine has *no* implicit transitions and *no* state column is writable except through these named events. The state column itself can stay in the DB schema as it is today (`ModelProvider.status`, `ModelProfile.modelStatus`); the difference is that it becomes the *output* of the state machine, not the input. Code paths that today write directly to status fields move behind named transition functions.

### 3.4 FIB — Forwarding Information Base

The FIB is the *compiled* routing table. It is what the data plane consults per request. It is a flat structure keyed by request criteria, valued by an ordered chain of endpoints to attempt.

Conceptually:

```
FIB: Map<RequestKey, FallbackChain>

RequestKey = {
  taskType: string,
  capability: { toolUse?, structuredOutput?, modalities?[], minContextTokens? },
  sensitivity: SensitivityLevel,
  tierFloor?: QualityTier,
  residency?: ResidencyPolicy,
  budgetClass: BudgetClass,
  conversationContinuity?: { previousProviderId, previousModelId }
}

FallbackChain = ChainEntry[]  // ordered, length 1..N

ChainEntry = {
  endpointId, providerId, modelId,
  fitnessScore: number,
  expectedCost: number,
  reason: string,
  // for ECMP: a chain may contain multiple equal-fitness entries
  // that the data plane round-robins or load-balances across
}
```

The FIB is *not* a literal `Map<RequestKey, Chain>` materialized for every possible key — that's combinatorially infeasible across `taskType × capabilityShape × sensitivity × tierFloor × residency × budgetClass × continuity`. It is a **two-level structure**:

1. **Eager-compiled rule set**: a decision-tree keyed on the *low-cardinality* dimensions (`taskType`, `budgetClass`, `tierFloor`, `sensitivity`). On compile, every cell is materialized — these dimensions have a small known cartesian product (dozens of cells in practice).
2. **Lazy per-request resolution**: the high-cardinality dimensions (precise `capability` shape, `previousProviderId` for continuity, exact `minContextTokens`) are resolved at lookup time by *filtering and reordering* the eager cell's pre-ranked candidate list. This filter step is O(N) over a small N (the eager cell rarely has >10 candidates) and contains *no* DB I/O, *no* state machine reads, *no* scoring math — only filter predicates over fields already cached on each `ChainEntry`.

Lazy resolution is **not** a fall-through to per-request scoring. Scoring happens at compile time; lazy resolution only filters and reorders an already-ranked list. The data-plane invariant — no DB joins, no scoring, bounded CPU — holds. Implementation note in §5.2.

Critically: the FIB is **immutable per generation**. When the control plane compiles a new FIB, it atomically swaps the published reference. The data plane never observes a partially-updated FIB. This eliminates the class of bugs where an audit log records one decision and the runtime takes a different path because the underlying state mutated between read and dispatch.

**Stale-chain protection during long fallbacks.** When the FIB swaps mid-dispatch, the in-flight request continues walking its original chain (§3.5). However, before *attempting* each non-primary chain entry, the data plane re-validates that entry's `endpointId` is still in `{active, degraded}` state via an O(1) RIB read (the RIB exposes a read-only `currentState(endpointId)` view alongside the published FIB). If the entry's state has moved to `rate_limited`, `retired`, or `unconfigured` since the chain was compiled, the data plane skips it and advances to the next entry. This catches the case where a 30-second fallback walk through a long chain would otherwise dispatch to an endpoint the control plane has since taken out of service.

### 3.5 Data Plane

The data plane is a *fast and dumb* lookup. Per request:

```
function dispatch(request: InferenceRequest): RouteDecision {
  const key = deriveRequestKey(request)
  const chain = currentFIB.lookup(key)
  return { selectedEndpoint: chain[0], fallbackChain: chain.slice(1), ... }
}
```

Notably absent from the data plane:

- Database queries for endpoint metadata
- Filter pipelines
- Scoring or ranking
- State machine transitions
- Probing

Those all happen in the control plane, off the request hot path. The data plane's only side effect on routing state is to *report outcomes* back to the control plane: success, failure, rate-limit, latency. These outcomes feed the probe/observation layer, which feeds the next FIB compilation.

The data plane is also responsible for **fallback execution**: if the first chain entry fails, it walks the chain. Fallback execution does *not* recompute the chain; it uses the chain that was already in the FIB at the moment of dispatch. If the FIB updates mid-dispatch, the in-flight request continues with its original chain. The next request gets the new FIB.

### 3.6 Outcome Feedback

Every dispatched call produces an outcome event:

```
OutcomeEvent = {
  endpointId, modelId,
  taskType,
  success: boolean,
  latencyMs,
  rateLimited: boolean,
  retryAfterMs?: number,
  authFailed: boolean,
  errorClass?: string,
  inputTokens, outputTokens,
  observedAt
}
```

Outcomes are delivered to the control plane via an in-process event bus (or queue if the control plane is later moved out-of-process). The control plane's observation aggregator updates rolling success rate, latency, consecutive-failure counters, and triggers state transitions where appropriate.

Outcome events are also persisted to the existing `RouteOutcome` table for audit and offline analysis. The persistence path is decoupled from the in-memory aggregator — durability is best-effort for audit; the aggregator is authoritative for routing.

**Idempotency.** Each `OutcomeEvent` carries a unique `eventId` (cuid). The aggregator deduplicates by `eventId` over a 5-minute sliding window. Without dedup, retried publications, dual subscribers, or replay-after-restart could double-count successes/failures and corrupt the rolling counters used for state transitions.

**Drop detection requires a separate dispatch counter.** The watchdog detector "outcome events not flowing" (§10.2) cannot be defined as `count(OutcomeEvent) / count(dispatched calls)` if outcome events are themselves the only durable record. The data plane therefore writes a lightweight `DispatchEvent { eventId, dispatchedAt, endpointId }` *at the moment of dispatch*, separate from the outcome write. The detector measures the gap between dispatched-and-not-completed events older than a timeout. This costs one extra row per call but makes silent outcome-drop loud.

## 4. Compilation: How RIB Becomes FIB

The compilation step is a deterministic function: `compile(RIB, Policy) → FIB`. It runs:

- On any state machine transition that affects candidate eligibility (`active → rate_limited`, `recovering → active`, etc.)
- On any policy change (admin save)
- On any catalog change (deploy, but typically also picked up at boot)
- On a debounced cadence (default 5s) to absorb bursts of events

The compilation algorithm reuses today's `pipeline-v2.ts` stages, but applied across the *full* RIB rather than per-request. The output is a structured FIB that captures, for each meaningful `RequestKey` pattern, the ranked chain of endpoints.

Stages, in order:

1. **Filter by lifecycle**: keep only `active` and `degraded` endpoints.
2. **Filter by capability**: for each capability dimension in the RequestKey, eliminate endpoints that don't satisfy it (toolUse, structuredOutput, modality match, context window).
3. **Filter by tier**: enforce `tierFloor` against the endpoint's `qualityTier`.
4. **Filter by sensitivity**: enforce sensitivity clearance.
5. **Filter by policy**: apply admin pins, blocks, residency rules.
6. **Filter by budget**: drop endpoints whose remaining quota budget is below the request's expected cost.
7. **Score**: apply the multi-dimensional scoring function (§6) to each surviving candidate.
8. **Rank**: sort by score (with the degraded penalty applied), then by cost-per-success, then by recency for tie-breaking.
9. **Diversify fallbacks**: ensure the chain includes endpoints from different providers when possible (BGP-style provider diversity).
10. **Apply ECMP**: when multiple top-ranked endpoints are within an ECMP threshold (default: scores within 5% of the top), group them as load-balance candidates rather than picking one arbitrarily. Selection within an ECMP group is **flow-stable, not round-robin**: when the request carries `previousProviderId` (conversation continuity, §6.3), the prior endpoint is preferred if it's in the group, otherwise selection is hashed on a stable conversation key. Pure round-robin within an ECMP group would force conversations to switch endpoints across turns, undoing the continuity bonus from §6.3 and re-introducing the mid-conversation provider-switch quality regression. (This matches how real ECMP in network routing works: per-flow hashed, not per-packet round-robin.)

The compilation output is the FIB. The previous FIB is retained until the new one is fully built, then atomically swapped.

## 5. Data Structures

### 5.1 RIB

In-memory, owned by the control plane:

```typescript
interface RIBEntry {
  // Identity
  endpointId: string;
  providerId: string;
  modelId: string;
  friendlyName: string;

  // Catalog facts (from seed/profile, immutable per process lifetime)
  capabilities: ModelCapabilities;
  qualityTier: QualityTier;
  costPerInputMToken: number;
  costPerOutputMToken: number;
  maxContextTokens: number | null;
  sensitivityClearance: SensitivityLevel[];
  modelClass: 'chat' | 'reasoning' | 'code' | 'embedding';

  // Lifecycle state (controlled by state machine, mutable via transitions only)
  state: EndpointState;
  stateChangedAt: Date;
  rateLimitResetAt: Date | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  dampeningMultiplier: number;  // [0, 1], applied to fitness during recovery

  // Observation aggregates (rolling windows, mutable via outcome events)
  recentSuccessRate: number;     // last N calls
  recentLatencyMs: number;       // EWMA
  recentRateLimitRate: number;   // last N calls
  totalCalls: number;            // since process start

  // Provider-shared state (linked, see §6.4)
  providerQuota: ProviderQuotaState | null;

  // Policy overlay
  pinnedForTaskTypes: string[];
  blockedForTaskTypes: string[];
}

interface ProviderQuotaState {
  providerId: string;
  budgetRemaining: number | null;  // null = unknown / unlimited
  budgetResetAt: Date | null;
  recentlyRateLimited: boolean;
}

type EndpointState =
  | 'unconfigured'
  | 'configured'
  | 'probed'
  | 'active'
  | 'degraded'
  | 'rate_limited'
  | 'recovering'
  | 'retired';
```

### 5.2 FIB

The FIB is structured to make data-plane lookup O(1) for the common case. Implementation: a layered index where each layer keys on one dimension of the RequestKey and the leaf is the fallback chain.

For the v1 implementation, a simpler form is acceptable: a `Map<string, FallbackChain>` keyed by a canonicalized string serialization of the RequestKey, computed for the cartesian product of *active task types and known capability shapes*. The cartesian product is small in practice (dozens of unique keys per running install). Memoize the lookup with a fallback to dynamic computation on cache miss.

```typescript
interface FIB {
  generation: number;             // monotonically increasing
  generatedAt: Date;
  lookup(key: RequestKey): FallbackChain;  // throws if no candidates
  ribSnapshotIds: string[];        // for diagnostics
}

interface FallbackChain {
  primary: ChainEntry;
  fallbacks: ChainEntry[];           // in dispatch order
  ecmpAlternates?: ChainEntry[];     // equivalent to primary, round-robin
  reason: string;                    // human-readable trace
}

interface ChainEntry {
  endpointId: string;
  providerId: string;
  modelId: string;
  fitnessScore: number;
  expectedCostPerCall: number;
  rationale: ChainEntryRationale;    // structured trace of why this was picked
}
```

### 5.3 Outcome Event Bus

A typed in-process pub/sub. Producers: the dispatch function in the data plane. Consumers: the observation aggregator in the control plane, and the audit persistence pipeline.

```typescript
interface OutcomeBus {
  publish(event: OutcomeEvent): void;
  subscribe(handler: (event: OutcomeEvent) => void): Unsubscribe;
}
```

Events are processed asynchronously; the data plane does not block on outcome publication.

## 6. Scoring Function

The DPF-specific scoring function is the bespoke part of this architecture. The rest is commodity. Scoring takes a candidate endpoint and a request, plus the full RIB, and returns a fitness in `[0, 100]`.

### 6.1 Dimensions

The scoring function combines:

- **Capability fitness**: hard filter only — either the endpoint can satisfy the capability requirements or it can't. Scored 0 (excluded) or 100 (passes) at the filter stage; not part of the scalar score.
- **Tier match**: distance from request's `tierFloor` to endpoint's `qualityTier`. Exact match scores best; over-provisioning (e.g., frontier when only adequate is needed) scores lower in cost-conscious budget classes.
- **Cost efficiency**: `expectedCost / qualityScore`. Lower is better. Quality score is the recent success rate × completeness of recent responses.
- **Recent performance**: rolling success rate, weighted toward recent calls.
- **Latency**: EWMA of recent response times; ranked but not heavily weighted unless the request specifies a latency budget.
- **Provider quota headroom**: endpoints on a provider near rate-limit get penalized to spread load.
- **Conversation continuity**: if the request carries a `previousProviderId`, the same provider gets a continuity bonus to avoid mid-conversation provider switches that degrade quality.
- **Eval scores**: when `EndpointTaskPerformance` has eval data for this `(endpointId, taskType)` pair, blend it into the score with a confidence-weighted multiplier.
- **Recency within tier**: when multiple endpoints tie on all other dimensions, prefer the newer model family revision (Opus 4.7 over Opus 4.1). The recency signal comes from a canonical `releasedAt` timestamp on the catalog entry — *not* from lexicographic ordering of model IDs. Provider naming schemes vary (`claude-opus-4-7` vs `gpt-5.3-codex` vs `gemini-2-5-pro-002`) and lexicographic comparison is unreliable across schemes. The catalog seed is the source of truth; if `releasedAt` is missing, the model is treated as "unknown date" (sorted last) and a boot warning is emitted. This is the structural fix for the "always picks oldest opus" bug — the original symptom was *first-found alphabetical order*, which a naive recency tiebreaker by ID string would partially reproduce.

### 6.2 Budget Class Influence

`AgentModelConfig.budgetClass` and the request's `preferCheap` flag combine into per-dimension weights:

| Dimension | `quality_first` | `balanced` | `minimize_cost` |
| --- | --- | --- | --- |
| Tier match | 0.40 | 0.25 | 0.15 |
| Recent performance | 0.25 | 0.20 | 0.15 |
| Eval scores | 0.20 | 0.15 | 0.10 |
| Cost efficiency | 0.05 | 0.20 | 0.40 |
| Latency | 0.05 | 0.10 | 0.10 |
| Provider quota headroom | 0.025 | 0.05 | 0.05 |
| Continuity bonus | 0.025 | 0.05 | 0.05 |

(Weights are illustrative; actual values tuned in implementation against eval data.)

### 6.3 Hysteresis for Conversation Affinity

When `previousProviderId` is present, the scoring function adds a hysteresis term: the previous provider's score is multiplied by `(1 + continuityBonus)` where `continuityBonus` defaults to `0.10`. This prevents flapping between providers across consecutive turns of the same conversation when scores are otherwise close. The bonus is *not* applied if the previous provider has since transitioned out of `active` state — a hard failure dominates continuity.

### 6.4 Provider-Shared Quota Modeling

Some providers have a single quota shared across multiple model endpoints (Anthropic Claude Max subscription is the canonical example: 9 model endpoints, one bucket). The RIB carries a `ProviderQuotaState` per provider, linked from each endpoint that shares it.

When a `429` is observed on any endpoint sharing the quota, the entire group transitions to `rate_limited`. The cooldown timer is provider-level, not endpoint-level. This matches the observed reality and prevents the false-fallback case where the router tries a different Claude model after rate-limiting and gets immediately rate-limited again.

When a provider quota recovers, *one* probe per provider determines whether the whole group can return to `active` (with dampening). Probing each model individually wastes quota; one probe per provider is sufficient because the quota is shared.

**Concurrency on shared-quota updates.** Two adapter callers can observe `429`s on different sibling endpoints in the same instant. Both reach `applyToProviderSiblings` and increment `consecutiveRateLimits` and halve `dampeningMultiplier` for every sibling — without coordination, the result is double-counted penalties. The control plane therefore wraps shared-quota state mutations in a per-provider lock (in-process mutex; if the control plane later externalizes, a Redis lock with TTL). State writers that miss the lock observe the post-update state and short-circuit if the update was already applied within a small dedup window (default 1s).

### 6.5 Burn-Rate-Aware Subscription Preference (Use-It-or-Lose-It)

Subscription pricing inverts the cost-optimization logic. With token-priced providers, every unused token is money saved. With fixed-plan subscriptions (Claude Max, ChatGPT Plus, Gemini Advanced), unused quota at window-end is **value forfeited** — the user has already paid for it whether they consume it or not.

The economically rational behavior depends on the subscription's *burn rate* relative to the elapsed window:

```text
window_elapsed_fraction  = (now - window_start) / (window_end - window_start)
quota_consumed_fraction  = tokens_consumed / estimated_quota_cap
burn_rate_score          = quota_consumed_fraction / window_elapsed_fraction
```

Three regimes:

| `burn_rate_score` | Subscription state | Routing implication |
| --- | --- | --- |
| `< 0.85` | **Lagging** — quota will be wasted | Apply *preference bonus* to subscription provider; prefer it over token-priced alternatives for any task it can serve |
| `0.85 – 1.15` | **On track** — tracking window | Score normally; subscription competes on quality/latency like other endpoints |
| `> 1.15` | **Ahead** — risk of exhaustion before window-end | Apply *throttling penalty*; prefer token-priced or local fallbacks to preserve subscription headroom |

The thresholds are tunable per-provider in policy. The default 0.85/1.15 bands give reasonable hysteresis — a subscription doesn't oscillate between "lag" and "track" on every call.

**Mathematical effect on scoring:**

For subscription endpoints, the cost dimension's weight is replaced (not added to) by a `subscriptionUtilizationDelta` term:

```text
if endpoint.providerQuota.kind == 'subscription':
  expected_completion_at_current_rate = now + (1 - quota_consumed_fraction) / current_rate_per_ms
  if burn_rate_score < 0.85:
    bonus = (0.85 - burn_rate_score) * SUBSCRIPTION_LAG_BONUS_WEIGHT  // default: 30
    score += bonus
  elif burn_rate_score > 1.15:
    penalty = (burn_rate_score - 1.15) * SUBSCRIPTION_LEAD_PENALTY_WEIGHT  // default: 50
    score -= penalty
```

The penalty weight is higher than the bonus weight because over-consumption causes hard rate-limit failures (with cascading downtime), while under-consumption is a soft "didn't extract maximum value" loss.

**Interaction with budget classes:**

The burn-rate logic applies *across all budget classes*, but with different intensities:

- `quality_first`: subscription-lag bonus applies normally (use the high-quality subscription you've already paid for); subscription-lead penalty is reduced (quality matters more than preserving quota).
- `balanced`: both apply at full weight.
- `minimize_cost`: subscription-lag bonus is *amplified* (cheapest possible choice is "use what's already paid for"); subscription-lead penalty applies normally.

**Bootstrap problem: the cap must be known before lagging/ahead means anything.**

`burn_rate_score` requires `estimated_quota_cap`. §12.2 describes learning the cap empirically from `429` events ("when a `429` hits, record consumption as a lower bound"). Taken alone, this is circular: the bonus/penalty mechanism is meant to *prevent* rate-limit hits, but it can't activate until at least one rate-limit hit has calibrated the cap. Until then, §12.2.1 returns `regime: 'unknown'`, and §6.5's logic is inert — the install ships with the bonus mechanism that never fires until the system has already failed at least once.

The bootstrap order is therefore mandatory:

1. **Provider-published caps** are seeded as `estimatedCapTokens` at provider activation, where the provider publishes a quota (Anthropic Claude Max, ChatGPT subscription tiers — published documentation values used as authoritative until proven wrong).
2. **Operator-set initial caps** are accepted via the policy layer as an override when published values are absent or known-stale.
3. **Conservative default** of `0` cap maps to `regime: 'unknown'` and *no* burn-rate adjustment in either direction — the system falls back to behaving as if the provider were token-priced. This is safer than guessing.
4. **Empirical lower-bound learning** (existing §12.2 mechanism) runs *in addition to* the bootstrap and tightens the estimate over time; it never replaces a published cap with a smaller observed one without operator confirmation.

The boot invariant in §12.7 should require either a published cap or a `regime: 'unknown'` acknowledgment for every subscription provider — silently routing into "unknown regime" without operator awareness is the failure mode this constraint prevents.

**The "I have surplus quota with N hours remaining" workflow:**

When a user knows they have unused quota (e.g., "I need to burn 23% of my weekly Claude Max in 13 hours"), the routing system already knows this from the subscription quota window state. No special user action is needed — the burn-rate score will be `(0.77 / 0.92) ≈ 0.84`, just barely in the "lagging" regime, and the subscription preference bonus will kick in automatically.

What the *user* needs is visibility, not a new control: the operator dashboard (§10.4) surfaces burn-rate score per subscription, with a "projected at current rate: X% consumed by window-end" gauge. If the projection is below 100%, the user can decide whether to direct more agent work toward subscription-served tasks or accept the loss.

**The "agent should consider spend rate" pattern:**

When an AI Coworker is planning multi-step work, it can query its own subscription headroom (a new MCP tool: `get_subscription_status`) and prefer harder, more thorough analyses when burn rate is lagging — turning surplus quota into deeper reasoning rather than padded output. This is the right way to "spend the budget" without the failure mode of generating tokens for the metric: the agent picks problems worth solving, and uses the subscription-funded model for them, rather than generating filler.

**What this is NOT:**

It is not a license to fabricate work or pad responses to consume quota. The cost ledger (§12) writes per-call; an agent that calls the model 50 times to summarize the same paragraph is detectable in the audit trail, and the watchdog (§10) flags it as a "low information density per call" anomaly. The mechanism rewards *useful* burn, not any burn.

## 7. Migration Path from Current Implementation

This is the part that determines whether the design ships. The current routing code (`pipeline-v2.ts`, `task-router.ts`, `loader.ts`, `fallback.ts`) has many call sites. Migration must be incremental and reversible.

### 7.1 Phase A: Introduce the RIB without removing per-request decisions

- Stand up the in-memory RIB structure as a wrapper around the existing `loadEndpointManifests()` query.
- The RIB is materialized **once per process** at boot and **invalidated on schema-affecting events** (provider added/removed, credentials saved, model registered). It is *not* rebuilt per request: today's per-request DB read is one indexed query, but wrapping it in a "rebuild RIB per call" pattern multiplies that into N queries (or one larger join) plus the typed-structure construction cost. "Same cost as today" is therefore false unless the RIB is built lazily and cached.
- All scoring continues to run per-call against the cached RIB.
- Verifies the RIB type contract without changing behavior.
- Adds a `show_routing_state` admin API that dumps the current RIB. This alone closes a significant operability gap.
- **Phase exit criterion (latency gate):** routing-call p99 latency in staging must not regress by more than 5% over the pre-Phase-A baseline. If it does, Phase A ships behind a feature flag for measurement only and the cache strategy is revisited before Phase B.

### 7.2 Phase B: Move state transitions behind named functions and retire legacy tier column

- Replace direct writes to `ModelProvider.status` with named transition functions: `markCredentialsValid()`, `markRateLimited()`, `markRecovering()`, etc.
- Audit all call sites. There should be a small fixed number; today they're scattered.
- Add a CI invariant: `ModelProvider.status` and `ModelProfile.modelStatus` may only be written from the routing module's transition functions. Linter or grep-based check in pre-commit.
- **Retire `ModelProfile.capabilityTier`** — the legacy LLM-grading column with the parallel vocabulary (`deep-thinker`/`fast-worker`/...). Migration: rename to `capabilityCategory` (the actual purpose, friendly admin-UI categorization). The routing layer reads only `qualityTier`. Boot invariant from §8.1 verifies the rename landed and no routing code path consults the old column. This collapses the parallel-tier-vocabulary drift surface that has plagued attempts 16-18 (see `2026-04-27-routing-substrate-attempt-history.md` Class A).

### 7.3 Phase C: Stand up the probe daemon

- A background task (Inngest function or in-process timer) probes each `configured` and `active` provider on a cadence (default 60s for active, 30s for configured/recovering).
- Probes are minimal: a `models.list` call, an embedding call, or a 1-token completion — whichever is cheapest per provider.
- Probe outcomes feed state transitions per §3.3.
- Initially run alongside per-request routing; the FIB is not yet consulted.

### 7.4 Phase D: Compile the FIB

- Add the compilation step from RIB to FIB.
- Initially, the FIB is computed but not consulted by the data plane.
- Add diagnostic output: dump of current FIB, with per-RequestKey chains.
- Compare FIB output to per-request routing decisions on a sampling basis. Investigate divergences.

### 7.5 Phase E: Switch the data plane to FIB lookup

- Per-request routing now queries the FIB instead of running the pipeline.
- Outcome events flow back to the control plane.
- The pipeline code remains as the *compilation* implementation, no longer the *dispatch* implementation.

### 7.6 Phase F: Remove dead code paths

- Once Phase E is stable in production for at least one full release cycle, remove the per-request pipeline entry points that the data plane no longer uses.
- Tighten the API: routing is *only* through the FIB lookup.

### 7.7 Phase G: Watchdog (Class A detectors)

- Stand up the watchdog scheduled task per §10.
- Implement Class A (rule-based, no LLM call) detectors first; they're cheapest and catch the highest-severity anomalies.
- Persist `RoutingAnomaly` rows; surface to operator via existing notification channels.
- Verify detectors fire correctly against synthetic anomaly injection in tests.

### 7.8 Phase H: Watchdog (Class B + C detectors) and operator dashboard

- Add Class B (LLM-augmented narrative diagnosis) with the per-hour synthesis-call budget cap from §10.2.
- Add Class C (trend detection over rolling 7-day / 30-day baselines).
- Build the `/admin/routing/health` dashboard per §10.4 (server-rendered v1).

### 7.9 Phase I: Rate-limit recovery formalization

- Implement the `rate_limited → recovering → active` algorithm per §11 in full.
- Add exponential cooldown backoff, dampening multiplier with decay, and provider-shared quota awareness per §11.5.
- Add property tests and simulation tests per §11.7. The recovery state machine is high-stakes; coverage gates the phase's completion.

### 7.10 Phase J: Cost ledger — universal token capture

- Wire `recordTokenUsage()` through every dispatch path including CLI adapters per §12.1.
- Add the `metered()` wrapper to enforce the invariant at module boundary.
- Backfill: a one-time migration that writes synthetic `TokenUsage` rows for recent `OutcomeEvent` data where adapter output included token counts. (Optional; primarily for trend continuity.)

### 7.11 Phase K: Cost ledger — subscription quotas, agent budgets, build accrual

- Schema migration for `SubscriptionQuotaWindow`, `AgentBudgetLedger`, additive cost fields on `FeatureBuild` per §12.
- Cost ledger component subscribes to outcome events and updates all three.
- Boot invariants for pricing per §12.7.
- Budget-exhaustion check in the data plane per §12.4.

### 7.12 Phase L: Cost observability surfaces

- Cost ribbon on the routing health dashboard.
- Per-build cost in Build Studio's existing build detail view.
- Per-agent budget status in the agent registry view.
- Prometheus gauges for subscription quota consumption.

### 7.13 Sequencing and Dependencies

```text
A → B → C → D → E → F            (correctness substrate)
            ↓
            G → H                 (operability — depends on FIB existing)
            ↓
            I                     (recovery — depends on state machine being authoritative)
            ↓
            J → K → L             (cost — J can start any time; K and L need the ledger from J)
```

Each phase is independently shippable, behind a feature flag, and reversible. Phase A alone delivers operability gains (RIB inspection). Phases B and C deliver correctness gains (no more direct status writes, no more discovery-by-failure). Phase E delivers performance gains (no per-request DB joins). Phase F is cleanup. Phases G-I deliver active observability and safe recovery. Phases J-L deliver financial visibility and budget enforcement.

**Note on §6.5 (burn-rate scoring) phasing.** Burn-rate scoring requires the `SubscriptionQuotaWindow` table and the empirical-cap learning loop, both of which land in Phase K. Until Phase K ships, §6.5's bonus/penalty terms degrade gracefully to a no-op (`regime: 'unknown'` returns 0 from the scoring delta — see §12.2.1 bootstrap rules). The architecture is correct without Phase K; it merely lacks the use-it-or-lose-it preference until the cost ledger lands. This is intentional: the routing-correctness substrate (Phases A-F) ships and stabilizes before any pricing-aware logic activates.

Estimated cadence: one phase per week with active development, allowing for review and stabilization. Twelve weeks end-to-end if uninterrupted; expect 14-18 with normal interruptions. Phases can overlap where dependencies allow — J and K (cost) can run in parallel with G and H (watchdog) once D (FIB) lands.

## 8. Invariants and Observability

### 8.1 Invariants Enforced at Boot

- Every `PLATFORM_TOOLS` entry has a `TOOL_TO_GRANTS` mapping. (Cross-cutting; not strictly routing, but the same architectural family of bug.)
- Every active provider in the catalog has a corresponding state machine entry in the RIB.
- Every RIB entry's `state` is a valid `EndpointState`.
- Every endpoint's `qualityTier` derives from `assignTierFromModelId(modelId)` or is explicitly admin-overridden in policy. No hand-set tiers in the catalog.
- No two endpoints share the same `(providerId, modelId)` pair.
- The legacy `ModelProfile.capabilityTier` column (LLM-grading vocabulary: `deep-thinker`/`fast-worker`/`specialist`/`budget`/`embedding`) is unused by routing. Phase B retires it: the column is renamed `capabilityCategory` (its actual purpose — friendly categorization for admin UI, not routing decisions) and the routing layer reads only `qualityTier`. This eliminates the parallel-vocabulary drift surface identified in attempts 16-17.

Boot fails with a clear error message if any invariant is violated. This is the structural prevention of the drift class.

### 8.2 Observable State

The control plane exposes:

- Current RIB snapshot (admin endpoint).
- Current FIB snapshot (admin endpoint).
- Last 100 state transitions per endpoint (audit endpoint).
- Last N outcome events (audit endpoint).
- FIB generation number, last compile time, last compile duration.
- Rate of probe calls vs. real calls (operational metric).

These replace the current ad-hoc "look at logs and guess" debugging path that consumed several hours tonight.

### 8.3 Failure Modes

- **All endpoints in a candidate pool are unhealthy.** FIB lookup throws `NoEligibleEndpointsError` carrying: the `RequestKey`, the per-stage filter elimination counts (so the operator can see "12 candidates entered, 9 dropped at capability filter, 3 dropped at sensitivity, 0 remained"), and the FIB `generation`. Callers MUST NOT silently substitute a default endpoint — the contract is "no eligible route is a hard failure, surfaced to the operator." A separate, named `requestEmergencyRoute(reason)` API exists for callers (notably the watchdog) that need a guaranteed best-effort path; it is audited as an emergency dispatch and not equivalent to a normal route.
- **Control plane crashes / restarts.** State machine state is recoverable from the persisted `ModelProvider.status` and recent `RouteOutcome` rows. The probe daemon resumes; FIB recompiles on first event.
- **FIB generation lags reality.** Mitigated by the debounce cadence and event-driven recompile; in practice, FIB is fresh within seconds of any state change. The data plane outcome feedback closes the loop within one request if the FIB is wrong.
- **Outcome events drop.** Best-effort delivery to the audit table; in-memory aggregator is authoritative for routing. A dropped outcome event slightly skews the success-rate average; impact is bounded.
- **Provider catalog drift after deploy.** Boot invariants catch most cases. Runtime catalog changes (admin adds a new provider) trigger an explicit `catalog_changed` event that recompiles the FIB.

## 9. What This Design Does Not Address

Explicit non-coverage, in priority order for follow-up specs:

1. **Artifact provenance / fakery prevention.** The `verificationOut`-fabrication problem is at the artifact-acceptance layer, not the routing layer. Needs a separate "tool-call receipts as evidence" design where `saveBuildEvidence` requires a receipt token from a real tool execution.
2. **Capability-derived grants.** The static-grants-per-agent model continues to be a drift surface. Replacing it with a capability-declaration → required-capability matching model is a separate design.
3. **Master Data Management for agent identifiers.** The `agent_id` / `agentId` / `cuid` triple-identifier problem persists. Single canonical key with explicit translation at edges is its own refactor.
4. **Build phase state machine.** The build lifecycle (`ideate → plan → build → review → ship`) is implicit string comparison today. Making it an explicit state machine with guards on each transition is a separate spec, structurally similar to the endpoint state machine here.
5. **Cross-process control plane.** This design assumes the control plane is in-process. If DPF horizontally scales, the control plane needs externalization (Redis-backed RIB, atomic FIB swaps via versioned keys). Out of scope until horizontal scaling is a near-term need.
6. **Policy-as-code for routing rules.** Admin policy is currently DB-backed records. A policy engine (OPA, Cedar) might eventually be warranted; not yet.

## 10. Watchdog and Proactive Anomaly Detection

Passive observability — the ability to *look at* RIB/FIB state on demand — is necessary but insufficient. Production routing systems also need *active* anomaly detection: a process that watches the system and surfaces problems before a human notices via failed work. This section formalizes the watchdog component referenced in §3.

### 10.1 Architectural Position

The watchdog is **a routing client**, not a separate privileged process. It uses the same FIB the data plane uses, picks the cheapest non-rate-limited route for its own observation calls, and runs on a scheduled cadence. This has three properties:

1. **It eats its own dogfood.** If the routing system is broken, the watchdog can't run. The watchdog's *own* operability is itself a signal: a missed watchdog cycle is an alarm.
2. **It scales with the platform's existing budget classes.** When primary endpoints are healthy, the watchdog uses gemma (free, local). When gemma is down, it picks the cheapest remaining option. The watchdog's cost is a small, bounded fraction of total routing cost.
3. **It can synthesize narrative explanations.** Rule-based detectors fire structured alarms; an LLM call against the watchdog's chosen endpoint turns the structured alarm into operator-readable text ("Provider X has been recovering for 12 minutes — last error was `invalid_grant`. The OAuth token may have been revoked externally.").

**Bootstrap path when routing itself is broken.** The dogfood property has a failure mode: if the FIB compiler crashes or the FIB returns nonsensical chains, the watchdog using the FIB will dispatch into the same broken path it's meant to detect. The watchdog therefore maintains a hardcoded **bootstrap route** — a direct call to the local `gemma` adapter, bypassing FIB lookup — used only for Class A rule-based detectors when:

- FIB lookup throws,
- FIB `generation` has not advanced for >2× the debounce cadence, or
- the watchdog's last 3 cycles all reported divergent decisions vs. real traffic outcomes.

The bootstrap route never serves user traffic and is not a fallback for the data plane; it exists solely so the watchdog can keep firing alarms when the routing substrate it's watching has failed. Class B (LLM synthesis) and Class C (trend) detectors are skipped when the bootstrap route is active — a degraded watchdog still produces structured alarms, just without narrative.

### 10.2 Watchdog Cadence and Detectors

The watchdog runs on a scheduled task (Inngest cron or in-process timer). Default cadence: every 60 seconds for cheap detectors, every 5 minutes for synthesis-heavy ones, every hour for trend detectors.

Detectors fall into three classes:

**Class A — Pure rule-based, no LLM call.** Run on every cycle. Cheapest.

| Detector | Signal | Severity |
| --- | --- | --- |
| Endpoint stuck in transitional state | `recovering` or `configured` for >15 min | warning |
| Active endpoint never selected | `active` for >5 min, zero selections in routing window | warning |
| Routing decision claims X but dispatch ran Y | `RouteDecisionLog.selectedEndpointId` ≠ outcome event's `endpointId` | error |
| Disabled provider in candidate pool | RIB candidate has `state ∉ {active, degraded}` | critical |
| Outcome events not flowing | `count(OutcomeEvent in window) / count(dispatched calls) < 0.95` | critical |
| Endpoint flapping | >N state transitions per endpoint in M-minute window | warning, escalates if persists |
| All routes degraded | `count(state=active) == 0` | critical |
| FIB compile failures | last compile attempt threw, FIB is stale | critical |
| FIB lookup latency spike | p99 lookup_duration_ms above threshold | warning |
| Diagnostic-vs-real reconciliation mismatch | `Test connection` admin endpoint succeeds for provider X within last 5 min AND real-traffic outcome events from same provider show >50% rate-limit or auth-failure rate in same window | error |
| Hallucinated tool-use (NO-CALL-BUT-MENTIONED) | `[tool-trace]` log line shows `extracted=0 names=[] mentioned=[<tool>]` for any agent turn AND mentioned tool was in scope at that turn | warning, escalates to error if same agent does it 3× in 1 hour |
| Outcome event without metering row | `count(OutcomeEvent in window with success=true) − count(TokenUsage rows in window) > 5%` for non-zero-cost dispatch paths | error |

**Class B — LLM-augmented diagnosis.** Triggered only by Class A alarms or scheduled hourly trend reviews. The watchdog calls its chosen route with: structured alarm context + recent log slice + RIB excerpt, and asks the model to explain what likely happened and what to check. The output goes to the operator surface alongside the structured alarm.

Class B is bounded: maximum N synthesis calls per hour to prevent the watchdog itself from contributing to rate-limit pressure. If the watchdog's own route is rate-limited, synthesis is skipped — the structured alarm fires alone.

**Class C — Trend detection.** Runs hourly. Compares current-window aggregates against baselines (rolling 7-day or 30-day):

- Cost spike per agent / per task type / per provider
- Success rate regression on a specific `(endpoint, task_type)` pair
- Latency drift on a specific endpoint
- Quota burn rate vs. subscription window

Trend regressions surface to the operator as `RoutingAnomaly` rows with `class: "trend"` and a comparison summary.

### 10.3 Anomaly Persistence

Every detector firing (regardless of class) writes a `RoutingAnomaly` row:

```typescript
interface RoutingAnomaly {
  id: string;
  detectedAt: Date;
  detectorName: string;
  class: 'rule' | 'llm-diagnosis' | 'trend';
  severity: 'info' | 'warning' | 'error' | 'critical';
  endpointId?: string;       // when the anomaly is endpoint-scoped
  providerId?: string;       // when provider-scoped
  agentId?: string;          // when agent-scoped
  contextSnapshot: Json;     // the structured payload the detector saw
  narrativeExplanation?: string;  // populated by Class B if applicable
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  resolvedAt?: Date;
  resolutionNotes?: string;
}
```

The table lives in the same schema as `RouteOutcome` and `RouteDecisionLog`. Retention: 90 days for `info`/`warning`, 1 year for `error`/`critical`.

### 10.4 Operator Surface

A new admin page at `/admin/routing/health` shows:

- **Endpoint health grid.** Each endpoint with: current state, time-in-state, recent success rate, recent latency, dampening multiplier, last probe outcome. Color-coded by state.
- **Active anomalies.** Unresolved `RoutingAnomaly` rows ordered by severity then time. Click to expand structured payload + narrative.
- **State transition timeline.** Last 24h of transitions per endpoint, visualized as a horizontal timeline. Operators can see "this endpoint flapped at 03:14, 03:21, 03:33" without reading logs.
- **FIB summary.** Top routes per task type, current ECMP groups, fallback chain depth distribution.
- **Cost ribbon.** Today's spend across providers, with per-agent breakdown drawer (links to §13).
- **Watchdog status.** Last successful watchdog cycle timestamp, route used, synthesis-call budget remaining.

The page is server-rendered. No client-side polling for v1; operators refresh manually. Real-time SSE update is a v2 enhancement.

### 10.5 Alarm Routing

Critical and error anomalies should reach the operator out-of-band, not just on the dashboard. Reuse the existing notification surface (whatever path notifies on failed builds). Severity → channel mapping:

| Severity | Channel |
| --- | --- |
| `info` | Dashboard only |
| `warning` | Dashboard + activity feed |
| `error` | Dashboard + activity feed + email if persistent (>15 min unresolved) |
| `critical` | Dashboard + activity feed + email immediately |

The mapping is admin-configurable via existing notification settings; defaults are sensible.

### 10.6 Watchdog as Documentation

A useful side-effect: the set of detectors *is* the documentation of what "healthy routing" means. Every detector encodes an invariant. Reading the detector list tells a new operator (or a new agent) what the system considers normal vs. broken. This is more durable than prose documentation because the detectors are tested code; if a detector becomes wrong, it fails its own tests rather than silently rotting.

## 11. Rate-Limit Recovery Semantics

Section 3.3 introduced the `rate_limited → recovering → active` transitions abstractly. This section formalizes the recovery algorithm with the specific guarantees the system needs: no thundering herds, no flap loops, no premature re-promotion, and provider-shared quota awareness.

### 11.1 Rate-Limit Detection

The data plane observes a rate-limit response when an adapter returns `InferenceError.code === 'rate_limited'` or an HTTP `429`, or when a structured error matches the provider's documented rate-limit signal (Anthropic's `Retry-After`, OpenAI's `x-ratelimit-reset-tokens`, etc.).

On observation, the data plane:

1. Emits an `OutcomeEvent` with `rateLimited: true`, `retryAfterMs: <parsed>`, `errorClass: "rate_limit"`.
2. Continues fallback dispatch using the next chain entry — the original request is not dropped.
3. Does *not* directly mutate any state. The control plane processes the event and decides what state changes to make.

### 11.2 Cooldown Calculation

The control plane's reaction to a rate-limit event:

```text
on rate_limit_received(endpoint, retryAfterMs):
  baseCooldownMs = retryAfterMs ?? defaultCooldownFor(endpoint.providerId)
  # Exponential backoff: each consecutive rate-limit event extends cooldown
  effectiveCooldownMs = baseCooldownMs * (2 ^ endpoint.consecutiveRateLimits)
  effectiveCooldownMs = min(effectiveCooldownMs, MAX_COOLDOWN_MS)  # cap at 1 hour
  # Jitter ±20% to prevent thundering-herd: when 9 siblings on a shared quota
  # all enter cooldown at the same instant, un-jittered timers expire in lockstep
  # and produce a synchronized probe burst that can re-trigger rate-limiting.
  jitterFactor       = randomInRange(0.8, 1.2)
  effectiveCooldownMs = effectiveCooldownMs * jitterFactor
  endpoint.rateLimitResetAt = now + effectiveCooldownMs
  endpoint.consecutiveRateLimits += 1
  endpoint.state = 'rate_limited'
  endpoint.dampeningMultiplier = clamp(endpoint.dampeningMultiplier * 0.5, MIN_DAMPENING, 1.0)
  persistRecoveryState(endpoint)  # see 11.8 — survives process restart
  applyToProviderSiblings(endpoint, ...)  # see 11.5
  scheduleCooldownTimer(endpoint, endpoint.rateLimitResetAt)
  emitStateTransition(...)
```

Defaults:

- `MIN_DAMPENING = 0.1` — even badly-flapping endpoints retain 10% of their nominal fitness, so they're never permanently excluded.
- `MAX_COOLDOWN_MS = 3_600_000` (1 hour) — sanity cap so an endpoint can't be parked indefinitely.
- `defaultCooldownFor(providerId)` — provider-specific defaults: Anthropic 60s, OpenAI 60s, Google 30s, others 120s.

`consecutiveRateLimits` resets to 0 after `DAMPENING_DECAY_PERIOD` of stable operation (default 5 minutes in `active`). This means a provider that rate-limits once recovers fully; one that rate-limits repeatedly stays penalized.

### 11.3 Cooldown Expiration and Probe-Based Recovery

When the cooldown timer fires:

```text
on cooldown_expired(endpoint):
  if endpoint.state != 'rate_limited':
    return  # state moved for some other reason; ignore
  endpoint.state = 'recovering'
  endpoint.consecutiveSuccesses = 0
  emitStateTransition(...)
  triggerProbe(endpoint)  # immediate probe
```

The endpoint does *not* go straight back to `active`. It enters `recovering`, where:

- It is **not** in the FIB candidate pool. Real traffic does not select it.
- A probe is fired immediately, then on a 30s cadence until N consecutive probes succeed.
- `REQUIRED_RECOVERY_PROBES = 2` (default) — must succeed twice in a row.
- On any probe failure during recovery: endpoint goes back to `rate_limited` with doubled cooldown (per 11.2's exponential backoff).

```text
on probe_succeeded(endpoint):
  if endpoint.state == 'recovering':
    endpoint.consecutiveSuccesses += 1
    if endpoint.consecutiveSuccesses >= REQUIRED_RECOVERY_PROBES:
      endpoint.state = 'active'
      # dampening multiplier persists; decays over DAMPENING_DECAY_PERIOD
      scheduleDampeningDecay(endpoint)
      emitStateTransition(...)
  elif endpoint.state == 'degraded':
    # similar logic, transitions to active after consecutive successes
    ...

on probe_failed(endpoint):
  if endpoint.state == 'recovering':
    # didn't actually recover — back to rate_limited with longer cooldown
    rate_limit_received(endpoint, retryAfterMs=lastCooldownMs * 2)
```

### 11.4 Dampening Decay

Once back in `active`, the dampening multiplier persists and applies to fitness scores during compilation. It decays linearly over `DAMPENING_DECAY_PERIOD` (default 5 minutes) of *uninterrupted* `active` operation. If another rate-limit fires during decay, the multiplier halves again from its *current* (decayed) value, so the endpoint can take many decay cycles to fully recover preference if it keeps flapping.

This is **route flap dampening** as BGP defines it. The mathematical effect: a once-flapping endpoint is back in service quickly but ranked below stable peers; a chronically-flapping endpoint is structurally deprioritized until it proves stable for a long window.

### 11.5 Provider-Shared Quota Recovery

For providers with shared quota across multiple model endpoints (canonical case: Anthropic Claude Max subscription with 9 model endpoints):

```
applyToProviderSiblings(endpoint, ...):
  quota = endpoint.providerQuota
  if quota is null or len(quota.siblings) == 1:
    return  # no shared quota
  for sibling in quota.siblings:
    if sibling.state == 'active':
      sibling.state = 'rate_limited'
      sibling.rateLimitResetAt = endpoint.rateLimitResetAt
      sibling.dampeningMultiplier = endpoint.dampeningMultiplier  # share the penalty
      emitStateTransition(sibling, ...)
```

When the provider's cooldown expires, **one probe per provider** is sufficient — not one probe per sibling. The probe targets the provider's lightest model (e.g., Claude Haiku for Anthropic). On success, *all* siblings transition `rate_limited → recovering` together, and individual probes run for each as they enter recovering. On the recovery side this means N siblings × M probes = N×M probe calls during recovery, which is acceptable because the cost is bounded and the benefit (knowing which specific models are responding) is operational.

Why not just transition everyone to `active` on the single probe success? Because a subscription quota recovery doesn't guarantee every model on that subscription works. Auth could be selectively revoked, a specific model could be in maintenance, etc. The shared-quota optimization applies to the *quota gate*, not to the *individual model health* gate.

### 11.6 Manual Override

Operators can:

- Force an endpoint out of `rate_limited` immediately (sets `rateLimitResetAt = now`, schedules immediate probe).
- Pin an endpoint as permanently `retired` regardless of probe outcomes.
- Reset all dampening multipliers to 1.0 (use after a known external incident resolves).

Manual override events are audited (`RouteAuditEntry` with `actor: <userId>`) and surface on the routing health dashboard.

### 11.7 Recovery State Persistence Across Restarts

`consecutiveRateLimits`, `dampeningMultiplier`, and `rateLimitResetAt` live on the in-memory `RIBEntry` (§5.1) and are lost on process restart. Without persistence, a flapping endpoint with `consecutiveRateLimits = 4` looks fresh after a redeploy, exponential backoff resets to 0, the next 429 produces a 60-second cooldown instead of 16-minute cooldown, and the system enters a faster flap loop than it was already in.

The control plane therefore persists recovery state to a small `EndpointRecoveryState` row at every state transition that mutates these fields. On boot, the RIB rehydrates `consecutiveRateLimits`, `dampeningMultiplier`, and `rateLimitResetAt` from this table. If `rateLimitResetAt` is in the past at boot, the endpoint enters `recovering` immediately and a probe is scheduled. If in the future, the cooldown timer is restored.

```prisma
model EndpointRecoveryState {
  endpointId            String   @id
  consecutiveRateLimits Int      @default(0)
  dampeningMultiplier   Float    @default(1.0)
  rateLimitResetAt      DateTime?
  consecutiveSuccesses  Int      @default(0)
  consecutiveFailures   Int      @default(0)
  updatedAt             DateTime @updatedAt
}
```

The persistence write is on the rate-limit hot path; it must not block dispatch. The `persistRecoveryState()` call is fire-and-forget (the in-memory state is authoritative until next boot), with the next event flushing again. A persistence failure is logged but does not propagate.

`§8.3` — "control plane crashes / restarts" — is updated by this section: the recovery substate, not just the lifecycle state, is recoverable.

### 11.8 Test Coverage Required

The recovery state machine is high-stakes — bugs cause cascading routing failures. Required test classes:

- **Unit tests** for each transition rule with explicit before/after state.
- **Property tests**: for any sequence of `(rate_limit, probe_success, probe_fail, cooldown_expire)` events, the endpoint state must remain valid (no `consecutiveSuccesses` going negative, no `dampeningMultiplier` outside [MIN_DAMPENING, 1.0], no impossible state combinations).
- **Simulation tests**: 24-hour traffic simulation with random rate-limit injection; verify no endpoint gets permanently stuck and total throughput stays within expected bounds.
- **Integration tests**: end-to-end with real adapter mocks returning 429s on configurable cadences; verify the recovery loop completes.

## 12. Cost and Quota Capture

The current install demonstrates the cost-tracking gap concretely: in a 12-hour window with at least 30+ Anthropic Claude calls, the `TokenUsage` table contains a single row — for gemma. The CLI adapter path (Claude CLI subprocess, Codex CLI subprocess) bypasses the `recordTokenUsage()` call in `ai-inference.ts`. Subscription pricing is set to $0, so even if the call fired, dollar values would be zero. There is no per-build cost rollup, no per-agent budget visibility, and no subscription quota tracking distinct from $.

This section closes those gaps.

### 12.1 Universal Token Usage Capture

**Every dispatch path must persist a `TokenUsage` row.** This is a hard invariant: a successful or failed inference call without a corresponding `TokenUsage` row is a metering bug.

Affected dispatch paths:

| Path | Current state | Required change |
| --- | --- | --- |
| Direct HTTP (`callProvider` in `ai-inference.ts`) | Persists ✓ | None |
| Claude CLI subprocess (`cli-adapter.ts`) | Does NOT persist | Add `recordTokenUsage()` call after each completion |
| Codex CLI subprocess (`codex-cli-adapter.ts`) | Does NOT persist | Add `recordTokenUsage()` call after each completion |
| MCP service calls (browser-use, filesystem, etc.) | N/A — no LLM cost | No change; these are not LLM calls |
| Local Docker Model Runner | Persists ✓ (cost = 0 by design) | None |

The CLI adapters return `inputTokens` and `outputTokens` in their result type (already exists in `fallback.ts`). The fix is to wire those through to `recordTokenUsage()`, not to add new instrumentation. Implementation: a thin `metered()` wrapper applied to all adapter results before they leave the routing module.

**A wrapper alone is a convention, not an enforcement.** The runtime invariant is the OutcomeEvent bus: every `OutcomeEvent` with `success: true` (and every `success: false` event whose `errorClass` indicates the upstream call was actually billed — partial generations, post-stream errors, etc.) MUST be paired with a `TokenUsage` write keyed by the same `eventId`. The cost-ledger consumer of the OutcomeEvent bus checks for the paired `TokenUsage` row within a small window (default 30s) and emits a `RoutingAnomaly` (severity `error`) for every event missing its meter. This makes the §10.2 "outcome event without metering row" detector the *primary* enforcement mechanism — the wrapper is the convenience layer that makes the invariant easy to satisfy; the bus check is what catches new dispatch paths that forget it.

### 12.2 Subscription Quota Tracking

Subscription-priced providers (Anthropic Claude Max, OpenAI ChatGPT subscription, Google Gemini Advanced when used as subscription) have flat-rate billing in $ but **rolling token budgets** in operationally meaningful units. The schema needs separate tracking:

```prisma
model SubscriptionQuotaWindow {
  id              String   @id @default(cuid())
  providerId      String
  windowStartsAt  DateTime  // start of the rolling window
  windowEndsAt    DateTime  // end of the rolling window
  windowKind      String    // 'rolling-5h' | 'daily' | 'monthly' — provider-specific
  inputTokens     Int       @default(0)
  outputTokens    Int       @default(0)
  callCount       Int       @default(0)
  rateLimitHits   Int       @default(0)
  estimatedCapTokens  Int?  // best-known cap for this subscription tier, if known
  updatedAt       DateTime  @updatedAt

  @@index([providerId, windowEndsAt])
  @@unique([providerId, windowStartsAt, windowKind])
}
```

The control plane's observation aggregator updates `SubscriptionQuotaWindow` on every outcome event for subscription providers. The watchdog (§10) surfaces "X% of subscription window consumed" as both a dashboard metric and a trend-detector input ("at current rate, you'll exhaust the window in N minutes").

When a rate-limit hits and `estimatedCapTokens` is unknown, the control plane records `inputTokens + outputTokens` at that moment as a *lower bound* on the cap and updates `estimatedCapTokens` accordingly. Over time this learns the actual subscription limit empirically.

### 12.2.1 Burn-Rate Computation and Use-It-or-Lose-It Logic

The cost ledger is responsible for deriving the `burn_rate_score` referenced in §6.5 and exposing it to both the routing scorer and the operator dashboard. The computation is a pure function of the current `SubscriptionQuotaWindow` state plus a clock:

```text
function computeBurnRate(window: SubscriptionQuotaWindow, now: Date): BurnRateState {
  const totalDurationMs   = window.windowEndsAt - window.windowStartsAt
  const elapsedMs         = now - window.windowStartsAt
  const elapsedFraction   = elapsedMs / totalDurationMs

  const tokensConsumed    = window.inputTokens + window.outputTokens
  const cap               = window.estimatedCapTokens ?? null

  if (cap === null) {
    return { regime: 'unknown', score: null, projectedFinalConsumption: null }
  }

  const consumedFraction  = tokensConsumed / cap
  const score             = elapsedFraction > 0 ? consumedFraction / elapsedFraction : 0

  // Projected final consumption assuming current burn rate continues:
  const currentRatePerMs  = elapsedMs > 0 ? tokensConsumed / elapsedMs : 0
  const projectedFinal    = currentRatePerMs * totalDurationMs
  const projectedFraction = cap > 0 ? projectedFinal / cap : 0

  let regime: BurnRateRegime
  if (score < 0.85)       regime = 'lagging'
  else if (score > 1.15)  regime = 'ahead'
  else                    regime = 'on_track'

  return { regime, score, projectedFinalConsumption: projectedFraction }
}
```

The result is cached per-window with a short TTL (default 30 seconds) — the inputs change only on outcome events, so re-deriving on every routing call is wasted work. When an outcome event fires for a subscription provider, the cache is invalidated and the next routing decision picks up the fresh value.

**Hysteresis edge case:** when a window resets (the `now > window.windowEndsAt` boundary), the cost ledger creates a new `SubscriptionQuotaWindow` with `windowStartsAt = now` and zero consumption. For the first ~60 seconds of a fresh window, `score` is undefined or wildly volatile (a single call against zero elapsed time gives a divide-by-zero or absurd ratio). The implementation must apply a warmup floor: for `elapsedFraction < 0.01` (i.e., first ~1.6 hours of a 7-day window, or first ~9 minutes of a daily window), the regime defaults to `on_track` regardless of score. This avoids spurious `ahead` classifications immediately after window reset.

### 12.2.2 Subscription Inspection Tool for Agents

A new MCP tool `get_subscription_status` lets agents introspect their own routing context's subscription headroom when planning multi-step work:

```text
tool: get_subscription_status
required_grant: routing_read
parameters:
  providerId?: string  // optional; if omitted, returns all subscription providers
returns:
  [
    {
      providerId,
      windowKind,
      windowStartsAt, windowEndsAt,
      tokensConsumed, estimatedCapTokens,
      consumedFraction, elapsedFraction,
      burnRateScore, burnRateRegime,
      projectedFinalConsumption,
      surplusOrDeficit: estimatedCapTokens * (1 - projectedFinalConsumption),  // tokens forecast to be unused (positive) or over (negative)
      timeToWindowEndMs
    },
    ...
  ]
```

The tool is read-only, requires only `routing_read` (a new minimal grant), and is safe for any agent to call. The intended pattern: an agent that's about to embark on a multi-step task checks subscription state, and chooses task scope accordingly. If a frontier-tier subscription is lagging, the agent can confidently choose the deepest analysis (more turns, more reasoning) — that's exactly the consumption pattern that converts surplus quota into delivered value. If subscription is ahead, the agent picks a tighter scope and prefers token-priced fallbacks to preserve quota for higher-priority work.

**This is not "burn quota for the sake of burning."** The tool returns *information*; the agent's prompt and skills determine whether to act on it. The intent is the inverse of the verificationOut-fakery failure mode: instead of generating fictional output to satisfy a metric, the agent picks *real harder problems* when surplus capacity exists. Audit (every call writes `TokenUsage` per §12.1) makes the agent's actual output reviewable; the watchdog flags low-information-density bursts as anomalies.

### 12.2.3 Use-It-or-Lose-It Anomalies

The watchdog (§10) gains two new detectors specifically for subscription utilization:

| Detector | Signal | Severity | Action |
| --- | --- | --- | --- |
| Subscription end-of-window underutilization | `burnRateRegime == 'lagging'` AND `timeToWindowEndMs < 25% of windowDuration` | warning | Surface to operator: "X% of subscription will go unused in N hours unless utilization increases" |
| Subscription mid-window over-consumption | `burnRateRegime == 'ahead'` AND `projectedFinalConsumption > 1.0` AND `timeToWindowEndMs > 25% of windowDuration` | warning | Surface to operator: "At current rate, subscription will hit hard rate-limit at `<projected time>`" |

Both detectors run on the watchdog's normal cadence and emit `RoutingAnomaly` rows. They're deliberately advisory rather than gating — the operator decides whether to redirect work, not the platform. The mid-window over-consumption case may also trigger an automatic adjustment to the scoring weights for that provider (the `SUBSCRIPTION_LEAD_PENALTY_WEIGHT` from §6.5), throttling the burn rate without operator action; this is configurable per-provider in policy.

### 12.3 Per-Build Cost Accrual

`FeatureBuild` should carry a running cost total, accrued from every `TokenUsage` row whose `contextKey` matches the build's identifier or whose thread is linked to the build:

```prisma
// Additive to existing FeatureBuild model
model FeatureBuild {
  // ... existing fields ...
  costAccruedUsd      Float    @default(0)
  inputTokensConsumed  Int      @default(0)
  outputTokensConsumed Int      @default(0)
  costLastUpdatedAt    DateTime?
}
```

The accrual is computed by the cost ledger (§12.5) on every `TokenUsage` write whose `contextKey` resolves to a build. Updates are eventually-consistent (small lag is acceptable for cost display); the authoritative number can always be recomputed from `TokenUsage` rows via aggregation.

This addresses the "build runs for hours and nobody notices the spend" failure mode. Build Studio's UI can display "$X spent on this build so far," and the watchdog can alarm on builds whose accrual exceeds a threshold without a corresponding artifact (silent burn).

### 12.4 Per-Agent Cost Rollup

Agents already carry an `AgentExecutionConfig.tokenBudget` field declaring a daily limit. Today nothing enforces or even *measures* against that limit. The cost ledger closes this:

```prisma
model AgentBudgetLedger {
  id              String   @id @default(cuid())
  agentId         String
  windowStartsAt  DateTime
  windowKind      String    // 'daily' | 'monthly'
  inputTokens     Int       @default(0)
  outputTokens    Int       @default(0)
  costUsd         Float     @default(0)
  callCount       Int       @default(0)
  budgetLimitTokens Int?    // copy of AgentExecutionConfig.tokenBudget at window start
  budgetLimitUsd  Float?    // future: $-denominated budgets
  exhausted       Boolean   @default(false)
  updatedAt       DateTime  @updatedAt

  @@index([agentId, windowEndsAt])
  @@unique([agentId, windowStartsAt, windowKind])
}
```

When `(inputTokens + outputTokens)` exceeds `budgetLimitTokens` for the current window, `exhausted = true`. **The data plane does not query the DB to enforce this** — that would violate §3.5's "no DB joins on the request path." Instead, the cost ledger publishes an in-memory `AgentBudgetSnapshot` keyed by `agentId`, updated on every cost-event and on window rollover. The data plane reads the snapshot via O(1) map lookup. Snapshot freshness is bounded by the cost-event cadence — typically sub-second; over-spend by at most one in-flight call when crossing the threshold, which is acceptable for budget enforcement (the alternative — synchronous DB read per dispatch — re-introduces the per-request hot-path I/O the architecture is built to eliminate).

When the snapshot reports `exhausted = true`, the data plane refuses to route and returns a structured `AgentBudgetExhaustedError`. Operator sees the alarm via the watchdog.

For v1, exhaustion behavior is configurable per-agent: `'block' | 'warn' | 'continue'`. Most agents block. Critical agents (the watchdog itself, system administrators) continue with a warning.

### 12.5 The Cost Ledger Component

The cost ledger is a logical component (could be implemented as a single module or a service) that owns:

- Reading `TokenUsage` writes via the outcome event bus.
- Updating `SubscriptionQuotaWindow` rows for subscription providers.
- Updating `AgentBudgetLedger` rows for the agent making the call.
- Updating `FeatureBuild.costAccruedUsd` when the call's `contextKey` resolves to a build.
- Emitting `BudgetAlarm` events when thresholds are crossed (80%, 95%, 100% of any tracked budget).
- Exposing query surfaces for the operator dashboard (per-provider, per-agent, per-build, per-window aggregations).

The cost ledger is a *consumer* of outcome events, not a producer of routing decisions. It does not gate dispatch (except the budget-exhaustion check in §12.4). Its writes are eventually-consistent with the routing path.

### 12.6 Pricing Configuration

Today, `ModelProvider.inputPricePerMToken` and `ModelProvider.outputPricePerMToken` carry per-million-token pricing. This works for token-priced providers but breaks for subscription-priced ones (currently set to 0).

The fix: add a `pricingModel` discriminator already present in the schema (`costModel` field, currently `'token' | 'compute'`) and extend it with `'subscription' | 'flat-rate'`. Pricing-model handlers compute effective $-cost differently:

| `pricingModel` | Cost calculation |
| --- | --- |
| `token` | `(inputTokens × inputPrice + outputTokens × outputPrice) / 1_000_000` |
| `compute` | `inferenceMs × computeWatts × electricityRateKwh / (1000 × 3600 × 1000)` (existing local model logic) |
| `subscription` | `0` for $-tally; `inputTokens + outputTokens` charged against the subscription quota window |
| `flat-rate` | Future: monthly fixed amount, amortized per call |

For subscription providers, the `$-cost` reported is genuinely zero (the marginal cost of each call is zero). What the operator needs to know is **quota consumption**, not $. The dashboard surfaces both: "$X spent (token-priced calls only) + Y% of Z subscription windows consumed (subscription-priced calls)."

### 12.7 Boot Invariants for Pricing

To prevent "pricing was forgotten on a new provider config" silently producing $0 metering:

- Every active LLM provider must have a non-null `pricingModel`.
- If `pricingModel == 'token'`, both `inputPricePerMToken` and `outputPricePerMToken` must be non-null and non-negative.
- If `pricingModel == 'subscription'`, `subscriptionWindowKind` must be set.
- If `pricingModel == 'compute'`, `computeWatts` and `electricityRateKwh` must both be non-null.

Boot fails with a clear message when violated.

### 12.8 Observability

The operator dashboard (referenced in §10.4) surfaces:

- **Today's spend** broken down by provider, agent, and task type. Drill-down to per-call.
- **Subscription windows** as gauges showing % consumed, time until reset, projected exhaustion at current rate.
- **Per-build cost** in Build Studio's existing build detail view.
- **Agent budget status** in the agent registry view: current window consumption vs. limit.
- **Cost trend charts** (last 7d, last 30d) per provider and per agent.

Existing Prometheus metric `aiInferenceCostUsd` continues to fire on every call; it's the only metric that today reflects routing cost. Adding new gauges for subscription quota consumption gives operations a Prometheus-native view of subscription burn rate.

## 13. Summary

The routing subsystem has the same architectural shape as 1990s-era network routing: a population of endpoints, each with a lifecycle state, with paths to be selected based on current observed reality and operator policy. Network routing solved this thirty-five years ago by separating the control plane from the data plane and by making endpoint state derived from observation rather than configuration. This design adopts that proven separation, adapted to the LLM-routing parameter set.

The current DPF implementation conflates intent, reality, and policy into the same tables, read by the same per-request code path. It pays for this in the bug class repeatedly observed across at least ten prior fix attempts: configuration drift between intent and reality going silently undetected. This spec ends that pattern by making drift structurally impossible — there is no separate "configured value" that can disagree with reality, because runtime state is *derived* from observation, not stored independently.

The architecture has four components:

- **Control plane** (§3.1, §4) — long-running, in-process. Owns the RIB and compiles it into the FIB. Reads catalog (intent), probes (reality), and policy (preference). One job: keep the FIB honest.
- **Data plane** (§3.5) — fast and dumb per-request lookup. Consults the FIB, dispatches the call, reports outcomes. No DB joins, no scoring, no state mutations.
- **Watchdog** (§10) — proactive anomaly detection. Runs as a routing client itself, using the cheapest non-rate-limited route for its own observation calls. Class A detectors (rule-based) fire on every cycle; Class B (LLM-augmented) provide narrative explanations; Class C (trends) catch slow regressions.
- **Cost ledger** (§12) — universal token capture across every dispatch path including CLI subprocess adapters. Per-build accrual, per-agent budgets with enforcement, subscription quota tracking distinct from $.

Each component is independently shippable. The 12-phase migration (§7) takes about 12 weeks of focused work, with phases A-F delivering routing correctness, G-H delivering operability, I delivering safe rate-limit recovery, and J-L delivering cost visibility and budget enforcement. Phases can overlap where dependencies allow.

The DPF-specific work is the multi-dimensional scoring function (§6) and the provider-shared quota modeling (§6.4 and §11.5) — domain logic without a networking analog. Everything else — control/data plane separation, RIB/FIB compilation, state machines with explicit transitions, dampening on flapping endpoints, ECMP for load distribution, watchdog as a routing client — is well-understood prior art adapted to the LLM-routing problem.

This is a complete specification. No follow-up spec is needed to make the routing subsystem ship-ready, observable, and financially accountable. The §9 deferred items (artifact provenance, capability-derived grants, agent-identifier MDM, build phase state machine) are *separate concerns* that share the same architectural disease but are not blocked by — and do not block — this work.
