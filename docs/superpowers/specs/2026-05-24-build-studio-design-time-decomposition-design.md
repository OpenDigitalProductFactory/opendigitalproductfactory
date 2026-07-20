---
title: Build Studio design-time decomposition - Epic parent, FeatureBuild children, Ideate-to-Plan gate
authoredAt: 2026-05-24
authoredBy: mark-bodman
status: draft
specKind: design
backlogItem: BI-2E6CC391 - Research: Build Studio concurrent Feature Builds; design and implement
epic: EP-BUILD-STUDIO primary; EP-9FC5D2FD empirical Dale hardening; EP-REDUCTION-GEAR-ARCH instrumentation alignment
relatedSpecs:
  - docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md
  - docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md
  - docs/superpowers/specs/2026-05-20-build-studio-layout-redesign-design.md
  - docs/superpowers/specs/2026-05-22-build-studio-sandbox-admin-recovery-design.md
relatedPrinciples:
  - docs/founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md
  - docs/founder-kernel/wiki/principles/research-before-implementing.md
  - docs/founder-kernel/wiki/principles/consult-specs-first.md
  - docs/founder-kernel/wiki/principles/architecture-over-shortcuts.md
  - docs/founder-kernel/wiki/principles/structural-verification-is-not-functional.md
empiricalAnchor: docs/dogfood/2026-05-23-dale-hvac-build-studio.md
persona: docs/personas/dale-hvac.md
---

# Build Studio design-time decomposition

## TL;DR

Build Studio today produces one `FeatureBuild` per request and tries to take that build through one Plan. When the request is xlarge, the Plan phase can oscillate instead of converging. Dale's truck-parts run is the concrete failure: 99 -> 86 -> 50 -> 97 tasks across review rounds, then idle with `phase=plan, sandboxId=null` ([dogfood log Phase H](../../dogfood/2026-05-23-dale-hvac-build-studio.md)). D38 (PR [#1107](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1107)) made the cliff visible; this spec removes the cliff earlier.

The fix is **design-time decomposition**: after `reviewDesignDoc` passes and before any `reviewBuildPlan` runs, the platform runs a deterministic sizing pass over the approved design. If the design is too large for one Plan, Build Studio proposes 2-4 candidate splits, the operator approves one, and the platform creates **child FeatureBuilds under one Epic that carries the immutable design contract**. Each child then plans against a coherent subset of the parent's acceptance criteria.

The substrate change is additive but must be normalized: `Epic` gains design-contract fields and a `featureBuilds` relation; `FeatureBuild` gains `parentEpicId`, `childOrder`, and `supersededByEpicId`; `BacklogItem` gains `activeEpicId`; and sibling dependencies use a `FeatureBuildDependency` join table, not a string array. No new parent/work-item concept is introduced, and no new `BuildPhase` values are introduced in the first rollout.

## 1. Why

### 1.1 Empirical baseline: Dale, FB-6F7D6AC4, 2026-05-23 to 2026-05-24

Full session: [docs/dogfood/2026-05-23-dale-hvac-build-studio.md](../../dogfood/2026-05-23-dale-hvac-build-studio.md). Persona: [docs/personas/dale-hvac.md](../../personas/dale-hvac.md). Single intake sentence: "I want to know what parts each truck has so my guys stop driving back to the warehouse."

Ideate succeeded on first review. The design doc that emerged was directionally correct and complete:

- 5 new database models
- 2 API surfaces
- Mobile-first UI with low-stock badges
- Authorization layer
- Idempotency key + optimistic locking acceptance criteria
- Append-only ledger discipline
- Multi-tenant isolation

Plan failed to converge:

| Round | Tasks | Issues | Critical | Reviewer signal |
|------:|------:|-------:|---------:|-----------------|
| 1 | initial | 21 | many | scope/granularity ("smaller steps") |
| 2 | 99 | 11 | 4 | structural rigor ("test-first") |
| 3 | 86 | 13 | unknown | consolidation overshoot |
| 4 | 50 | 21 | 6 | back to "smaller steps" |
| 5 | 97 | 15 | 4 | mixed; agent went idle |

D38 persisted `planReview.iteration` and surfaced the "(Round N: X addressed, Y persist, Z new)" trajectory chip. The agent now honors persistence in chat, but it cannot break out of the local minimum because the reviewer is optimizing competing axes: test-first sequencing, bite-sized tasks, alternatives documented, and scope completeness. Those are all legitimate requirements; the scope is the problem.

### 1.2 The shape of the cliff

This is not primarily a Plan prompt problem. The reviewer is right to reject a 97-task, 5-model, 2-surface, mobile-plus-ledger-plus-auth plan. Relaxing the reviewer would hide quality problems. Capping iterations would force a bad plan forward.

The cliff is upstream: **the design that survived Ideate was xlarge, and the platform tried to plan it as one unit**. The Ideate reviewer (`reviewDesignDoc` at [apps/web/lib/mcp-tools.ts:6657](../../../apps/web/lib/mcp-tools.ts:6657)) approves designs on quality: correctness, completeness, acceptance criteria, mobile discipline, and multi-tenant safety. It does not currently ask "is this one build or several?" That is the missing gate.

### 1.3 Why design-time, not promotion-time or plan-time

| Gate | Pro | Con | Verdict |
|------|-----|-----|---------|
| Promotion (`promote_to_build_studio`, [mcp-tools.ts:446](../../../apps/web/lib/mcp-tools.ts:446)) | Earliest; nothing wasted | Manual promotion does not read `effortSize`; automatic tee-up treats size as an eligibility signal, but the truth still depends on what Ideate uncovers | Reject as the primary gate |
| Design-end, after `reviewDesignDoc` pass | Design doc is the substrate; AC count, model count, surface count, and complexity multipliers are readable | Adds a second gate to Ideate exit | Accept |
| Plan early-feedback, after first `reviewBuildPlan` | Catches work that slipped past design-time sizing | Tasks and reviewer churn already exist | Keep as a retroactive escape hatch |

The design doc is where the truth lives. By the time `reviewDesignDoc` passes, the platform has a structured representation of the proposed models, endpoints, UI surfaces, and acceptance criteria. Sizing that substrate is more reliable than sizing an intake sentence or a manually assigned backlog label.

## 2. Substrate currently in the repo

Per [verify-substrate-before-proposing-new](../../founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md), this design is anchored in the current repo before proposing structure.

### 2.1 What exists

| Surface | File | Current behavior |
|---------|------|------------------|
| `BacklogItem.effortSize` | [packages/db/prisma/schema.prisma:962](../../../packages/db/prisma/schema.prisma:962) | Nullable string: `small`, `medium`, `large`, `xlarge`. Operator-assigned at triage time. |
| `BacklogItem.activeBuildId` | [packages/db/prisma/schema.prisma:964](../../../packages/db/prisma/schema.prisma:964) | Nullable unique FK-shaped pointer to the active top-level `FeatureBuild`. It cannot represent "this BI is active as an Epic with N child builds." |
| `Epic` | [schema.prisma:1155](../../../packages/db/prisma/schema.prisma:1155) | Groups `BacklogItem[]`. No `FeatureBuild` relation and no design contract fields. |
| `FeatureBuild` | [schema.prisma:4279](../../../packages/db/prisma/schema.prisma:4279) | Owns `designDoc`, `designReview`, `buildPlan`, `planReview`, `phase`, and `buildExecState`. Has `originatingBacklogItemId`; no `parentEpicId`; no dependency relation. |
| `BuildPhase` | [apps/web/lib/explore/feature-build-types.ts:265](../../../apps/web/lib/explore/feature-build-types.ts:265) | Canonical union: `ideate`, `plan`, `build`, `review`, `ship`, `complete`, `failed`. |
| `reviewDesignDoc` | [mcp-tools.ts:6657](../../../apps/web/lib/mcp-tools.ts:6657) | Reviews `FeatureBuild.designDoc`, writes `FeatureBuild.designReview`, and advances passing top-level builds from `ideate` to `plan`. |
| `reviewBuildPlan` | [mcp-tools.ts:6945](../../../apps/web/lib/mcp-tools.ts:6945) | Reviews `FeatureBuild.buildPlan`, writes `FeatureBuild.planReview`, and includes D38 iteration trajectory data. |
| `propose_decomposition` | [mcp-tools.ts:1561](../../../apps/web/lib/mcp-tools.ts:1561), handler [mcp-tools.ts:6063](../../../apps/web/lib/mcp-tools.ts:6063) | Exists today as validation/echo for a decomposition plan. It does not create Epics or FeatureBuild children. |
| `/build` list data | [feature-build-data.ts:14](../../../apps/web/lib/explore/feature-build-data.ts:14) | Reads one row per `FeatureBuild` where `phase != "failed"`, ordered by `updatedAt`. It has no Epic rollup read model. |
| Build Studio route context | [route-context-map.ts:519](../../../apps/web/lib/tak/route-context-map.ts:519) | `/build` already tells TAK to use Build Studio tools, including `propose_decomposition`. |
| Activity Quiescence | [2026-05-24-activity-quiescence-protocol-design.md](2026-05-24-activity-quiescence-protocol-design.md) | Coordination primitive for draining in-flight work before mutating shared state. |
| Reduction Gear | [2026-05-24-reduction-gear-architecture-design.md](2026-05-24-reduction-gear-architecture-design.md) | Ring 2 is predictable AI-human workflow; this spec is a Ring-2 stage refinement. |

### 2.2 What does not exist

- No `Epic.designDoc` field. Only `FeatureBuild` carries a design doc today.
- No `Epic.featureBuilds` relation.
- No `FeatureBuild.parentEpicId`.
- No normalized build-level dependency edges.
- No design-time size heuristic.
- No Epic rollup in `/build`.
- No parent-level active pointer on `BacklogItem`.

### 2.3 Why Epic-as-parent, not a new `Initiative` entity

Mark's direction on 2026-05-24: "the parent / child decomposition is how epics work, not with BIs under them." Reframing Epic as the multi-build parent reuses the entity that already means "a coherent body of work bigger than one item."

These uses coexist:

- **Portfolio-organizational Epic:** groups related BIs, has no design contract, and may never create child FeatureBuilds.
- **Execution-organizational Epic:** owns one approved design contract plus multiple child FeatureBuilds derived from that contract.

The distinction is observable from the data: an execution-organizational Epic has `designDoc` and `featureBuilds`; a portfolio-organizational Epic does not. No new `Epic.type` is necessary in the first rollout.

## 3. Research & Benchmarking

AGENTS.md requires benchmarking before finalizing new feature specs. The relevant pattern across mature planning tools is not "make every task a flat issue"; it is "keep one parent contract visible, model children explicitly, and model blocking relationships separately from hierarchy."

| Product | Observed pattern | Adopt for DPF | Reject for DPF |
|---------|------------------|---------------|----------------|
| [GitLab Epics](https://docs.gitlab.com/user/group/epics/) | Epics can parent issues and child epics, and GitLab is converging epics into a unified work-item framework. | Parent object carries the larger outcome; children stay visible under that parent. | Arbitrary nested epics for first rollout; DPF's first failure is one design split into child builds, not a general hierarchy editor. |
| [OpenProject work package relations](https://www.openproject.org/docs/user-guide/work-packages/work-package-relations-hierarchies/) | Parent-child hierarchy is distinct from relations such as Blocks / Blocked by. | Normalize sibling dependencies as edges. Waiting state is derived from dependency edges plus child phases. | `dependsOnBuildIds String[]`; it makes reverse lookup, FK safety, and cycle checks harder. |
| [GitHub sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues) | Parent issues roll up sub-issues and show parent/sub-issue progress in project views. | `/build` should show one parent Epic row with child progress and plain-language "Waiting on" labels. | Deep nesting up front; GitHub supports it, but Build Studio needs execution control before hierarchy depth. |
| [Jira Advanced Roadmaps hierarchy](https://support.atlassian.com/jira-software-cloud/docs/configure-custom-hierarchy-levels-in-advanced-roadmaps/) | Larger hierarchy levels can be configured above Epic, but such changes affect parent/child relationships broadly. | Avoid introducing an Initiative-like table for this slice; use existing Epic and keep migration blast radius narrow. | Product-specific hierarchy customization before DPF has evidence that operators need it. |
| [Linear Initiatives](https://linear.app/docs/initiatives) and [Projects](https://linear.app/docs/projects) | Initiatives roll up project health; projects are large units of work with progress and documents. | Parent rollup should show health, active child, and document contract without forcing platform vocabulary on Dale. | Splitting conversation ownership onto the parent; child FeatureBuilds remain the actionable units. |

## 4. Architectural decisions from this review

1. **Do not add first-rollout `BuildPhase` values.** Current `BuildPhase` is `ideate | plan | build | review | ship | complete | failed`. Waiting on a sibling is a derived read-model state, not `phase="blocked-on-sibling"`. Supersession is represented by `supersededByEpicId`, `abandonedAt`, and `abandonReason`, not `phase="superseded"`.
2. **Use normalized dependency edges.** A `FeatureBuildDependency` table gives FK integrity, reverse lookup, uniqueness, and cycle-checking. String arrays do not.
3. **Resolve `BacklogItem.activeBuildId` ambiguity.** Decomposed active work needs `BacklogItem.activeEpicId`, with an invariant that active work points to either one active build or one active Epic, never both.
4. **Reuse and harden `propose_decomposition`.** The existing tool name should not be bypassed by a duplicate hidden workflow. The first implementation should evolve it into a read-only proposal/validation tool, then add a separate write-scoped approval tool.
5. **Persist thresholds in Build Studio config, not `PlatformDevConfig`.** The closest existing pattern is `PlatformConfig`-backed Build Studio settings; a dedicated table can follow if thresholds become operator-edited records.
6. **Keep first rollout non-recursive.** Children do not re-decompose into grandchildren. If a child oscillates, the operator amends the parent or re-slices non-started children.

## 5. Design

### 5.1 The gate

**Trigger:** `reviewDesignDoc` returns a passing review decision for a top-level `FeatureBuild` with no `parentEpicId`.

**Action:** Run `sizeDesignDoc(featureBuildId)`. This is deterministic and model-free: it counts structured properties of the approved design doc and applies thresholds.

**Inputs read from `FeatureBuild.designDoc`:**

- New database models proposed
- API endpoints proposed, including auth complexity flags
- New UI routes / surfaces
- Acceptance criteria count
- ACs touching idempotency, optimistic locking, append-only ledgers, multi-tenant isolation, background jobs, or cross-surface synchronization
- Cross-cutting concerns such as auth, audit, contribution applicability, mobile, and offline/error recovery

**Output:** one of `{ ok, decompose-recommended, decompose-required }`.

- `ok`: proceed to Plan as today.
- `decompose-recommended`: show an inline recommendation; operator may proceed as one build.
- `decompose-required`: operator must decompose, narrow the design, or type a one-line override that is recorded for audit.

**Thresholds** (initial calibration; tuneable via `PlatformConfig` key `build-studio-decomposition` or a future dedicated Build Studio config model):

| Property | Recommend | Required |
|----------|----------:|---------:|
| New DB models | 3 | 5 |
| API endpoints | 4 | 7 |
| Total ACs | 12 | 20 |
| ACs touching complexity multipliers | 2 | 4 |
| New UI routes | 2 | 4 |

A design hits the higher level if any threshold trips at that level. Dale's truck-parts design would have scored: 5 models (required), 2 APIs (under), 25+ ACs (required), 4 complexity multipliers (required), 2 routes (recommend). Required. The gate would have fired.

This pass is intentionally not model-driven. Per [structural-verification-is-not-functional](../../founder-kernel/wiki/principles/structural-verification-is-not-functional.md), decomposition gates are too important to delegate to a confabulation-prone surface. Counting is deterministic, explainable, and replayable.

### 5.2 The decomposition assistant

Trigger: the gate returned `decompose-recommended` or `decompose-required` and the operator clicked "Propose splits."

The assistant calls a Software Architect-class coworker with the approved design doc and asks for 2-4 candidate decompositions. Each decomposition is a partition of the design's ACs into 2-4 child scopes. Each child scope must:

- Ship a usable increment on its own.
- Stay below the `recommend` thresholds where possible.
- Name sibling dependencies explicitly in terms the operator can understand.
- Preserve parent acceptance criteria traceability.
- Avoid moving one AC into two children unless the duplicate is marked as a shared invariant.

The existing `propose_decomposition` MCP tool should become the public read-only proposal/validation contract for this step. It remains side-effect-free, and its grant profile should be reconciled with that contract. Approval is a separate write-scoped tool, likely `approve_decomposition`, so the model cannot accidentally create children while brainstorming options.

For Dale's truck-parts ask, a plausible decomposition is:

- **Child 1 - Truck and parts read.** Models: MobileInventoryLocation, InventoryItem, LocationInventory. Endpoints: My Inventory list and detail. UI: truck-stock viewer. Read authorization only. No mutations, idempotency, or ledger. Ships first so techs can look up parts.
- **Child 2 - Record usage.** Model: InventoryTransaction. Endpoint: Record Usage POST. UI: usage action. Idempotency key, optimistic locking, append-only ledger. Depends on Child 1.
- **Child 3 - Low-stock surfacing.** Derived low-stock query, low-stock badge, dispatch roll-up, threshold seed/config. Depends on Child 1 and Child 2.

The operator picks a decomposition, edits it, or asks for a fresh proposal with a short hint.

### 5.3 What happens on approval

The platform performs the approval atomically in one Prisma transaction, wrapped by the same advisory-lock discipline used by `promoteBacklogItemToBuildDraft`:

1. Create an execution-organizational Epic. Title defaults from the design doc title. `originatingBacklogItemId`, `designDoc`, and `designReview` are copied from the originating FeatureBuild. `decompositionState` stores the chosen partition, AC-to-child mapping, dependency edges, approver, timestamp, rationale, and superseded build id.
2. For each child scope, create a live child BacklogItem linked to the execution Epic. It inherits the originating item's intake/work-type facets, records its sibling dependencies in the body, and becomes the durable queue identity for that independently shippable scope.
3. For each child scope, create a FeatureBuild:
   - `parentEpicId` set to the new Epic.
   - `originatingBacklogItemId` set to that scope's child BacklogItem; the Epic and coverage receipt retain the umbrella relationship for audit and reporting.
   - `childOrder` set per the chosen sequence.
   - `designDoc` set to a child-scoped projection of the parent doc.
   - `designReview` copied from the parent, with metadata showing transitive approval from the parent contract.
   - `phase` set to `plan` only when dependency edges are clear. Children with unmet sibling dependencies still use an existing phase, usually `plan`, but dispatch/review gates treat them as "waiting" until dependencies clear.
4. Create `FeatureBuildDependency` rows for sibling dependencies.
5. Mark the original FeatureBuild as superseded without inventing a new phase: set `supersededByEpicId`, `abandonedAt = now()`, and `abandonReason = "decomposed-into-epic:<epicId>"`. Preserve its original phase for audit.
6. Update the umbrella BacklogItem to `activeEpicId = <epic.id>` and `activeBuildId = null`; each child BacklogItem points to its child build.
7. Record a `plan_backlog_coverage` activity on the umbrella with the child BI/build mapping and dependency graph, plus `decomposition_created` on each child FeatureBuild.

`getFeatureBuilds` and the `/build` route then exclude superseded top-level builds from the main list and include Epic rollups for active execution-organizational Epics.

### 5.4 Eager creation, not lazy

All N children are created at approval time, not generated one-at-a-time as predecessors complete.

- **Contract immutability.** Eager creation snapshots one parent contract and one partition decision.
- **Visibility.** The operator can see "3 of 3 builds queued" immediately.
- **Dependency planning.** The platform can compute the DAG and parallelize independent children.
- **Rollup correctness.** Aggregate state is well-defined because N is known.

The cost is that a wrong parent contract can invalidate multiple unstarted children. The mitigation is the amendment flow in Section 7.

### 5.5 Data model changes

All changes are additive. Existing rows continue to work unchanged.

```prisma
model Epic {
  // existing fields ...
  originatingBacklogItemId String?
  originatingBacklogItem   BacklogItem? @relation("EpicOriginatingBacklogItem", fields: [originatingBacklogItemId], references: [id])
  designDoc                Json?
  designReview             Json?
  decompositionState       Json?
  activeBacklogItem        BacklogItem? @relation("BacklogItemActiveEpic")
  featureBuilds            FeatureBuild[] @relation("FeatureBuildParentEpic")
  supersededFeatureBuilds  FeatureBuild[] @relation("FeatureBuildSupersededByEpic")
  dependencies             FeatureBuildDependency[] @relation("FeatureBuildDependencyParentEpic")

  @@index([originatingBacklogItemId])
}

model BacklogItem {
  // existing fields ...
  activeEpicId            String? @unique
  activeEpic              Epic?   @relation("BacklogItemActiveEpic", fields: [activeEpicId], references: [id])
  originatedExecutionEpics Epic[] @relation("EpicOriginatingBacklogItem")
}

model FeatureBuild {
  // existing fields ...
  parentEpicId       String?
  parentEpic         Epic?   @relation("FeatureBuildParentEpic", fields: [parentEpicId], references: [id])
  childOrder         Int?
  supersededByEpicId String?
  supersededByEpic   Epic?   @relation("FeatureBuildSupersededByEpic", fields: [supersededByEpicId], references: [id])

  dependencies       FeatureBuildDependency[] @relation("FeatureBuildDependencyDependent")
  dependents         FeatureBuildDependency[] @relation("FeatureBuildDependencyDependency")

  @@index([parentEpicId, childOrder])
  @@index([supersededByEpicId])
}

model FeatureBuildDependency {
  id                        String       @id @default(cuid())
  parentEpicId              String
  dependentFeatureBuildId   String
  dependencyFeatureBuildId  String
  reason                    String?
  createdAt                 DateTime     @default(now())

  parentEpic                Epic         @relation("FeatureBuildDependencyParentEpic", fields: [parentEpicId], references: [id], onDelete: Cascade)
  dependentBuild            FeatureBuild @relation("FeatureBuildDependencyDependent", fields: [dependentFeatureBuildId], references: [id], onDelete: Cascade)
  dependencyBuild           FeatureBuild @relation("FeatureBuildDependencyDependency", fields: [dependencyFeatureBuildId], references: [id], onDelete: Cascade)

  @@unique([dependentFeatureBuildId, dependencyFeatureBuildId])
  @@index([parentEpicId])
  @@index([dependencyFeatureBuildId])
}
```

Implementation note: the exact relation names may need adjustment to coexist with current Prisma relation names, but the architecture decision is fixed: dependencies are rows, not arrays.

Application invariants:

- A child `FeatureBuild.parentEpicId` requires parent `Epic.designDoc`.
- A child inherits design approval from the parent only at creation time; later parent amendments re-derive unstarted or not-yet-built children explicitly.
- `FeatureBuildDependency.parentEpicId` must match both builds' `parentEpicId`.
- A dependency cannot point to itself.
- The dependency graph under one Epic must be acyclic.
- `BacklogItem` active work has exactly one active pointer: `activeBuildId` XOR `activeEpicId`.
- Recursive decomposition is not allowed in the first rollout.
- Superseded top-level builds are hidden from `/build` primary lists but remain queryable for audit.

### 5.6 Waiting state without a new phase

Children with unmet dependency edges do not receive a new `BuildPhase` value. Their UI state is derived:

- Stored phase remains one of the canonical values.
- Dispatch and plan-review gates check dependency readiness before starting or advancing the child.
- `/build` renders the derived state as "Waiting on Truck and parts read."
- When a dependency reaches terminal success (`complete` in the current phase union), the platform queries reverse dependency edges and clears waiting state for eligible siblings.

This keeps the phase state machine stable while still giving operators the plain-language state they need.

### 5.7 Coordination protocol

The Epic is the coordinating read model; child FeatureBuilds remain the executable units.

Parent state is derived at read time:

- `ready`: children exist; none has started build execution.
- `in-progress`: at least one child is in `build`, `review`, or `ship`, or at least one child is `complete` while others remain.
- `complete`: all children are in terminal success.
- `blocked`: every incomplete child is waiting on a failed or unresolved dependency, with no child currently progressing.
- `needs-attention`: at least one child is `failed`, superseded, or requires operator amendment.

When a child fails, the Epic does not auto-cascade. The operator can re-run the child Plan, amend the parent design, or abandon the Epic. Abandoning the Epic marks remaining children with `abandonedAt` and `abandonReason = "epic-abandoned:<epicId>"`; it does not invent a new phase.

Activity Quiescence is used when an amendment must propagate to children with in-flight Plan iteration. A `QuiescenceRun` drains those iterations before the amendment lands. Completed children are not mutated; if the amendment implies follow-up work, the operator files a BI under the Epic.

### 5.8 Phase H trajectory chip becomes a one-click affordance

Today PR [#1107](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1107) can surface a trajectory chip such as "(Round 3: 0 addressed, 15 persist, 0 new) - consider splitting this feature into smaller scopes."

After this spec, the chip becomes a button for top-level builds with a design doc. Click -> run `sizeDesignDoc` retroactively and open the decomposition assistant. If the build has no design doc, the button is disabled with hover text "Need a design doc first." If the build is already a child, the button offers "Amend parent design" rather than recursive decomposition.

## 6. Operator UI

All UI must use existing DPF theme tokens from `apps/web/app/globals.css`. Do not introduce hardcoded colors or non-existent token names. Per [no-hardcoded-colors](../../founder-kernel/wiki/principles/no-hardcoded-colors.md), use `--dpf-*` tokens.

### 6.1 Decomposition prompt at Ideate exit

When `sizeDesignDoc` returns `decompose-required`, the design-review-passed banner is augmented:

```text
+----------------------------------------------------------------+
| Design review PASSED                                            |
| ---------------------------------------------------------------- |
| Heads up: this design is bigger than fits in one build.          |
| 5 database models, 25 acceptance criteria, and 4 criteria need   |
| ledger / idempotency / multi-tenant work.                        |
|                                                                 |
| Recommended: split this into 2-4 smaller builds that ship one    |
| at a time. Each smaller build will plan faster and be easier     |
| to verify.                                                       |
|                                                                 |
| [ Propose splits ]   [ Keep as one build (explain why) ]         |
+----------------------------------------------------------------+
```

Styling:

- Container: `bg-[var(--dpf-state-warning)] border-[var(--dpf-warning)] text-[var(--dpf-text)]`.
- Primary button: existing accent button pattern, `bg-[var(--dpf-accent)] text-white`.
- Secondary path: neutral button on `bg-[var(--dpf-surface-1)] border-[var(--dpf-border)] text-[var(--dpf-text)]`.
- Override helper text: `text-[var(--dpf-muted)]`.

For `decompose-required`, "Keep as one build" is text-input gated and writes `FeatureBuild.designReview.decompositionOverride`. For `decompose-recommended`, the same surface says "Worth considering" and the proceed-as-one path is one click.

### 6.2 Decomposition assistant panel

Use a right rail, not a modal, so the approved design remains visible.

Each candidate proposal card shows:

- Title in the operator's vocabulary.
- One-line outcome summary.
- 3-7 included ACs.
- Plain-language dependency labels.
- Expand toggle for all ACs and details.

Controls:

- Pick proposal as-is.
- Edit proposal: rename child, drag AC, reorder child sequence.
- Ask for new proposal with a short hint.

Styling:

- Rail background: `bg-[var(--dpf-bg)]`.
- Cards: `bg-[var(--dpf-surface-1)] border-[var(--dpf-border)]`.
- Hover/drag state: `bg-[var(--dpf-surface-2)]`.
- Selected proposal: `bg-[var(--dpf-accent-soft)] border-[var(--dpf-accent)]`.
- Dependency arrows: `color-mix(in srgb, var(--dpf-accent) 45%, var(--dpf-border))` or an existing icon stroke using `text-[var(--dpf-accent)]`.

### 6.3 Epic-with-children rollup in `/build`

Today `/build` lists one row per `FeatureBuild`. After this spec:

- Superseded top-level builds are hidden from the primary list.
- Child FeatureBuilds appear nested under their parent Epic.
- Execution-organizational Epics appear as top-level rows.

Collapsed:

```text
+--------------------------------------------------------------+
| > Truck inventory                          1 of 3 - in progress |
|   Open since 2026-05-23  -  Mobile-first  -  Multi-tenant       |
+--------------------------------------------------------------+
```

Expanded:

```text
+----------------------------------------------------------------+
| v Truck inventory                          1 of 3 - in progress |
|   Open since 2026-05-23  -  Mobile-first  -  Multi-tenant       |
|                                                                 |
|   [complete] 1. Truck and parts read                            |
|              Truck list, parts viewer, read auth                |
|   [build   ] 2. Record usage                                    |
|              Mark parts used, idempotency, optimistic locking   |
|              Driving live: FB-...                               |
|   [waiting ] 3. Low-stock surfacing                             |
|              Restock visibility, dispatch roll-up               |
|              Waiting on: Record usage                           |
+----------------------------------------------------------------+
```

"Waiting on" always renders titles, not internal IDs. The next actionable child uses `bg-[var(--dpf-accent-soft)]` plus a compact "Up next" tag. Do not use nested cards inside cards; the Epic row expands into an unframed child list inside the row.

### 6.4 Coworker chat continuity

Each child carries its own coworker thread. The Epic itself does not have a chat thread in the first rollout. The coworker calls children "Truck and parts read," "Record usage," and "Low-stock surfacing," not "the parent Epic" or "child build 2."

When the operator switches children, the live-preview footer ("Open live preview - driving:") updates to the active child. The D34 driving-pointer staleness issue remains a dependency before this ships ([BI-EEC5A5ED](http://localhost:3000/backlog/BI-EEC5A5ED)).

## 7. Amendment flow

The parent design doc is the contract. If a child reveals that the parent design is wrong, the operator can amend the parent, but the path is loud and audited.

1. From any child, operator clicks "Amend parent design."
2. A diff view opens: parent `designDoc` vs proposed edit.
3. The Software Architect coworker assesses impact: which children have started Plan, which are in build/review/ship, which are complete, and whether the amendment invalidates completed contracts.
4. If any affected child has in-flight Plan work, Activity Quiescence drains those iterations first.
5. `Epic.designDoc` updates and `Epic.decompositionState.amendments[]` appends the structured diff, rationale, operator, timestamp, and affected child ids.
6. Affected children that are not complete have their design projections re-derived. Their next Plan run is operator-visible; no silent auto-resume.
7. Completed children are not touched. If the amendment implies new work against a completed child, the operator is prompted to file a follow-up BI under the Epic.

Amendment is intentionally heavyweight. Cheap amendment would turn the parent contract into a mutable suggestion, which recreates the drift this design is meant to avoid.

## 8. Failure modes addressed

| Risk | Response |
|------|----------|
| Decomposition too aggressive | Thresholds are calibrated so small/medium designs do not trip. Required threshold starts at 5 models or 20 ACs. |
| Decomposition too conservative | Dale's baseline would trip 3 of 5 required thresholds; Phase 9 adds calibration once decomposed-Epic evidence exists. |
| Parent/child drift | Parent amendments are audited, quiesced, and explicit; completed children are immutable. |
| Dependency tangles | Dependency edges are normalized and rendered as "Waiting on <title>"; failed dependencies surface on dependent children. |
| Rollup hides a stalled child | D38 trajectory chips operate per child; parent rollup surfaces `needs-attention`. |
| Contribution semantics break | Execution-organizational Epic becomes the contribution unit; parent design doc is the narrative, child diffs are the evidence. |
| D31/D35/D36/D37 runtime cluster | Out of scope. Smaller children reduce exposure window but do not replace those fixes. |
| Resume reconciler re-runs expensive pre-build work on a gate-parked build (BI-BD4F2D0D) | A build parked at the `decompose-required` gate (design passed review, no override) is *waiting on a human*, not stranded. `resumePreBuildPhase` (the boot + periodic resume reconciler, `apps/web/lib/integrate/resume-pre-build-phase.ts`) must NOT re-dispatch Ideate (~847s of cloud spend) or re-run `reviewDesignDoc` (recomputes the same verdict, re-fires the gate) — it detects the parked state via the same condition as §5.1's gate, proposes decomposition candidates once (idempotently) so the operator can `approve_decomposition`/`record_decomposition_override`, then parks. Live repro: FB-7930340F looped for ~2 days, amplified by the #2156 periodic reconciler. |

## 9. Reduction-gear framing

This spec is a Ring-2-internal stage refinement, not a new ring. See [Reduction Gear Architecture](2026-05-24-reduction-gear-architecture-design.md).

- **Today:** Ring 2 has one stage between Ideate and Plan. For xlarge inputs, the ratio is too steep and the output stalls.
- **After this spec:** Ring 2 gains a deterministic sizing and decomposition stage at the Ideate-to-Plan boundary.
- **GearInterface emission:** every decomposition decision emits a gear-interface event with size, complexity, child count, override status, and eventual outcome. This lets Hive evidence teach future per-archetype thresholds.

Connection to other rings:

- **Ring 2 to 3:** archetype-aware calibration of thresholds. Field-service work has different complexity signals than SaaS dashboard work.
- **Ring 4 to 5:** contributions ship as execution Epics, not monolithic FeatureBuilds.

## 10. Phased rollout

Each phase ships as one Build Studio feature and lands by PR against `main`.

| Phase | Deliverable | Test scenario | Ships alone? |
|-------|-------------|---------------|--------------|
| 0 | This design memo, signed off | n/a | yes |
| 1 | Schema substrate: `Epic` design fields, `BacklogItem.activeEpicId`, `FeatureBuild.parentEpicId`, `FeatureBuildDependency`, supersession fields, invariants | Existing builds list and promote unchanged. New columns nullable. Unit tests cover active pointer XOR and dependency validation. | yes |
| 2 | `sizeDesignDoc` deterministic counter + evidence logging | Run Dale's `FB-6F7D6AC4` design through the counter; verify required threshold with no UX change. | yes |
| 3 | Ideate-exit banner, informational only | Drive a new Dale persona BI; observe required/recommended banner; proceed/override paths are audited. | yes |
| 4 | `propose_decomposition` proposal flow + `approve_decomposition` transaction | Drive Dale; approve a split; verify Epic, children, dependency rows, and design projections. | yes |
| 5 | `/build` Epic rollup and child detail waiting state | Verify top-level Epic row, expansion, child phases, and plain-English "Waiting on." | yes |
| 6 | Dependency gate enforcement and auto-clear on terminal success | Complete Child 1; verify dependent child becomes actionable without a new phase value. | yes |
| 7 | D38 trajectory chip -> decompose-now / amend-parent affordance | Replay a Plan-iteration oscillation; verify top-level builds can decompose and child builds route to amendment. | yes |
| 8 | Amendment flow + QuiescenceRun integration | Amend parent mid-execution; verify quiescence, re-derived child design, and completed-child immutability. | yes |
| 9 | Per-archetype threshold calibration | Deferred until Hive has enough decomposed-Epic evidence to fit thresholds. | no |

Re-runnable persona scenario for phases 4+:

"Re-drive Dale's truck-parts ask from a fresh persona BI. Verify it becomes one Epic with 3 coordinated child FeatureBuilds within the same wall-clock window the original `FB-6F7D6AC4` took to stall. At least 1 child reaches `complete`, and the remaining children are actionable, building, or visibly waiting on named dependencies. A Dale-class operator can read the rollup without platform vocabulary."

Phase 3 or 4 must add this scenario to [docs/personas/dale-hvac.md](../../personas/dale-hvac.md); this memo does not claim that edit has already happened.

## 11. Constraints honored

- **Spec-only thread.** This pass updates the design artifact only. Implementation belongs in follow-on Build Studio work.
- **Live backlog checked.** Relevant live anchors: `BI-2E6CC391`, `EP-BUILD-STUDIO`, `EP-9FC5D2FD`, and `EP-REDUCTION-GEAR-ARCH`.
- **Verify substrate before proposing new.** Section 2 separates current repo truth from future contract.
- **Cite sources.** Repo paths, empirical dogfood evidence, PRs, kernel principles, and external benchmarking sources are linked.
- **Single source of truth.** Parent Epic carries the design contract; child projections are derived.
- **Theme-aware UI.** Section 6 uses existing `--dpf-*` variables and avoids nonexistent token names.
- **Privacy and multi-tenancy unchanged.** All relations remain per-install.
- **No new parent concept.** Epic is the parent; FeatureBuilds are executable children.

## 12. Sign-off decisions

1. **Override on `decompose-required`:** allowed, but must require a one-line justification and must be recorded in `FeatureBuild.designReview.decompositionOverride`.
2. **Coworker role:** the existing **Software Engineer** coworker (slugId `build-specialist`) absorbs architect responsibilities, including design-time decomposition. The "Software Architect" role does not exist as a discrete coworker today; rather than introduce a new seed, extend the Software Engineer's description and prompt to claim architect scope, and reference a DPF-specific architecture-patterns doc (MVC mapping in Next.js app router, singleton/factory restraint rules, GearInterface emission points, WWMD consultation pattern, DPF anti-patterns from kernel memory). The architecture-patterns doc is filed as a follow-up BI; this spec's Phase 1 work proceeds against the Software Engineer prompt as-is, with the patterns reference added in parallel. Reconsider a dedicated Decomposition Architect only if production evidence shows the SE role becoming a grab-bag.
3. **Epic auto-naming:** auto-name from the design doc, with inline edit before approval.
4. **Recursive decomposition:** no for first rollout. Child oscillation routes to parent amendment or re-slice of non-started children.
5. **Originating backlog placement:** `Epic.originatingBacklogItemId` retains the umbrella contract; each independently shippable child FeatureBuild points to its own live child BacklogItem. This does not make BIs the execution hierarchy — Epic remains the parent and FeatureBuilds remain its executable children — but it prevents future work from disappearing from the live backlog.
6. **Phase value:** no new `blocked-on-sibling`, `superseded`, or `shipped` phase values in first rollout.
7. **Threshold persistence:** use `PlatformConfig` key `build-studio-decomposition` first; graduate to a dedicated table only when operator-edited threshold history matters.

## 12a. Kernel consultation record

All seven sign-off questions were scored against the founder kernel via `mcp__dpf__principle_decide` (calling population `in_platform_coworker`, ring scope `["ring-2-workflow", "universal-ring"]`, 10 commandments retrieved). Feature vectors supplied per option against `PRINCIPLE_DIMENSIONS` ([packages/db/src/wiki-taxonomy.ts:144](../../packages/db/src/wiki-taxonomy.ts:144)).

| Q | WWMD recommendation | Margin | Confidence | Operator decision in §12 | Delta |
|---|--------------------|-------:|-----------|-------------------------|-------|
| 1 | text-input-override | 0.51 | high | text-input-override | match |
| 2 | software-architect | 0.16 | **low** (below tieMargin) | Software Engineer absorbs architect responsibilities (substrate correction; SA role does not exist today) | substrate override |
| 3 | auto-name-with-confirm | 0.82 | high | auto-name with inline edit before approval | match |
| 4 | forbid-recursion | 2.24 | high | no recursion in first rollout | match |
| 5 | canonical-on-epic-only | 0.44 | high | hybrid — `Epic.originatingBacklogItemId` AND keep child `originatingBacklogItemId` for audit/reporting | operator-modified (ship-smaller-first) |
| 6 | new-phase-value | 1.38 | high | no new phase values in first rollout; revisit when evidence demands | operator-modified (ship-smaller-first) |
| 7 | new-build-studio-config | 0.40 | high | `PlatformConfig` key `build-studio-decomposition` first; dedicated table when operator-edited threshold history matters | operator-modified (ship-smaller-first) |

Three operator modifications (Q5, Q6, Q7) all moved in the same direction: defer normalization until evidence justifies it. Recorded here as training signal for future kernel-weight calibration once the consultation-persistence loop (filed as follow-up BI) ships.

## 13. After sign-off

Approved spec feeds `writing-plans`; implementation lands through topic branches and PRs against `main`, per AGENTS.md. Do not commit directly to `main`.

The next smallest plan is Phase 1: schema substrate, invariants, and read-model preservation. The acceptance bar is that all existing builds still list/promote normally while the new data model can represent one active Epic with three child FeatureBuilds and normalized dependency edges.

## 14. Addendum (2026-07-19) — backlog-visible decomposition

The original implementation preserved the umbrella BI on every child build.
That made the execution graph visible in Build Studio but left independently
shippable child work absent from the canonical PostgreSQL backlog. BI-C24C83FA
corrects the boundary without introducing a new hierarchy or schema: approval
creates one child BI per child build in the same transaction and writes the
shared `plan_backlog_coverage` receipt on the umbrella. The explicit atomic
override path writes the same receipt shape with the operator rationale.
