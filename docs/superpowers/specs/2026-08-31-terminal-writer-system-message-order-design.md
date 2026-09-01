---
status: active
---

# Terminal-writer system-message order — fix design
Backlog item: BI-EDC0DAF2
Workroom: WC-A291253B
Named baseline: `origin/main` at `be4c6bfcb4fd62f497167fa55c747105512a0ecd`

## Objectives
**OBJ-TWSO-001:** Put hydrated terminal-writer system authority before user content.
**OBJ-TWSO-002:** Preserve ordinary history and every existing fail-closed control.
**OBJ-TWSO-003:** Carry that authority on the provider-neutral system-prompt
contract, including adapters that intentionally omit system-role history.

## Problem and live evidence
An initiative-review TaskRun can complete immutable reads and resume writer-only,
but `mcp-task-execution.ts` builds history as user then hydrated system context.
Bundled local Qwen refuses that order with HTTP 400, `System message must be at
the beginning`; the writer is not called and the same run remains resumable.
Customer-zero TaskRun `TR-MCP-Y21xamsxOWhsMDAwMDdwcnZzZm4ybTAzOQ-557F042B9990`
reproduced this after reading BI-B223F45E commit
`035a6335bd0e609bafbe96777ef6c5e0ea26bac0`, blob
`b9fe8f0707291805fbc468aef62b401e0ee210a5`; two replays wrote no receipt.

After the original order correction merged, Codex-only live replays for
`BI-199F71B6` hydrated the complete immutable source but recorded three false
spec-approval failures claiming that source was absent. The Codex CLI adapter
correctly omits system-role history because it receives `systemPrompt`
separately. Therefore ordering the history entry first was necessary for local
providers but not provider-neutral; the authority must be appended to the
actual system-prompt argument and omitted from history.

## Contract
- Hydrated terminal-writer context is system authority and must be appended to
  the provider-facing system prompt, before the separate user history.
- Ordinary external TaskRuns keep their existing message order.
- Writer-only narrowing, immutable artifact binding, server-bound arguments,
  PAT grant intersection, reviewer identity, and idempotency remain unchanged.
- A provider failure remains fail-closed: no receipt is inferred from reads or
  prose, and the same TaskRun remains resumable.

## Ordered fix sequence
1. Add a failing test that asserts terminal-writer `system` precedes `user`.
2. Reorder only terminal-writer hydrated history in `mcp-task-execution.ts`.
3. Run focused MCP suites, affected web tests, and the production build.
4. Advance the canonical runtime through `/ops/self-upgrade`.
5. Replay the customer-zero run; verify its bound writer and BI-B223F45E readiness.

## Candidate causes ruled out
- Source and grant exist: four exact reads passed and the packet narrowed to its writer.
- WC-22868A77 reconciled; other local inference continued; no matching PR exists.

## Verification mapping
| ID | Objectives | Acceptance criterion |
| --- | --- | --- |
| AC-TWSO-001 | OBJ-TWSO-001 | Focused test proves `system` then `user`. |
| AC-TWSO-002 | OBJ-TWSO-002 | Ordinary path and fail-closed suites stay green. |
| AC-TWSO-003 | OBJ-TWSO-001 | Customer-zero bound receipt succeeds live. |
| AC-TWSO-004 | OBJ-TWSO-003 | A Codex terminal-writer replay receives the hydrated source through `systemPrompt`, while `chatHistory` remains user-only. |

Documentation impact: this design is the durable internal contract. The change
does not alter owner-facing behavior or public product documentation.
