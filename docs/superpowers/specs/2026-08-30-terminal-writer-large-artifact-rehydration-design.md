---
status: active
---

# Terminal-Writer Large-Artifact Rehydration Design

**Backlog item:** BI-8B8731EE  
**Workroom:** WC-D8BEE5C9  
**Kernel decision:** DI-2C90F0EF92B2  
**Status:** Design and ordered fix plan

## Problem

The initiative-review terminal-writer recovery path preserves reviewer identity and immutable artifact binding, but its deterministic server-side reread stops after six 3,200-character pages (19,200 characters). A valid design artifact can exceed that ceiling while still fitting the minimum 32,000-token reviewer route. The preserved TaskRun `TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-47E477394386` demonstrates the defect: its exact 452-line, 24,493-character artifact was read successfully in six bound pages, then recovery failed with `terminal_writer_context_truncated` before `record_initiative_evidence` could execute. No writer call or receipt was created.

The bound artifact is:

- repository `OpenDigitalProductFactory/opendigitalproductfactory`
- commit `61c791c938ada349cbca1ca54ca24b01a17b75e8`
- path `docs/superpowers/specs/2026-08-30-paaw-competence-evolution-workroom-design.md`
- provider blob `72caf4ebd1185bada197875ce1b4ba9c8589801a`

This is a process-substrate defect. It does not authorize a proxy receipt, a new reviewer identity, or a bypass of immutable-source verification.

## Goals

- Rehydrate the complete preserved artifact for the same reviewer TaskRun when it is no larger than a documented, bounded context envelope.
- Keep repository, commit, path, and provider-blob verification exact on every page.
- Preserve reviewer/author separation and the existing governed terminal writer as the only receipt authority.
- Preserve every immutable reader execution in the existing `ToolExecution` audit trail.
- Fail closed with a typed result for oversized, incomplete, conflicting, malformed, or drifted artifacts.
- Resume the exact preserved TaskRun after deployment; do not mint a replacement reviewer identity.

## Non-goals

- No new table, receipt type, reviewer role, grant, tool, or authorization path.
- No unbounded artifact ingestion, summarization proxy, or model-authored source reconstruction.
- No change to the generic initiative-readiness requirements or receipt semantics.
- No change to `feat/workroom-definition-roster-contracts`, its Workroom, branch, or artifacts.
- No weakening of the six-call provider-visible reader policy. Server-owned deterministic hydration remains a separate recovery operation.

## Existing substrate retained

| Concern | Canonical substrate |
|---|---|
| Immutable binding | `TerminalToolPolicy.immutableReaderArguments` |
| Page verification and reconstruction | `mcp-task-terminal-writer-context.ts` |
| Same-TaskRun recovery | existing `mcp-task-submit.ts` compare-and-set resume |
| Durable audit | existing `TaskRun.progressPayload` and `ToolExecution` rows |
| Terminal authority | existing governed initiative writer handler |
| Provider routing | existing minimum-context route and model profile |

The repair changes only the bounded deterministic hydration policy and its tests. It introduces no parallel source of truth.

## Decision

Implement the `bounded-ceiling-lift` selected by DI-2C90F0EF92B2.

Set the server-owned hydration content ceiling to 64,000 characters and derive its page ceiling from the existing 3,200-character page limit, yielding at most 20 pages. At the repository's conservative four-characters-per-token planning ratio, the source allowance is approximately 16,000 tokens. The initiative reviewer route already requires at least 32,000 context tokens, leaving approximately half of that minimum window for system instructions, writer schema, conversation state, and output.

The limit is deliberately explicit and bounded. It is large enough for the preserved 24,493-character artifact, while avoiding an unbounded read loop or a generic context-window claim. A source that remains incomplete at 20 pages still returns `terminal_writer_context_truncated`; a page or aggregate exceeding the character ceiling returns `terminal_writer_context_oversize`.

Every existing invariant remains mandatory:

1. The reader tool must be authorized by the terminal policy.
2. Every persisted execution must retain exact repository/path/version/blob binding, durable order, and unique identity.
3. Every fresh page must match the server-owned binding, stay within 3,200 characters, form a contiguous cursor-progressing sequence, and retain stable line totals.
4. Partial persisted bytes are never spliced with fresh bytes; deterministic reread begins at line one.
5. Conflicting complete attempts fail closed.
6. Only the existing terminal writer may issue the receipt, using independently selected arguments.
7. The TaskRun id, request digest, caller authority, writer approval boundary, and artifact identity do not change.

## Ordered fix plan

1. Add a failing regression using a 24,493-character, 452-line artifact served across eight exact-bound pages. Assert complete context, tail visibility, and exactly eight reads on the same policy binding.
2. Extend the existing truncation regression to prove that a source still incomplete after 20 pages fails with `terminal_writer_context_truncated`.
3. Raise the aggregate ceiling to 64,000 characters and derive the deterministic page count from that ceiling and the unchanged 3,200-character page size.
4. Run the focused terminal-writer hydration suite, related-test blast radius, web typecheck, style guard, and pregate preflight.
5. Obtain independent semantic review and exact-tree local CI for the immutable DCO candidate, then publish through a protected PR.
6. Release and upgrade the canonical development install through the normal governed path.
7. Resume the preserved TaskRun once with its original request identity. Verify additional exact-bound reader `ToolExecution` rows, one real `record_initiative_evidence` execution, and the resulting canonical receipt. If the source or route no longer matches, stop without creating a new reviewer identity.

## Traceability

| Requirement | Contract/flow | Verification |
|---|---|---|
| AC-LARGE-COMPLETE | Bounded exact-source hydration completes artifacts up to 64,000 characters | 24,493-character / eight-page regression; preserved TaskRun replay |
| AC-IDENTITY | Same TaskRun and exact repository/commit/path/blob remain authoritative | Existing binding/order/cursor tests; live TaskRun id unchanged |
| AC-FAIL-CLOSED | Oversize, truncated, malformed, conflicting, and drifted evidence cannot reach the writer | Existing negative suite plus 20-page truncation regression |
| AC-AUDIT | Reader and writer calls remain durable in existing audit rows | Exact-tree tests and live `ToolExecution`/receipt inspection |
| AC-SEPARATION | Reviewer supplies writer disposition; server does not synthesize a receipt | Existing terminal-writer policy and live writer-result verification |

**Coverage decision:** atomic. The constant change and its paired regression are one independently meaningful repair; neither is shippable alone. There are no implementation dependencies beyond the current mainline substrate.

## Architecture and blast radius review

- **Architecture:** one existing module remains the single policy owner. No schema or orchestration topology changes.
- **Security:** immutable identity validation, cursor continuity, page size, aggregate size, and terminal-writer authorization remain fail-closed.
- **Scale:** worst-case recovery grows from six to twenty provider reads, each capped at 3,200 characters. Reads are sequential because cursor continuity is part of the evidence contract. The 64,000-character aggregate is a hard upper bound.
- **Runtime:** only same-TaskRun terminal-writer recovery is affected. Ordinary reads, interactive chat, task routing, readiness projection, and writer validation are unchanged.
- **Data:** no migration and no source bytes added to TaskRun persistence. Existing metadata and ToolExecution rows remain authoritative.
- **Rollback:** reverting the constant restores the former fail-closed ceiling without corrupting persisted state. Existing waiting TaskRuns remain resumable after a later compatible release.

## Recovery behavior

After the protected release is live, replay the original idempotent request for TaskRun `TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-47E477394386` exactly once. The server must resume that row rather than create a sibling, reread the bound blob from line one in eight pages, and expose only `record_initiative_evidence` for the independently selected terminal disposition. Success is a genuine receipt attached to the same TaskRun; any mismatch, timeout, approval requirement, or incomplete source remains an auditable fail-closed state.
