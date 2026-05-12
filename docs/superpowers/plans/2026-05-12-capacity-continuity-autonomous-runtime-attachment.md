# Capacity Continuity to Autonomous Runtime Attachment Plan

| Field | Value |
| --- | --- |
| Date | 2026-05-12 |
| Status | In implementation |
| Related specs | `docs/superpowers/specs/2026-05-12-ai-capacity-continuity-design.md`, `docs/superpowers/specs/2026-05-11-autonomous-coworker-runtime-design.md` |

## Objective

Attach Capacity Continuity to the autonomous coworker runtime as a policy and scheduling layer, not a separate execution system.

Capacity Continuity selects useful, authorized work when paid AI capacity is available. `AutonomousWorkRun` executes that work under the existing task, tool, approval, and evidence controls.

## Dependencies and current state

**Dependency status**: autonomous runtime Slice 2 (`AutonomousWorkRun` service extraction) has started. The first seam is `apps/web/lib/tak/autonomous-work-run.ts`, with `createTaskRunForScheduledTask()` now acting as a scheduled-task adapter over that shared service. Capacity candidate selection now targets this seam through the pure mapper in `apps/web/lib/capacity-continuity/candidates.ts`.

**Implemented foundation** (2026-05-12):

- `apps/web/lib/tak/autonomous-work-run.ts` creates shared `TaskRun` identity for scheduled and capacity-continuity triggers.
- `apps/web/lib/capacity-continuity/candidates.ts` defines the `CapacityContinuityCandidate` shape and maps accepted candidates into `AutonomousWorkRunInput`.
- `apps/web/lib/capacity-continuity/candidates.ts` also performs the first conservative pre-run rejection checks for duplicate dedupe keys, phase-gated routes, forbidden grant classes, and ambiguous objectives.
- `apps/web/lib/capacity-continuity/finance-routing.ts` turns finance utilization signals into provider-class/model-tier routing hints and finance tracking metadata without pinning a provider.
- `apps/web/lib/capacity-continuity/finance-signals.ts` reads live AI-provider finance profiles, active/draft supplier contracts, allowances, and latest usage snapshots into normalized capacity finance signals.
- `apps/web/lib/capacity-continuity/backlog-selector.ts` provides the first live safe-queue adapter: open backlog items become read-only review candidates, enriched with finance/routing metadata, deduped against recent capacity-triggered `TaskRun`s, and optionally mapped to `AutonomousWorkRunInput`s through the shared grant map.
- Focused tests cover the capacity mapper, finance/routing hints, finance-signal normalization, backlog safe-queue selection, hard-rejection behavior, and standing-order attribution rules.

**Schema already in place** (re-verified 2026-05-12):

- `ScheduledAgentTask.taskRunId` — schema line 4329.
- `ToolExecution.taskRunId` — schema line 3029.
- `AgentMessage.taskRunId` — schema line 2886.
- `Principal` / `PrincipalAlias` — schema lines 219/230.

No new schema migration is required for the attachment seam itself. All capacity metadata lives in `TaskRun.a2aMetadata` for the first slice (consistent with runtime spec §6.2). New tables (`StandingOrder`, `ReturnBriefing`, etc.) are introduced by later capacity-continuity slices, not by this attachment plan.

## Boundary

Capacity Continuity owns:

- capacity inventory,
- calendar and availability interpretation,
- standing-order evaluation,
- safe work queue ranking,
- provider/funding fit,
- idle reason accounting,
- return briefing assembly.

Autonomous runtime owns:

- `TaskRun` identity,
- prompt/context/tool resolution,
- agentic loop execution,
- approval pauses,
- `governedExecuteTool()` calls,
- evidence, receipts, and audit linkage.

No capacity runner may call MCP tools directly. It must submit work through `AutonomousWorkRun`.

## Phase 1: Interface Definition

Define a small selection type:

```ts
type CapacityContinuityCandidate = {
  candidateId: string;
  // Idempotency key for cross-window dedup. The selector skips a candidate
  // whose dedupeKey already maps to an open or recently-completed TaskRun
  // (a `TaskRun` carrying this dedupeKey in `a2aMetadata.cognitiveLoad.dedupeKey`).
  // Lookback window comes from `StandingOrder.dedupeLookbackHours` (capacity
  // spec §7 — Standing Orders). If not set, default is 24h.
  dedupeKey: string;
  source:
    | "standing-order"
    | "backlog"
    | "pull-request"
    | "qa-gap"
    | "spec-drift"
    | "capability-need"
    | "proceduralization";
  title: string;
  objective: string;
  routeContext: string;
  agentId: string;
  ownerPrincipalId: string;        // standing-order owner Principal (capacity spec §11.0a)
  riskClass: "read-only" | "review-after" | "approval-required";
  evidenceRequired: string[];
  // Routing HINTS — fed to the existing dynamic router. Never a hard pin.
  // The runtime is free to choose a different provider/model when the
  // router determines a better fit on capability tier or task type.
  capacityFit: {
    providerClassHint: "fixed-cost" | "quota" | "token-priced" | "local";
    modelTierHint: "routine" | "standard" | "frontier";
    reason: string;
  };
  sourceRef: {
    kind:
      | "standing-order"
      | "backlog-item"
      | "pull-request"
      | "qa-gap"
      | "spec"
      | "capability-need"
      | "proceduralization-candidate";
    id: string;
  };
};
```

Map accepted candidates to `AutonomousWorkRunInput` with `trigger: "capacity-continuity"` and `userId` resolved from `ownerPrincipalId`. The mapper is the only place `CapacityContinuityCandidate` shape converts; everything downstream operates on the runtime spec's `AutonomousWorkRunInput` contract.

Acceptance:

- candidate selection is pure and testable,
- candidate-to-run mapping is deterministic and implemented in `apps/web/lib/capacity-continuity/candidates.ts`,
- `dedupeKey` prevents re-selection within the configured lookback,
- candidates with `riskClass: "approval-required"` are **selected** (not filtered) but the resulting `TaskRun` pauses at the first side-effecting tool call as `input-required` via proposal-mode — the policy layer never elevates approval-required candidates above the runtime's approval gates,
- no tool execution occurs during selection.

## Phase 2: Metadata Contract

Store capacity metadata in `TaskRun.a2aMetadata`, aligned with the runtime spec's `AutonomousWorkTrigger` union and the shape already used by `scheduled-task-runs.ts`:

```json
{
  "trigger": "capacity-continuity",
  "sourceRef": { "kind": "standing-order", "id": "<orderId>" },
  "cognitiveLoad": {
    "capacityState": "<away|holiday|after-hours|...>",
    "capacityWindowId": "<windowId-if-available>",
    "fundingFitHint": { "providerClassHint": "...", "modelTierHint": "..." },
    "routingHints": {
      "budgetClass": "<minimize_cost|balanced|quality_first>",
      "interactionMode": "background",
      "modelTierHint": "<routine|standard|frontier>",
      "preferredProviderClass": "<fixed-cost|quota|token-priced|local>",
      "reasonCodes": ["underused_commitment", "safe_background_work"]
    },
    "financeTracking": {
      "observedProviderClasses": ["fixed-cost"],
      "sourceProviderIds": ["<providerId-for-audit-not-routing>"],
      "projectedUnusedValue": 0,
      "utilizationPct": 0
    },
    "dedupeKey": "<candidate.dedupeKey>"
  }
}
```

The standing-order id is `sourceRef.id` when `sourceRef.kind = "standing-order"`; do not duplicate it under `cognitiveLoad`. When the candidate's `sourceRef.kind` is a non-standing-order kind (e.g. `backlog-item`), the originating standing-order id moves to `cognitiveLoad.viaStandingOrderId` so the run still attributes back to the capacity policy that selected it.

Idle reasons are recorded **outside** `TaskRun` (no TaskRun was created), against `CapacityWindow` rows when those exist or against a transient idle-reason event log until then. A `TaskRun` is never created solely to record idle — that would inflate run cardinality and confuse the Operations Map projection.

`returnBriefingId` is set on the briefing's own `TaskRun` (Slice 4 of the capacity spec); it is not copied onto every summarized run. Slice 4 indexes briefings by `sourceTaskRunIds`.

The metadata key is `trigger` (not `triggerKind`) to match the live `a2aMetadata` shape written by `scheduled-task-runs.ts` and the `AutonomousWorkTrigger` union in the runtime spec.

`routingHints` are contract hints only. They may influence future `RequestContract` inputs such as `budgetClass`, `interactionMode`, and capability tier, but they must not become `allowedProviders`, `preferredProviderId`, `pinnedProviderId`, or model pins. `financeTracking.sourceProviderIds` exists only to explain which finance signals informed the policy decision.

Acceptance:

- Operations Map filters capacity-triggered work by `a2aMetadata.trigger = "capacity-continuity"`,
- the briefing's `TaskRun` can be located from any summarized run via the briefing index,
- no new table is needed for the first attachment slice.

## Phase 3: Conservative Selector

Start with safe queues only:

- stale spec review,
- QA evidence collection,
- read-only backlog analysis,
- capability-need review,
- docs/runtime drift checks.

Hard-rejected work — the selector must drop any candidate matching any of these signals before producing an `AutonomousWorkRunInput`:

- the candidate's resolved tool set (the same resolution `runAgenticLoop` would perform for the candidate's agent + route) contains a tool whose `TOOL_TO_GRANTS` entry includes any grant in the rejection set: `deploy`, `publish-external`, `schema-migrate`, `data-delete`, `spend-money`, plus the live high-risk grant classes currently used by the governed tool layer (`admin_write`, `deployment_plan_create`, `iac_execute`, `release_gate_create`, `release_plan_create`). The selector consumes the same tool-to-grant mapping shape exposed by `getToolGrantMapping()` so the check can be wired to the runtime policy source.
- the candidate's `routeContext` matches a phase-gated workflow that owns its own initiation contract (Build Studio phase routes, deliberation initiation routes) — capacity continuity does not initiate those flows, it only assists work already inside them.
- the candidate's objective parses as an "ambiguous product decision" per the heuristic owned by §13.1 of the capacity spec ("useful work" inverse: a candidate whose objective has no resolvable artifact target is rejected as ambiguous).

The first rejection check lives next to the mapper in `apps/web/lib/capacity-continuity/candidates.ts` and is unit-tested against synthetic candidates covering the current rejection signals.

Approval-required candidates from allowed work **are** selected but execute under the runtime's existing approval gates: the resulting `TaskRun` pauses as `input-required` at the first side-effecting tool call (via proposal-mode in the agentic loop). The selector does not elevate, pre-authorize, or bypass any approval.

Acceptance:

- hard-rejected work never produces an `AutonomousWorkRunInput` (verified by tests that exercise each rejection signal independently and in combination),
- approval-required candidates from allowed work produce `TaskRun`s that demonstrably pause at proposal-mode before any side effect (verified by a test that asserts no `ToolExecution` with a side-effecting grant runs before an approval is recorded),
- rejected work produces a structured idle/blocker entry against the capacity window (or transient log per Phase 2) with the matching rejection-signal code so operators can tell *why* a candidate was rejected, not just *that* it was.

## Phase 4: Funding Research

Research phase that runs **after** Phases 1–3 are in production. Not on the critical path of the attachment seam; do not block Phases 1–3 on this. Phase 4 tunes ranking inputs only — it does not change execution authority or alter the contracts from Phases 1–3.

Inputs to research:

- Which capacity is fixed-cost, quota-based, token-priced, or local? (Inventory.)
- Which capability tiers are best for review, refactor, QA, research, and coding? (Capability tier, not provider name — the no-pinning rule still applies.)
- Which work can run off-hours without human interruption?
- Which idle reasons indicate missing funding, missing tools, or missing standing orders?

Deliverables:

- a capability-tier × work-class fit matrix (no provider names),
- utilization metric definitions concrete enough to compute against `TaskRun` + `ToolExecution` + provider usage telemetry,
- recommended `StandingOrder` defaults (queue ranking weights, idle-reason follow-up rules),
- backlog items for missing provider integrations, evidence capture gaps, or routing-hint feedback the router does not yet honor.

Acceptance:

- the fit matrix is checked in as part of the capacity spec or a linked appendix and referenced from `StandingOrder` defaults,
- every utilization metric defined here has a query against shipped tables (no metric defined against tables that do not yet exist),
- no recommendation pins a provider; every recommendation expresses a hint shape (`providerClassHint`/`modelTierHint`) the router already consumes,
- gap-driven backlog items are filed with linked evidence from real capacity runs, not hypothetical scenarios.

## Verification

For the attachment slice (mirrors AGENTS.md §5 build gate):

- unit tests for candidate selection and mapping (pure functions; no DB),
- integration test: a synthetic standing-order candidate flows through `AutonomousWorkRun`, produces a `TaskRun` with `a2aMetadata.trigger = "capacity-continuity"`, and every resulting `ToolExecution` row carries the `taskRunId`,
- invariant test: zero `TaskRun`s with `a2aMetadata.trigger = "capacity-continuity"` and a hard-rejected `sourceRef.kind`,
- invariant test: zero side-effecting `ToolExecution` rows from an approval-required capacity candidate without a preceding approval record,
- typecheck and full vitest pass,
- `apps/web` next production build,
- UX walkthrough of `/platform/ai/capacity-continuity` against the running install (per the platform's UI-verification requirement — type-checks do not verify UX),
- Operations Map evidence that capacity-triggered runs appear as real work and are filterable by trigger.

## Risks at the seam

| Risk | Mitigation |
| --- | --- |
| Selector and runtime grant-resolution drift (a candidate the selector judged safe trips a runtime grant check). | Phase 3 rejection check uses the shared grant-resolution helper from `mcp-governed-execute.ts`; an integration test wires both call sites to the same fixture set. |
| Dedup escape via objective rewording. | `dedupeKey` is owned by the selector and computed from `sourceRef` + canonical work fingerprint, not from `title`/`objective` free text. |
| Capacity metadata accumulates on `TaskRun.a2aMetadata` and becomes unsearchable as volume grows. | Phase 2 limits metadata to a fixed key set; promotion-to-column criteria live in runtime spec §6.2. Review key-set growth at the Slice 5 baseline. |
| Idle accounting tables (`CapacityWindow`) not yet present when this plan ships. | Phase 2 documents the transient idle-reason path; the seam does not depend on `CapacityWindow` existing. Capacity spec Slice 4 takes over once it ships. |
| `ownerPrincipalId` resolution drifts from `StandingOrder.ownerPrincipalId`. | Mapper reads the principal id from the standing-order row at selection time, not from cached candidate state; rejection if the order has been disabled or its owner alias revoked. |
| Approval-required candidates pile up unattended during long absences. | The capacity spec's return briefing surfaces every `input-required` paused run; idle accounting flags growth over time as a capacity-effectiveness signal. |

## Recommendation

Build the attachment seam before deep funding optimization.

The platform needs a safe execution path first. Funding research then improves ranking and provider choice without changing the core authority model.

Concrete next action: add the first governed runner entrypoint that calls `selectBacklogReviewCapacityWorkInputs()`, creates `TaskRun`s through `AutonomousWorkRun`, and records idle/blocker entries for every rejection. That runner must still perform no direct MCP/tool execution; the autonomous runtime remains the only execution path.
