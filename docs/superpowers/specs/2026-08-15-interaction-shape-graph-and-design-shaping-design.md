---
status: draft
---
# Interaction Shape Graph & design shaping — design

**Status:** draft for operator review · 2026-08-15
**Proposed epic home:** EP-8DC217EB (Vertical Integration Inward) · composes with EP-VSL-SURFACE / EP-VSL-GOVERN
**Companion:** [Portfolio-shaped information architecture](2026-08-14-portfolio-shaped-information-architecture-design.md)
**Origin:** UX surface & navigation analysis, 2026-08-14 — four owner flows break the same way; six rail sections don't map to the four-portfolio model.
**Amended:** 2026-08-15 — §3.2 `delegate` + `lexicon`, §3.3 `entry-gated-by-setup` + `spine-stage-inert`, §4 `prerequisitesToEntry`, §10 ordering note. Source: competitive read of a consumer agent product (Grokbot) whose entire differentiator is ease of use, tested against this model for what it fails to catch. Rationale inline at each amendment.
**Amended:** 2026-08-16 — §3.4 rebuilt onto three vocabulary classes after the first draft's binary was found to endanger the GAID/TAK standards corpus; §3.3 `guarantee-unnamed`. Operator correction, 2026-08-16.

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
| `stepRole` | `entry · progress · decide · delegate · complete · reference` | What the surface does *within* a flow — the field that makes "arrives but cannot continue" detectable. |
| `continuesTo` | nav graph edges + `page-purpose.findability` | The next surface(s) in the job path. |
| `lexicon` | operator vocabulary + the normative standards corpus, extending `page-purpose` | Which words this surface must not say, and which it must. Three classes in §3.4. |

`stepRole` is the load-bearing addition. A `progress` or `decide` node with no `continuesTo` is a **dead end** — the exact defect found in sales-orders (read-only, no detail), recruiting (no candidate→employee convert), and the bill detail (no approve control).

**`delegate` is a distinct role, not a flavour of `progress`.** A `delegate` node is where the human hands the remainder of the job to a coworker. It **terminates the human's traversal** for flow-load purposes (§4), and its `continuesTo` names the receiving job lane rather than another surface. Typing delegation as `progress` or `decide` would make handing work to a coworker *increase* `stepsToOutcome` — the metric would penalise the platform's primary answer to cognitive load, and the phase-2 baseline would bake that inversion in. This is why the role belongs in the phase-0 contract rather than in a later phase.

### 3.3 Violation types

Emitted as conformance findings on the existing EA canvas and into blast-radius output:

| Finding | Fires when |
|---|---|
| `shape-off-spine` | A surface binds to no `spineStage` and no `jobLane` — it serves neither earning nor a known job. |
| `job-path-broken` | A `progress`/`decide` node has no `continuesTo`, or its only continuation leaves the app (e.g. an emailed token page as sole actuation). |
| `flow-load-regressed` | A job path's flow-load metrics (§4) worsen against baseline. |
| `spine-stage-orphaned` | An OVS stage has no surface bound to it — the business has a stage the UI cannot serve. |
| `entry-gated-by-setup` | A job path's `entry` requires configuration, connection, or permission that could have been requested in-flow at the step that needs it. |
| `spine-stage-inert` | A stage is bound to surfaces and traversable, but no job path reached a `complete` node on it within the observation window. |
| `lexicon-leak` | A user-visible string on the surface names an implementation detail (§3.4). |
| `guarantee-unnamed` | A surface performs a governed action without naming the guarantee that makes it governed — the standard-bearing term is absent at the point the promise is made (§3.4). |

`spine-stage-orphaned` is the inverse check, and valuable: it detects *missing* shape, not just malformed shape. Two of the additions extend that inverse logic to the two blind spots the structural findings cannot see:

- **`entry-gated-by-setup`** covers the cost paid *before* the path. Every metric in §4 begins at `entry`, so a job whose entry is fronted by connector configuration scores identically to one that starts on first intent. The alternative posture — authorisation surfacing mid-flow, at the step that needs it, granted once and inherited — is the single largest ease-of-use gap between this platform and consumer agent products, and it is currently unmeasured rather than decided against.
- **`spine-stage-inert`** covers the difference between traversable and used. A stage can bind cleanly, pass every page budget, hold no dead ends, and still produce nothing a human accepted. Without this finding the conformance suite certifies *process* and is silent on *value* — the criticism this platform is most exposed to, given how much governance machinery sits behind each surface.

### 3.4 Lexicon — the shape has a vocabulary, not only a structure

§1.1 requires that implementation complexity stay hidden and that design semantics never be promoted into human semantics. Today that requirement is asserted for *structure* and enforced for structure only. Nothing checks the **words**.

The cost of leaving this unenforced is already measurable. Retiring one leaked primitive — `WorkCapsule` → `Workroom` — took four coordinated PRs (#4338 model rename, #4339 doctrine, #4340 view vocabulary, #4342 MCP tool aliases) and a database model rename. That is the correct instinct executed by hand, and by hand it does not survive the next surface.

#### Three classes, sorted by what the term names

The first draft of this section (2026-08-15) treated vocabulary as a binary — operator words good, technical words bad — and that was wrong in a way that would have damaged the platform. Sorting by *how technical a word sounds* puts `GAID`, `AIDoc`, and `TAK-JSI qualification` in the same bucket as `extractor` and `pregate`, and a diligent implementer would soften them all away. Softening those away deletes the guarantee. The correct axis is what the term **names**:

| Class | Rule | Examples |
|---|---|---|
| **Implementation detail** — names how the system is built | **Hide.** Never reaches a reader who did not build the system. | `capsule`, `decomposition`, `projection`, `extractor`, `gear`, `pregate`, `backlog item`, `epic` |
| **Operator vocabulary** — names the work | **Use.** The default register for job, action, and outcome copy. | the words already carried in `page-purpose.job` / `successOutcome` |
| **Standard-bearing** — names a guarantee the customer is buying | **Teach.** Must appear, must match the normative document, first-use explained rather than removed. | `GAID`, `Agent Identity Document` / `AIDoc`, `TAK-JSI qualification`, assurance claim, chain of custody, action receipt, clearance |

An AI coworker **has** an agent identity; the two are different objects, not two names for one thing. The identity is the GAID record — how the agent is named, badged, authorised, and traced across system boundaries. Hiding that vocabulary would hide precisely what an enterprise is paying for. **Hide the machinery; teach the standard.**

**Rule.** A user-visible string naming an implementation detail emits `lexicon-leak`. A surface that performs a governed action *without* naming the guarantee behind it emits `guarantee-unnamed` — the inverse finding, and the one that protects the standards corpus from this spec's own ease-of-use push. Both are graded and ratcheted exactly as §5 grades every other finding: pre-existing baselined and improving-only, net-new blocking.

**Mechanism (no new machinery).** `ux-route-sweep` already drives every route in a real portal and already captures an ARIA snapshot for drift detection, so the visible strings are in hand at the moment the sweep runs. The lexicon extends `page-purpose`, which already carries `job` and `successOutcome` in operator language. The standard-bearing list is **derived from the normative corpus** — `docs/architecture/GAID.md`, the TAK and TAK-JSI standards and their conformance-test suites — rather than hand-maintained, so the check cannot drift from the published text. The net-new cost is a derivation and a check, not a subsystem.

**Boundary.** This governs what a surface *says*, never what the model *is*. Implementation names stay internal and stay precise; standard-bearing names stay visible and stay exact.

## 4. Flow-level cognitive load *(operator-selected: flow-level, complementing the page budget)*

The existing `ux-budget` measures **load per page** (words, primary actions, visible fields). This adds its peer: **load per job**.

Metrics, measured per job path:

| Metric | Definition | Why |
|---|---|---|
| `stepsToOutcome` | Surfaces traversed from entry to `complete`. | Directly measures "how hard is it to get this done." |
| `sectionCrossings` | Rail-section changes mid-path. | The product-lifecycle flow crosses three; each is a reorientation cost. |
| `groupExits` | Route-group / app exits mid-path. | Catches approvals that leave the shell for email-token pages. |
| `deadEnds` | `progress`/`decide` nodes with no continuation. | The single most common defect found in the analysis. |
| `prerequisitesToEntry` | Configuration, connection, or permission steps standing between stated intent and the first `entry` node. | Setup is load the other four metrics cannot see, because they all start at `entry`. It is where a non-technical operator abandons before reaching a surface this spec would score as healthy. |

A `delegate` node closes the human's traversal: `stepsToOutcome` counts the steps to the delegation, not the coworker's subsequent path. Delegated work is still subject to `spine-stage-inert` (§3.3), so handing a job to a coworker cannot be used to make a stage look cheap while producing nothing.

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
- **No new copy pipeline, and no new glossary.** The §3.4 check reads the strings `ux-route-sweep` already captures and extends the `page-purpose` record already generated. The standard-bearing list is derived from the existing normative corpus (`docs/architecture/GAID.md`, the TAK / TAK-JSI standards and their conformance tests); authoring a second glossary would be exactly the drift this spec exists to prevent.
- **No new delegation model.** `delegate` types a surface that already exists; the coworker side is owned by the coworker epic referenced in the companion spec §4.4.

## 10. Phasing

| Phase | Deliverable | Size |
|---|---|---|
| 0 | Shape node contract (`spineStage`, `jobLane`, `stepRole` **incl. `delegate`**, `continuesTo`, **`lexicon`**) + extractor enrichment emitting `shape-off-spine` / `spine-stage-orphaned` as **advisory** | M |
| 1 | `job-path-broken` detection (dead-end + group-exit) across the four analyzed flows; validate it reproduces the known defects | M |
| 2 | Flow-load metrics incl. `prerequisitesToEntry` + baseline + ratchet CI policy (advisory legacy / blocking net-new) | M |
| 2b | Three-class lexicon (§3.4) — implementation list, plus a standard-bearing list derived from the normative corpus — emitting `lexicon-leak` and `guarantee-unnamed` on the existing sweep, baselined against the current estate | M |
| 3 | Proactivity ↔ Reduction Gear coupling; per-stage "who runs this" rendering | L |
| 3b | `spine-stage-inert` — completion observation per stage over a rolling window | M |
| 4 | Shape lens on the EA canvas as an operator-facing view | M |

**Phase 1 is the proof gate:** if the detector does not independently reproduce the four flow breaks already found by hand, the model is wrong and phases 2–4 do not proceed.

**Ordering constraint (from the 2026-08-15 amendment).** `delegate` and `lexicon` are phase-0 contract changes, not later additions. Both are cheap to add before the baseline is written and expensive afterwards: `delegate` because phase 2 would otherwise baseline a `stepsToOutcome` that penalises delegation, and `lexicon` because a baseline written without it has no record of which leaks were pre-existing. `prerequisitesToEntry` and `spine-stage-inert` are genuinely later work and are phased accordingly.

## 11. Acceptance

- Every human-reachable surface resolves to a spine stage or a job lane, or is reported as off-shape — no silent unclassified surfaces.
- The detector independently reproduces the four known flow breaks (bill approval dead-end, recruiting→hire gap, sales-order dead end, product→build discontinuity).
- A net-new surface introducing a dead end or lacking a shape binding fails CI; pre-existing violations ratchet.
- The EA canvas renders the shape lens with per-stage human/AI attribution sourced from gear autonomy tiers.
- No design semantics leak into end-user surfaces — the shape informs navigation and impact analysis, it is not shown as a model to the user. This is asserted for **words as well as structure**: no user-visible string names an implementation detail without a baselined exception (§3.4).
- Standard-bearing vocabulary survives the ease-of-use push. The check derives its list from the normative corpus, and a surface performing a governed action without naming the guarantee behind it is reported (`guarantee-unnamed`) — the lexicon can never be used to soften GAID / TAK / TAK-JSI terms out of the product.
- Handing a job to a coworker registers as a `delegate` node and does not increase `stepsToOutcome`; a stage cannot pass by delegating work that never completes (`spine-stage-inert`).
- Every job path reports `prerequisitesToEntry`, so setup cost is visible rather than invisible-by-construction.
