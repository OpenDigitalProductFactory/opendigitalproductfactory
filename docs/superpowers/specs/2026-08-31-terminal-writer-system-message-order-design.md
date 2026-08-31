---
status: active
---

# Terminal-writer system-message order — fix design

Backlog item: BI-EDC0DAF2  
Workroom: WC-A291253B  
Named baseline: `origin/main` at `be4c6bfcb4fd62f497167fa55c747105512a0ecd`

## Problem and live evidence

An initiative-review TaskRun can complete its immutable reads and resume in the
writer-only phase. That path hydrates source bytes into a system message, but
`mcp-task-execution.ts` constructs `chatHistory` as user request then system
context.

That order is accepted by some hosted adapters but is invalid for the bundled
local Qwen chat template, which requires system content to precede user
content. When hosted providers are unavailable, local fallback returns HTTP
400 with `System message must be at the beginning`. The governed writer is
never called and the same TaskRun remains `input-required`.

Customer-zero TaskRun `TR-MCP-Y21xamsxOWhsMDAwMDdwcnZzZm4ybTAzOQ-557F042B9990`
reproduced it after reading the immutable BI-B223F45E design at commit
`035a6335bd0e609bafbe96777ef6c5e0ea26bac0`, blob
`b9fe8f0707291805fbc468aef62b401e0ee210a5`. Two replays produced zero writer
executions. Logs distinguish the ordering error from hosted capacity failures.

## Contract

- Hydrated terminal-writer context is system authority and must appear before
  user content in provider-facing message history.
- Ordinary external TaskRuns keep their existing message order.
- Writer-only narrowing, immutable artifact binding, server-bound arguments,
  PAT grant intersection, reviewer identity, and idempotency remain unchanged.
- A provider failure remains fail-closed: no receipt is inferred from reads or
  prose, and the same TaskRun remains resumable.

## Ordered fix sequence

1. Add a failing unit test that captures `executeAutonomousAgenticLoop` input
   for terminal-writer replay and asserts `system` precedes `user`.
2. Reorder only the terminal-writer hydrated history in
   `mcp-task-execution.ts`.
3. Run the focused MCP task execution and terminal-writer suites, then the
   affected web tests and production build.
4. Advance the canonical runtime through `/ops/self-upgrade`.
5. Replay the existing customer-zero TaskRun and verify that its bound
   `record_initiative_evidence` writer executes and BI-B223F45E research
   readiness becomes satisfied.

## Candidate causes ruled out
- Missing source: four `read_source_at_version` calls read the bound blob.
- Missing grant: the server issued the exact packet and narrowed to its writer.
- Wrong Workroom: base/head reconciliation passed for WC-22868A77.
- Local outage: HTTP 400 named message order while other inference continued.
- In-flight repair: no matching PR exists; `origin/main` retains the defect.

## Verification mapping
- Role ordering and ordinary-path preservation → focused
  `mcp-task-execution` test.
- Terminal writer remains exact and fail-closed → existing
  `mcp-task-terminal-writer` and terminal-tool-policy suites.
- Type and integration safety → affected web test gate and production build.
- Functional acceptance → the same customer-zero TaskRun records its bound
  research receipt after canonical deployment.

Documentation impact: this design is the durable internal contract. The change
does not alter owner-facing behavior or public product documentation.
