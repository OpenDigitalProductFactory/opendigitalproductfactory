---
status: active
---

# Immutable Source Review Traversal Design

**Backlog item:** BI-SIG-463E478D  
**Workroom:** WC-C4836AC0  
**Kernel decision:** DI-5B59E245E250  
**Status:** Design checkpoint

## Problem

An initiative reviewer can be given an immutable repository artifact and the exact tools needed to assess it, yet still fail before it reaches the governed evidence writer. The current `read_source_at_version` result repeats the complete file in both `message` and `data.content`. The agent loop later compacts that result to a short prefix. The reader has no range or cursor input, so another call repeats the same prefix. `search_source_at_version` similarly has no continuation marker. A local reviewer can spend its entire small-model tool-call allowance on repeated reads and searches, then hit the generic local spinning guard before it proposes `record_initiative_evidence`.

The observed failure is systemic. It blocks the readiness receipt needed by BI-FFBDDD96 and, downstream, the WordPress regression BI-A45D744A. This design changes only the immutable source tools and the bounded initiative-review execution contract. It does not change either dependent BI, their Workrooms, their branches, or their receipts.

## Goals

- Let a reviewer traverse a long immutable artifact without repeating a truncated prefix.
- Preserve and verify the server-issued repository, commit, path, and blob identity.
- Keep each model-facing tool result below the existing context-result budget.
- Reserve a terminal governed-writer step instead of allowing reads to consume the whole local-model tool surface.
- Fail closed when the reviewer does not read evidence or does not attempt the writer.
- Reuse the existing MCP tool pack, task submission path, agent loop, `ToolExecution` audit rows, and initiative receipt validators.

## Non-goals

- No new receipt type, reviewer role, database table, or readiness policy.
- No increase to the generic local-model spinning limit.
- No proxy approval, fabricated receipt, or bypass of writer authorization.
- No changes to BI-FFBDDD96 or WordPress source paths.
- No general orchestration rewrite.

## Existing substrate

| Concern | Canonical home retained |
|---|---|
| Immutable git reads | `apps/web/lib/build/git-utils.ts` |
| MCP schemas and handlers | `apps/web/lib/mcp/packs/version-history-pack.ts` |
| Server-issued immutable review binding | `apps/web/lib/mcp-task-submit.ts` |
| Autonomous caller seam | `apps/web/lib/tak/autonomous-work-run.ts` |
| Iterative tool execution and audit | `apps/web/lib/tak/agentic-loop.ts` and `governedExecuteTool` |
| Receipt validation and persistence | Existing initiative-readiness writer handlers and repositories |

No schema migration is needed. The workflow policy is ephemeral execution input derived from the already-canonical `initiativeReviewBinding`; it is not a second persisted source of truth.

## Decision

Implement the `paged-tools-terminal-contract` selected by DI-5B59E245E250.

### 1. Bounded immutable read pages

Extend `read_source_at_version` with optional `startLine`, `cursor`, `maxLines`, `maxChars`, and `expectedBlobId` inputs.

- `startLine` is a human-friendly 1-based entry point.
- `cursor` is an opaque continuation returned by the prior page and takes precedence over `startLine`. Its payload is bound to the resolved ref, path, and blob id; replay against another artifact fails closed.
- `maxLines` and `maxChars` are clamped to conservative server limits. The first page defaults to a payload that fits the agent loop's 4,000-character unknown-window result budget after JSON metadata.
- The result contains exactly one copy of source bytes, in `data.content`. `message` becomes a short page summary.
- The result also returns `startLine`, `endLine`, `totalLines`, `hasMore`, and `nextCursor`.
- The handler resolves the blob id at `version:path`. When `expectedBlobId` is supplied and differs, it returns a failure rather than reading drifted bytes.

The opaque cursor encodes a character offset plus a digest of the exact ref/path/blob binding. This guarantees progress even when one source line exceeds the page character ceiling without turning the cursor into a transferable source locator. Line metadata remains informational and lets a reviewer jump to a searched line.

### 2. Deterministic search continuation

Extend `search_source_at_version` with `offset`, bounded `maxResults`, and `expectedBlobId`.

- Use git's stable path/line output order, fetch one result beyond the requested page, slice from `offset`, and return `hasMore` plus `nextOffset`.
- Bound both page size and maximum offset. An out-of-range request fails clearly; it never silently wraps to the first page.
- For an initiative review the schema binds `version`, `glob`, and `expectedBlobId` to the server-issued artifact. Search therefore cannot escape to another path or accept a same-path blob at a different identity.

### 3. Initiative-review terminal tool policy

When `tasks/submit` carries a valid `initiativeReviewBinding`, derive an ephemeral policy:

```text
writerToolName     = binding.writerToolName
readerToolNames    = required immutable read/search tools
minimumReaderCalls = 1 successful call
maximumReaderCalls = 6 attempted calls
```

Thread the policy through `executeAutonomousAgenticLoop` into `runAgenticLoop`. A small pure module owns its state transitions and messages as typed dispositions (`allow`, `refuse`, `nudge`, `input-required`, `complete`). The loop maps the waiting disposition to a typed failure on its existing `AgenticResult`; this does not create a parallel orchestration outcome model.

The loop enforces these states:

```text
evidence required -> evidence available -> writer required -> writer attempted
       |                    |                    |
  writer blocked      reader cap reached    text-only blocked
```

- A writer call before one successful reader is returned to the model as a non-executed policy refusal.
- Once six reader calls have been attempted, further reader calls are returned as non-executed policy refusals and the provider tool surface narrows to the single writer schema.
- A text-only response before a writer attempt receives one explicit, ephemeral next-action notice. A second text-only response fails closed as `missing-terminal-writer`; the remote TaskRun remains `input-required`, has no `completedAt`, and records no receipt.
- The same immutable request may reserve that waiting TaskRun once through a compare-and-set transition back to `working`. A second missing-writer stop remains `input-required` and is not automatically attempted again. The TaskRun id, request digest, token authority, thread, artifact binding, and writer approval path do not change.
- Any writer call counts as the terminal attempt, whether the governed result succeeds, requests input/approval, or rejects the proposed receipt. The existing writer remains the sole authority for validation and persistence.
- The policy is absent for every non-initiative caller, preserving their current agent-loop behavior.

The six-call ceiling stays below the existing local-provider spinning guard at eight executed tool calls. It also bounds worst-case retrieval to six model-visible pages, while search allows the reviewer to target relevant sections rather than scan every line.

## Result serialization

DPF's native loop serializes `message` followed by JSON `data`. Removing file/search bytes from `message` eliminates the duplicate inside that model-facing string. The external MCP route continues to emit its protocol-compatible text block and `structuredContent`; this follows the MCP tool-result compatibility recommendation while avoiding the prior third copy of the same source bytes.

## Research and benchmarking

- [Model Context Protocol tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools): adopt structured tool results and keep a compatible text result at the transport boundary; do not make a DPF-only wire format.
- [Model Context Protocol schema reference](https://modelcontextprotocol.io/specification/2025-06-18/schema): adopt an opaque continuation cursor and explicit continuation metadata rather than silent truncation.
- [LangGraph Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api): adopt deterministic state-based routing for a multi-stage tool workflow; reject a separate graph runtime because DPF already has the canonical agent loop.
- [OpenAI Agents SDK model settings](https://openai.github.io/openai-agents-js/guides/models/): adopt the principle that a workflow may require tool use. The server-owned terminal policy remains the authority and compiles its hard requirement into each provider's wire format; no provider-specific setting may independently decide when the requirement applies.

## Architecture and scale

- **Single source of truth:** the immutable binding supplies identity and the new policy module supplies the one transition algorithm. Prompts may explain the contract but do not own it.
- **Data architecture:** no parallel table is added. Existing TaskRun `progressPayload.terminalWriterWait` carries the versioned wait reason and bounded attempt count; TaskRun and ToolExecution rows remain the audit record.
- **Scalability:** each read is bounded by lines and characters; each search is bounded by page size and offset; each review is bounded by reader attempts. The current git helper retains its 1 MiB command buffer ceiling. Artifacts beyond that ceiling fail explicitly and require a separately governed scale-lift BI/epic for streamed blob access; no such epic is currently linked to BI-SIG-463E478D.
- **Security:** ref/path validation remains in git-utils, the bound schemas prevent artifact escape, `expectedBlobId` detects identity drift, and a cursor is accepted only for its bound ref/path/blob tuple.
- **Portability:** use existing Node/git helpers only; add no shell pipeline or platform-specific command.

## Blast radius

- General callers see pageable read/search metadata and concise messages; short-file content remains in `data.content`.
- Bound initiative reviewers receive cursor/range fields and a fixed blob id in their provider schemas.
- Only bound initiative reviews opt into the terminal policy. Interactive chat, Build Studio, scheduled work, and unrelated MCP tasks are unchanged.
- The main agent-loop file must not grow beyond its ratcheted baseline. Policy logic and tests live in a focused module, and integration replaces or extracts enough existing guard code to keep the baseline flat or smaller.

## Verification

- Unit tests for page boundaries, long-line cursor progress, search continuation, blob mismatch, and non-duplicated messages.
- Unit tests for evidence-first, reader ceiling, writer-only transition, one nudge, resumable fail-closed exit, same-TaskRun compare-and-set resume, bounded retry exhaustion, and writer-attempt terminal behavior.
- Submission tests proving exact path/commit/blob schemas and policy propagation.
- An agent-loop regression proving a local initiative reviewer reaches the writer rather than the eight-call spinning diagnostic.
- A long-artifact functional fixture proving a reviewer can reach a late section and submit a writer call bound to the same immutable artifact.
- Negative cursor tests proving cross-ref, cross-path, malformed, and stale-blob replay all fail closed.
- Typecheck, source policy/pregate preflight, exact-tree local integration CI, independent semantic review, PR health, and protected merge.

## Documentation impact

This design and its implementation plan are the durable operator/contributor record. The MCP tool descriptions are updated in source so progressive tool discovery explains pagination. No end-user route or UI copy changes.

## Live substrate extension (2026-08-28)

The first protected deployment proved the server-side argument normalizer: provider calls with `{}` executed with the exact bound path, commit, and blob identity. The same run then failed because the live `/workspace` git volume did not contain the open-PR commit object. Its ToolExecution rows also stored `{}` because metrics-only audit policy suppressed every parameter. Neither failure permits a readiness receipt.

Decision DI-D2257AD7DD7D selected `reuse-canonical-provider-blob-reader` with high confidence. The extension keeps local git as the fast path and reuses the authenticated canonical GitHub blob substrate only when local resolution fails and the call carries a complete server-bound identity: canonical repository, 40-character commit, path, and 40-character expected blob. The provider response must be a file at the exact blob id, valid UTF-8, and no larger than 1 MiB. Missing or conflicting identity, provider failure, blob mismatch, oversized content, and invalid UTF-8 all fail closed. No mutable checkout refresh or TaskRun source-byte copy is introduced.

`read_source_at_version` additionally opts into redacted parameter retention while remaining `metrics_only`. This persists the normalized immutable identity and bounded page controls for evidence, but continues to suppress the returned source content. Other metrics-only tools retain the existing empty-parameter behavior.

This extension remains provider-agnostic and initiative-agnostic. It changes no grants, provider floors, approval semantics, writer validation, or non-review execution behavior.

## Required terminal-writer dispatch extension (2026-08-28)

Live TaskRun `TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-95A624D36842` proved that a single-writer tool surface plus prompt reminders is not a hard execution contract. After successful bound context hydration, the provider returned prose on attempt five because the routed execution plan still carried `toolChoice: "auto"`. No writer execution, envelope, or receipt existed.

The server-owned terminal policy now sets a caller-scoped `toolChoice: "required"` only when the current provider surface contains exactly the governed writer. Route resolution applies that value after recipe and harness selection, preserves it across fallback construction, and adapters compile it to the provider's native required-call form. An adapter that cannot enforce the requirement fails closed before inference. Ordinary tool-backed and conversational turns retain their existing automatic policy.

The model still independently supplies every writer argument, including its decision. Required dispatch neither synthesizes a judgment nor bypasses approval. A provider that nevertheless returns prose leaves the same TaskRun `input-required` and records `dispatchContract: "required-tool-call"` plus `noncompliance: "prose-without-required-writer"`; no receipt is inferred.

## Persisted reader-history extension (2026-08-28)

The first identical-key replay after required writer dispatch was live exposed a separate history-accounting defect on preserved TaskRun `TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-95A624D36842`. Seven successful exact-bound `read_source_at_version` rows had accumulated across earlier attempts: two original proof-only rows, two subsequent proof-only rows, and three proof-only rows from the latest bounded hydration. Hydration compared that durable cross-attempt history count with the six-call single-attempt ceiling and failed `terminal_writer_context_reader_count_invalid` before it could reuse a coherent page set or reread the bound artifact. No writer, envelope, or receipt was created.

The reader ceiling remains per attempt, not per TaskRun lifetime. Hydration validates every persisted reader row for success, tool authority, immutable parameters, durable ordering, uniqueness, and result binding. Content-free rows remain authority proof and do not consume a new hydration attempt. Contentful rows are partitioned at exact line-one request boundaries; each attempt remains limited to the policy reader ceiling and must be internally contiguous, cursor-progressing, blob-stable, and within the existing page and character budgets. Complete attempts may be reused only when every complete attempt agrees on the exact source content; disagreement fails closed. When no complete persisted attempt exists, the server rereads the one bound artifact from line one under the existing six-page/19,200-character ceiling and never splices persisted partial content with reread content.

This extension changes no TaskRun identity, request digest, grants, provider floors, writer arguments, approval boundary, receipt semantics, or ordinary task execution. Historical proof rows can no longer make a correctly bound same-TaskRun recovery permanently unrecoverable, while conflicting, failed, malformed, out-of-order, over-budget, or ambiguous content still fails closed.

## Failed reader-attempt isolation extension (2026-08-29)

Live BI-F48 TaskRun `TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-0B380E66396F` exposed a narrower recovery defect after the reader-history release. Its durable history contains five successful exact-bound content pages at start lines 1, 58, 97, 148, and 165, plus one failed exact-bound subset request at start line 28. The successful rows independently cover the complete 165-line design artifact, but terminal-writer hydration rejected the entire TaskRun as `terminal_writer_context_reader_failed` solely because the failed historical row existed. No writer, envelope, receipt, or baseline was created.

Failed reader rows remain immutable audit history, but failure is not source evidence. Hydration validates every historical row's tool authority, unique and durable ordering, exact repository/path/version/blob binding, and any persisted non-empty result identity before classifying it. A failed row that is unauthorized, conflicts with the binding, duplicates or reverses execution identity/order, or contains malformed/conflicting persisted content still fails closed. An exact-bound failed row contributes neither reader authority nor content coverage and cannot start, extend, bridge, or invalidate a separately complete successful attempt.

Only successful exact-bound rows may form hydration attempts. Each candidate attempt must independently start at the artifact boundary, remain contiguous and cursor-progressing, respect the existing per-attempt call/page/character ceilings, preserve a stable total and blob identity, and terminate with complete coverage. Pages are never combined across attempt boundaries. When no complete successful persisted attempt exists, hydration may use only the existing bounded deterministic reread of the one server-bound artifact; failed-only history, a missing successful row, conflicting successful attempts, or an unavailable/incomplete reread remains a fail-closed resumable state.

This extension changes no immutable request digest, TaskRun identity, model route or floor, grants, writer arguments, approval boundary, receipt semantics, or non-review behavior. It only separates audited failed attempts from successful immutable evidence after authority and binding validation.
