---
status: draft
---

# Proactivity and capacity allocation

**Backlog:** `BI-7AE90091`
**Extends:** [Coordinated Workrooms](2026-09-03-coordinated-workrooms-design.md) — supersedes its Phase E (COO surface) by adding the allocation dimension the surface was missing.
**Budget side:** [Portfolio budgets and investment-weighted WIP](2026-09-24-portfolio-budget-and-investment-wip-design.md) (2026-09-24) holds the investment budget per portfolio and replaces the build count cap with points in flight; this design remains the capacity side for the weekly AI pool, and its board is a candidate host for the budget tie-out.

## 1. The question this answers

A week's pre-paid LLM allocation is use-it-or-lose-it. The platform already drains
the remainder near the reset. It drains it into **platform development** — and
only there.

So an animal rescue at full capacity, whose actual constraint is placing animals,
spends its unused week building the platform. A restaurant whose orders are late
does the same. The capacity is not wasted; it is spent on the wrong thing, which
is harder to see.

**Where the capacity goes is a business question, and nothing in the platform
currently asks it.**

## 2. What already exists

Verified in code. None of this is rebuilt.

| Capability | Where |
| --- | --- |
| Use-it-or-lose-it drain, hourly, near weekly reset | `queue/functions/capacity-drain.ts`, `capacity/evaluate-drain.ts`, `run_capacity_drain` |
| Real weekly quota (opt-in, fail-closed) | `routing/weekly-quota-collector.ts` |
| Demand scoring and policy | `demand-scoring-pack`, `set_demand_policy` |
| Spend per agent | `AgentBudgetEvent` — `amountUsd`, `tokensTotal`, `modelId` |
| Proactivity resolution and roster | `proactivity/proactivity-resolver.ts`, `proactivity-roster.ts` |
| Workroom hierarchy, ownership, shapes | `contains` relations, `room-owner-ladder.ts`, `work-shapes.ts` |
| Stall detection | `attention/sources/workroom-stall.ts` |

The kernel already ratified the drain itself (`DI-5FED0D945EBB`). This design does
not revisit that; it widens what the drain may fund.

## 3. The five gaps

1. **Allocation cannot reach the business.** `evaluate-drain.ts` dispatches Build
   Studio builds only, bounded by `BUILD_WIP_CAP`. There is no path from spare
   weekly capacity to an archetype workroom.
2. **No situational intent.** `set_demand_policy` expresses an investment horizon
   (run / grow / transform). Nothing expresses *"we are at capacity; prioritise
   placement"*.
3. **No hierarchy-shaped view.** The roster is per coworker. Nothing shows the
   room tree with purpose, proactivity, allocation and throughput together.
4. **Declared budgets are unfunded.** Work shapes carry `budgets`; nothing funds
   them from the pool or reports consumption against them.
5. **No backlog-to-workroom coverage.** Nothing shows which rooms are starved of
   the work the backlog says matters.

## 4. Research and benchmarking

Four mature systems solve "divide a finite pool across competing consumers". Each
contributes one idea; none is adopted wholesale.

**Kubernetes — ResourceQuota, LimitRange, PriorityClass with preemption.**
Namespaces get hard quotas; priority classes decide who is evicted under
pressure. *Adopted:* per-portfolio **floors and ceilings** as first-class, and an
explicit priority band that is never preempted. *Rejected:* preemption of running
work — a half-finished governed stage cannot be evicted without an evidence
story, and DPF's unit is an outcome, not a pod.

**Apache Airflow — pools and slots.** A named pool has N slots; tasks declare the
pool they draw from and queue when it is empty. *Adopted:* the **named pool with
declared draw** — a workroom draws from its portfolio's pool, so starvation is
visible as a queue rather than as silence. *Rejected:* slot counting as the unit.
LLM work is priced in tokens and dollars, not uniform slots; an identical slot
count across a haiku-class sweep and an opus-class review would misallocate by an
order of magnitude.

**YARN Capacity Scheduler / HashiCorp Nomad — hierarchical weighted queues with
elasticity.** Parent queues subdivide guarantees to children; an idle queue lends
capacity to a sibling and reclaims it later. *Adopted:* **hierarchical weights
that mirror the room tree**, and **elastic lending** — an idle foundational pool
lends to a busy customer-facing one rather than expiring unused. This is the
closest structural match to the workroom hierarchy and is the backbone of the
model in §6. *Rejected:* YARN's strict reclaim semantics; DPF has no preemption,
so lending is one-way within a week and settles at reset.

**FinOps Foundation — showback/chargeback and unit economics.** Spend is
attributed to the business unit that caused it, and reported in business terms.
*Adopted:* **attribution to the room and its portfolio**, and reporting in *"what
it bought"* (findings raised, animals placed, orders expedited) alongside dollars.
*Rejected:* chargeback as a control. An internal cross-charge between portfolios
of one organisation adds ceremony without changing behaviour.

**What DPF needs that none of them supply:** a *situational* intent. Every system
above is steered by weights set by an operator who already knows what they want.
The rescue operator knows the shelter is full; they should not have to translate
that into portfolio percentages. §5 is the part with no prior art to copy.

## 5. Situational posture — the intent lever

An archetype declares a small, closed set of **postures**, derived from its
operational value stream. A posture is a named business situation with a
re-weighting attached.

```
animal-rescue:
  at-capacity      intake exceeds placement — boost placement, adoption marketing
  intake-heavy     demand at the front door — boost intake triage, foster recruitment
  steady           no binding constraint — default weights
restaurant:
  fulfilment-bound orders late — boost kitchen throughput, expediting
  demand-thin      covers below plan — boost marketing, reservations
  steady           default weights
```

Rules:

- **Derived, never authored per install.** Postures come from the archetype's
  value stream, exactly as the standing room set does. Authoring them per install
  is the failure the derivation discipline exists to prevent, and this program has
  already made that mistake once (the source-ops room gate).
- **Closed set.** The operator picks; they do not write weights or prose. A
  posture is auditable and comparable across installs of the same archetype.
- **One active posture per organisation**, with the reason recorded and an
  attributable actor. Changing posture is a governed write.
- **A posture re-weights; it never removes floors.** See §6.
- **Steady is always available** and is the default for a new install.

Where a posture should be *suggested* rather than picked — the rescue is
demonstrably at capacity, from its own occupancy data — that is a later slice
(§8, Phase E). The first version asks.

## 6. The allocation model

One pool per week, divided hierarchically, mirroring the room tree.

```
weekly pool
 └── portfolio share          floor ≤ posture-weighted share ≤ ceiling
      └── room share          by demand score within the portfolio
           └── shape budget   the work shape's own declared budget
```

**Floors come first, and they are not negotiable.** Each portfolio declares a
floor — the allocation below which its standing obligations cannot run. A posture
re-weights only what remains above the floors. *A marketing push must never
starve the credential-hygiene or dependency-advisory rooms*, and the model makes
that structurally impossible rather than a matter of care.

**Ceilings prevent a single boosted portfolio from consuming the week** in the
first two days, leaving nothing for a situation that changes on Thursday.

**Elastic lending.** A portfolio that will not reach its share lends the
remainder to portfolios that are demand-saturated, in posture-weight order.
Lending is one-way within the week and settles at reset; nothing is reclaimed
mid-week, because there is no preemption.

**The drain becomes the last resort, not the only path.** Near the reset,
whatever is still unspent is offered to the highest demand-ranked ready work
across *all* rooms — business and platform — instead of Build Studio alone. This
is the single change that answers the operator's question.

**Spend truth is measured, not proxied:** `AgentBudgetEvent` for what was spent,
the weekly collector for what remains. A proxy is used only when the collector is
not enabled, and the board says so rather than presenting an estimate as fact.

### 6.1 Spend less per unit of work — effort tier per stage

Allocation decides *how much* capacity a room gets. It does not decide *how
expensively that capacity is consumed*, and that is the larger lever: a week
stretches much further when a stage that lists open pull requests is not sized
like a governed architecture decision.

The substrate is already there. `deriveEffortWarrant` resolves an effort level
(`minimal` … `high`) from reasoning depth, task type, or — failing both — a
message-length proxy, and `modelRequirements` carries it into the loop. Routing
already learns model eligibility per auth mode and resolves family successors.

**The gap is that a work shape's stage declares no effort tier**, so every
Workroom stage falls back to the proxy. Stage length is a terrible predictor of
the reasoning a stage needs.

So a stage gains a declared tier, alongside the `evidence` and `advance` it
already declares:

```
sweep    effort: low        read sources, correlate, no judgment
raise    effort: low        open a finding per correlated advisory
decide   effort: high       governed accept / patch / defer
```

Rules:

- **The shape declares it; the run does not guess.** Stage-declared tier beats
  the proxy, exactly as `reasoningDepth` already beats it today.
- **Cheapest capable, not cheapest.** The tier is a floor on capability, not a
  cost target. A governed-decision stage is never demoted to save budget — that
  trades a real decision for a cheap one, and the saving is not the operator's
  to take.
- **Declared, then measured.** The board reports spend per stage against its
  declared tier, so a stage running hotter than it declared is visible. A tier
  that is wrong is a shape defect, fixed in the shape.
- **Floors still apply.** Cheap models do not make a starved room fast; they make
  a funded room go further.

Expected shape of the saving: most standing-room stages are `read`, `scan`,
`sync`, `classify` — sweeps and correlations. Those are the bulk of the tick
volume and the cheapest to serve. The governed decisions are rare and stay
expensive, which is the correct allocation of both money and care.

## 7. The board

One dense page. Rows are workrooms in their real hierarchy, collapsible, grouped
outside-in by portfolio — the same axis the attention inbox uses, so the operator
learns one ordering.

Per row: **what it is set up to do** (shape, trigger, cadence) · **owner**
(ladder-resolved, or flagged unowned) · **proactivity** (level and action
boundary) · **allocation** (share, consumed, remaining) · **throughput**
(dispatches, stage advances, evidence recorded) · **state** (advancing, stalled,
unowned, blocked).

Two things the board must do that a dashboard usually does not:

- **Show what the capacity bought,** not only what it cost. Dollars next to
  findings raised, animals placed, orders expedited. Cost without outcome is how
  an estate spends a week on 343 fabricated sweeps and reads as healthy.
- **Name starvation.** A room with backlog pressure and no allocation is the
  finding; it must be a row that stands out, not an absence the reader has to
  notice.

**The board steers; it never dispatches.** It sets posture and policy and posts
asks. The drive still owns dispatch, the shape still owns the gate, conformance
still owns authority. This is the Phase E rule and it survives unchanged.

## 8. Slices

Every slice ends at something observable on this install. No slice is "done" at a
finished module — this program has shipped that eleven times.

- **A — read model and board.** The tree, with allocation and throughput read
  from existing sources. *Observable:* the operator sees the real state of this
  install, including any starved room.
- **B — allocation model.** Floors, ceilings, posture weights, lending. Pure
  function over the pool and the tree. *Observable:* the board shows planned
  versus actual share per portfolio.
- **C — postures.** Derived per archetype; governed write to select one.
  *Observable:* selecting `at-capacity` visibly re-weights the board, floors
  intact.
- **D — drain extension.** Business work competes for the remainder. *Observable:*
  near a reset, spare capacity dispatches archetype work, with attribution.
- **E — posture suggestion.** Derive a candidate posture from the organisation's
  own operational data and offer it. *Observable:* the board proposes
  `at-capacity` before the operator does.
- **G — effort tier per stage.** Shapes declare a tier; the warrant honours it;
  the board reports spend against it. *Observable:* the same weekly pool serves
  materially more stage runs, with governed decisions unchanged.
- **F — backlog coverage.** Map backlog to the room that would execute it, across
  platform and archetype scope. *Observable:* starved rooms are named with the
  backlog that is waiting on them.

## 9. Risks

- **A boosted posture starves an obligation.** Mitigated structurally by floors;
  asserted in Phase B's tests, not left to review.
- **Allocation becomes a second scheduler.** It sets shares; the drive still
  dispatches. Any design that has the board calling dispatch is wrong.
- **Postures drift into per-install authoring.** The archetype derivation guard
  extends to cover them (Phase C), the same way the room set is guarded.
- **Measured spend is unavailable.** The collector is opt-in; when it is off the
  board reports a proxy *labelled as a proxy*. It never presents an estimate as
  measurement.
- **The week ends underspent anyway** because no room has ready work. That is a
  real finding about the backlog, and Phase F surfaces it rather than hiding it
  behind a full-looking gauge.
