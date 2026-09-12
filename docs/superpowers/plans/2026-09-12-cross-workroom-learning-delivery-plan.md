---
title: Cross-Workroom learning and recovery delivery plan
date: 2026-09-12
umbrella_backlog_item: BI-IMP-9DA35549
status: draft
---

# Cross-Workroom learning and recovery delivery plan

**For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus this plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Approved outcome and evidence boundary

Implement the [approved design](../specs/2026-09-06-cross-workroom-learning-review-design.md), extending the existing improvement flywheel, Workroom cycles and competence-evolution contracts. Scope baseline: `baseline-4fe955ce-95b5-4c30-add9-6758aed688fd`. Independent scope receipt: `initiative-861c76b4-c4f3-4098-aa33-59ba218f8f0c`, against design blob `f3c5a38099c020391d8c65719edd1b496af55dd3` at `370ddb44e8c72ccc42eaab727fa89e06adea4b53`. Plan admission after refreshing source to `93ce4c5ceca5595c163b08eb762586b5db2bffee`: `IRD-C2E0A47A52AC`, allowed. Source refresh did not change the design blob.

The four baseline objectives are OBJ-COVERAGE, OBJ-RECOVERY, OBJ-LEARNING and OBJ-OPERATION. Baseline acceptance IDs AC-01 through AC-12 remain authoritative; this plan adds execution detail without reducing them. Planning admission is not implementation approval.

September 12 evidence: 488 persisted rooms, 43 nonterminal rooms linked to done backlog items, 58 recorded missing-coordinator deviations. These are metadata cohorts, not 488 narrative assessments or proof of 101 distinct broken rooms. Earlier cleanup reconciled 33 obsolete attempts, then six more and 149 stalled children, and subsequently archived two individually verified delivered rooms. Preserve all history and reconcile current state before further cleanup. September 9–11 completed review coverage is unproven; scheduled triggers are not completed analyses.

The external recurring pilot already exists. Native capture/recovery remains an implementation obligation. No native activation, domain efficacy, blanket cleanup or standards ratification follows from this document.

## Verified substrate and ownership

Source was inspected at the refreshed commit above. The runtime excludes the spec/plan corpus; its empty search result was explicitly unknown, so planning used the source checkout. The live backlog search exceeded its response budget; a narrow read-only PostgreSQL query identified overlap, followed by MCP reads of covering items. All backlog changes use governed MCP.

| Existing home | Use and boundary |
| --- | --- |
| `apps/web/lib/work-management/source-registry.ts`, `room-definition-contract.ts`, `work-shapes.ts` | Canonical definition/shape identity and inherited review requirements; no parallel registry |
| `apps/web/lib/work-management/room-cycle.ts`, `room-cycle-store.ts`, `room-cycle-prisma.server.ts` | Cycle lifecycle, durable payload, cursor and carry-over |
| `apps/web/lib/work-capsules/workroom-recovery-projection.ts`, `worktree-binding-recovery.ts` | Recovery and source binding; no second lifecycle controller |
| `apps/web/lib/queue/functions/workroom-drive.ts`, `workroom-drive-data.ts` | Existing cadence/dispatch/conformance boundary |
| `apps/web/lib/improvement-flywheel/signals.ts`, `apps/web/lib/process-spine/canonical-improvement-digest.ts` | Signal intake, proposal/backlog linkage and weekly curation |
| `apps/web/lib/tak/work-pattern-promotion-policy.ts`, `work-pattern-experiment-promotion.ts` | Independent evaluation and qualification-aware activation |
| `apps/web/components/workspace/workroom/WorkroomBody.tsx`, `WorkroomHeader.tsx`, `WorkroomCycles.tsx`; `apps/web/components/ops/workrooms/WorkroomInventory.tsx` | Owner-facing summary, progressive evidence disclosure and bounded inventory |
| `packages/db/prisma/schema/work-coordination.prisma` | Canonical Workroom model; inspect actual ImprovementSignal/Proposal owners before any schema change |

The inspected signal writer increments `recurrenceCount` on a repeated `(sourceType, sourceId)`. That is replay/attempt evidence, not necessarily another independent occurrence. Delivery application below must fix this semantic distinction without silently reinterpreting historical counts.

Existing owners remain responsible for their contracts:

- BI-36FC2981: write the resolved ownership ladder's explicit coordinator at room creation; BI-4CB2EF76 and BI-4B5E3443 supply roster and role bindings. Never appoint an arbitrary principal to silence conformance.
- BI-06AE6833: PR-tail recovery, exact-head reconciliation and takeover; BI-7C1F43E3: durable waits/resource lanes. Our review cycle consumes these mechanisms.
- BI-E2507972: restore captured room/source bindings. A successful export alone is not tested recovery.
- BI-3CE72645: bounded MCP traversal; BI-80BECE1E: definition/occurrence projection; BI-4BB68EB6: existing report-cap repair.
- BI-B146AB6B: route a recurring miss to a gate, exhaustive test, qualified reviewer or generated doctrine. This plan consumes that classification rather than adding another control-placement policy.
- BI-1B7BB954: evaluator integrity and target-profile transfer; BI-6DB95601: JSI revalidation/activation; BI-636638A6: informative standards publication and human-governed normative adoption.
- BI-9DC43E17: shared operator-visible delivery projection and UI; BI-3AA4A997: canonical archetype baseline mapping. Domain assessment uses those existing baseline items rather than cloning a campaign per room.

## Delivery graph and effort allocation

Each row is independently shippable and maps to a live BI. Dependencies name deliverable keys; additional existing prerequisites are specified in the phase. Estimates are relative implementation units, not calendar promises. Every row reserves 20% for shared refactoring, with actual effort recorded in its PR and evidence packet.

| Key | BI | Depends on | Units / refactor | Traceability |
| --- | --- | --- | --- | --- |
| profiles | BI-11458908 | none | 10 / 2 | OBJ-COVERAGE, OBJ-OPERATION; contract:profile-resolution; flow:definition-to-review; AC-01, AC-02, AC-03, AC-10, AC-11 |
| continuity | BI-BF20F828 | profiles | 20 / 4 | OBJ-RECOVERY, OBJ-LEARNING, OBJ-OPERATION; contract:durable-review-cycle; flow:capture-to-safe-resume; AC-04, AC-05, AC-06, AC-10, AC-11, AC-12 |
| application | BI-64E86574 | profiles, continuity | 15 / 3 | OBJ-LEARNING; contract:attributed-application; flow:signal-to-later-assessment; AC-06, AC-07, AC-08, AC-11 |
| operator-view | BI-9DC43E17 | profiles, continuity, application | 10 / 2 | OBJ-OPERATION; contract:owner-action-projection; flow:attention-to-evidence; AC-09, AC-10 |
| domain-assurance | BI-3AA4A997 | profiles, continuity, application, operator-view | 10 / 2 | OBJ-COVERAGE, OBJ-LEARNING; contract:domain-opportunity-window; flow:profile-to-observed-outcome; AC-03, AC-07, AC-08, AC-11 |
| standards | BI-636638A6 | application, domain-assurance | 5 / 1 | OBJ-COVERAGE, OBJ-LEARNING; contract:scoped-standards-application; flow:lesson-to-standard-reference; AC-02, AC-07, AC-08 |

UI and standards delivery estimates refer only to this campaign's contribution to existing BIs. They neither reset another item's scope nor declare its other requirements complete. Total campaign allowance: 70 units, 14 refactoring. Shared normalization, identity propagation, lifecycle classification, duplicate suppression and UI projection are the only refactoring scope.

## Phase 1 — profiles

Deliver `contract:profile-resolution` through `flow:definition-to-review` in the existing registry and definition-contract files and colocated tests. Introduce typed review requirement/profile composition within those owners, keyed by canonical source definition/version. Resolve common requirements, applicable facets, category, leaf and organization constraints in deterministic order, retain provenance, and reject conflict or removal of inherited safety requirements. Organization constraints can narrow authority, never grant it.

First write failures for alias double counting, unknown definition, shuffled facet order, conflicting critical criteria, missing evidence and unsupported profile. Add development, bookkeeping/standing operations, pet-rescue and campground profile fixtures from their canonical operating models. Each names its evidence fields, denominator, critical failure, authority and review opportunity. Enumerate every source definition, reporting resolved/unsupported/not exercised separately from occurrence coverage.

Consume BI-80BECE1E and BI-3CE72645 where delivered; otherwise preserve explicit partial coverage while their owners finish. Do not add another list endpoint to hide truncation. Verify a bounded page with denied/deleted evidence and correct totals. Load test the resolver at the design's 10,000-room ceiling with sparse definitions included. This phase can ship as a read contract before native scheduling.

Refactoring: consolidate alias/definition lookup and profile provenance in the registry owner. Rollback disables the new review projection; old work identity and evidence remain intact.

## Phase 2 — capture, cycles and recovery

Deliver `contract:durable-review-cycle` through `flow:capture-to-safe-resume`. Extend existing WorkroomActivity evidence payloads, room-cycle persistence and the drive's dispatch/receipt seams. Use one versioned parser shared by server writers/readers. Capture installation/org/source/cycle/room/task/executor identity, exact skill/tool/instruction/profile version where known, expected/observed result, event and ingestion timestamps, attempts and wait class. Unknown attribution remains explicit. Client notes enrich server evidence, never own durability.

Before schema edits, inspect canonical model fields and query plans; add query-critical fields/indexes only to their owning models, with forward-only migration and existing-data tests. Do not promise a migration-free implementation before that check.

Persist intent before consequential dispatch and confirmed receipt after execution. Store objective/remaining acceptance, artifact identity, preserved dirty outputs, last confirmed side effect, blocker owner, safe next step, authority, checkpoint revision and time. Recovery claims compare expected revision and fence stale executors. Reconcile actual publication before replay. Missing paths route to source recovery; dirty files are preserved with provenance. Reuse PR-tail and restore owners above.

Fix ingestion high-water marks for each cycle, stable composite keyset cursors, append-only corrections and transactional output/cursor advancement. Late events enter the next cycle. A killed reviewer resumes the same cycle and cannot emit duplicate signals. Register the approved review shape only after this path exists. Use existing coordinator/qualification/grant contracts. Legacy unowned rooms receive a named missing binding and attention, not fabricated appointments.

Red/integration scenarios: crash before dispatch; after publication before receipt; after output before cursor; concurrent replacements; stale original executor; unavailable/dirty checkout; terminal parent with stalled child; capture outage/reconciliation; missed cadence; a dependency resolving once. Stop/replace external executor and reviewer with conversation unavailable and have an independent executor reconstruct solely from durable evidence.

Budgets: 200 occurrences/page, 1,000/cycle, 20 proposal candidates, 30 minutes analysis; cursor and remaining count persist at exhaustion. Round-robin definitions prevent busy cohorts starving sparse ones. Exercise 10,000 rooms and 100,000 daily evidence records, query plans and interrupted resumption. Track capture latency against the proposed one-minute target and overdue routine triage against one working day. A missed target produces evidence/attention, never a false completed cycle.

Refactoring: consolidate checkpoint/event parsing, lifecycle classification and fenced recovery in existing owners. Rollback pauses new review dispatch while retaining evidence and due work. External pilot remains the sole scheduler until explicit tested native handoff; never two owners for the same cycle.

## Phase 3 — application and objective assessment

Deliver `contract:attributed-application` through `flow:signal-to-later-assessment` in signals, digest and governed proposal/evaluation services. Distinguish event, independent occurrence and problem hypothesis. Add replay/concurrency tests before changing the writer. Preserve legacy recurrence as historically ambiguous; do not backfill independent counts from attempt counts. Reprocessing one event creates no new corroboration or backlog item. Three independent occurrences in two rooms may trigger routine prioritization; critical failures use existing urgent attention without waiting for a threshold.

Record evidence and counterevidence, eligible/affected/excluded/unknown counts, cohort/profile/window, active/queue/dependency time, observation versus hypothesis, uncertainty, proposed route and existing owner. Valid refusal, duplicate and no-change are successful triage dispositions. A proposed change is not an applied change. Consume the control-placement answer from BI-B146AB6B.

Before rollout, commit baseline/candidate version, target profiles, rollback owner, independently selected held-out material and opportunity window. BI-1B7BB954 supplies anti-gaming and assessor separation; BI-6DB95601 supplies material-change qualification interlock. Do not implement replacement evaluator or authority models. These are prerequisites to promotion, not blockers to writing the replay tests.

Verify one common change and one scoped change on subsequent comparable work: next ten eligible executions or seven days, whichever occurs first. Record deployed version and concurrent changes; fewer observations remain inconclusive. Seasonal/regulated profiles retain domain windows and critical failures; pooled speed cannot compensate for them. Follow-up may conclude harm or no demonstrated benefit and trigger rollback/reassessment. AC-08 requires real observations, not fixtures or merge timestamps.

Refactoring: shared identity/deduplication and classification; preserve immutable negative evidence. Rollback stops candidate activation and re-evaluates qualification freshness, not merely reverting a file.

## Phase 4 — operator view

Contribute `contract:owner-action-projection` and `flow:attention-to-evidence` to BI-9DC43E17. Extend the shared Workroom projection and current header/body/cycles/inventory components. Default viewport: requested outcome, current progress, next action and owner, waiting reason, last evidence and learning count. Expand for exact profile, missing/satisfied gates, comparable examples, evidence coverage, confidence, recovery packet freshness and assessment result.

Use one shared projection across surfaces, no local lifecycle fork. Distinguish running, recovery needed, dependency wait, actual human decision, delivered awaiting reconciliation and obsolete attempt. A missing coordinator offers the governed appointment/role-binding destination to an authorized owner; absence of authority remains explicit.

Cleanup uses a bounded preview with expected source state, active task/lease checks and per-item outcome. Re-read at mutation: any new activity invalidates the candidate. Completed BI or age alone never authorizes archival. Retain branches, artifacts and history. Apply the existing governed transitions, not direct database writes.

Verify keyboard/screen-reader, focus retention, 44px actions, narrow/mobile, light/dark/org themes and partial/stale/empty/error/reconnect states. An owner must find scope, evidence and safe next action without interpreting transport logs. Empty evidence says no evidence received. List queries remain cursor bounded and do not call GitHub per row.

Refactoring: unify status/recovery/learning projection and existing shared UI primitives. Rollback removes added presentation while leaving canonical evidence accessible.

## Phase 5 — domain assurance and standards

Use BI-3AA4A997's existing baseline map for `contract:domain-opportunity-window` and `flow:profile-to-observed-outcome`. Reconcile the current catalog and all source definitions; the earlier 107-leaf count is a dated snapshot. Every archetype receives common defaults and explicit extension/exclusion state. Do not claim all archetypes exercised from catalog coverage.

Exercise the four baseline representative profiles in an admitted nonproduction environment: development delivery/recovery, bookkeeping reconciliation/close, rescue capacity/medical authority, campground site fit/booking conflict. Independent expected outcomes and known-wrong negative controls are required. Record scenario, role, profile/source/runtime version and persistent readback. Fixtures prove mechanics; real user-observed outcomes remain separately labeled. Peer installation stays read-only.

Feed assessed lessons through BI-636638A6's `contract:scoped-standards-application` and `flow:lesson-to-standard-reference`. JSI following section 8.3, PAAW section 9.6 and profile catalog section 2 already carry merged informative references (PR 5244). Keep rule bodies in their canonical homes. Weekly curation considers durable results, failed experiments and no-change decisions; normative adoption requires the existing human Standards Steward. Update existing capture/recovery/triage skills at their actual boundaries under `packages/dpf-skill-pack/skills`, with scoped triggers and tools, not another global instruction dump.

Refactoring: consolidate duplicate profile evidence/fixture/projection helpers and canonical references. No business authority is inferred from platform-development authorization.

## Verification and completion gate

The September 12 plan path claim returned a resolved docs-only impact contract: no testImpact or guardObligation entries, derived doc index/diagrams, preflight and mechanical PR health. This is evidence for this document only. Before each runtime slice, claim exact edit paths, consume its current changeImpactContract and put every testImpact/guardObligation into the implementation loop. Unresolved or stale impact requires explicit resolution and exhaustive verification, never exemption.

Run affected unit/integration tests, proportional local checks, cloud production-build gate and migrations where applicable; UI paths require live UX verification. Source-only checkout status means local tests/builds unproven. Record exact commands, SHA, environment and receipts. Independent plan/review and protected merge remain required. No bypass for a difficult gate.

| Acceptance | Required evidence |
| --- | --- |
| AC-01 | Registry set equality with explicit unsupported/not-exercised states and alias test |
| AC-02 | Deterministic inherited profile composition and conflict/removal rejection |
| AC-03 | Four domain-specific scenarios with critical-failure and evidence contracts |
| AC-04 | Executor and reviewer killed; conversation unavailable; independent durable restart |
| AC-05 | Dirty/missing paths, competing claims, uncertain publication, terminal parent/child tests |
| AC-06 | Replay/late events/censored durations/denominator changes/sparse cohorts/cap labels |
| AC-07 | Author self-assessment refused, evaluator isolation and held-out provenance |
| AC-08 | One common and one scoped deployed change independently assessed on later work |
| AC-09 | Owner task success plus keyboard/theme/narrow-view evidence |
| AC-10 | Declared load/budgets, cursor interruption/resume and starvation checks |
| AC-11 | Read-only/tenant boundaries and hostile transcript instruction negative tests |
| AC-12 | Missed cycle due visibility and replacement without duplicate cycle/dispatch |

Do not close the umbrella until all four objectives and all twelve acceptance cases carry independent, resolvable evidence. No indefinite wait: every dependency has an existing BI, reason, owner role and next trigger; recurring review records due/carry-forward state. A blocked second-level repair is handed to its owner with exact evidence rather than spawning another repair chain. Actual observation windows start at applied deployment, not this plan date.

## Backlog coverage

Parent: BI-IMP-9DA35549. Decision: decomposed. Live mappings and dependencies are in the delivery graph above. New child BIs BI-11458908, BI-BF20F828 and BI-64E86574 reference the approved design; existing UI, domain and standards owners are reused.

Coverage receipt: pending immutable plan publication and governed `record_plan_backlog_coverage`. This draft is not implementation-ready until the receipt is recorded and independent plan review passes. Keep the initial immutable plan locator and receipt in the Workroom; append the returned receipt here as provenance without altering the deliverable graph.
