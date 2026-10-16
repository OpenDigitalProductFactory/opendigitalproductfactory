---
status: proposed
backlog: BI-C684AF45
---

# Workroom flow review: baseline, investigation, verified change

This is the implementation scope for BI-C684AF45, extending section 8 of
[the Workroom flow design](2026-10-02-workroom-flow-map-and-measurement-design.md).
The October 15 operator request authorizes completion of this work. The parent
design remains the shared notation and measurement contract. Its section 16 is
the detailed behavior description; this document provides the bounded objective
and acceptance manifest for this delivery only.

## Problem and boundary

The daily review currently turns a count of held rooms into an ImprovementSignal.
It does not produce a baseline comparison or a dated, owner-attributed review.
The operator cannot establish whether a process change improved flow.

Extend `lib/work-management/flow-review.ts`, the existing
`lib/queue/functions/workroom-flow-review.ts` scheduler and area flow projections.
Reuse canonical event reconstruction and duration calculations. WorkroomActivity
owns durable review evidence; ImprovementSignal owns recurring investigation
intake. No new provider, dependency, service or telemetry stream is introduced.

BI-9148060C owns archetype-stage home binding. BI-69803ACC owns the wider delivery
scorecard. BI-B146AB6B owns the shared recurring-control routing classification.
Do not silently substitute this delivery for those separate items.

## Objectives

**OBJ-REVIEW:** Make each shape's due review a durable comparison of trustworthy baseline and current flow, with an accountable owner and disclosed coverage.

**OBJ-IMPROVE:** Turn a persistent measured constraint into one attributable investigation and verify change against comparable observations.

**OBJ-EXPLAIN:** Let the existing Workroom flow experience explain the latest review, constraint and improvement evidence without a separate analytics application.

## Acceptance contract

| Criterion | Objectives | Observable result |
|---|---|---|
| AC-F8B-1 | OBJ-REVIEW | Each shape version is reviewed on its reviewPoint.everyDays cadence. One immutable receipt per review period records shape/version, windows, source provenance, sample counts, readiness and accountable principal. Replay adds no receipt. |
| AC-F8B-2 | OBJ-REVIEW | The first four full weeks with recorded demand form the baseline. Baseline/current windows are disjoint. Incomplete history stays unavailable. Percentiles come from reconstructed observations using canonical duration math, with at least five completed observations for a duration verdict. |
| AC-F8B-3 | OBJ-REVIEW, OBJ-IMPROVE | Rank measured stage constraints by waiting time times current queue. Retain queue-only findings with missing-measurement status. An observed hold reason is a symptom, not a proven cause. Process time is observed execution-state time, not human touch time or proven customer value-add. |
| AC-F8B-4 | OBJ-IMPROVE | Two consecutive due reviews naming the same stage/cause route one investigation through the shared facility with queueKey+cause identity and accountable owner. Clear reviews reset consecutiveness. Replays and concurrent filing do not multiply items. Missing owner holds routing explicitly. |
| AC-F8B-5 | OBJ-IMPROVE | Investigation evidence names the baseline, affected stage/rooms, countermeasure hypothesis, target measure and next review. Before/after uses comparable cohorts. Filing an item never establishes root cause or benefit. The BI-B146AB6B routing dependency is preserved. |
| AC-F8B-6 | OBJ-EXPLAIN | Existing area flow views show latest review, baseline readiness, owner, leading constraint and linked improvement. Trends have dated version markers derived from recorded facts. Missing, partial, stale and insufficient evidence have explicit states. |

## Architecture

Separate pure reconstruction/comparison from I/O adapters. Refactor the existing
flow functions rather than duplicating their definitions in the scheduler, UI
and MCP. Never average percentiles and present the result as a pooled median.
Use exact matched cohorts for ratios and comparisons.

Before implementation, validate the WorkroomActivity storage anchor and atomic
deduplication under the room's serialized activity contract. Keep receipt and
investigation publication replay-safe when interrupted between operations.
Page source reads by stable cursor. Process one due shape/version at a time;
never silently truncate rooms or treat retention-limited telemetry as complete.
The current retention window is the scale/coverage ceiling; longer-lived evidence
must be preserved in review receipts without inventing historical observations.

Canonical Principal identity resolves accountability. Platform improvements may
read paired-installation context but cannot mutate peer-owned records. Existing
routes and schedulers remain the deployment boundary; no topology or public API
change is needed. UI projections use report-kit, theme tokens, keyboard-accessible
links and progressive disclosure on the current flow views.

## Research and alternatives

[ASQ DMAIC](https://asq.org/quality-resources/dmaic) supplies the validated-baseline
and control discipline. [Lean Enterprise Institute VSM](https://www.lean.org/lexicon-terms/value-stream-mapping/)
supplies current/future-state analysis. The parent design section 10 compares
Flow Framework, Camunda Optimize duration overlays and Celonis event-based process
reconstruction. Adopt their measurement patterns; reject an additional analytics
runtime/store, queue depth as causal proof, and correlation as verified benefit.
Reuse DPF's event model and fixed flow vocabulary. No external tool is adopted.

## Verification and rollback

Behavior fixtures cover incomplete baseline, non-overlapping windows, cadence
boundaries, multiple versions, idle intervals, held/released spans, replay,
concurrent filing, interrupted publication, changed causes and unresolved owners.
Run affected tests and package typecheck. Served verification covers a measured
shape and an insufficient-history shape, keyboard use and both themes. Record
UX-fit evidence and update operator flow documentation in the same delivery.

Rollback disables the new review behavior/projection and retains receipts and
telemetry. No destructive migration or invented passing evidence is allowed.

## Delivery

Plan this one bounded item after independent design/spec and architecture review.
Bind immutable plan coverage to these three objectives and six acceptance rows.
Implementation and UX evidence precede protected PR submission and governed live
verification. The remaining home-binding and delivery-scorecard items retain
their own BIs, branches, plans and verification.
