---
status: active
title: A room's projection mode derives from its declared work shape
backlog_item: BI-97B24FB5
decision_interaction: DI-5F69035EC6B9
---

# A room's projection mode derives from its declared work shape

- **Date:** 2026-09-07
- **Scope:** platform — Workroom cycle projection, work-case read model
- **Backlog item:** `BI-97B24FB5`
- **Profile:** fix
- **Status:** Design — implemented in this branch.

## Problem

Every room sourced `work-capsule` was registered `FINITE_ROOM_PROJECTION`. A
standing operational room always holds an active carrier, so `room-cycle.ts`
threw `finite_room_has_cycle`. The throw escaped the server component, so the
operator saw "Something went wrong" instead of the room.

Observed on the live install: WC-D40E9C3C (Inquiry response) and WC-0A92C30D
(Adopter health) had each refused 41 consecutive wakes on
`executor_writeback_unavailable`, were surfaced in the owner's Needs-you inbox,
and neither could be opened.

The failure was reported by the operator as "none of the Open room links work",
which turned out to be three independent defects stacked on one button
(BI-6F2CC21B, BI-EBEB77E2, and this one).

## Research & Benchmarking

The relevant comparison is not an external library but how mature workflow
engines classify recurrence, and all three of the usual approaches were
considered against what the platform already holds:

- **Temporal / Cadence (Uber)** separates a *workflow type* from its *schedule*:
  recurrence is a property declared on the definition, not inferred by the
  runtime or attached to the storage class. DPF's `WorkShapeDefinition` is the
  direct analogue, and it already carries `triggers`.
- **Airflow** binds recurrence to the DAG object via `schedule_interval`;
  a DAG without one is a manual, finite run. Same shape of rule: the definition
  declares recurrence, the executor reads it.
- **Camunda/BPMN** distinguishes a timer start event from a message/none start
  event — again a declared property of the process definition.

All three put recurrence on the *definition of the work*, none on the *source
or storage class of the instance*. DPF adopts that: the source-registry entry is
a default, the declared shape is the authority. DPF rejects inferring recurrence
from runtime behaviour (e.g. "it woke more than once"), which none of the three
engines do either, because it makes the classification unstable and unexplainable.

## Decision

Kernel decision `DI-5F69035EC6B9` (stakes: high, `external_coding_agent`):

| Option | Composite |
| --- | --- |
| **Derive projection mode from the room's declared shape** | **11.97** |
| Add a distinct `standing-room` source entry and migrate rooms | 5.38 |
| Flip `work-capsule` wholesale to `STANDING_ROOM_PROJECTION` | 0.83 |

Margin 6.58, confidence high, verdict proceed, no commandment conflict, zero
flipping principles under sensitivity analysis, 49 principles applied. Leading
contributors: *Research and Use Standards*, *Classify ambiguous requests before
acting*, *Ground New Work In Existing Platform*, *Single Source of Truth*,
*Verify substrate before proposing new*.

The decisive evidence was that the classifying fact is **already on the room**:
`scopeClaims` on WC-0A92C30D carries `workShape: "adopter-health-watch@1.0.0"`,
and `STANDING_OPERATIONS_SHAPE_KEYS` already declares twelve standing shapes.
The two rejected options both invent substrate to hold a fact the platform
already stores.

The wholesale flip was rejected because it trades a visible crash for an
invisible correctness bug: genuine finite build rooms would silently project
recurring cycles they must never have.

## Design

1. **Standing-ness is read from the shape's own trigger.** Every standing shape
   declares `cadence`; every finite delivery shape declares `claim`.
   `isStandingWorkShape(key)` reads that rather than a hand-kept membership list,
   so a new standing shape is standing the day it is declared.

2. **The override is one-way.** A declared standing shape widens a finite source
   to standing; a declared shape never narrows a standing source to finite, and
   an absent or unknown shape leaves the source's policy untouched. No
   already-correct room changes meaning.

3. **One resolver, every reader.** `resolveRoomProjectionMode` is used by both
   the cycle selection and `room-read-model`, which previously derived `mode`
   from the source alone — so a room's rendered mode and its projected cycle can
   no longer disagree.

4. **A failed projection costs the cycle, not the room.** `projectRoomCycles`
   catches `WorkroomCycleError` at the loader boundary, logs the reason, and
   carries it on the view. The cycle section reports that the cycle could not be
   worked out, rather than claiming the room is "healthy and idle" — a state
   nobody established, on a room that is in trouble.

## Consequence for BI-A2234157

`BI-A2234157` ("Standing Workrooms for ongoing operational activity") is
deferred to 2026-09-15 on the premise that standing rooms need new trigger and
scope substrate. That premise is overtaken: the work-shape registry has landed
since the deferral and already carries what is needed. The item is flagged for
its owner to close as overtaken or re-scope — not closed here, since the
deferral is owner-attributed.

## Non-goals

- Reclassifying the four `COWORKER_STANDING_SHAPES` that do not declare
  `cadence`. They keep today's finite behaviour; the conservative fallback means
  this is a no-op for them, and whether they are genuinely standing is a
  separate question for their owner.
- Changing any room's stored data. This is a read-path change only.
