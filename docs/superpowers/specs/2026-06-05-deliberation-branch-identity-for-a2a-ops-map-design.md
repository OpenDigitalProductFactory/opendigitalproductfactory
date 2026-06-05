# Deliberation Branch Identity for A2A Operations-Map Edges — Design / Coordination Note

| Field | Value |
|-------|-------|
| **Status** | Coordination proposal (PAR: proposed, awaiting capture-thread acknowledgement) |
| **Created** | 2026-06-05 |
| **Owner (this note)** | AI Operations Map (read/projection/render) — `BI-65B0D697` / `EP-AI-OPSMAP` |
| **Acknowledging owner** | Multi-agent collaboration & visibility capture thread — `BI-9DB7C332` / `EP-A2A` (branch `claude/sleepy-khorana-197ea7`) |
| **Surface** | `apps/web/lib/ai-operations-map/project-a2a-interactions.ts`, `load-map-data.ts`, `apps/web/components/platform/A2aInteractionsPanel.tsx`; `packages/db/prisma/schema.prisma` (`TaskNode`, `DeliberationRun`) |
| **Related** | `docs/superpowers/specs/2026-06-04-ai-operations-map-a2a-interaction-visibility-design.md`, `docs/superpowers/specs/2026-06-04-multi-agent-collaboration-visibility-design.md`, `docs/superpowers/specs/2026-04-21-deliberation-pattern-framework-design.md` |

## 0. Why this note exists

The A2A Operations Map (`BI-65B0D697`, PR #1467) ships a typed-edge interaction model that already renders **delegation**, **phase-handoff**, and **task-lineage** coworker↔coworker edges from existing substrate. The fourth edge kind — **`a2a-deliberation`** (coordinator → branch persona) — is implemented in the pure projector and unit-tested, but the loader deliberately passes `deliberations: []` because **no stable branch-persona identity is persisted**. This note (a) verifies that gap precisely, (b) frames the product decision it forces, (c) defines the data contract the projector needs so identity is never fabricated, and (d) flags a **direct overlap** with the capture thread's planned Operations-Map work so the two threads converge instead of duplicating.

This is a **proposal**. The capture thread (`BI-9DB7C332`) owns the write path / migration; it should acknowledge or amend before any schema change.

## 1. Substrate truth (verified 2026-06-05)

A deliberation is a `DeliberationRun` (`schema.prisma` ~9028) with branch `TaskNode` rows linked by `TaskNode.deliberationRunId` (~5199). Findings:

- **`TaskNode` has no `agentId` / persona-identity column.** Branch nodes carry `workerRole` (string: `reviewer` | `skeptical_reviewer` | `researcher` | …) and `status` only.
- **Branch dispatch** (`apps/web/lib/queue/functions/deliberation-run.ts:221-228`) writes `status`, `completedAt`, and `routeDecision` (JSON) to each branch node. It does **not** persist a clean per-branch executor identity.
- **Per-branch provider/model are computed but not first-classed.** `deliberation-run.ts:176-179` derives `providerId`/`modelId` per branch and pushes them to `priorProviderIds`/`priorModelIds` for *diversity tracking* only. However, the full `decision` (incl. `selectedEndpoint` / `selectedModelId`) **is** persisted in `TaskNode.routeDecision` — so the per-branch **model/provider** is recoverable from JSON for the diverse modes.
- **`DeliberationOutcome.branchRoster`** (`synthesizer.ts:84-89`, schema ~9072) is `[{ branchNodeId, role, completed, failureReason? }]` — **no** agent/provider/model id.
- **The coordinator IS resolvable**: `DeliberationRun.taskRunId` → `TaskRun.currentAgentId ?? initiatingAgentId`. My projector already resolves coordinator this way.

### The nuance that makes this a decision, not a column add

Branch identity depends on `DeliberationRun.diversityMode`:

| diversityMode | What distinguishes a branch | Is the branch a distinct *coworker*? |
|---|---|---|
| `single-model-multi-persona` | **role only** (same model, same provider) | **No** — it is the same coworker wearing different review hats |
| `multi-model-same-provider` | role + **model** (recoverable from `routeDecision`) | No — different model, same coworker/provider |
| `multi-provider-heterogeneous` | role + **provider/model** (recoverable from `routeDecision`) | Debatable — different executor, still not a registered `Agent` |

So a deliberation branch is, in today's runtime, **the coordinator running an internal review branch under a role** — not a separate registered coworker `Agent`. Rendering `a2a-deliberation` as coworker→coworker would **fabricate coworker identity** unless the capture thread elevates branch personas to first-class `Agent`s. The A2A spec's own non-goal forbids that fabrication.

## 2. The product decision (capture thread to make)

**Are deliberation branch personas distinct coworkers, or internal review facets of one coworker?**

- **Option A — Personas are distinct coworkers.** The capture thread registers/binds an `Agent` per deliberation persona (or per persona+model) and records its `agentId` on the branch node. Then `a2a-deliberation` renders as genuine coworker→coworker fan-out. Cost: a migration (`TaskNode.agentId`) + a persona→Agent mapping policy.
- **Option B — Personas are internal facets (recommended default).** Deliberation stays a coordinator-internal self-fan. The Operations Map renders it **not** as coworker↔coworker but as a coordinator self-loop / distinct "deliberation" affordance (e.g., a badge or a small fan glyph on the coordinator node, or a dedicated lens), differentiated by role and — where diverse — by model/provider pulled from `TaskNode.routeDecision`. **No migration; no fabricated coworker identity.**

Recommendation: **Option B** unless the capture thread has a concrete product reason to treat reviewers as distinct coworkers. It is truthful to the runtime, needs no migration, and still surfaces "this coworker deliberated across N roles/models."

## 3. Data contract the projector needs (either option)

To keep the Operations Map honest, extend `A2aDeliberationBranchRow` (in `project-a2a-interactions.ts`) so identity carries its **kind**, and the renderer decides representation:

```ts
type A2aDeliberationBranchRow = {
  nodeId: string;
  role: string | null;            // workerRole (always present)
  status: string | null;
  // identity + its kind — projector never fabricates a coworker:
  identityKind: "agent" | "model" | "role";   // agent only when a real Agent.agentId exists
  agentId: string | null;          // populated ONLY when identityKind === "agent"
  modelId: string | null;          // from TaskNode.routeDecision (diverse modes)
  providerId: string | null;       // from TaskNode.routeDecision (diverse modes)
};
```

- **Option A** populates `identityKind:"agent"` + `agentId` → loader wires `a2a-deliberation` coworker→coworker edges.
- **Option B** populates `identityKind:"role"|"model"` → loader keeps `deliberations: []` for the coworker band and (optionally, follow-up) renders a coordinator-side deliberation affordance from `modelId`/`role`. The projector's deliberation path stays guarded so it only emits coworker edges when `identityKind === "agent"`.

The `model`/`provider` fields are **recoverable today with no migration** from `TaskNode.routeDecision`, so an Option-B deliberation affordance is buildable now without the capture thread.

## 4. Overlap reconciliation (important)

`BI-9DB7C332` Slice 2 (per its backlog body) plans: *"delegatesTo/escalatesTo enforcement + DelegationChain hops; **Operations Map transfer overlay + collaboration-graph inspector**."* That intersects PR #1467 directly:

- The capture thread **writes** `DelegationChain` hops and `TaskRun.parentTaskRunId` / `a2aMetadata` (role/tier/enteredVia). PR #1467 **already projects** those into `a2a-delegation` and `a2a-task-lineage` edges and renders them in `A2aInteractionsPanel`.
- Both threads otherwise risk building **two parallel Operations-Map overlays** for the same coworker↔coworker concept.

**Proposal:** the typed-edge substrate from PR #1467 — `OperationsMapA2aEdge` / `a2aEdges` on the topology + `A2aInteractionsPanel` + `project-a2a-interactions.ts` — becomes the **shared render/projection substrate**. The capture thread's "collaboration-graph inspector" projects into that model (add inputs to the projector) rather than adding a second overlay. Division of ownership:

| Concern | Owner |
|---|---|
| Writing collaboration substrate (AgentEvent bus, `DelegationChain`, `a2aMetadata`, branch identity) | Capture thread (`BI-9DB7C332`) |
| Typed-edge topology model + Operations-Map render/projection/filter/inspector | Ops-Map thread (`BI-65B0D697`) |
| Deliberation branch identity decision + capture (§2) | Capture thread, per this note |

## 5. Minimal capture change (only if Option A is chosen)

| Model | Field | Type | Written at | Notes |
|---|---|---|---|---|
| `TaskNode` | `agentId` (or `personaAgentId`) | `String?` | `deliberation-run.ts:221-228` (alongside `routeDecision`) | Nullable; populated only for deliberation branches once a persona→`Agent` binding exists. Requires a persona→Agent registration/mapping policy. |

If Option B is chosen, **no migration**; the Ops-Map thread builds the coordinator-side deliberation affordance from `TaskNode.routeDecision` + `workerRole` as a follow-up slice.

## 6. Asks of the capture thread (acknowledgement)

1. Decide §2 Option A vs B.
2. If A: add `TaskNode.agentId` + persona→Agent mapping, and emit `identityKind:"agent"` rows (§3).
3. Adopt the §4 division of ownership so the "collaboration-graph inspector" composes the PR #1467 typed-edge substrate instead of a parallel overlay.
4. Coordinate before either thread pushes further Operations-Map render changes (continuous overlap sweep).
