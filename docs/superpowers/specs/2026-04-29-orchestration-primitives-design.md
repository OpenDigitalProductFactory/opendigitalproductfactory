# Orchestration Primitives Design

| Field | Value |
| --- | --- |
| Status | Draft for review |
| Created | 2026-04-29 |
| Author | Claude (Opus 4.7) + Mark Bodman |
| Primary audience | Platform architecture, AI runtime, Build Studio orchestration, governance |
| Related repo areas | `apps/web/lib/tak/*`, `apps/web/lib/integrate/*`, `apps/web/lib/routing/*`, `apps/web/lib/queue/functions/*` |
| Related standards | `TAK`, `GAID`, `A2A`, Google ADK workflow agents |
| Distinct from | Inngest durable retries, task-envelope redesign, UI redesign, OpenTelemetry export |

## Purpose

Introduce a small, governed orchestration runtime for DPF with four explicit primitives:

- `Sequential`
- `Parallel`
- `Loop`
- `Branch`

The goal is not to rename existing control flow. The goal is to remove three recurring failure classes that the current repo still allows:

1. silent exhaustion or silent downgrade at retry boundaries
2. inconsistent event visibility for long-running work
3. budget and patience rules scattered across inline constants instead of flowing from governance posture

This spec defines the in-process orchestration layer only. It does not replace Inngest's durable execution model, and it does not redesign the A2A-shaped task envelope that already has its own spec.

## Executive Decision

DPF should add a new `apps/web/lib/orchestration/` module that owns four deterministic primitives, typed outcomes, typed orchestration events, and governance-derived runtime budgets. Existing ad hoc retry loops and fan-out code should migrate to that module in phases, with the riskiest migration (`agentic-loop.ts`) saved for the end.

The important architectural boundary is this:

- Inngest remains the durable outer shell for queued, resumable, cross-restart work.
- The new orchestration module becomes the single in-process control-flow layer used inside those durable shells and inside request-time agent execution.

That split keeps DPF honest about what is durable versus what is merely structured.

## Problem Statement

Today the repo expresses in-process retry, repetition, polling, and fan-out across multiple unrelated surfaces, each with different semantics for failure, visibility, and budgeting.

Verified examples in the current repo:

- `apps/web/lib/tak/agentic-loop.ts:486` uses a `for` loop with `MAX_ITERATIONS = 200` and several early exits. Some exits return explicit content, some `break`, and the max-iteration boundary falls back to prior content rather than a structured exhausted result.
- `apps/web/lib/integrate/build-orchestrator.ts:629` retries specialists with `MAX_SPECIALIST_RETRIES = 2`.
- `apps/web/lib/integrate/build-orchestrator.ts:912` runs phases sequentially with a raw `for` loop.
- `apps/web/lib/integrate/build-orchestrator.ts:950` fans out a batch with `Promise.all`.
- `apps/web/lib/integrate/build-orchestrator.ts:1036` retries optimistic result merging with `MAX_MERGE_RETRIES = 1`.
- `apps/web/lib/integrate/build-pipeline.ts:95` retries pipeline steps with `MAX_RETRIES` and `RETRY_DELAYS_MS`.
- `apps/web/lib/integrate/sandbox/sandbox-db.ts:50` and `:68` poll readiness/health with raw `while` loops.
- `apps/web/lib/integrate/github-fork.ts:105` polls fork creation and returns `{ status: "deferred" }` when the fork is not ready in time.
- `apps/web/lib/routing/fallback.ts:79` walks a fallback chain with explicit delay and retry behavior.
- `apps/web/lib/queue/functions/deliberation-run.ts:114` dispatches worker branches in sequence even though the domain concept is a branch set with later synthesis.

Separately, Inngest already provides durable retries and waits:

- `apps/web/lib/queue/functions/route-work-item.ts:66` uses `step.waitForEvent(...)`.
- multiple queue handlers define `retries: N` at the function boundary.

Those durable concerns are real, but they are not the same problem as in-process orchestration. The current code mixes the concepts informally.

### Failure Modes We Need To Eliminate

1. **Silent exhaustion**
   - `agentic-loop.ts` can hit loop or duration boundaries and return best-available content instead of a first-class exhausted outcome.
   - `github-fork.ts` returns `"deferred"` after polling out, which forces every caller to reinterpret whether that is acceptable progress, temporary delay, or real failure.

2. **Visibility gaps**
   - Current progress reporting is fragmented across `agentEventBus`, inline console logging, Inngest progress events, and no event at all.
   - The current event bus is keyed by `threadId` only and has no required `userId` in the event envelope.

3. **Budget drift**
   - Attempt limits and timing behavior are encoded as local constants such as `MAX_ITERATIONS`, `MAX_SPECIALIST_RETRIES`, `MAX_MERGE_RETRIES`, polling deadlines, and retry-delay arrays.
   - Those values do not currently flow from any shared governance posture.

4. **Semantic drift**
   - Parallelism, branching, looping, and retry are implemented with raw language constructs rather than with explicit platform-level contracts, so behavior differs by file.

## Goals

- Provide exactly four in-process orchestration primitives with explicit contracts.
- Make exhaustion, failure, and cancellation structurally visible.
- Give long-running work a uniform event model with heartbeats.
- Derive orchestration budgets from governance posture instead of ad hoc call-site constants.
- Migrate the repo toward one control-flow vocabulary, not many.
- Preserve the durable-vs-in-process boundary rather than blurring it.

## Non-Goals

- Replacing Inngest `retries` or `step.waitForEvent`.
- Designing public A2A endpoints.
- Redesigning the coworker or Build Studio UI.
- Persisting a new orchestration history table in V1.
- Per-org admin-tunable orchestration budgets.
- Cross-run checkpointing for the new primitives in V1.
- User-driven cancellation APIs beyond mapping existing cancellation signals into typed outcomes.

## Research And Benchmarking

This spec needs to be stronger than "we should have loops and branches." The benchmark matters because DPF already has multiple orchestration layers and must avoid inventing a weaker duplicate.

### Open-Source References

#### 1. Google ADK workflow agents

Relevant upstream model:

- `SequentialAgent`
- `ParallelAgent`
- `LoopAgent`

Patterns adopted:

- keep workflow control deterministic
- keep orchestration separate from LLM reasoning
- use a small named primitive set rather than arbitrary ad hoc flow code

Patterns rejected:

- treating ADK's primitive set as sufficient for DPF as-is
- copying the surface without adding DPF-specific governance and event semantics

Gap DPF must fill:

- ADK does not provide DPF's governance-derived budgets, thread/user-scoped event bus rules, or explicit exhausted outcomes tied to our coworker runtime.

#### 2. Inngest

Relevant upstream model:

- durable function retries
- per-step retry semantics
- `step.waitForEvent`
- long-running pause/resume behavior

Patterns adopted:

- preserve durable outer shells for queued work
- keep retry semantics explicit and observable
- treat waiting for external events as a distinct concern from in-process retry loops

Patterns rejected:

- collapsing all orchestration into the durable layer
- using Inngest retries as the answer to request-time or in-memory orchestration semantics

Gap DPF must fill:

- Inngest gives durability and retries, but it does not define the in-process orchestration contract used inside agent loops, fallback chains, or synchronous orchestration code.

#### 3. LangGraph and graph-first agent runtimes

Relevant upstream model:

- explicit node/edge workflows
- stateful execution graphs
- branching and loopback through graph edges

Patterns adopted:

- state and control flow should be explicit, not hidden inside helper functions
- nested composition should be first-class

Patterns rejected:

- graph-first authoring for every DPF flow
- forcing the whole platform onto a node-edge DSL before the core orchestration semantics are cleaned up

Gap DPF must fill:

- DPF needs a smaller operational substrate first. A four-primitive runtime is a better near-term fit than a full graph authoring model.

### Commercial References

#### 1. Temporal / Temporal Cloud

Patterns adopted:

- thin deterministic orchestration shell
- explicit retry and timeout policy
- strong distinction between durable workflow state and activity execution

Patterns rejected:

- introducing a second durable orchestration platform into DPF when Inngest already occupies that role

Gap DPF must fill:

- DPF needs Temporal's conceptual discipline, not a platform replacement.

#### 2. AWS Step Functions

Patterns adopted:

- named states with explicit branch, parallel, and retry semantics
- observability matters as much as execution

Patterns rejected:

- JSON-state-machine authoring as the primary local development surface

Gap DPF must fill:

- Step Functions is a durable service workflow tool, not a lightweight internal runtime abstraction for our TypeScript codebase.

#### 3. Commercial agent orchestration surfaces

Across managed agent platforms, the common lesson is:

- orchestration primitives without governance are too permissive
- governance without observability is not trustworthy
- event visibility without consistent terminal semantics still leaves operators guessing

That is the gap this spec must close inside DPF.

### Recommended Synthesis

DPF should adopt:

- ADK's small deterministic primitive vocabulary
- Inngest's durable boundary discipline
- Temporal and Step Functions' insistence on explicit terminal states and retry semantics

DPF should not adopt:

- a new durable orchestration platform
- a graph DSL-first rewrite
- call-site-specific retry policy sprawl

## Current Repo Truth

### Event Bus Reality

The canonical bus is `apps/web/lib/tak/agent-event-bus.ts`.

Current verified behavior:

- subscribers are keyed by `threadId`
- `subscribe(threadId, handler)` is the only current subscription shape
- `emit(threadId, event)` is the only current emit shape
- `AgentEvent` variants do not include a required shared envelope with `userId`

This spec therefore requires a real bus evolution, not just a new event type.

### Governance Reality

`packages/db/prisma/schema.prisma:1503` defines `AgentGovernanceProfile`.

Verified fields relevant here:

- `autonomyLevel`
- `hitlPolicy`
- `maxDelegationRiskBand`

Notably absent:

- no `profileSlug`
- no current orchestration budget fields

So V1 should derive runtime orchestration posture from the existing governance model instead of adding a second overlapping source of truth.

### A2A Reality

The related DPF spec is:

- `docs/superpowers/specs/2026-04-23-a2a-aligned-coworker-runtime-design.md`

That spec already establishes:

- `contextId`
- `taskRunId`
- `parentTaskRunId`
- A2A-shaped status and artifact semantics

This orchestration spec should compose with that task envelope, not redefine it.

### Route-Work-Item Reality

`apps/web/lib/queue/functions/route-work-item.ts` currently uses `step.waitForEvent(...)` and does not contain an inner polling loop that should migrate into the new primitives today.

That means the previous version of this draft overstated the migration scope there. The Inngest wait is durable and should stay durable.

## Proposed Architecture

### Boundary

Create a new module:

- `apps/web/lib/orchestration/`

Suggested files:

- `index.ts`
- `types.ts`
- `primitives.ts`
- `events.ts`
- `governance-profiles.ts`
- `heartbeat.ts`
- `assert-never.ts`

This module is responsible for:

- primitive execution contracts
- typed outcomes
- event emission
- governance-derived budget resolution
- heartbeat behavior

It is not responsible for:

- durable persistence
- UI rendering
- task-envelope storage
- provider routing
- tool execution

Those remain in their existing domains.

### Primitive Set

#### Sequential

Purpose:

- run ordered steps
- stop on first non-success terminal outcome

Good fit for:

- build phase progression
- ordered pipeline steps
- multi-step review gates

#### Parallel

Purpose:

- run independent work concurrently
- synthesize results through an explicit success policy

Good fit for:

- Build Studio task batches currently executed with `Promise.all`
- reviewer fan-out where branch results must later be synthesized

#### Loop

Purpose:

- run repeatable work until success, typed failure, typed exhaustion, or typed cancellation

Good fit for:

- retry with changed inputs
- polling with deadlines
- iterative agent loops
- provider fallback walk with evolving attempt state

#### Branch

Purpose:

- express competing or complementary branches that later merge into a typed result

Good fit for:

- deliberation branch sets
- reviewer/skeptic/adjudicator synthesis
- multiple strategy branches whose outputs are compared or merged

### Type Contracts

```ts
export type GovernanceProfile =
  | "economy"
  | "balanced"
  | "high-assurance"
  | "document-authority"
  | "system";

export type RunContext = {
  runId: string;
  userId: string;
  threadId?: string;
  taskRunId?: string;
  agentId?: string;
  governanceProfile: GovernanceProfile;
  parentRunId?: string;
  routeContext?: string;
};

export type Outcome<T> =
  | { status: "succeeded"; value: T; evidence: Evidence[] }
  | { status: "failed"; error: OrchestrationError; evidence: Evidence[] }
  | { status: "exhausted"; reason: ExhaustionReason; evidence: Evidence[]; attempts: number }
  | { status: "cancelled"; reason: "user_cancelled" | "upstream_cancelled"; evidence: Evidence[]; attempts: number };

export type ExhaustionReason =
  | "max_attempts"
  | "deadline"
  | "token_budget"
  | "sandbox_unavailable"
  | "no_more_strategies";

export type Evidence = {
  attemptNumber: number;
  startedAt: string;
  endedAt: string;
  summary: string;
  outcome: "succeeded" | "failed" | "cancelled";
  detail?: unknown;
};
```

### Architectural Rules

1. No primitive may terminate without returning a typed terminal `Outcome`.
2. Exhaustion is never encoded as `null`, `"deferred"`, or fallback free-text.
3. Callers must exhaustively handle outcome variants through an `assertNever()` pattern or equivalent typed guard.
4. Heartbeats are emitted by the orchestration layer, not reimplemented per call site.
5. Governance budgets are resolved centrally, not passed as ad hoc literals from product code.

## Event Model

### Principle

The orchestration runtime should use the existing bus but evolve it to support a real event envelope.

### Required Envelope

```ts
export type OrchestrationEnvelope = {
  runId: string;
  parentRunId?: string;
  primitive: "sequential" | "parallel" | "loop" | "branch";
  userId: string;
  threadId?: string;
  taskRunId?: string;
  agentId?: string;
  governanceProfile: GovernanceProfile;
  emittedAt: string;
  cost: {
    tokens: number;
    ms: number;
    attempts: number;
  };
};
```

### Bus Evolution Required In Phase 1

The bus should evolve from:

- `subscribe(threadId, handler)`
- `emit(threadId, event)`

To support:

- `subscribe({ threadId }, handler)`
- `subscribe({ userId }, handler)`
- `emit(eventEnvelope)`

Implementation note:

- V1 should preserve backward compatibility with the thread-keyed path while existing emitters migrate.
- The old positional `subscribe(threadId, handler)` may remain temporarily as a compatibility shim, but the new orchestration module should emit through the new envelope shape from day one.

### Event Families

Representative event types:

- `sequential:started`
- `sequential:step_started`
- `sequential:step_completed`
- `sequential:succeeded`
- `sequential:failed`
- `parallel:started`
- `parallel:branch_started`
- `parallel:branch_completed`
- `parallel:synthesized`
- `parallel:failed`
- `loop:started`
- `loop:attempt_started`
- `loop:attempt_completed`
- `loop:still_working`
- `loop:succeeded`
- `loop:exhausted`
- `loop:cancelled`
- `branch:started`
- `branch:branch_started`
- `branch:branch_completed`
- `branch:merged`
- `branch:failed`

### Heartbeat Contract

Every primitive instance gets a heartbeat timer scoped to `runId`.

Rules:

- the timer starts when the primitive starts
- the timer is cleared in `finally`
- a heartbeat emits only when no other event has been emitted for `heartbeatMs`
- any event for the same `runId` resets the quiet timer

UI implication:

- `WORKING` means recent events continue to arrive
- `STALLED` means no event has arrived for more than `2 x heartbeatMs`

That gives the coworker surfaces a real stall signal instead of inferring liveness from hope.

## Governance Profile Registry

### Decision

Store orchestration budgets in code, not in the database.

File:

- `apps/web/lib/orchestration/governance-profiles.ts`

Reason:

- this is platform behavior, not tenant content
- no seed drift
- no admin UX requirement
- easy review in code

### Shape

```ts
export type ProfileBudget = {
  maxAttempts: number;
  tokenBudget: number;
  deadlineMs: number;
  heartbeatMs: number;
};

export const GOVERNANCE_PROFILES: Record<GovernanceProfile, ProfileBudget> = {
  economy:                { maxAttempts: 2, tokenBudget: 20_000,  deadlineMs:  60_000, heartbeatMs: 10_000 },
  balanced:               { maxAttempts: 4, tokenBudget: 80_000,  deadlineMs: 300_000, heartbeatMs: 10_000 },
  "high-assurance":       { maxAttempts: 6, tokenBudget: 250_000, deadlineMs: 900_000, heartbeatMs: 15_000 },
  "document-authority":   { maxAttempts: 3, tokenBudget: 120_000, deadlineMs: 600_000, heartbeatMs: 10_000 },
  system:                 { maxAttempts: 3, tokenBudget: 0,       deadlineMs:  60_000, heartbeatMs:  5_000 },
};
```

### Resolution Order

1. explicit call-site profile when the caller already knows the intended posture
2. derived profile from `AgentGovernanceProfile`
3. `"system"` fallback for infra or non-agent work

### Derivation Rule

V1 should derive from existing fields, not add a new DB column:

```ts
function deriveGovernanceProfile(g: {
  autonomyLevel: string;
  hitlPolicy: string;
  maxDelegationRiskBand?: string | null;
}): GovernanceProfile {
  if (g.hitlPolicy === "always" || g.autonomyLevel === "supervised") return "high-assurance";
  if (g.autonomyLevel === "constrained") return "balanced";
  if (g.autonomyLevel === "autonomous" && g.maxDelegationRiskBand === "low") return "economy";
  return "balanced";
}
```

Important constraint:

- `document-authority` should remain an explicit selection path, not an inferred default.

### Budget Semantics

Each primitive invocation gets its own resolved budget.

That means:

- nested primitives inherit context by default
- nested primitives do not share one pooled attempt counter in V1
- the outer primitive's deadline still constrains total wall clock

This is intentionally simple and debuggable.

## Primitive Semantics

### Sequential — Semantics

Input:

- ordered steps

Behavior:

- run each step in order
- short-circuit on first `failed`, `exhausted`, or `cancelled`

Terminal results:

- `succeeded` when all steps succeed
- otherwise return the first non-success terminal outcome

### Parallel — Semantics

Input:

- branch set
- explicit `errorPolicy`
- explicit `synthesize` function

Policies:

- `all_must_succeed`
- `best_effort`
- `quorum`

The error policy must be explicit at construction time. No implicit default.

### Loop — Semantics

Input:

- `step`
- `exitWhen`
- `strategy`

Key rule:

- `strategy` is mandatory because retries that do not evolve input are usually just expensive repetition

Exit modes:

- `succeeded`
- `failed`
- `exhausted`
- `cancelled`

### Branch — Semantics

Input:

- branch set
- `merge`
- optional `exitEarly`

DPF-specific interpretation:

- `Branch` is for strategic divergence and later synthesis
- it is not just another spelling for `Parallel`

That distinction matters for deliberation, review, and multi-strategy analysis.

## Migration Inventory

### Group A: Migrate To The New Primitives

| Surface | Current file | Current pattern | Target primitive |
| --- | --- | --- | --- |
| Build phase progression | `apps/web/lib/integrate/build-orchestrator.ts` | raw sequential `for` loop | `Sequential` |
| Build task batch fan-out | `apps/web/lib/integrate/build-orchestrator.ts` | `Promise.all` batch fan-out | `Parallel` |
| Specialist retry | `apps/web/lib/integrate/build-orchestrator.ts` | bounded retry loop | `Loop` |
| Task-result optimistic merge | `apps/web/lib/integrate/build-orchestrator.ts` | bounded retry loop | `Loop` |
| Build pipeline step retry | `apps/web/lib/integrate/build-pipeline.ts` | retry with delay arrays | `Loop` inside `Sequential` |
| Agentic loop | `apps/web/lib/tak/agentic-loop.ts` | iteration loop with multiple break/return paths | `Loop` |
| Sandbox DB/health polling | `apps/web/lib/integrate/sandbox/sandbox-db.ts` | polling `while` loops | `Loop` |
| GitHub fork readiness | `apps/web/lib/integrate/github-fork.ts` | poll-until-ready then `"deferred"` | `Loop` |
| Provider fallback chain | `apps/web/lib/routing/fallback.ts` | chain walk with delay/retry | `Loop` |
| Deliberation branch set | `apps/web/lib/queue/functions/deliberation-run.ts` | sequential branch dispatch plus later synthesis | `Branch` with optional nested `Parallel`/`Sequential` pieces |

### Group B: Keep As Durable Outer Shells

| Surface | Why it stays |
| --- | --- |
| Inngest `retries: N` | durable retry across worker restarts |
| Inngest `step.waitForEvent(...)` | durable wait, not in-process loop |
| Inngest function lifecycle | owns queued execution, replay, and resume semantics |

### Group C: Retire After Migration

Examples to remove once call sites move:

- `MAX_SPECIALIST_RETRIES`
- `MAX_MERGE_RETRIES`
- `MAX_ITERATIONS`
- pipeline-local retry tables where the primitive registry supersedes them
- `"deferred"` return semantics for fork readiness
- primitive-specific ad hoc heartbeat or retry events where the new event family replaces them

## Migration Sequence

### Phase 1: Foundation

Deliver:

- new orchestration module
- profile registry
- event envelope types
- bus evolution to support envelope-based subscriptions
- heartbeat helper
- unit tests for primitive behavior

Do not migrate business call sites yet.

### Phase 2: Low-Risk Polling And Readiness Loops

Migrate:

- sandbox readiness and health checks
- GitHub fork readiness

Why first:

- simple semantics
- high clarity
- good proof that exhausted outcomes and heartbeats work

### Phase 3: Build Pipeline And Build Orchestrator

Migrate:

- build pipeline step retry
- specialist retry
- phase sequencing
- task-batch fan-out
- optimistic merge retry

Why together:

- these surfaces are already conceptually related
- one coherent PR keeps Build Studio orchestration easier to review

### Phase 4: Provider Fallback Chain

Migrate:

- `callWithFallbackChain(...)`

Architectural note:

- this is a good test of Loop strategy evolution because attempts genuinely change endpoint/model choice

### Phase 5: Deliberation

Migrate:

- worker branch dispatch
- synthesis/merge flow

Important note:

- current code dispatches worker branches sequentially, so this phase is partly a semantic upgrade, not just a wrapper extraction

### Phase 6: Agentic Loop

Migrate last:

- `apps/web/lib/tak/agentic-loop.ts`

Why last:

- highest blast radius
- most complex combination of looping, nudging, failure recovery, cancellation, and content fallback behavior

This phase needs extra review and replay testing.

### Phase 7: Retirement Sweep

Delete:

- obsolete retry constants
- obsolete helpers
- duplicated ad hoc loop semantics
- the legacy `AgentEvent` shape (replaced by the unified envelope, see *Bus Refactor*)

The codebase should finish this phase with one orchestration vocabulary.

**Mechanical enforcement (not by convention).** After Phase 7 merges:

- grep for `MAX_RETRIES|MAX_ATTEMPTS|maxRetries\s*=` in `apps/web/lib/` returns matches **only** inside `apps/web/lib/orchestration/`
- grep for `for\s*\(\s*let\s+attempt` returns zero matches outside `apps/web/lib/orchestration/`
- grep for `while\s*\(\s*attempt\s*<` returns zero matches outside `apps/web/lib/orchestration/`
- grep for the legacy positional `subscribe(threadId,` returns zero matches outside `apps/web/lib/tak/agent-event-bus.ts`
- a pre-push lint rule (or grep-based check) fails the build if these patterns reappear

The build must fail if anything still imports retired symbols. That is the verification that retirement is real.

## Agentic Loop Special Handling

The current `agentic-loop.ts` contains several semantically distinct terminal paths:

- user cancellation
- sandbox unavailable circuit breaker
- duration boundary
- repeated-tool stuck detection
- fabrication failure
- frustration cutoff
- natural no-tool completion
- max-iteration fallback

The migration must preserve the useful distinctions and stop flattening them into ambiguous free text.

Recommended V1 mapping:

- user cancellation -> `Outcome.cancelled`
- sandbox unavailable -> `Outcome.exhausted { reason: "sandbox_unavailable" }`
- duration boundary -> `Outcome.exhausted { reason: "deadline" }`
- max iterations -> `Outcome.exhausted { reason: "max_attempts" }`
- fatal model/tooling condition -> `Outcome.failed`
- natural completion -> `Outcome.succeeded`

The existing repetition detector, fabrication detector, and frustration guard should remain as named exit predicates or typed failure producers inside the Loop implementation, not as inline one-off control-flow traps.

## Verification Plan

### Foundation Tests

Required in Phase 1:

1. primitive unit tests for `Sequential`, `Parallel`, `Loop`, `Branch`
2. event-envelope tests proving `userId`, `runId`, `primitive`, and cumulative cost exist on every orchestration event
3. heartbeat tests proving quiet runs emit `*:still_working`
4. budget-resolution tests proving explicit -> derived -> system order
5. negative test proving unknown profile resolution fails loudly at primitive entry

### Migration Gates Per PR

Every migration PR must include:

1. behavior test for the migrated surface
2. terminal-outcome test
3. event emission test
4. heartbeat test when the surface can run long enough to stall visually
5. `pnpm --filter web typecheck`
6. `pnpm --filter web exec vitest run ...` for affected tests
7. `cd apps/web && npx next build`

For UI-adjacent runtime behavior, the migration PR also needs route verification against the running app where relevant.

### Replay And Fixture Requirement For Agentic Loop

The `agentic-loop.ts` migration must add replay-style tests or recorded fixtures that cover:

- successful multi-step tool execution
- repeated-tool stuck condition
- fabrication recovery path
- sandbox unavailable path
- user cancellation path
- duration or iteration exhaustion

This is the highest-risk migration in the plan and should not ship on unit tests alone.

## Risks And Mitigations

### 1. Primitive layer becomes a second orchestration religion

Risk:

- teams keep using raw loops anyway

Mitigation:

- add lint/grep enforcement after migration
- code review rule: retry/fan-out/polling additions outside `lib/orchestration` need explicit architectural justification

### 2. Event-bus migration destabilizes existing realtime UX

Risk:

- moving too aggressively from thread-keyed events to envelope-based events breaks current subscribers

Mitigation:

- compatibility shim during migration
- migrate orchestration events first
- move old emitters incrementally

### 3. Budget calibration is wrong

Risk:

- too strict starves useful work
- too loose recreates runaway behavior

Mitigation:

- start with conservative defaults
- review evidence after early migrations
- tune in code under review rather than exposing runtime knobs too early

### 4. Deliberation migration accidentally changes semantics

Risk:

- current sequential branch dispatch includes implicit ordering assumptions

Mitigation:

- make those assumptions explicit during migration
- if a branch group is truly ordered, model it as `Sequential`, not `Branch`

### 5. Agentic loop callers depend on today's fallback text behavior

Risk:

- callers may assume free-text "best effort" content instead of handling exhausted outcomes

Mitigation:

- migrate callers in the same PR
- use exhaustive outcome typing
- fail builds on non-exhaustive handling where possible

## Implementation Constraints

- No schema migration in V1 unless the foundation work proves that `userId` cannot be carried through the bus without one.
- No admin settings UI for orchestration budgets.
- No hardcoded UI-only interpretation of orchestration events outside the shared event contract.
- No parallel old/new retry logic left behind after a migration is complete.

## Recommended Next Slice

The smallest architecture-sound first slice is:

1. add `apps/web/lib/orchestration/` with `Loop`, typed `Outcome`, profile registry, and heartbeat helper
2. extend `agent-event-bus.ts` to support the new event envelope alongside the legacy thread-keyed API
3. migrate `sandbox-db.ts` polling loops and `github-fork.ts` readiness polling to `Loop`
4. add tests proving exhausted outcomes and heartbeats work in those low-risk paths

That slice proves the substrate without touching the riskiest agent-facing runtime yet.

## Standards And References

- Google ADK workflow agents documentation:
  - workflow agents: `https://google.github.io/adk-docs/agents/workflow-agents/`
  - sequential agents: `https://google.github.io/adk-docs/agents/workflow-agents/sequential-agents/`
  - parallel agents: `https://google.github.io/adk-docs/agents/workflow-agents/parallel-agents/`
  - loop agents: `https://google.github.io/adk-docs/agents/workflow-agents/loop-agents/`
- A2A protocol specification and definitions:
  - specification: `https://a2a-protocol.org/dev/specification/`
  - definitions: `https://a2a-protocol.org/latest/definitions/`
  - task lifecycle explainer: `https://a2a-protocol.org/dev/topics/life-of-a-task/`
- Inngest durability and retry references:
  - retries: `https://www.inngest.com/docs/features/inngest-functions/error-retries/retries`
  - durable execution overview: `https://www.inngest.com/docs/learn/how-functions-are-executed`
  - steps and waits: `https://www.inngest.com/docs/learn/inngest-steps`
- DPF A2A runtime spec:
  - `docs/superpowers/specs/2026-04-23-a2a-aligned-coworker-runtime-design.md`
- DPF event bus:
  - `apps/web/lib/tak/agent-event-bus.ts`
- DPF governance schema:
  - `packages/db/prisma/schema.prisma`

## Open Questions

1. Should `Branch` allow true concurrent execution in V1, or should V1 model branch synthesis while preserving sequential dispatch for some current deliberation flows?

This is an implementation question, not a reason to block the foundation slice.

## Resolved Questions

### Bus Refactor — `AgentEvent` is unified, not layered

Decision: **refactor `AgentEvent` into a shared envelope plus family-specific payloads.** Do not ship a parallel orchestration-only event shape alongside the legacy `AgentEvent`.

Rationale:

- DPF principle: no parallel implementations, approach zero technical debt. A "compatibility shim" event shape would persist indefinitely and recreate the fragmentation this spec exists to fix.
- The visibility gap is not unique to orchestration. Build progress, sandbox lifecycle, brand extraction, queue, and verification events all benefit from the same `userId` / `runId` / `cost` envelope and from the terminal-event invariant.
- The AI Coworker UI is the single interface to the workforce. One event contract means one filtering path, one subscription pattern, one stall-detection rule across every panel.
- A2A alignment: the event envelope becomes the streaming projection of identity already on `TaskRun` (`contextId`, `taskRunId`, `parentTaskRunId`).
- Phase 7 retirement is only meaningful if the legacy event shape retires too — otherwise "one orchestration vocabulary" is partial.

Implications captured elsewhere in this spec:

- §Bus Evolution Required In Phase 1 — Phase 1 migrates **every** existing `AgentEvent` emit site to the shared envelope, not only orchestration emitters. The existing positional `subscribe(threadId, handler)` may remain temporarily as a compatibility shim **only** for the duration of Phase 1's migration window; it retires in Phase 7.
- §Group C / Phase 7 — legacy `AgentEvent` union shape is listed as a retirement target.
- §Risks — the bus migration risk (§Risks #2) is acknowledged; mitigation is "migrate orchestration events first, then move old emitters incrementally within Phase 1," with the legacy positional API gone by Phase 7.
