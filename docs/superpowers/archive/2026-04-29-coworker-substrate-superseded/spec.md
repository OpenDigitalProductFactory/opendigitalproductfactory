# Coworker Execution Adapter Substrate Design

| Field | Value |
| --- | --- |
| Status | Draft for review |
| Created | 2026-04-29 |
| Author | Codex + Mark Bodman |
| Primary audience | Platform architecture, coworker runtime, Build Studio orchestration, governance |
| Related repo areas | `apps/web/lib/agent-event-bus.ts`, `apps/web/lib/integrate/*`, `apps/web/lib/tak/*`, `apps/web/lib/queue/functions/*`, `apps/web/lib/routing/fallback.ts` |
| Related prior artifacts | `2026-04-29-orchestration-primitives-design.md`, `2026-03-20-execution-adapter-framework-design.md`, `2026-04-23-a2a-aligned-coworker-runtime-design.md` |

## Purpose

Introduce a small coworker execution substrate for DPF that gives in-process agent and workflow execution a single control-flow vocabulary:

- `Sequential`
- `Parallel`
- `Loop`
- `Branch`

This substrate is for coworker and Build Studio runtime behavior. It is not the same thing as the older routing-layer execution-adapter framework around `callProvider()`. The name overlap is historical; the boundaries are different.

The goal is to remove recurring failure classes already visible in the repo:

1. retry and polling semantics scattered across unrelated files
2. inconsistent terminal behavior at exhaustion boundaries
3. event and heartbeat behavior implemented ad hoc
4. budget and patience rules encoded as local constants instead of a reviewed runtime policy

## Executive decision

DPF should add `apps/web/lib/coworker-substrate/` as the canonical home for in-process execution primitives, typed outcomes, event-envelope helpers, and runtime budget resolution.

The architectural split should be:

- Inngest remains the durable outer shell for queued, resumable, cross-restart work.
- The existing routing execution-adapter framework remains the provider-dispatch abstraction around inference calls.
- The new coworker execution substrate becomes the single in-process control-flow layer used inside Build Studio orchestration, coworker loops, readiness polling, and branch-oriented deliberation flows.

That gives DPF one durable layer, one provider-adapter layer, and one in-process orchestration layer instead of blurring them together.

## Current repo truth

### Event bus reality

The canonical bus implementation lives at [`apps/web/lib/tak/agent-event-bus.ts`](../../../apps/web/lib/tak/agent-event-bus.ts). The top-level [`apps/web/lib/agent-event-bus.ts`](../../../apps/web/lib/agent-event-bus.ts) is an intentional 2-line shim (`export * from "./tak/agent-event-bus";`) left in place during a Phase 12 refactor so existing imports keep working. Both import paths resolve to the same module; substrate work should evolve the `tak/`-scoped file.

Verified current behavior:

- subscriptions are keyed by `threadId`
- API shape is `subscribe(threadId, handler)` and `emit(threadId, event)`
- the union already includes `task:status` and `task:artifact`

Implication:

- Phase 1 should evolve the existing bus, not replace it wholesale
- task semantics already exist, but the envelope is too weak and too thread-centric

### Task-state reality

The repo already defines the canonical task-state vocabulary in [`apps/web/lib/tak/task-states.ts`](../../../apps/web/lib/tak/task-states.ts):

- `submitted`
- `working`
- `input-required`
- `auth-required`
- `completed`
- `failed`
- `canceled`
- `rejected`
- `archived`

This spec reuses that vocabulary.

### Existing control-flow hot spots

Verified substrate-worthy surfaces:

- [`apps/web/lib/integrate/build-orchestrator.ts`](../../../apps/web/lib/integrate/build-orchestrator.ts)
  - bounded specialist retry
  - sequential phase progression
  - batched parallel task dispatch
  - optimistic merge retry
- [`apps/web/lib/integrate/github-fork.ts`](../../../apps/web/lib/integrate/github-fork.ts)
  - poll until ready, then return `"deferred"` on timeout
- [`apps/web/lib/routing/fallback.ts`](../../../apps/web/lib/routing/fallback.ts)
  - provider/model fallback chain with backoff and special-case retry handling
- [`apps/web/lib/queue/functions/deliberation-run.ts`](../../../apps/web/lib/queue/functions/deliberation-run.ts)
  - sequential branch dispatch with branch-specific persistence and progress events

## Problem statement

DPF has good primitives but weak substrate coherence.

The codebase already contains:

- task states
- event streaming
- Build Studio orchestration
- coworker loops
- deliberation orchestration
- durable queue execution

What it lacks is one explicit in-process execution contract. As a result:

- timeouts sometimes degrade into free-text or ambiguous status values
- heartbeats and progress semantics differ by subsystem
- retries and polling rules are hard to compare or govern
- similar logic is reimplemented with different edge-case behavior

## Naming and boundary rule

To avoid collision with the 2026-03-20 routing design:

- `execution adapter` in routing docs still means provider-dispatch adapter
- `coworker execution substrate` in this doc means in-process control-flow substrate

Implementation paths should reflect that separation:

- routing adapter code stays under `apps/web/lib/routing/`
- coworker substrate code lands under `apps/web/lib/coworker-substrate/`

## Goals

- provide exactly four in-process control-flow primitives
- make terminal outcomes explicit and typed
- centralize heartbeat and event-envelope behavior
- centralize runtime budget resolution
- reduce duplicated loop, retry, and fan-out code
- prove the substrate first in lower-risk and Build Studio surfaces before touching the main coworker loop

## Non-goals

- replacing Inngest durability semantics
- replacing the routing/provider execution-adapter framework
- redesigning the coworker UI
- adding tenant-admin knobs for runtime budgets in V1
- shipping the highest-blast-radius coworker loop migration first

## Research and benchmarking synthesis

DPF should combine:

- Google ADK's small deterministic workflow vocabulary
- Inngest's durable-boundary discipline
- Step Functions and Temporal style explicit terminal semantics

DPF should explicitly not do:

- a graph-DSL-first rewrite
- a second durable orchestration platform
- another large framework layer that hides current behavior instead of clarifying it

## Proposed architecture

### Module

Create:

- `apps/web/lib/coworker-substrate/index.ts`
- `apps/web/lib/coworker-substrate/types.ts`
- `apps/web/lib/coworker-substrate/primitives.ts`
- `apps/web/lib/coworker-substrate/events.ts`
- `apps/web/lib/coworker-substrate/budgets.ts`
- `apps/web/lib/coworker-substrate/heartbeat.ts`
- `apps/web/lib/coworker-substrate/assert-never.ts`

### Primitive set

#### Sequential

Use for:

- ordered phase progression
- ordered review gates
- any multi-step workflow where first non-success should stop the run

#### Parallel

Use for:

- concurrent task batches
- independent reviewer or specialist work
- any fan-out that needs an explicit synthesis policy

#### Loop

Use for:

- bounded retry
- polling with deadlines
- fallback walking where inputs evolve between attempts

#### Branch

Use for:

- strategic branch sets
- deliberation and synthesis
- cases where branches are semantically distinct roles, not just parallel workers

### Type contracts

```ts
export type SubstrateProfile =
  | "economy"
  | "balanced"
  | "high-assurance"
  | "document-authority"
  | "system";

export type RunContext = {
  runId: string;
  userId?: string;
  threadId?: string;
  taskRunId?: string;
  buildId?: string;
  agentId?: string;
  routeContext?: string;
  profile: SubstrateProfile;
  parentRunId?: string;
};

export type Outcome<T> =
  | { status: "succeeded"; value: T; attempts: number; evidence: Evidence[] }
  | { status: "failed"; error: SubstrateError; attempts: number; evidence: Evidence[] }
  | { status: "exhausted"; reason: ExhaustionReason; attempts: number; evidence: Evidence[] }
  | { status: "cancelled"; reason: "user_cancelled" | "upstream_cancelled"; attempts: number; evidence: Evidence[] };

export type ExhaustionReason =
  | "max_attempts"
  | "deadline"
  | "token_budget"
  | "no_more_strategies"
  | "external_dependency_not_ready";

export type Evidence = {
  attemptNumber: number;
  startedAt: string;
  endedAt: string;
  summary: string;
  detail?: unknown;
};
```

### Hard rules

1. No primitive may terminate without returning a typed terminal `Outcome`.
2. Exhaustion may not be represented as `null`, `"deferred"`, or free-text fallback.
3. Heartbeat behavior belongs to the substrate, not to each call site.
4. Call sites must handle all terminal variants explicitly.
5. New retry or polling logic outside the substrate needs architectural justification.

## Event model

### Principle

Keep the current bus, but upgrade the envelope.

### New envelope

```ts
export type SubstrateEnvelope = {
  runId: string;
  parentRunId?: string;
  primitive: "sequential" | "parallel" | "loop" | "branch";
  userId?: string;
  threadId?: string;
  taskRunId?: string;
  buildId?: string;
  agentId?: string;
  routeContext?: string;
  profile: SubstrateProfile;
  emittedAt: string;
  cost: {
    ms: number;
    attempts: number;
    tokens?: number;
  };
};
```

### Compatibility strategy

Phase 1 should support:

- legacy `emit(threadId, event)`
- new substrate-aware emitters that attach a shared envelope before projecting to the thread-keyed bus

Important constraint:

- do not break existing SSE subscribers while foundation work is landing

### Heartbeat contract

Every substrate run gets a quiet-window heartbeat timer.

Rules:

- timer starts on primitive start
- any emitted progress event resets the quiet window
- heartbeat emits only after a quiet interval with no other event
- timer clears in `finally`

UI use:

- recent events mean `working`
- missed heartbeat windows mean `possibly-stalled`

This is a support signal, not a terminal state.

## Budget resolution

Store reviewed defaults in code:

- `apps/web/lib/coworker-substrate/budgets.ts`

Reason:

- platform behavior, not tenant content
- easy to review with code changes
- avoids another seed/runtime drift axis

Suggested defaults:

```ts
export const SUBSTRATE_BUDGETS = {
  economy: { maxAttempts: 2, deadlineMs: 60_000, heartbeatMs: 10_000, tokenBudget: 20_000 },
  balanced: { maxAttempts: 4, deadlineMs: 300_000, heartbeatMs: 10_000, tokenBudget: 80_000 },
  "high-assurance": { maxAttempts: 6, deadlineMs: 900_000, heartbeatMs: 15_000, tokenBudget: 250_000 },
  "document-authority": { maxAttempts: 3, deadlineMs: 600_000, heartbeatMs: 10_000, tokenBudget: 120_000 },
  system: { maxAttempts: 3, deadlineMs: 60_000, heartbeatMs: 5_000, tokenBudget: 0 },
} as const;
```

Resolution order:

1. explicit profile from the caller
2. profile derived from governance posture when present
3. `system` for infra-only flows

## Migration inventory

### Group A: First consumers

| Surface | Current file | Target |
| --- | --- | --- |
| GitHub fork readiness polling | `apps/web/lib/integrate/github-fork.ts` | `Loop` |
| Low-risk readiness/polling helpers | future small polling sites | `Loop` |

### Group B: First major proving ground

| Surface | Current file | Target |
| --- | --- | --- |
| Build phase progression | `apps/web/lib/integrate/build-orchestrator.ts` | `Sequential` |
| Specialist retry | `apps/web/lib/integrate/build-orchestrator.ts` | `Loop` |
| Task-batch dispatch | `apps/web/lib/integrate/build-orchestrator.ts` | `Parallel` |
| Task-result optimistic merge retry | `apps/web/lib/integrate/build-orchestrator.ts` | `Loop` |

### Group C: Later consumers

| Surface | Current file | Target |
| --- | --- | --- |
| Provider fallback chain | `apps/web/lib/routing/fallback.ts` | `Loop` |
| Deliberation branch orchestration | `apps/web/lib/queue/functions/deliberation-run.ts` | `Branch` plus nested primitives |

### Group D: Last migration

| Surface | Current file | Why last |
| --- | --- | --- |
| Main coworker/agentic loop | current coworker runtime loop | highest blast radius, most hidden compatibility assumptions |

## Refactoring budget

This work must reserve 20 percent of implementation effort for refactoring and deletion.

That budget is for:

- retiring duplicate retry constants
- collapsing local backoff tables where the substrate supersedes them
- removing ambiguous timeout or deferred semantics after migration
- simplifying call-site event emission once the substrate owns heartbeat behavior

This is not optional cleanup. It is part of the architecture.

## Verification strategy

### Foundation

Required before consumer migration:

1. primitive unit tests
2. event-envelope tests
3. heartbeat tests
4. budget-resolution tests
5. exhaustive outcome-handling tests

### Per migration PR

Each migration PR must include:

1. behavior tests for the migrated surface
2. explicit terminal-outcome assertions
3. event and heartbeat assertions where relevant
4. `pnpm --filter web typecheck`
5. focused Vitest runs
6. `cd apps/web && npx next build`

### UX verification

For Build Studio-facing migrations:

- verify the affected path against the running app
- verify current progress rendering still behaves coherently after event changes

## Risks

### 1. Naming confusion with routing execution adapters

Mitigation:

- keep code and docs under `coworker-substrate`
- reserve `routing execution adapter` for provider-dispatch work only

### 2. Compatibility breakage in SSE consumers

Mitigation:

- compatibility shim first
- migrate emitters incrementally
- do not combine bus evolution with the riskiest runtime migration

### 3. Wrapper-only migration with no real debt reduction

Mitigation:

- enforce the 20 percent refactor budget
- require retirement of superseded constants and helpers as part of each migrated surface

### 4. Main coworker loop changes too early

Mitigation:

- Build Studio first
- provider fallback second
- deliberation after that
- main coworker loop last

## Recommended next slice

The smallest architecture-sound first slice is:

1. add `apps/web/lib/coworker-substrate/` with `Loop`, typed `Outcome`, budget registry, and heartbeat helper
2. add substrate event-envelope helpers that project onto the current thread-keyed bus
3. migrate `github-fork.ts` polling to `Loop`
4. add tests for exhausted outcomes and heartbeat behavior

The first major proving-ground slice after that is:

1. move Build Studio phase sequencing, retry, and batched dispatch onto the substrate
2. spend the reserved refactor budget deleting superseded constants and duplicate retry helpers

That sequence proves the substrate where DPF most needs reliability gains without taking the highest-risk migration first.
