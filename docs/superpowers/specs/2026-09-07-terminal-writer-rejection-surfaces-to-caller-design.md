---
status: active
title: A rejected terminal writer surfaces its rejection to the caller
backlog_item: BI-A57B6185
decision_interaction: DI-F648E26A7FAE
---

# A rejected terminal writer surfaces its rejection to the caller

- **Date:** 2026-09-07
- **Scope:** platform — MCP remote task execution, terminal-writer wait and escalation
- **Backlog item:** `BI-A57B6185`
- **Profile:** fix
- **Status:** Design — implemented in this branch.

**OBJ-WRITER-REJECTION-1:** When the governed terminal writer is called and rejects the review packet, the caller of request_coworker receives the writer's own error code and message, the wait is classified as a rejection rather than a missing writer, and no attempt count or reviewer-switch escalation is charged against it.

## 1. Defect, on a named ref

Observed live on 2026-09-06 while closing BI-B19BE117 (this operator install, deployed portal `998d1c4cbaa`, source main `f0f8fcd9dc1`):

| Time | Writer call (`ToolExecution.result`) | What the caller was told |
| --- | --- | --- |
| 17:55:42 | `CANONICAL_DESIGN_REQUIRED: AC-1 has a malformed objective link.` | `waitReason: missing-terminal-writer` — "did not produce a receipt or approval envelope" |
| 18:18:30, 18:46:44, 19:07:46 | `CANONICAL_DESIGN_AMBIGUOUS: No live workroom … has head 3af4c61 … Sync the branch head with adopt_worktree …` | same, then `terminal_writer_retry_exhausted` — "The required writer was omitted on three attempts. … select a different eligible reviewer/provider" |

Both rejections were author-side and named their own fix. Neither reached the caller. The escalation text was false on both counts: the writer was not omitted, and a different reviewer hits the identical rejection because the packet, not the reviewer, is wrong. Cost: four dispatches, one alternate-reviewer dispatch, one mis-diagnosed backlog item, and a Postgres read of `ToolExecution.result` to learn what one line in the response would have said.

Source at `origin/main` (`b5a236a0a62`):

- `apps/web/lib/mcp-task-execution.ts` — the `terminal-writer-missing` branch treats a failed writer execution and an absent writer execution identically: `waitReason` is always `missing-terminal-writer`, `structuredContent` is only set on escalation, and `terminalWriterRetryIsExhausted(attempt)` fires regardless of whether the writer ran.
- `apps/web/lib/mcp-task-terminal-writer-escalation.ts` — `recoverTerminalWriterEscalation` re-derives a retry-exhausted escalation from any `missing-terminal-writer` wait at attempt ≥ 3 on replay, so even a caller that reads the ledger cannot stop the escalation.
- `apps/web/lib/tak/terminal-tool-policy.ts` `terminalWriterFailureMessage` (since #5129) does include the last error and message in prose, but the execution layer discards it whenever the loop reports `failure.kind === "terminal-writer-missing"`, which it always does on this path.

Candidate causes ruled out by running, not reading: reader budget (BI-E8237EAE) — the same reviewer passed design-spec on the same blob minutes earlier; reviewer capability — the alternate holder of `initiative_design_review` produced the identical rejection; provider rotation (#5129) — the writer was called on every attempt.

## 2. Fix sequence

1. `mcp-task-terminal-writer-escalation.ts`: add `TerminalWriterRejection`, `lastTerminalWriterRejection(writerToolName, executions)`, `terminalWriterRejectionMessage`, `terminalWriterRejectionStructuredContent`, `TERMINAL_WRITER_REJECTED_WAIT_REASON`; make `recoverTerminalWriterEscalation` return null when the persisted wait carries `writerRejection`.
2. `mcp-task-execution.ts`: in the `terminal-writer-missing` branch, derive the rejection from the writer executions; when present, emit `waitReason: terminal-writer-rejected`, `structuredContent.error: terminal_writer_rejected` with `writerRejection: { error, message }` and `action: fix-packet-and-resume`, persist `writerRejection` inside `terminalWriterWait`, keep `resumable: true`, and never create an escalation.
3. Tests: `mcp-task-execution.test.ts` (rejected writer at attempt 2 surfaces code and message; rejected writer at attempt 3 does not escalate and does not say "omitted"); `mcp-task-terminal-writer-escalation.test.ts` (a wait with `writerRejection` never recovers into an escalation).

## 3. Acceptance criteria

| Criterion | Objective | Statement |
| --- | --- | --- |
| AC-1 | OBJ-WRITER-REJECTION-1 | A writer execution with `success:false` yields `waitReason: terminal-writer-rejected` and `structuredContent.writerRejection` carrying the writer's `error` and `message` verbatim |
| AC-2 | OBJ-WRITER-REJECTION-1 | The same case at attempt 3 stays resumable, records no `terminalWriterEscalation`, and its content never says the writer was omitted |
| AC-3 | OBJ-WRITER-REJECTION-1 | On replay, a persisted wait carrying `writerRejection` never recovers into a retry-exhausted escalation |
| AC-4 | OBJ-WRITER-REJECTION-1 | A genuine no-show (no writer execution) still yields `missing-terminal-writer` and still escalates at attempt 3 |

## 4. Non-goals

- Changing the writer's own validation (CANONICAL_DESIGN_* rules) or the reader budget.
- Offering alternate reviewer routes in the recovery packet; that is BI-A57B6185's acceptance item 2 and is out of this fix's blast radius.

## 5. Backlog coverage

- Decision: atomic
- Parent: `BI-A57B6185`
- Receipt: `blocked-by: coverage is recorded against this design doc once the branch head is bound to the Workroom; see the fix sequence above`
- Rationale: three files, one behaviour; shipping the escalation guard without the execution branch (or vice versa) leaves the caller with contradictory signals.
- Dependencies: none
