---
status: draft
backlog: BI-E96C5778
---

# Preserve the reserved execution fence through review hydration

**Backlog item:** BI-E96C5778

**Workroom:** WC-366AA1D9

**Branch:** fix/terminal-writer-hydration-fence

**Base:** d35d2d218e8121819fc423e3e626641d817a4816

**Design admission:** IRD-8261040055B9, allowed fix profile, Medium/low for the initial documentation scope. Implementation admission and runtime path claims remain required.

## Objective and acceptance

**OBJ-HF-RECOVERY:** Allow an otherwise authorized original review to hydrate immutable evidence and continue within its exact reserved execution generation, preserving existing authority, uncertainty and attempt limits.

These criteria reproduce the filed item without changing its acceptance contract.

| ID | Objectives | Acceptance criterion |
| --- | --- | --- |
| AC-HF-1 | OBJ-HF-RECOVERY | A valid exact same-task terminal-writer reservation carries one frozen fence through both governed evidence readers, settlement and writer admission; real default preflight admits its authorized reads and rejects a missing/malformed fence. |
| AC-HF-2 | OBJ-HF-RECOVERY | Lost reservation CAS or changed request, reviewer, authority, generation, dispatch, cancellation, hold or UNKNOWN blocks later reads/writes; concurrent state survives and no fresh task or adopted generation is created. |
| AC-HF-3 | OBJ-HF-RECOVERY | Source commit/blob, original task/thread/request digest, permission intersection, independent reviewer, writer policy and existing attempt/read budgets remain unchanged. |
| AC-HF-4 | OBJ-HF-RECOVERY | Meaningful regressions reproduce the current omission through the actual work-tool wrapper and default preflight, including empty-reader bootstrap, partial-reader hydration, writer admission and reservation/hold races. Admission fixtures are reported separately from PostgreSQL effect proof. |
| AC-HF-5 | OBJ-HF-RECOVERY | Complete applicable source verification and independent assessment, signed protected PR/merge and canonical deployment. Read the original checkpoint afterward and use only its supported recovery; report a genuine receipt or exact unresolved refusal truthfully, separately from source delivery. |

## Observed boundary and prior coverage

The two reader calls in [task submission](../../../apps/web/lib/mcp-task-submit.ts) omit the server-owned taskExecutionFence. The real [autonomous work wrapper](../../../apps/web/lib/tak/autonomous-work-run.ts) forwards that missing value to the existing bound-review preflight. Its [recovery predicate](../../../apps/web/lib/mcp-task-review-recovery.ts) requires a matching captured fence; normal execution captures one only after hydration. The relevant source blobs match between inspected c16f83b5ba731e1139dcee7cca3dcda9aecb2d01 and recorded deployed release144 source c17502c73e9ebdc35cfb3677f0a33b20da5cf192.

BI-26EB2F63 architecture task ending 5AB91DD193B5 stopped after six evidence reads. Its one unchanged request continuation reserved terminal-writer attempt 2 at 2026-10-26T22:22:56.226Z, then returned terminal_writer_context_reader_failed before another tool ran. Readback at updatedAt 2026-10-26T22:22:56.243Z remained input-required with the original dispatch attempt 1, no receipt and no completedAt. Evidence is in WC-09F64F43 sequence31; scope coordination is sequence36. The source omission explains this refusal but does not exclude other simultaneous live authority failures. No complete failed-reader audit was read.

Reuse the [large-artifact hydration design](2026-08-30-terminal-writer-large-artifact-rehydration-design.md) and existing reservation, preflight, executor and settlement code. Native semantic search and the complete 41-item EP-ABB3AC9D title list found no exact active repair. BI-8B8731EE and BI-DE58CFE8 are delivered hydration/terminal-policy mechanisms. BI-A5E13FD9 repairs submitted capacity-wait request admission; this defect occurs after terminal-writer reservation. BI-F646BC4E protects canonical writer effects. BI-7906C73E retains historical recovery ownership and its own baseline. None grants this item implementation admission.

This repair is independently shippable and blocks BI-26EB2F63. It neither delivers that scenario nor settles historical UNKNOWN tasks. The active Critic owner confirms BI-BCBCA8D1 leaves the generic hydration sites unchanged. Its adapter/submit/execution claims remain active until protected publication and explicit release.

## Scope and authority

Candidate production changes are restricted to:
- apps/web/lib/mcp-task-terminal-writer-recovery.ts
- apps/web/lib/mcp-task-submit.ts
- apps/web/lib/mcp-task-execution.ts

Obtain exact normal path claims and resolve returned test impact before editing. Candidate tests reuse mcp-task-terminal-writer.test.ts and mcp-task-execution-fence.test.ts, with a focused composition test/fixture only if needed; every added path also needs a claim. Active ownership is never overridden by this document.

There is no new table, migration, UI, grant, model, provider, configuration, signed-token format or executor. Preserve the shared fence parser, unchanged preflight and canonical writers. Public arguments cannot supply execution authority. No alternate credentials, caller flags, review impersonation, task replacement, budget reset, UNKNOWN clearing or historical closure is permitted. The current task's explicit allocation is approximately20% relevant refactoring; installation identity does not determine a funding owner.

## Ordered fix plan

1. **Reproduce both missing-fence paths.** Start from a genuine-shaped immutable bound-review fixture entering the real submit/reservation path. Cover empty-reader bootstrap and partial/content-free reader history separately. Keep the actual executeAutonomousWorkTool wrapper and default preflight. Before the fix, require the source-reader backend to remain uncalled with review_execution_authority_refused surfaced as terminal_writer_context_reader_failed. Record RED without treating unrelated setup failures as proof.

2. **Capture at reservation ownership.** In [terminal-writer recovery](../../../apps/web/lib/mcp-task-terminal-writer-recovery.ts), construct the exact proposed progress from retained original dispatch/authority fields and the normal next-attempt resumeReservedAt. Use the existing typed fence capture/parser with the validated immutable request digest. Invalid capture refuses before the reservation write. Perform the existing original-status/updatedAt compare-and-set. Only its successful owner receives that frozen fence; a loser returns persisted state and executes no reader/provider. Never reconstruct authority from whichever row is current later.

3. **Carry the frozen identity through every read.** Pass that fence unchanged to both executeAutonomousWorkTool calls. Preserve the task, reviewer, user, token and exact artifact arguments. Every new page passes the existing authorization and execution checks. Keep valid complete-history reuse, strict page/source binding and bounded whole-blob rereading; do not splice partial bytes, increase limits or fabricate successful reader history.

4. **Keep settlement and writer admission in the same generation.** Pass the fence and bound reviewer to the existing settleRemoteTask boundReview guard for hydration success and failure; honor displacement. Add only a server-internal expected-fence input to the subsequent executor admission. Compare the fresh persisted task to that expected fence before inference/tool work, then retain the original frozen value. Existing callers retain their admission behavior. A hold, cancellation, UNKNOWN or authority/generation change cannot be overwritten or borrowed.

5. **Refactor and verify atomically.** Consolidate repeated reservation snapshot construction and audit-backed fixture setup for the approximately20% refactoring allocation. Reuse identity/lifecycle helpers instead of adding a parser or state machine. The reservation, readers, guarded settlements and writer handoff are one atomic repair; partial forwarding leaves an exploitable or permanently refused boundary. Resolve current main and the prior owner's published changes before implementation.

## Meaningful regression contract

The current terminal-writer suite mocks executeAutonomousWorkTool and hides this composition. Partially mock its module while retaining that actual function; leave the default toolPreflight active. Reuse readerBootstrapTask, readerBootstrapHistory and taskRunState with real-shaped immutable metadata. Follow mcp-governed-execute.execution-fence.test.ts for unrelated storage/permission/provider ports. Do not stub the recovery predicate or fence comparison. Bank only qualifying successful wrapper audit results into reader history; failed reads are not context evidence.

| Case | Required result |
| --- | --- |
| Valid bootstrap and partial/content-free hydration | Real preflight permits exact-bound reads, same task/thread remains, and normal writer-only handoff receives the identical fence. |
| Invalid capture or reservation CAS loss | Zero reader/provider calls; no extra task; current state is preserved. |
| Missing, malformed, stale or foreign fence | Existing refusal remains; source backend and writer do not run. |
| Cancellation, hold or UNKNOWN before/between pages | Subsequent work stops; failure settlement preserves the newer state. |
| Reservation, dispatch, request, authority or reviewer displacement | The original fence is rejected, never replaced from current state. |
| Displacement between hydration and writer admission | Expected-fence validation refuses before inference or writer execution. |
| Concurrent exact resume, receipt readback and exhaustion | One reservation owner; original budget and genuine receipt semantics remain intact. |

The provider-loop stand-in may call the real governed wrapper for a fixture writer with the loop's fence. Stubbing only the final tool proves admission composition, not an independent verdict or database effect. Reuse existing isolated PostgreSQL fixtures where proving compare-and-set/settlement ordering requires real storage. Do not claim source mocks prove database atomicity or served behavior.

## Coverage, verification and delivery

Coverage is one atomic deliverable, reserved-review-hydration-fence, bound to this item's own canonical ordered fix design. Requirement refs: AC-HF-1 through AC-HF-5. Contract ref: reserved-generation-through-hydration. Flow ref: original-review-reservation-to-writer. Verification refs: real-preflight-recovery-composition and original-task-deployed-readback. All phases depend on this deliverable; none is independently shippable. Record and check native immutable coverage after publication, then obtain normal implementation admission for the actual scope. This Markdown is not a coverage receipt.

Run the impact-selected tests, applicable production/test TypeScript programs, documentation/index checks and returned guards. Use the managed dependency probe before source checks. Runtime-bound checks use canonical shared verification, with a real lease and truthful executed/skipped outcomes. Preserve bounded cleanup and all failures. Obtain independent assessment under current policy, normal signed push, ready PR, protected checks and merge queue; verify final source and merge identities.

Canonical deployment must contain the merged repair before any original-task recovery attempt. Re-read that original task's actual checkpoint and use only its ordinary owner-issued supported recovery if eligible. Existing attempt accounting may legitimately leave it held; this repair grants no budget reset or new task. A missing receipt, timeout, cancellation or UNKNOWN remains explicit. Report source delivery, deployment and native review/served acceptance separately.

Rollback is a protected source repair and canonical deployment. Preserve the execution fence, preflight and task history; incompatible generations remain refused. No task-state edits or weakened authority checks are a rollback.

Implementation, regressions, native independent review and deployed verification are **UNRUN**. Design scope is the only admission currently recorded.
