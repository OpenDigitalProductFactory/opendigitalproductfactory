# Interaction Shape Graph & design shaping — design

**Status:** draft for operator review · 2026-08-15
**Proposed epic home:** EP-8DC217EB (Vertical Integration Inward) · composes with EP-VSL-SURFACE / EP-VSL-GOVERN
**Companion:** [Portfolio-shaped information architecture](2026-08-14-portfolio-shaped-information-architecture-design.md)
**Origin:** UX surface & navigation analysis, 2026-08-14 — four owner flows break the same way; six rail sections don't map to the four-portfolio model.

---

## 1. Problem

The 2026-08-14 analysis found the platform's surfaces sprawl relative to the work a business actually does: ~230 routes across 26 top-level domains, four everyday owner jobs (pay a bill, hire, close a customer, ship a product) each breaking on the same pattern — *the flow arrives at a surface but cannot continue* — and a rail taxonomy that doesn't correspond to the operating model DPF publishes.

Fixing those instances is necessary but insufficient. Without a **shape** to conform to, the next wave of surfaces sprawls again. What is missing is not another consolidation pass; it is a *durable, machine-checkable model of the intended human-interaction shape*, and a discipline that flags divergence from it as changes land.

### 1.1 What "shape" means here

The shape is the **human-interaction spine and its flow** — how a person moves through the system to get a job done. It is deliberately **not** the implementation graph. The underlying complexity of getting work done (services, models, tools, adapters, agents) is real and must stay hidden; the shape is the far simpler figure the human traverses over the top of it.

The two are **coupled, not fused**: shape nodes reference implementation nodes (so impact analysis can traverse code → route → surface → job path), but design semantics are never promoted into human semantics. The user sees their job; the graph knows the machinery.

### 1.2 Governing principles (from the operator, 2026-08-15)

1. **Cognitive load is a first-class constraint**, not a review opinion.
2. **The spine is the business**: one main goal and process — earning the income that pays the costs — and everything else supports it.
3. **People have varying job complexity** and need a path that highlights *their* job.
4. **Small companies flatten**: the target install has few people wearing many hats, so the model must stay shallow rather than role-partitioned.
5. **Hide complexity, highlight survival-and-thrive needs.** Many product spaces were consolidated into one platform precisely to eliminate swivel-chair integration; the UX must cash that in.
6. **Proactivity is earned**: as trust and fidelity accrue, AI takes the mundane work, then increasingly the sophisticated work, as salient perspectives and trade-offs become programmatically executable.

## 2. The substrate already exists — this fuses it, it does not rebuild it

A substrate sweep (2026-08-15) found roughly four-fifths of this concept already built and fragmented across four subsystems. Building a new graph would *be* the sprawl this spec exists to prevent.

| Piece | Where it already lives | Role in the shape graph |
|---|---|---|
| **Nav/flow projection** | `apps/web/lib/ea/navigation-extract.ts` — projects the nav model into the live SysML graph (`navigation:surface:*` → `navigation:entry:*`), cross-linked to `route:*`, published as the *"Navigation — Live Projection"* view (`scopeRef: "navigation"`). Already emits `nav-entry-crosses-domain` (teleport) and `route-not-in-canonical-nav` (orphan). | **The graph itself.** Extend this extractor; do not create a second projection. Re-derived from source each run, so it cannot drift. |
| **The income spine** | `OperationalValueStreamStageKey` (`packages/storefront-templates/src/operational-value-stream.ts:18`) — closed set: `attract · capture · qualify · deliver · settle · retain` + `trust-compliance · operate-improve`, plus archetype stages (`return-inspect`, `receive-store`). Projected per-org via `projectOperationalValueStreamForArchetype`. | **The spine ordering.** Already archetype-aware, so per-archetype nuance is inherited rather than re-modeled. |
| **Job lanes / who-is-this-for** | `apps/web/lib/navigation/route-audience.ts` (~330 routes → audience + destinationKind, generated) and `apps/web/lib/ux-budget/page-purpose.ts` (`primaryUser`, `triggeringNeed`, **`job`**, `successOutcome`, **`findability`**: parentArea/entryPoints/navigationLayer/expectedPath). | **The lane selector.** The job-path data largely exists; it is simply not fused with the nav graph. |
| **Cognitive-load enforcement** | `apps/web/lib/ux-budget/*` (founder-tunable per-shell caps) + `.github/workflows/ux-route-sweep.yml` (drives every route in a real portal; **ratchet for pre-existing, absolute budgets block net-new**; ARIA snapshot drift check). | **The enforcement pattern to mirror.** Page-local today; this spec adds the flow-level peer. |
| **Trust accrual → autonomy** | `apps/web/lib/gear-interface/` (Reduction Gear): `computeFrequentistTrust()` over a rolling outcome window; graduation ladder `hitl-required → hitl-fallback → auto-confirm → auto-silent` gated on score/sample-size/recent-failures, with operator veto. | **The proactivity engine.** Already built; disconnected from the human-facing proactivity control (which is deliberately cadence-only and never raises authority). |

**Net-new code is therefore limited to:** one extractor enrichment, one baseline, one CI policy, and the proactivity↔gear coupling (§6).

## 3. The model

### 3.1 Two orderings, resolved

The spine and the job path are different axes and can disagree: the income spine says compliance is *supporting*; a compliance officer's job path says compliance is *the whole day*. A graph modeling only the spine buries the specialist; one modeling only lanes reproduces today's flat sprawl.

**Resolution: the spine orders the shape; the job lane selects the subgraph.**

- One canonical spine per org (its projected OVS stages), ordered by how the business earns.
- Each person's surfaces are highlighted as a **lane through** that spine — never as a separate map.
- A small-company owner wearing five hats sees one continuous spine; a specialist sees their lane emphasized but still positioned *relative to how the business earns*.

This keeps principle 4 (flatten for small orgs) without sacrificing principle 3 (highlight my job), and it gives the conformance check something concrete to assert.

### 3.2 Shape node contract

Every human-reachable surface carries a shape binding:

| Field | Source | Meaning |
|---|---|---|
| `spineStage` | `OperationalValueStreamStageKey` | Which stage of earning/supporting this serves. |
| `jobLane` | derived from `route-audience` + `page-purpose.primaryUser` | Whose job path this sits on. |
| `stepRole` | `entry · progress · decide · complete · reference` | What the surface does *within* a flow — the field that makes "arrives but cannot continue" detectable. |
| `continuesTo` | nav graph edges + `page-purpose.findability` | The next surface(s) in the job path. |

`stepRole` is the load-bearing addition. A `progress` or `decide` node with no `continuesTo` is a **dead end** — the exact defect found in sales-orders (read-only, no detail), recruiting (no candidate→employee convert), and the bill detail (no approve control).

### 3.3 Violation types

Emitted as conformance findings on the existing EA canvas and into blast-radius output:

| Finding | Fires when |
|---|---|
| `shape-off-spine` | A surface binds to no `spineStage` and no `jobLane` — it serves neither earning nor a known job. |
| `job-path-broken` | A `progress`/`decide` node has no `continuesTo`, or its only continuation leaves the app (e.g. an emailed token page as sole actuation). |
| `flow-load-regressed` | A job path's flow-load metrics (§4) worsen against baseline. |
| `spine-stage-orphaned` | An OVS stage has no surface bound to it — the business has a stage the UI cannot serve. |

The last one is the inverse check, and valuable: it detects *missing* shape, not just malformed shape.

## 4. Flow-level cognitive load *(operator-selected: flow-level, complementing the page budget)*

The existing `ux-budget` measures **load per page** (words, primary actions, visible fields). This adds its peer: **load per job**.

Metrics, measured per job path:

| Metric | Definition | Why |
|---|---|---|
| `stepsToOutcome` | Surfaces traversed from entry to `complete`. | Directly measures "how hard is it to get this done." |
| `sectionCrossings` | Rail-section changes mid-path. | The product-lifecycle flow crosses three; each is a reorientation cost. |
| `groupExits` | Route-group / app exits mid-path. | Catches approvals that leave the shell for email-token pages. |
| `deadEnds` | `progress`/`decide` nodes with no continuation. | The single most common defect found in the analysis. |

These are budgeted per job path the same way page budgets are per shell — founder-tunable, explicitly calibration rather than science, consistent with the existing `UX_BUDGETS` posture.

## 5. Enforcement *(operator-selected: ratchet)*

Mirror the proven `ux-route-sweep` pattern rather than inventing a gate:

- **Pre-existing violations are baselined** and may only improve (ratchet). No mass-remediation project is front-loaded onto a ~330-route estate.
- **Net-new off-shape surfaces block.** A new surface must declare a `spineStage` *or* a `jobLane`, and must not introduce a dead end.
- Findings graded `advisory` (pre-existing) / `blocking` (net-new), matching `evaluate.ts`'s existing grading vocabulary.
- Baseline file follows the `route-budget-baseline.json` precedent.

This is the anti-sprawl mechanism: it does not demand the estate be perfect, it demands it stop getting worse.

## 6. Proactivity accrual *(operator-selected: folded into this build)*

Today proactivity (`lib/proactivity/`) is deliberately **cadence-only** — assertive tightens attention windows but never raises authority — while the Reduction Gear separately computes trust and graduates autonomy tiers. The gap is that the human-facing control implies autonomy it cannot deliver (the known defect behind BI-2726089C).

**Coupling (not merging):**

1. Proactivity **reads** the Reduction Gear's autonomy tier for a capability rather than inferring authority from cadence. Cadence stays cadence; authority stays gear-governed.
2. The shape graph renders, per spine stage, **who runs it** — human, AI-with-approval, or AI-autonomous — sourced from the gear tier. This makes principle 6 legible: the owner *sees* the mundane stages going quiet as trust accrues, and sees which sophisticated stages are becoming candidates.
3. Graduation stays **consult-then-emit** with operator veto; nothing auto-elevates silently. Elevation remains an operator-visible event.

The shape graph is the natural surface for this because autonomy is a property *of a stage of the business*, not of a settings page — which is exactly the "couple the semantics, don't expose them" requirement.

## 7. Design shaping — the discipline for future work

The durable output. Proposed as a kernel principle once ratified:

> **A new human-reachable surface declares its shape or it does not ship.** It names the spine stage it serves or the job lane it sits on, its step role, and where the flow continues. A surface that serves neither earning nor a known job is off-shape by definition.

Practical consequences:
- **Build Studio output inherits the contract.** The `/complaints` orphan (a functional surface generated with no nav home and no inbound link) is exactly what this prevents — generated surfaces must bind to the shape like any other.
- **Impact analysis gains a shape dimension.** "What breaks if I change this?" extends to "what job paths does this sit on, and does the shape still hold?"
- **Consolidation gets a target.** "Is this surface needed?" becomes answerable: which spine stage does it serve, whose job, and what continues from it.

## 8. Research & benchmarking

- **Value-stream / flow modeling (SAFe, Flow Framework).** Flow metrics (velocity, time, efficiency, load) measure *work* moving through a value stream. Adopt: flow-load-per-job-path as a budgeted metric. Reject: their unit is a work item; here the unit is a **person's traversal**, so the metrics are re-based on human steps rather than ticket cycle time.
- **Jobs-to-be-Done.** Organize around the job, not the feature. Adopt: `job` + `successOutcome` as first-class shape fields — already present in `page-purpose.ts`, so this is fusion rather than adoption. Reject: JTBD's research-artifact framing; here it must be machine-checkable, not a workshop output.
- **Service blueprinting.** Maps front-stage user actions against back-stage support — precisely the "couple, don't expose" split. Adopt: the front-stage/back-stage separation as the shape/implementation boundary. Reject: hand-drawn, point-in-time blueprints; this must be re-derived from source (the `navigation-extract` posture) or it drifts.
- **Architecture fitness functions (evolutionary architecture).** Continuously assert an architectural characteristic in CI. Adopt: shape conformance as a fitness function with a ratchet — the direct precedent for §5. This is the closest prior art and the pattern the codebase already runs for UX budgets.

**Adopted stance:** express the shape as a *derived* projection with fitness-function enforcement, re-based on human traversal, fusing the existing job/audience/value-stream data rather than authoring a parallel model.

## 9. §1 substrate check

- **No new graph.** Extends the existing Navigation SysML projection; no second nav or shape registry.
- **No new spine taxonomy.** Reuses `OperationalValueStreamStageKey` and its per-org projection; archetype nuance inherited.
- **No new job model.** Reuses `route-audience` + `page-purpose` generators.
- **No new CI machinery.** Reuses the sweep + ratchet + baseline pattern already running for UX budgets.
- **No new autonomy model.** References the Reduction Gear's `CalibrationKey`→`AutonomyTier` ladder; does not extend the deliberately cadence-only proactivity module.

## 10. Phasing

| Phase | Deliverable | Size |
|---|---|---|
| 0 | Shape node contract (`spineStage`, `jobLane`, `stepRole`, `continuesTo`) + extractor enrichment emitting `shape-off-spine` / `spine-stage-orphaned` as **advisory** | M |
| 1 | `job-path-broken` detection (dead-end + group-exit) across the four analyzed flows; validate it reproduces the known defects | M |
| 2 | Flow-load metrics + baseline + ratchet CI policy (advisory legacy / blocking net-new) | M |
| 3 | Proactivity ↔ Reduction Gear coupling; per-stage "who runs this" rendering | L |
| 4 | Shape lens on the EA canvas as an operator-facing view | M |

**Phase 1 is the proof gate:** if the detector does not independently reproduce the four flow breaks already found by hand, the model is wrong and phases 2–4 do not proceed.

## 11. Acceptance

- Every human-reachable surface resolves to a spine stage or a job lane, or is reported as off-shape — no silent unclassified surfaces.
- The detector independently reproduces the four known flow breaks (bill approval dead-end, recruiting→hire gap, sales-order dead end, product→build discontinuity).
- A net-new surface introducing a dead end or lacking a shape binding fails CI; pre-existing violations ratchet.
- The EA canvas renders the shape lens with per-stage human/AI attribution sourced from gear autonomy tiers.
- No design semantics leak into end-user surfaces — the shape informs navigation and impact analysis, it is not shown as a model to the user.
