---
status: draft
backlog: BI-C684AF45
---

# Workroom flow review: baseline, investigation, verified change

This is the implementation scope for BI-C684AF45, extending section 8 of
[the Workroom flow design](2026-10-02-workroom-flow-map-and-measurement-design.md).
The October 15 operator request authorizes completion of this work. The parent
design remains the shared notation and measurement contract. This document
provides the bounded objective and acceptance manifest for this delivery only.

## Problem and boundary

The daily review currently turns a count of held rooms into an ImprovementSignal.
It does not produce a baseline comparison or a dated, owner-attributed review.
The operator cannot establish whether a process change improved flow.

Extend `lib/work-management/flow-review.ts`, the existing
`lib/queue/functions/workroom-flow-review.ts` scheduler and area flow projections.
Reuse canonical event reconstruction and duration calculations. Existing managed
DocumentVersion records own immutable review reports and baseline snapshots.
WorkroomActivity records their operational receipts and links; ImprovementSignal
owns recurring investigation intake. No new store, provider, dependency, service
or telemetry stream is introduced.

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
| AC-F8B-1 | OBJ-REVIEW | Each shape version is reviewed on its reviewPoint.everyDays cadence. One immutable managed report per review period records shape/version, windows, source provenance, sample counts, readiness and accountable principal. Its Workroom receipt links the exact document version. Replay adds neither a report version nor a receipt, including after operational activity retention. |
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

### Evidence lifetime and publication

The source audit found that WorkroomActivity is telemetry retained for 180 days
and cascades when its Workroom is deleted. Its command receipt locking provides
serialization, but it cannot be the sole home of a baseline used in later years.
Use existing Document and DocumentVersion instead. These records are independent
of Workroom deletion; their existing managed lifecycle and access rules apply.
This delivery does not grant permanent retention or bypass document disposition.
If required baseline evidence has been disposed of, report it as unavailable.

Bind one report to a deterministic Document.documentId derived from the owning
organization, shape version and due period. Save the complete comparison and
its baseline snapshot in one immutable version with a canonical content digest.
An exact replay returns that version; conflicting content for the same period
is a reconciliation failure, never a silent replacement or another version.
Use this durable identity to deduplicate even after the operational command
receipt has expired. Baseline provenance names the original observation window,
source coverage and sample counts; retaining a snapshot never creates missing
observations or makes incomplete history sufficient.

Refactor the existing managed-document writer's transaction core so the report,
Workroom command receipt and evidence link can commit together under the room's
serialized command contract. Do not call its current transaction-owning public
wrapper from inside another transaction. Retain current document authorization,
organization ownership, versioning and validation; run optional search/embedding
projections after commit. Database uniqueness on the stable document identity
must also handle competing or recreated room anchors. After rolling back a
uniqueness conflict, read back an identical winner in a usable transaction;
reject a mismatched digest. Read the existing period report before attempting
reconstruction, so a replay remains possible after its source telemetry expires.

Keep investigation publication replay-safe when interrupted after the report
transaction. A retry reads the persisted report and shared investigation identity,
then finishes the missing link without another report or backlog item. Review
history and baseline lookup page durable reports, rather than relying on the
recent Workroom activity feed or its retention window.

The current createOrTouchImprovementSignal call is insufficient for this promise:
it increments recurrence on each retry and can file a backlog item before saving
its backlink. This delivery must refactor the shared facility for occurrence-aware
intake, counting a due review period once, and idempotent backlog publication
with a stable shared investigation key. Require concurrency and
crash-between-publication-and-link tests before enabling investigation routing.
BI-B146AB6B remains the separate recurring-control classification dependency;
its recorded scope does not supply these publication guarantees. Until the
required contracts are verified, persist reports with routing explicitly pending;
do not claim AC-F8B-4 or AC-F8B-5 complete or repeatedly call the current helper
and describe its source-id uniqueness as sufficient.

Page source reads by stable cursor. Process one due shape/version at a time;
never silently truncate rooms or treat retention-limited telemetry as complete.
The telemetry retention window bounds reconstructable raw history; persisted
reports preserve previously measured evidence with that limitation disclosed.

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
The WorkroomActivity-only alternative fails the verified 180-day/cascade contract;
an additional review table is unnecessary because managed document versions
already provide independent report storage. Reuse DPF's event model and fixed
flow vocabulary. No external tool is adopted.

## Verification and rollback

Behavior fixtures cover incomplete baseline, non-overlapping windows, cadence
boundaries, multiple versions, idle intervals, held/released spans, replay,
concurrent filing, interrupted publication, changed causes and unresolved owners.
Also verify exact-period replay after activity pruning, Workroom replacement,
conflicting report digests, report/receipt transaction rollback and unavailable
baseline documents. A later comparison must retain its original baseline after
the source telemetry expires, while disclosing that raw replay is unavailable.
Run affected tests and package typecheck. Served verification covers a measured
shape and an insufficient-history shape, keyboard use and both themes. Record
UX-fit evidence and update operator flow documentation in the same delivery.

Rollback disables the new review behavior/projection and retains receipts and
telemetry. No destructive migration or invented passing evidence is allowed.

## Delivery

Plan this one bounded item after independent design/spec and architecture review.
Bind immutable plan coverage to these three objectives and six acceptance rows.
Implementation and UX evidence precede protected PR submission and governed live
verification. This retention amendment supersedes the draft's Activity-only
evidence claim. Earlier pending reviews remain tied to their original immutable
source; they do not approve this amendment and must not be replayed as if they did.
The remaining home-binding and delivery-scorecard items retain
their own BIs, branches, plans and verification.
