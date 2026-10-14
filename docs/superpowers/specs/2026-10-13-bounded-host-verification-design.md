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
   a documented 10-minute per-command default and existing environment
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

BI-D27ADE59's shared CI classification is already merged. Claim identity remains
BI-2641F34A; semantic-review recovery remains BI-8ECEC429; readiness presentation
remains BI-9DC43E17. Canonical identity BI-CAP-437F7745 and role-and-room
BI-56E9CEC2 remain separate. Managed dependency readiness (including current
pinned compiler aliases) is inspected independently before expanding this fix.
No other session's worktree is used. No runtime assets are edited and no manual
image or deployment path is introduced.
