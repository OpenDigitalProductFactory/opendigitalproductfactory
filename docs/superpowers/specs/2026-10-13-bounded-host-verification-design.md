---
status: active
---

# Bounded host verification

Backlog: BI-6DE5A3B6. Workroom: WC-6CABA4D9.
Extends the existing [concurrent delivery design](2026-08-15-resilient-concurrent-development-process.md).

## Problem and research

On source `e74ab9d0b5da4233dd2f9a5759f75ef152453e8c`, host
policy checks use synchronous children without execution budgets. The parent
preflight buffers output until completion. `runWithGuardReceipt` writes a
running receipt but does not settle an exception or expose a progress callback.
Two source-local regressions fail: interrupted execution retains `running`,
and command progress cannot be persisted before completion. The fixtures inject
execution and source identity, ruling out dependency and shell failures for
this reproduction. These facts do not establish historical root causes.

The existing Windows inventory reader in `scripts/host-resource-runner.mjs`
also accepts an unsuccessful producer as an empty inventory and throws an
unclassified exception for malformed JSON. A diagnostic executed the actual
reader function with injected producer results: malformed output threw
SyntaxError; a failed producer returned zero rows. No actual process command
lines were printed. A peer reported intermittent live parse failures, but their
cause remains unproven. Raising a buffer alone would not establish correctness.

This is a repair, with executable reproduction as research. Reuse the existing
`local-ci-process-observer`, `local-ci-stage-receipt`,
`pregate-preflight-receipt`, `lease-supervisor` and `host-resource-attempt`.
No dependency, table, scheduler, grant or parallel evidence store is added.

## Objectives and acceptance

**OBJ-HOST-001:** Host checks finish within an explicit budget or report a non-success outcome.

**OBJ-HOST-002:** Progress and final outcomes remain attributable to the source and observed command.

**OBJ-HOST-003:** Failed process inventory cannot admit resource-consuming work as an empty host.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-HOST-001 | OBJ-HOST-001 | Every host guard has a finite default command budget; timeout and cancellation terminate its owned process tree with bounded grace and remain non-success even if a child exits zero. |
| AC-HOST-002 | OBJ-HOST-002 | Started, periodic and completed observations persist through the existing receipt writer; thrown execution settles inconclusive, and process death remains detectable from the receipt's existing PID contract. |
| AC-HOST-003 | OBJ-HOST-001, OBJ-HOST-002 | Violation, missing runtime, cancellation, deadline and uncertain execution remain distinguishable; only complete successful results with unchanged identity may be reused. |
| AC-HOST-004 | OBJ-HOST-003 | Inventory collection has finite time and byte bounds, explicit encoding, validated rows and a bounded redacted unavailable result; unsuccessful, empty, malformed or truncated producer output never becomes a successful empty inventory. |
| AC-HOST-005 | OBJ-HOST-003 | A process-inventory failure stops before lease admission and before command execution; existing process/resource fences, resume identity and actor/grant checks remain intact. |
| AC-HOST-006 | OBJ-HOST-001, OBJ-HOST-002, OBJ-HOST-003 | Tests exercise genuine violation, missing dependency, hanging child, cancellation, interrupted receipt, changed identity and unavailable inventory, and applicable publication gates pass. |

## Ordered implementation and refactoring

1. Make inventory failure explicit in the existing reader. Use one producer
   call, terminating errors, UTF-8 output, finite timeout and maxBuffer, and
   validate the entire response before returning rows. Catch errors without
   printing output, parser excerpts or command lines. Retain enough metadata
   (reason, exit/signal, byte count) for recovery. Stop before admission, with a
   stable unavailable classification and an executable retry of the same command.
2. Extend the existing observed-process runner for host cwd, explicit shell
   choice and cancellation. Retain its bounded output and termination budget;
   preserve all existing callers' defaults. Validate process ownership before
   termination and test descendants on the actual supported host.
3. Replace host guard synchronous execution with the observed runner, using
   a documented 30-minute per-command default and existing environment
   classification. Await commands in the shared policy loop without changing
   CI's guard selection. Stop canceled runs instead of starting later guards.
4. Pass progress through `runWithGuardReceipt` into existing heartbeats, and
   settle thrown executions inconclusive. Keep identity/policy/TTL checks and
   successful-only reuse. Persist deadline/cancellation details in the result,
   without adding receipt schema states that other consumers cannot interpret.
5. Stream compact parent preflight progress using bounded output, retaining
   actionable failure tails. A preflight infrastructure limitation must be
   identified as such and cannot be advertised as a full host verification pass.
6. Run regressions and affected policy tests, document budgets and recovery,
   then obtain applicable independent review, canonical gate, protected CI and
   queue merge. Record source and deployed verification separately.

At least 20% of the repair effort consolidates host execution and receipts onto
existing utilities. Budget values are design bounds, not measured timing claims.
The medium fix is atomic because inventory admission and execution evidence
must both fail closed for the same host verification contract. It may be
implemented in ordered commits, without weakening a fence to unblock testing.

## Scope and dependencies

WWMD `DI-6F05F6D7FF32` resolves the technical classification as Medium; governed
claim `IRD-44D33C4C7CD3` admits implementation as `delivery-medium@1.0.0`.
The operator is not asked to guess technical size. No initiative scope baseline
was available to bind the initial coverage request; the admitted shape's live
readiness determines its applicable gates rather than manufacturing a receipt.

| Implementation owner | Requirements | Existing contracts | Verification |
| --- | --- | --- | --- |
| BI-6DE5A3B6 / WC-6CABA4D9 | OBJ-HOST-001 through OBJ-HOST-003 | Host resource admission, observed process runner, policy guard loop, stage receipts and status reader | AC-HOST-001 through AC-HOST-006, independent acceptance and publication gates |

The same-source status reducer now prefers admitted/running over a queued
sibling only when both remain inconclusive and bind the same branch and SHA.
It cannot promote a different source or invent a pass. Source-only fixtures
reproduce and verify the tie. Migration-inventory batching is owned separately.
Cross-stage guard-cache consolidation is a separate follow-up: current stage
and plan identities intentionally differ, and PR metadata must remain fresh.

Independent client assessment of the committed change found that a parent
preflight could return zero when the observer reported a recording error with
a zero child close. The parent now maps every reported observer error to unrun
exit 88 before interpreting the child status. A parent-level regression covers
that combination, including a child summary claiming pass; ordinary successful
completion and elapsed-deadline controls retain their distinct outcomes.

BI-D27ADE59's shared CI classification is already merged. Claim identity remains
BI-2641F34A; semantic-review recovery remains BI-8ECEC429; readiness presentation
remains BI-9DC43E17. Canonical identity BI-CAP-437F7745 and role-and-room
BI-56E9CEC2 remain separate. Managed dependency readiness (including current
pinned compiler aliases) is inspected independently before expanding this fix.
No other session's worktree is used. No runtime assets are edited and no manual
image or deployment path is introduced.

The AC-HOST-003 continuation in WC-7A91FE56 narrows the shared preflight and PR
readiness environment classifier to runtime diagnostic lines. Static import
guards can exit 1 and explain `ERR_MODULE_NOT_FOUND`; that explanation remains
a violation and blocks admission/readiness. Genuine loader absence remains an
environment limitation, while explicit observer cancellation, timeout and
runner failure retain precedence. Actual child-exit regressions cover both
static diagnostics, native loader absence and the shared readiness consumer.

The same continuation separates generic policy intent from actual local Vitest
coverage. BI-2227C37C permits affected local selection while cloud verification
remains exhaustive. A completed exact-stage receipt establishes actual local
coverage; absent or conflicting evidence remains unknown. New receipts persist
selection mode and reason. The supported exhaustive override participates in
the existing pre-admission execution fingerprint, preserving successful-only
reuse for the requested scope. Historical receipts remain unchanged.

## Abandoned pre-admission host receipts (BI-10AD69D2)

This continuation belongs to BI-10AD69D2 / WC-73B1995B, on
`fix/host-preflight-receipt-recovery`. It does not reopen BI-6DE5A3B6 or inherit
that item's approval or execution evidence. Source inspected:
`46f8a5ca9cb75aa871a223b70acc6dcc65d15a67`. Design admission is
IRD-71E56C33ADED; implementation admission and delivery remain pending.

### Evidence and existing boundary

The Critic owner observed two interrupted host preflights, sessions 85795 and
63162, before native lease admission. For the latter, host process 65908 and
last child 95748 were absent, with no matching native lease, queue or new gate
verdict. Its retained host receipt still said `running`, last heartbeat
2026-10-28T21:50:03.727Z. This establishes a recovery gap, not the cause of
process termination or a product-test failure. Preserve the original records.

At the inspected source, `runWithGuardReceipt` in
`scripts/lib/pregate-preflight-receipt.mjs` settles thrown execution while its
controller runs. Abrupt controller death cannot execute that catch/finally.
`classifyPriorStage` in `scripts/lib/local-ci-stage-receipt.mjs` is a read-time
PID classifier, used by other runners, not this host wrapper. The existing
`scripts/lib/local-convergence-lock.mjs` already retains an owner token and
process birth identity; `scripts/lib/local-sandbox-fence.mjs` owns process
identity. Extend these contracts rather than introducing another controller.

The earlier AC-HOST-002 promises recorded progress and detectable process death;
it does not promise an independent finalizer or survival of the foreground
executor. Queued local-CI recovery is post-admission and does not establish host
preflight recovery. BI-92EE4EC5 concerns effective PR-body identity;
BI-091A2DCF concerns uncertain host-resource admission; BI-9BDF9539 concerns
queued resume; BI-9A353411 concerns Workroom reaper rollout. Preserve those scopes.

### Recovery objectives and acceptance

**OBJ-HR-1:** An abandoned host preflight retains an attributable inconclusive outcome without inventing a child verdict.

**OBJ-HR-2:** Recovery preserves single-owner execution and the exact original receipt, source and process identity.

**OBJ-HR-3:** The responsible executor receives one supported next action and the evidence still missing before another execution.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-HR-1 | OBJ-HR-1 | A real controller subprocess is abruptly terminated after the actual receipt writer persists progress; supported reconciliation records inconclusive with original identity, observations and last progress, without inventing the child's result. |
| AC-HR-2 | OBJ-HR-2 | A live controller, unreadable probe, legacy identity, reused PID or foreign lock cannot be treated as authoritative death; uncertain ownership remains UNKNOWN and cannot authorize mutation, reuse, cleanup or duplicate execution. |
| AC-HR-3 | OBJ-HR-2 | Concurrent reconciliation, late completion, receipt replacement and changed owner tokens cannot overwrite terminal or replacement evidence; repeated reconciliation is idempotent. |
| AC-HR-4 | OBJ-HR-3 | The existing status/recovery path names the exact attempt, accountable owner, missing child or ownership proof and one supported next action; disposition of an old receipt is separate from admission of a new attempt. |
| AC-HR-5 | OBJ-HR-1, OBJ-HR-2, OBJ-HR-3 | Existing successful-only reuse, input/environment identity, TTL, command budgets, queue/lease fences, authority and protected publication remain intact, and evidence distinguishes source tests, source publication and installed verification. |

### Options and selected scope

- Rerun after a timeout: rejected. Age alone cannot prove process death or safe
  replacement, and a new invocation can overwrite the only retained progress.
- Add a detached scheduler or receipt ledger: rejected for this repair. It adds
  a second execution authority without establishing the old attempt's outcome.
- Extend existing receipt observation, strong process identity and convergence
  locking: selected. This provides truthful abandonment reconciliation and
  bounded recovery eligibility. It does not provide execution survival.

The selection stays within the captured repair and existing substrate; it is
not permission to widen grants, invoke a model, clear a lease or replay a review.
Funding allocation remains unresolved; no provider spend is inferred.

### Ordered implementation and verification

1. Reproduce the gap on a named source ref in an isolated temporary fixture.
   The real writer must persist start and progress, then the fixture terminates
   only its own identified controller without allowing normal exception
   settlement. Observe the retained running receipt and lock. Never signal a
   delivery gate or infer a historical cause from this fixture.
2. Bind new host receipts to the existing convergence owner token and strong
   controller identity. Preserve original source/input/environment identities.
   Reuse process identity utilities. Do not equate the current boolean
   `isProcessAlive` false result with proven absence: it swallows probe errors.
   Permission, transport, parse and identity failures remain UNKNOWN. Bare PID,
   elapsed time or a legacy lock age is insufficient for receipt mutation.
3. Reconcile through the supported receipt/lock owner path. Before mutation,
   prove the same original owner is absent, serialize with the existing
   convergence contract, and re-read the exact receipt and ownership. Compare
   original receipt identity/version and owner token immediately before the
   atomic replacement. Every completion and reconciliation writer must use the
   same owner-fenced serialization or a real compare-and-swap; a read-check
   followed only by atomic rename is insufficient against a late writer.
   A changed, terminal, live or unprovable record is left
   untouched. The observer releases only its own acquired lock. It never kills
   a process or deletes a foreign lock; a stale-lock helper's legacy-age path
   is not sufficient authorization for receipt settlement.
4. Persist an attributable inconclusive disposition through the existing atomic
   receipt writer, retaining original observations, controller identity and
   last heartbeat. Record observer/time/reason separately from any actual child
   exit. Reuse the existing readable receipt states; no pass flag or fabricated
   result is added. Integrate this observation into existing host preflight and
   status recovery. A dead controller with unknown descendants must still name
   that missing proof and refuse duplicate execution.
5. Exercise the actual read/reconcile/write path with real abrupt loss and
   deterministic live, unreadable, PID-reuse, changed-lock, concurrent-observer,
   late-terminal and changed-source cases. Test successful receipt reuse and
   TTL/input/environment regressions. Obtain current scope coverage, research,
   implementation admission, independent review and protected source delivery;
   record installed verification separately. At least 20% of relevant repair
   effort consolidates existing identity/receipt helpers rather than adding
   parallel utilities.

Research and checks must report actual outcomes. A helper-only simulation,
handled exception or successful source test cannot establish recovery after
abrupt client loss. The real subprocess fixture should run on Windows and a
POSIX host where available; unsupported host evidence remains unrun/unknown.

### Research references and architectural fit

This is a bounded defect continuation, not adoption of another workflow product.
It reuses the existing bounded-host design and concurrent delivery contracts.
[Node.js signal documentation](https://nodejs.org/api/process.html#signal-events)
confirms that SIGKILL cannot be handled and that Windows signal behavior differs;
[process.kill documentation](https://nodejs.org/api/process.html#processkillpid-signal)
explains the signal-zero existence probe. Accordingly, a controller's own
finally block cannot be the abrupt-loss finalizer, and probe errors must retain
their actual uncertainty. No external package, service or new executor is needed.

No database migration, provider, credential, grant, container or resource-policy
change is included. No portal layout is changed; any implementation that changes
a rendered status owes that surface's existing UX verification. Older receipts
remain readable; missing strong ownership makes them unknown, never reusable
passes. Rollback removes new reconciliation eligibility while retaining old
receipts and observations. No manual receipt rewriting is a recovery procedure.

This continuation does not authorize another Critic gate, replenish any
historical attempt, or prove a future foreground run survives client loss.
Execution durability beyond truthful reconciliation requires its own scoped
owning decision and observed proof on an existing supported runner. The original
Critic result and disposition remain separate obligations.