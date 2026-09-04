---
status: active
---

# Exact-bound terminal-writer replay liveness plan

**Backlog item:** `BI-E2B632D2`  
**Workroom:** `WC-17F74F70`  
**Design:** `docs/superpowers/specs/2026-08-25-immutable-source-review-traversal-design.md`

**For agentic workers:** execute this plan one independently reviewable backlog
item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green
implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate
before any success claim, and `dpf-pr-with-dco` for handoff.

## Observed state

- The original reproduction is an exact-bound TaskRun reaped to `stalled` while
  waiting in governed inference admission. Its request digest, artifact binding,
  successful immutable reads, and `missing-terminal-writer` marker survived, but
  `reserveTerminalWriterReplay` admits only `input-required` and one historical
  `completed` route exit.
- Canonical replay for `BI-BFBF1BBB` exposed the same contract mismatch at a
  second terminal state. TaskRun `...7AF37EB34EF7` is `failed`, retains the exact
  request and terminal-writer wait marker, has no successful writer, and is
  projected as `resumable`; identical replay nevertheless returns the cached
  failure. Its earlier writer arguments were rejected after a prerequisite
  schema defect that is now fixed and deployed.
- The fix extends the existing reservation and terminal-writer attempt budget.
  It adds no TaskRun, writer, receipt, approval bypass, or alternate evidence
  path.

## Atomic deliverable

This is one replay-contract correction: admit an exact marked `stalled` or
`failed` terminal-writer wait to the existing compare-and-set reservation only
when the request digest matches, the server reconstructs the same immutable
review binding, no writer has succeeded, and the bounded attempt ceiling remains
open. A failed non-proposal writer attempt is historical evidence, not an active
approval; replay reruns only the bound writer turn on the same TaskRun.

## Phase 1 — RED

Add source-local regressions in
`apps/web/lib/mcp-task-stalled-terminal-writer.test.ts` for:

1. a reaper-stalled exact-bound wait returning the same TaskRun to writer-only
   execution;
2. a failed exact-bound wait after a rejected writer argument doing the same;
3. unchanged refusal for a generic stalled/failed task, digest mismatch,
   successful writer, and exhausted attempt budget.

Run the new regression plus all six graph-linked `mcp-task-submit` suites. Keep
the first failure as evidence before implementation.

## Phase 2 — GREEN

Change only `reserveTerminalWriterReplay` and its small parsing predicates in
`apps/web/lib/mcp-task-submit.ts`:

- recognize `stalled`/`failed` only when the persisted terminal-writer marker is
  valid and matches the reconstructed writer;
- retain request-digest, successful-writer, immutable hydration, approval, and
  compare-and-set checks;
- allow a prior non-successful, non-proposal writer attempt to trigger a new
  bounded writer-only turn, while preserving proposal-envelope recovery as the
  authority for actual pending approvals;
- preserve ordinary TaskRun terminal semantics.

Update the governing design with the live evidence and exact eligibility rule.

## Phase 3 — gates and functional replay

Run the new regression, all graph-linked suites, style guard, web production
build, `pregate:preflight`, and the exact-tree `pregate`. Open a DCO-signed PR
with the design and current code substrate named in Design grounding, verify it
with `pnpm pr:health`, and merge through the queue.

After canonical self-upgrade, replay the unchanged `BI-BFBF1BBB` recovery packet.
Success requires the same TaskRun to execute the now-bound objective mapping,
produce the governed acceptance evidence, and allow both its BI and Workroom to
close. Then close this dependency BI and Workroom with the same live evidence.

UX is not applicable because no UI changes. Migration is not applicable because
no schema changes.

## Risks and rollback

- Risk: reopening an unrelated terminal task. Control: require the exact request
  digest, immutable review policy, valid same-TaskRun marker, zero successful
  writer, and compare-and-set reservation.
- Risk: repeating a rejected judgment forever. Control: retain the existing
  terminal-writer attempt counter and escalation ceiling.
- Risk: bypassing a live approval. Control: proposal envelopes continue through
  approval recovery; replay does not execute their stored arguments directly.
- Rollback: revert the eligibility branch and regressions. No persisted schema or
  evidence format changes.

## Backlog coverage

- Decision: atomic
- Parent: `BI-E2B632D2`
- Design baseline: `baseline-f49b4926-7e2b-4511-8cdb-0e2fb903637e`
- Receipt: pending immutable plan registration
- Rationale: stalled/failed admission, reservation checks, regressions, and live
  same-TaskRun proof are one replay contract and have no independently useful
  shipping boundary.

### Four-way traceability

The atomic deliverable is bound to every objective and acceptance criterion in
the approved immutable-source terminal-writer baseline. The replay correction
extends that contract; it does not replace or narrow the original safeguards.

- Requirement refs: `OBJ-DE-001`, `OBJ-DE-002`, `OBJ-DE-003`, `OBJ-DE-004`,
  `OBJ-DE-005`, `OBJ-E2B-001`, `OBJ-E2B-002`, `OBJ-E2B-003`, and `OBJ-E2B-004`.
- Contract refs: `immutable-source terminal-writer contract` and
  `exact-bound stalled and failed replay contract`.
- Flow refs: `writer-only turn`.
- Verification refs: `AC-DE-001`, `AC-DE-002`, `AC-DE-003`, `AC-DE-004`,
  `AC-DE-005`, `AC-DE-006`, `AC-DE-007`, `AC-E2B-001`, `AC-E2B-002`,
  `AC-E2B-003`, `AC-E2B-004`, `AC-E2B-005`, and `AC-E2B-006`.

## Progress evidence

- Workroom resumed and canonical path repaired on 2026-09-03.
- Live `BI-BFBF1BBB` replay reconfirmed the cached failed-but-resumable mismatch.
- Graph impact resolved: six exact related test suites were returned for
  `apps/web/lib/mcp-task-submit.ts`.
