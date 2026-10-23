---
status: draft
backlog_item: BI-BCF32886
workroom: WC-DD47BCFD
---

# Workroom execution continuity implementation plan

**Backlog item:** BI-BCF32886. **Design:** [Workroom execution continuity](../specs/2026-10-19-workroom-execution-continuity-design.md). **Decision:** DI-8CF7A9DDCFAF. This document scopes execution; it does not authorize implementation or certify accepted outcomes.

For agentic workers: execute this plan one independently reviewable backlog item at a time, one BI, one branch, one PR. Use `dpf-tdd` for behavior changes, `dpf-local-merge-ci-before-push` plus the current completion gate, and `dpf-pr-with-dco` for publication. Preserve existing owners and accepted evidence. The xlarge parent never enters implementation.

## Design grounding

Extend existing stage briefs and dispatch checkpoints, effort-context MCP, context arbitrator, TaskRun/TaskNode, durable recovery/resource lanes, adapter telemetry, Workroom read models and the improvement flywheel. The source and live carrier ledger, research, scope, safety boundaries and acceptance table are in the design sections 2-11. No new queue, scheduler, memory service or spend ledger is proposed.

The claimed documentation paths have a resolved change-impact contract: no testImpact or guardObligation entries; derived artifact `apps/web/lib/docs/doc-index.generated.json` must be regenerated and checked. Before any runtime slice, claim its exact paths and consume its own fresh impact contract. Unknown impact requires exhaustive verification, not an exemption.

## Execution order and work boundaries

| Step | Independent deliverable / carrier | Dependencies | Stop / completion evidence |
| --- | --- | --- | --- |
| P0 | Establish trustworthy baseline and attribution using BI-731F7FA2, BI-CCF1ACBB and BI-3EC91596 | Existing route/account authority and instrument owners | Actual call-to-run-to-room joins and null-aware usage; bounded baseline with sample counts; no new implementation based on historical dark-instrument claims alone. |
| P1 | Common bounded assignment and continuation brief, BI-4A06271B | Current parent approval/coverage; BI-23A65B81 and BI-A9052DCB qualification; coordinate BI-FF2FA0F7 and BI-07F52DA6 | Native plus supported external resume from referenced artifacts without old transcript; source/authority invalidation and idempotent checkpoints pass. |
| P2 | Changed-state wake and safe recovery integration, existing BI-7C1F43E3, BI-7CCCA696 and BI-5366EF78 | Current owning repairs and P1 identity/brief contract | Unchanged waits cause zero inference; one valid changed event resumes once; uncertain effects never replay; receiver acknowledgement remains required. |
| P3 | Qualified provider/client run policy, BI-F9510151, using BI-4761F54E | P0 attribution; current admission under BI-285EF102; P1 execution contract | Dated tuple-specific cold/warm/cache/queue/cancellation matrix and explicit unqualified clients. |
| P4 | Operator continuity and economy projection, existing BI-3EC91596 | P0-P3 read models; reuse BI-65D75876 / BI-3023912F UI | Working/waiting/person-needed, next owner/wake, session links and honest spend coverage; verified accessible/theme-aware served UI and MCP agreement. |
| P5 | Lifecycle knowledge reuse and improvement qualification, existing BI-IMP-9DA35549 with BI-4A06271B integration | P1 capture/retrieval and existing memory/doc/graph routes; P2 handoff/close events | Fresh-session retrieval test demonstrates useful prior information, private exclusions, supersession and a measured improvement through existing proposal/backlog routing. |
| P6 | Program pilot and outcome reconciliation, internal sequencing of BI-BCF32886 | Qualified P0-P5; current independent acceptance obligations | Next10 eligible assignments or 7 days; matched report against AC-CONT-1 through AC-CONT-7; missing surfaces/samples stay unqualified/inconclusive. |

P0-P5 are independently shippable carrier work, with accepted portions reused rather than rebuilt. P6 is parent outcome observation, not a new capability or separate implementation item. Dependencies express contract readiness, not permission to block all useful independent documentation, measurement or review work. Coordinate overlapping edits before claim; do not force another room's ownership.

## P0: Baseline and attribution

Candidate existing files: `apps/web/lib/routing/chat-adapter.ts`, `apps/web/lib/routing/adapter-telemetry-writer.ts`, `apps/web/lib/tak/thread-cost-ledger.ts`, `thread-cost-ledger-runner.ts`, and their owning telemetry projections. Confirm current files and declarations before edit.

1. Read current BI-731F7FA2, BI-CCF1ACBB, BI-3EC91596 and actual served implementation; historical September null counts are not a fresh measurement. Reuse accepted liveness evidence when still applicable.
2. Trace representative native, external and local requests. Identify run, session, Workroom, provider call and actual receipt joins. Mark unavailable external telemetry unknown.
3. Test provider usage normalization: total-input-with-cached-subset versus disjoint input/cache categories, nulls, duplicate imported events, retries and failed calls. Do not add cache tokens twice.
4. Capture elapsed, active, wait, startup/rehydration, prompt/generation and unchanged-wake observations by task class; report exact observation window and denominator. Include avoidable human handbacks, required decision waits, evidence generation/retrieval/reverification cost, completion fraction and unfinished-work age; count all attempts against the same deliverable.
5. Verification V-ATTRIBUTION: real adapter-to-canonical-writer integration and a served correlated readback; sums reconcile to original provider evidence. No inferred API charges from subscription allowance.

## P1: Bounded brief and durable context contract

BI-4A06271B owns only the cross-surface projection/consumer gap. Candidate seams: `apps/web/lib/work-management/stage-briefing.ts`, `workroom-drive-checkpoint.ts`, `apps/web/lib/queue/functions/workroom-drive.ts`, `apps/web/lib/tak/effort-context.ts`, `effort-context-runner.ts`, `context-arbitrator.ts`, `apps/web/lib/mcp/packs/effort-context-pack.ts`. Resolve current session briefing/checkpoint producers before choosing touched files.

1. Read BI-23A65B81 and BI-A9052DCB and qualify their existing producer/consumer wiring. Read BI-FF2FA0F7 identity and BI-07F52DA6 supervised external sessions before introducing an adapter change.
2. Extend one shared brief builder from authoritative records. Include assignment/acceptance, source and document versions, relevant scoped references, completed evidence, next owner/action, wake/stop and budget. Consolidate duplicated native/external formatting; reserve at least 20% of this slice for reuse/refactoring.
3. Apply existing context budget and essential-field reservation. Rank and excerpt only relevant references, with truncation notices and retrievable detail. Live status never comes from a summary or graph cache.
4. Wire native entry and external MCP consumption. External clients lacking session control receive a bounded continuation artifact; no automatic conversation creation or message sending is implied.
5. Persist checkpoint/handoff/close contributions through existing activity/effort/document/commons routes with idempotency and provenance. Re-resolve grants and source versions before dispatch or effects.
6. Verification V-REHYDRATION: disconnect the original observer, resume native and supported external consumers from the same governed brief, produce the next verified artifact, and prove no original transcript was required. Cover stale source, revoked authority, conflicting knowledge, private scope, missing graph/document and mid-effect interruption.

## P2: Resume work instead of polling conversations

Candidate seams remain under existing owners: `apps/web/lib/change-review/semantic-review-background.ts`, `apps/web/lib/work-management/workroom-drive-checkpoint.ts`, `apps/web/lib/work-capsules/workroom-queue-hold.ts`, `workroom-recovery-projection.ts`, `reassign-executor-handler.ts`, `workroom-lease.ts` and existing event/reconciliation functions.

1. Preserve BI-7C1F43E3's durable waits, coalescing and valid evidence reuse; BI-7CCCA696's proven pre-dispatch recovery; BI-5366EF78's acknowledgement contract. Do not refile their implementations or replay historical uncertain executions.
2. Map existing wait states to a reason, dependency fingerprint, next observation/wake, owner, original attempt/deadline and settlement. Extend the existing event adapter and bounded reconciliation backstop.
3. Check dependency changes without inference. A changed event rechecks authority, source/digest, complete checkpoint set, budgets and quiescence, then admits at most one continuation through existing receipts/CAS/fences.
4. Verification V-WAKE: 100 repeated unchanged observations issue zero provider calls; duplicate/reordered dependency events admit exactly one continuation; restart and lost notification recover; cancelled/expired/paused/revoked/uncertain work cannot replay. These are deterministic integration cases, not 100 paid live calls. Exercise an authorized phase transition and resume with no repeat approval; a genuine new gate produces one scoped request while independent ready work continues. An unsupported external unattended-resume path must expose a saved brief and an honest capability limit.

## P3: Provider and client qualification

BI-F9510151 composes existing adapter/configuration contracts. Candidate seams: `apps/web/lib/routing/chat-adapter.ts`, `cli-adapter.ts`, `anthropic-cache.ts`, current endpoint tester and `docs/architecture/agent-client-capability-parity.md`; discover their current owners and any task-aware routing overlap before edit. BI-4761F54E retains TTL/local prefix implementation and BI-285EF102 admission. The historical capability-refresh locator did not resolve through the live read, so it is not a live coverage mapping; BI-F9510151 must reconcile the current capability-refresh owner before editing.

1. Resolve the actual provider/model/account/endpoint/runtime/client tuple and current official documentation. Distinguish documented support, configured behavior and measured behavior; version and expire the existing capability projection.
2. Select supported context, output reserve, cache boundary/retention and checkpoint/wait behavior through existing settings. Do not infer API controls for native clients or change eligible provider/account/residency policy.
3. Run the design section 7 matrix through existing diagnostics within explicit finite budgets and admitted capacity. Never force foreign model reloads or retain a warm cache with synthetic inference.
4. Verification V-PROVIDER: actual local load/queue/prompt/generation and prefix evidence; actual cloud cached/uncached/write evidence where exposed; cancellation and uncertain-timeout safety; unsupported/unknown controls visible. An untested client is not qualified.

## P4: Workroom experience

Existing BI-3EC91596 owns economy projection; reuse Workroom detail/inventory, report-kit and Authorized Surface Contract from BI-65D75876 / BI-3023912F. Discover exact active renderer/projector files through the code graph before claims.

1. Prototype the design section 8 hierarchy: outcome, bounded assignment, material progress, next owner/wake and person-needed action first; sessions/context/spend second; diagnostics last.
2. Keep status derived from the canonical shared read model. Separate delivered, accepted and outcome-observation-pending. Show telemetry coverage and freshness rather than a misleading zero or invented completion percentage.
3. Verification V-UX: served happy path and wait/recovery/handoff states, keyboard and narrow viewport, light/dark/brand themes, and equivalent authorized MCP read/action projection. Use the DPF UX-fit skill and actual scoped evidence; no new dashboard or opaque technical flow.

## P5: Knowledge reuse and improvement

BI-IMP-9DA35549 owns capture/triage/follow-through; BI-4A06271B wires the common lifecycle consumers. Reuse existing WorkroomActivity, ImprovementSignal/ImprovementProposal, document revisions, WWMD/WWWD/WSID decision/curation and code/document graph retrieval. Inspect their current writer/readers and grants before claim.

1. At entry retrieve relevant prior evidence; at checkpoint persist meaningful changed work; at handoff/close reconcile status, next obligations and durable findings. Use scoped references, not transcript replication.
2. Test provenance, source freshness, private/person/org boundaries, deduplication, supersession and contradictory/stale knowledge. Do not add retention deletion or automatic doctrine publication.
3. Route observed stoppages, retrieval misses and successful techniques through existing triage, with one canonical work link and proposed remedy. Independent outcome assessment remains separate from capture.
4. Verification V-REUSE: a second eligible run retrieves the prior approved decision/work product and advances without repeating its investigation; a superseded/private item is excluded; replaying one event does not inflate recurrence; the recorded repair is tested against its original failure class. Include a non-engineering Workroom. An unchanged identity reuses its existing receipt without repeating verification; invalidation obtains the required new evidence. Collection stops once acceptance has sufficient proof, and a fresh reader can substantiate the outcome from the compact record and its canonical references. Additional diagnostics identify their unresolved question or existing requirement.

## P6: Pilot, rollout and rollback

Owner: parent Workroom coordinator for scheduling and next action, carrier owners for implementation, independent assessor for acceptance, appropriate scope curator for doctrine. Funding organization and charged budget must be resolved before implementation; the design claim reported `funding-organization-unresolved`. No budget is invented by this plan.

Use the next 10 eligible assignments or 7 days, whichever occurs first. Required strata: native, supported external Claude/Codex/Grok, local inference and a non-engineering purpose. Unavailable strata remain unqualified; do not broaden export or paid-provider permissions to fill a matrix. Proposed efficiency target is 25% lower median rehydration input and avoidable wait against matched work classes with unchanged verification burden, zero duplicate effects and zero private/authority leakage in exercised cases. Report sample sizes and missing coverage; inconclusive is a valid outcome, not accepted performance. Report total deliverable elapsed time and observable cost alongside narrower rehydration/wait gains, including evidence overhead and all failed/resumed attempts. Show completion fraction and unfinished-work age. Before running the pilot, record baseline-derived tolerances for overall time/cost regression with the owning decision; do not widen rollout on a narrower metric when overall performance or audit reconstructability is unqualified.

Roll out through existing controls by qualified surface. Revert new dispatch/projection policy on duplicate work, lost obligations, leakage or material unexplained regression; retain original records and safe settlement. Long-running observation is a durable owned obligation so the construction conversation can close. Parent acceptance remains open until reconciled against all actual criteria.

## Backlog coverage

- Decision: decomposed
- Parent: BI-BCF32886
- Scope baseline: baseline-e344160c-0104-4401-bf38-a3f3564760a7, independently approved against design commit f2c05001c4751f3b7acce860ca557d7209bd15e6 and blob 616803c28bf2b64edea43de88edbbb17a50edf6f.
- Receipt: blocked-by: live schema-v2 decomposition recording against this published plan is pending; implementation remains gated until its genuine receipt is recorded and checked.
- Dependencies: P0 attribution precedes performance claims; P1 shared brief precedes cross-surface resume; P2 depends on existing recovery/handoff contracts; P3 depends on attribution and current provider/client capability; P4 consumes P0-P3; P5 consumes P1/P2; P6 observes qualified P0-P5.
- P0 attribution -> BI-731F7FA2
- P0 cumulative spend -> BI-CCF1ACBB
- P0/P4 Workroom economy -> BI-3EC91596
- P1 shared run brief and lifecycle consumers -> BI-4A06271B
- P1 existing briefing qualification -> BI-A9052DCB
- P1 existing effort context -> BI-23A65B81
- P2 durable flow and changed-state wake -> BI-7C1F43E3
- P2 proven capacity continuation -> BI-7CCCA696
- P2 acknowledged handoff -> BI-5366EF78
- P3 provider/client execution policy -> BI-F9510151
- P3 cache hardening -> BI-4761F54E
- P5 improvement capture and outcome -> BI-IMP-9DA35549

Baseline objectives (requirementRefs): OBJ-CONTINUITY, OBJ-FLOW, OBJ-REUSE, OBJ-ECONOMY, OBJ-CLARITY. Baseline acceptance (verificationRefs): AC-CONT-1, AC-CONT-2, AC-CONT-3, AC-CONT-4, AC-CONT-5, AC-CONT-6, AC-CONT-7. Contracts: C-BRIEF, C-WAKE, C-PROVIDER, C-REUSE, C-ATTRIBUTION, C-UX. Flows: F-ENTRY, F-CHECKPOINT, F-HANDOFF, F-CLOSE, F-WAIT, F-OBSERVE. Verification: V-REHYDRATION, V-WAKE, V-PROVIDER, V-REUSE, V-ATTRIBUTION, V-UX, V-PILOT. These labels identify this plan's obligations, not new schema/types or implemented capabilities.

The independent scope approval is recorded above. After publishing the current plan, Record coverage against this plan's exact commit and blob with each independently shippable mapping and its requirement/contract/flow/verification references; record P6 as internal sequencing. Read back with `check_plan_backlog_coverage` and append its genuine receipt and immutable locator without rewriting historical evidence. If the current coverage reader requires refreshed plan identity after this bookkeeping append, follow its returned contract. Do not fabricate a receipt, self-approve or downgrade the parent's shape to obtain coverage.

## Verification of this planning delivery

Run the documentation index generator/check, plan-coverage syntax guard, objective/acceptance parser and prose/whitespace checks for the actual diff. No product tests, runtime gates, provider calls, rollout or UX acceptance are claimed from document validation. Preserve the distinction between a complete scoped proposal, approved execution coverage and completed implementation.
