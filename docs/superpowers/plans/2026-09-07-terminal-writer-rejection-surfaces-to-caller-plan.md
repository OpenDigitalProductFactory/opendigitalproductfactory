---
status: active
title: A rejected terminal writer surfaces its rejection to the caller — fix plan
backlog_item: BI-A57B6185
design: docs/superpowers/specs/2026-09-07-terminal-writer-rejection-surfaces-to-caller-design.md
---

# A rejected terminal writer surfaces its rejection to the caller — fix plan

- **Backlog item:** `BI-A57B6185` (fix profile, atomic)
- **Design:** [`2026-09-07-terminal-writer-rejection-surfaces-to-caller-design.md`](../specs/2026-09-07-terminal-writer-rejection-surfaces-to-caller-design.md)
- **Status:** delivered in PR #5161

## Backlog coverage

- Decision: atomic
- Parent: `BI-A57B6185`
- Receipt: `blocked-by: the coverage receipt is minted against this plan blob once it is on the bound Workroom head; recorded on the next push`
- Rationale: three files, one behaviour. Shipping the escalation guard without the
  execution branch, or the reverse, leaves the caller with contradictory signals: a
  rejection wait that still escalates on replay, or an escalation that names a rejection.
- Dependencies: none

| Key | Requirement refs | Contract refs | Flow refs | Verification refs |
| --- | --- | --- | --- | --- |
| writer-rejection-surface | OBJ-WRITER-REJECTION-1 | terminal-writer-rejected, terminal_writer_rejected, fix-packet-and-resume | derive the rejection from the writer executions; never recovers into an escalation | AC-1, AC-2, AC-3, AC-4 |

## Fix sequence (all complete)

1. `apps/web/lib/mcp-task-terminal-writer-escalation.ts`: `TerminalWriterRejection`, `lastTerminalWriterRejection`, rejection message and structured content, wait reason `terminal-writer-rejected`; `recoverTerminalWriterEscalation` never recovers into an escalation from a wait that carries `writerRejection`.
2. `apps/web/lib/mcp-task-execution.ts`: derive the rejection from the writer executions in the `terminal-writer-missing` branch; emit `terminal_writer_rejected` with `writerRejection { error, message }` and action `fix-packet-and-resume`; stay resumable; never escalate.
3. Tests: rejected writer at attempt 2 surfaces the code and message (AC-1); rejected writer at attempt 3 does not escalate and never says "omitted" (AC-2); a persisted wait with `writerRejection` never recovers into an escalation (AC-3); a genuine no-show still reports `missing-terminal-writer` and still escalates (AC-4, existing tests unchanged).

## Verification

Red-then-green: the three new assertions fail against `origin/main` source and pass with the fix. Objective OBJ-WRITER-REJECTION-1 is covered by AC-1, AC-2, AC-3, AC-4.
