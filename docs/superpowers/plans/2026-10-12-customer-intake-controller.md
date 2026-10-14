---
status: active
---

# Customer-first repository intake delivery
Status: implementation plan; commissioning and acceptance remain outstanding.
**Backlog item:** BI-FD40397B. Workroom: WC-FDE1240A (controller fencing increment: WC-A2D58814).

For agentic workers: execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use dpf-tdd for red-green implementation, dpf-local-merge-ci-before-push plus the completion gate, and dpf-pr-with-dco for handoff.

## Design grounding
Extends [ecosystem intake §6.1](../specs/2026-09-16-ecosystem-issue-intake-and-arbitration-design.md).
Read current inbound-triage-runner, upstream-issue-reader, standing-operations-shapes, backlog-ingest, scheduler catalog and queue trigger at b69781ec7ae60898a9255b219bdab2c963b5fa33.
The October 12 audit still has 40 open GitHub issues, all unassigned, including 35 Hive submissions. A GitHub author identifies transport, not a customer relationship.

## Acceptance
- AC-1: the repository-controller installation alone holds the verified repository-controller assignment; DEV remains read-only toward peer-owned records.
- AC-2: A new external submission reaches one canonical item, an accountable owner and a due next action on the agreed intake cadence.
- AC-3: Repeat polling preserves item and occurrence counts, including deferred and terminal items; repository identity prevents issue-number collisions.
- AC-4: Comments, edits and reopen/closure reconcile with the same work; failed or partial reads visibly report incomplete coverage.
- AC-5: Existing capacity arbitration produces an evidenced disposition and sanitized approved public status; failed delivery is visible and retried idempotently.
- AC-6: Work/Attention show overdue external responses and reviews, owners, next actions, blockers and scan health with accessible theme-aware UI.
- AC-7: A seven-day baseline and successful recurring run demonstrate honest burndown; duplicate retirement and standing-report closure are not delivered fixes.
- AC-8: Pending human decisions remain discoverable during operator absence; BI-8239CD30 supplies fresh authorization and server-side resumption without automatic approval.


## Delivery boundaries
This is a decomposed operating outcome. Each existing dependency keeps its own delivery record; this branch does not claim to implement those other BIs.
- controller / BI-FD40397B: extend the existing watch's classification and follow-through contract and make scan coverage truthful. Commission on the owner installation only after prerequisites pass.
- source-identity / BI-952F08BA: typed repository/source identity foundation; existing work is deferred and owned by the repository-controller installation.
- reconciliation / BI-CCD8D841: repeated imports and changes reconcile without count inflation or re-created terminal items. Depends on source-identity.
- disposition / BI-4C8A83AB: existing arbitration capacity and reply path. Depends on reconciliation.
- terminal / BI-AE9FCB4C: existing governed close-on-terminal path. Depends on reconciliation.
- human-resumption / BI-8239CD30: durable pending decisions and fresh authorization at execution.

## Controller sequence
1. Repair scan truth in upstream-issue-reader.ts and inbound-triage-runner.ts. A capped full page is incomplete, not an empty or successful scan. Bound invalid page limits. Normalize transport exceptions into failure outcomes. Preserve successfully read transport work while returning complete=false and source errors. Item-ingest failures also prevent completeness.
2. Wire the queue wrapper to persist incomplete coverage as a failed ScheduledJob heartbeat with counts and source errors, so the existing schedule/attention projection sees it. Return the partial result without replaying already-ingested records solely because the other transport failed. Keep existing exception retries and polling cadence while occurrence inflation remains unresolved.
3. Extend issue-triage-watch in standing-operations-shapes.ts: external/customer, internal and unknown origin need relationship evidence; severity remains first; external acknowledgement and triage precede routine internal suggestions; demand scoring still decides delivery. Require owner, due next action, stale update/deferral review and real delivered-fix evidence in existing stage findings. No new queue, ranking engine or dashboard.
4. After dependency acceptance, commission repository-qualified controller ownership and the existing scheduled watch through governed owner-install tools. DEV has read-only peer authority and cannot perform this step. Verify existing Work/Attention presentation and file any uncovered UI defect before calling the operating outcome complete.
   - [x] Fencing increment (WC-A2D58814, feat/intake-controller-fencing): the runner resolves a typed commission reference on the existing `ecosystem-inbound-issue-triage` ScheduledJob metadata and refuses with `not commissioned: <reason>` unless the spec §6.1 AC-1 predicate holds. That includes a declared-production install identity, so a DEV peer cannot pass. Issues are read from the explicit `upstreamRemoteUrl` repository, never the reader's fallback. The queue function runs with concurrency 1. Schedule edits and enable toggles merge metadata, so they keep the reference. `commissionIntakeControllerAction` requires `manage_platform` plus current Workroom ownership. Failing or uncommissioned scheduled-job runs reach Attention, linking to `/admin/scheduled-jobs`. No commissioning UI control was added; the action is the governed write path.
   - [ ] Commission on the controller install through that action, then verify one recurring run and the Attention presentation there. Source tests are not deployment proof.
5. Capture seven days of real arrivals, open work, responses, resolutions and reopenings, with duplicate/standing-report retirement separate. Record recurring run evidence.

## Contracts, flow and verification
- CONTRACT-SCAN: failed, capped or partially unread sources never report complete coverage.
- CONTRACT-WATCH: triage evidence names verified origin, urgency, owner, due action and disposition without granting public-send authority.
- CONTRACT-IDENTITY: one repository-qualified origin maps to one canonical item through repeat polls and terminal states.
- CONTRACT-DISPOSITION: existing capacity and governed sanitized outbound paths decide and report work.
- CONTRACT-RESUMPTION: pending human decisions survive absence without auto-consent.
- FLOW-CONTROLLER: upstream/peer read → canonical intake → classified/deduped findings → owner decision → follow-through evidence.
- FLOW-RECONCILIATION: upstream identity/change → same canonical item → terminal/status bridge.
- FLOW-RESUMPTION: pending decision → human answer → fresh authorization → server continuation.
- VERIFY-SCAN: first-failing tests for page-cap exhaustion (including all-PR pages), invalid limits, thrown/failed reads, one transport failing while the other ingests, malformed success payload and ingestion failures; existing happy-path tests remain green.
- VERIFY-WATCH: stage contract tests preserve declared source/tools and require customer origin, accountable next actions, stale follow-through and honest burndown.
- VERIFY-IDENTITY: repeat import, same issue number across repositories, edits/reopen/closed/deferred/retired preservation.
- VERIFY-DISPOSITION: canonical-runtime evidence of capacity decision and idempotent sanitized reply/closure.
- VERIFY-RESUMPTION: pending decision remains visible during absence and resumes once after fresh authorization.

## Impact and completion gate
Workroom scope advice is unresolved because its older directory claim remains active; releasing it requires approval. This grants no exemption. Use colocated reader/runner/shape tests, queue tests found by bounded source search, package typecheck, exhaustive pregate and required protected CI. Run pnpm gate:context and generated doc-index updates. Test changed behavior red before green. Runtime/UX acceptance must use the canonical install or governed shared nonproduction target; source tests are not deployment proof.
Use shared existing error and scheduling plumbing for the refactoring portion (operator request approximately 20% effort); this is a scope direction, not a fabricated token accounting claim.

## Risks and rollback
A failed sweep can have partially ingested work. Existing retries already exist; do not increase retry count or polling cadence until identity reconciliation is accepted. Page-cap exhaustion reports incomplete coverage conservatively even if the last full page happens to be the final page. Revert this branch through a normal PR to restore the prior source behavior; no database migration or peer mutation is included. Keep original receipts and source data.

## Backlog coverage
- Decision: decomposed
- Receipt: cmv7m317q128k01mxpqvjkbn6

Receipt cmv7m317q128k01mxpqvjkbn6 maps six live items (BI-FD40397B, BI-952F08BA, BI-CCD8D841, BI-4C8A83AB, BI-AE9FCB4C, BI-8239CD30) and binds the immutable plan blob 3b406d4af2340a677469ad3ab5f53382a3ba88d3 at pushed commit c32d8250514d628d43c0609e1252912fabc63512. It supersedes cmv7loxoi0u0u01mx0m3dh2e5 (invalidated when the workroom declared delivery-medium@1.0.0) and the earlier receipt cmv674efp0vuw01o77l9sg4hd, which was recorded on the development install and does not exist on the controller install. Graph: controller depends on reconciliation, disposition, terminal and human-resumption; reconciliation depends on source-identity; disposition and terminal depend on reconciliation. All dependency work remains on its existing BI. This branch may deliver a verified controller repair increment, but BI-FD40397B remains open until all acceptance criteria are evidenced.

Scope update: the subsequent claim resolved the impact contract to concrete paths. Related-test lookup returned the colocated reader/runner tests plus migration-proof, standing-operations-shapes, standing-room-declaration and standing-stage-evidence-grants tests. The queue wrapper has no linked tests; add its behavior test. The required style-drift guard, Design Grounding explanation and doc-index regeneration remain in the completion gate.

Integration finding: the sequential-drive characterization also covers the task content generated from the issue-watch conditions. The first merged-code run passed 6,715 tests and failed only its golden comparison for ten issue-triage-watch traces; their stage-sequence summaries were unchanged. Regenerate that fixture through its documented writer for the intentional condition-text change, leave the frozen generator untouched, and verify that all other shapes and direct cases remain identical. Include the sequential-drive test in subsequent verification.

