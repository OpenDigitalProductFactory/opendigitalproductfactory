---
status: active
---

# Terminal-writer system-message order — fix design

Backlog item: BI-EDC0DAF2  
Workroom: WC-A291253B  
Named baseline: `origin/main` at `be4c6bfcb4fd62f497167fa55c747105512a0ecd`

## Problem and live evidence

An external initiative-review TaskRun can complete its immutable reads and then
resume in the writer-only phase. The resume path hydrates the verified source
bytes into a system message, but `apps/web/lib/mcp-task-execution.ts` currently
constructs `chatHistory` in this order:

1. the original user request;
2. the hydrated terminal-writer system context.

That order is accepted by some hosted adapters but is invalid for the bundled
local Qwen chat template, which requires system content to precede user
content. When hosted providers are unavailable, local fallback returns HTTP
400 with `System message must be at the beginning`. The governed writer is
never called and the same TaskRun remains `input-required`.

Customer-zero reproduced the defect on 2026-08-31. TaskRun
`TR-MCP-Y21xamsxOWhsMDAwMDdwcnZzZm4ybTAzOQ-557F042B9990` read all 51 lines of
the immutable BI-B223F45E design at commit
`035a6335bd0e609bafbe96777ef6c5e0ea26bac0`, blob
`b9fe8f0707291805fbc468aef62b401e0ee210a5`. Two terminal-writer replays then
failed closed with zero writer executions. Live portal logs separate the local
template error from concurrent hosted-provider capacity failures.

## Contract

- Hydrated terminal-writer context is system authority and must appear before
  user content in provider-facing message history.
- Ordinary external TaskRuns keep their existing message order.
- Writer-only narrowing, immutable artifact binding, server-bound writer
  arguments, PAT grant intersection, reviewer identity, and idempotency remain
  unchanged.
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

- **Missing immutable source:** ruled out by four successful
  `read_source_at_version` executions on the exact bound blob.
- **Missing writer grant:** ruled out because the server issued the exact
  two-tool packet to AGT-WS-BUILD and terminal replay narrowed to the bound
  writer.
- **Wrong Workroom identity:** ruled out by provider-verified base/head
  reconciliation on WC-22868A77.
- **A general local-model outage:** ruled out by the deterministic HTTP 400
  parser response naming message order; unrelated local inference continued.
- **An in-flight repair:** no open PR matched terminal-writer prompt ordering,
  and `origin/main` still contains the user-then-system construction.

## Verification mapping

- Role ordering and ordinary-path preservation → focused
  `mcp-task-execution` test.
- Terminal writer remains exact and fail-closed → existing
  `mcp-task-terminal-writer` and terminal-tool-policy suites.
- Type and integration safety → affected web test gate and production build.
- Functional acceptance → same TaskRun
  `TR-MCP-Y21xamsxOWhsMDAwMDdwcnZzZm4ybTAzOQ-557F042B9990` records the bound
  research receipt after canonical deployment.

Documentation impact: this design is the durable internal contract. The change
does not alter owner-facing behavior or public product documentation.
