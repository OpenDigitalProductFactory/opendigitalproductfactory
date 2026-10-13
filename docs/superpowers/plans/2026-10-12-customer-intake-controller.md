# Customer-first repository intake delivery
Status: implementation plan; commissioning and acceptance remain outstanding.
Backlog: BI-FD40397B. Workroom: WC-FDE1240A.

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
Receipt pending immutable plan publication and server validation. Graph: controller depends on reconciliation, disposition, terminal and human-resumption; reconciliation depends on source-identity; disposition and terminal depend on reconciliation. All dependency work remains on its existing BI. This branch may deliver a verified controller repair increment, but BI-FD40397B remains open until all acceptance criteria are evidenced.

