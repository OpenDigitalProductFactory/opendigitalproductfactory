# Resource estimation methodology — implementation plan

**Backlog item:** `BI-29F61030`
**Epic:** EP-WORKROOM-COMMS
**Design of record:** the umbrella BI's methodology section, grounded against
[`2026-07-26-work-rooms-collaboration-design.md`](../specs/2026-07-26-work-rooms-collaboration-design.md)
and the Workroom canonical rename
([`2026-08-15-workroom-canonical-rename.md`](2026-08-15-workroom-canonical-rename.md), all four phases merged).

## Problem

Work is budgeted and allocated from a time perspective; BIs are already
estimated (`record_effort_estimate`, `effectiveJobSize`, RICE inputs). Combining
them should identify the full budget of an initiative — but estimation stops at
the item. A grep for `estimate|capacity|throughput|velocity` across
`apps/web/lib/work-management/` returns nothing: rooms have no estimation
concept, so neither "will we finish" (finite) nor "are we keeping up"
(standing) can be answered.

Three resource classes must be estimable — AI coworker, human, and non-digital
— and they are not commensurable. Flattening them into one hours number is the
failure mode this plan is designed against.

## Core rule

**One time-phased envelope, three scarcity profiles.**

| Class | Scarce thing | Estimate as | Notes |
| --- | --- | --- | --- |
| Human | time (cost AND constraint) | person-hours on a working calendar | non-fungible (skill), exclusive (one place at a time), premium non-linearity |
| AI coworker | spend | work units × cost-per-unit; latency DERIVED from concurrency caps | ten agents in parallel cost 10× and take 1× wall-clock; spend and latency are two numbers, never merged |
| Non-digital | occupancy + lead time | exclusive holds (reusable) or depletion (consumable) | lead time is LATENCY, not effort |

## Phases

### Slice 1 — ResourceDemand envelope (`BI-16DF26D1`)

The typed contract `{ class, quantity, unit, window, exclusivity,
substitutability }` plus projection on the canonical Workroom. No solver, no UI.
Everything else consumes this.

### Slice 2 — Human profile (`BI-B37AE246`)

Adapt the existing staffing solver stack (`apps/web/lib/workforce/staffing/` —
`NormalizedStaffingProblem`, `PremiumLine`, validate-after-solve) to answer
"can these members cover this envelope in this window, at what premium."
Explicitly not a second capacity model.

### Slice 3 — AI profile (`BI-B67516DD`)

Attribute the agentic loop's existing per-turn token counts to the work unit
carrying the turn; report expected spend and expected latency separately, with
latency derived from the live caps (`BUILD_WIP_CAP`, sandbox slots, workflow
concurrency). Check the dormant Reasoning Economy knobs (EP-27FD96BC) before
adding any new knob.

### Slice 4 — Non-digital resources (`BI-DF31725F`)

The genuinely new modelling: no Equipment/Asset/Vehicle/Facility/Material/Part
model exists, while `field-service-job` is already a canonical work-case source.
Minimal resource + hold + lead-time model only; new Prisma models ride the
~6-gate cascade; check the attended-device/archetype-hardware spec for overlap
first. Largest slice, deliberately independent so it cannot stall the roll-up.

### Slice 5 — Mode-aware roll-up (`BI-C78ED69A`)

Finite room → totals per class converging to zero ("will we finish?").
Standing room → rate per class per cycle against member capacity ("are we
keeping up?"). Carry-over is the reconciliation point: the outcome packet's
`unresolvedWork[].disposition` already captures the honest signal every cycle —
compare it against expectation, persist no parallel record. Rolls up existing
item-level estimates; replaces nothing. Not to be conflated with
`set_backlog_delivery_budget`, which is an intake valve, not an estimate.

## Sequencing

Slice 1 is the hinge. Slices 2, 3, 4 are independent of each other and consume
the envelope. Slice 5 needs 1–3; slice 4 enriches it but does not block it —
the roll-up ships with human + AI classes and gains the physical class when
slice 4 lands.

## Out of scope

- Pricing/margin (estimation is time-and-resource, not billing).
- Editing the demand-scoring pack's RICE semantics — the roll-up consumes it.
- Any per-item estimation UI change before the verify-first check on the parent
  (whether item estimates are visible from a room today) is answered.

## Backlog coverage

- Decision: decomposed
- Parent: `BI-29F61030`
- Receipt: RECEIPT_PLACEHOLDER
- Rationale: three scarcity profiles are independently shippable against one envelope; the physical-resource model is the largest unknown and is isolated so it cannot stall the roll-up.
- Dependencies: envelope -> `BI-16DF26D1`; human -> `BI-B37AE246` (depends on envelope); ai -> `BI-B67516DD` (depends on envelope); non-digital -> `BI-DF31725F` (depends on envelope); roll-up -> `BI-C78ED69A` (depends on envelope, human, ai)
