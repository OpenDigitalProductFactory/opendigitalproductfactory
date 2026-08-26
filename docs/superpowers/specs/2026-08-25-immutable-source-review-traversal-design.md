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

Thread the policy through `executeAutonomousAgenticLoop` into `runAgenticLoop`. A small pure module owns its state transitions and messages as typed dispositions (`allow`, `refuse`, `nudge`, `fail-closed`, `complete`). The loop maps those dispositions into its existing `AgenticResult`; this does not create a parallel orchestration outcome model.

The loop enforces these states:

```text
evidence required -> evidence available -> writer required -> writer attempted
       |                    |                    |
  writer blocked      reader cap reached    text-only blocked
```

- A writer call before one successful reader is returned to the model as a non-executed policy refusal.
- Once six reader calls have been attempted, further reader calls are returned as non-executed policy refusals and the provider tool surface narrows to the single writer schema.
- A text-only response before a writer attempt receives one explicit, ephemeral next-action notice. A second text-only response fails closed.
- Any writer call counts as the terminal attempt, whether the governed result succeeds, requests input/approval, or rejects the proposed receipt. The existing writer remains the sole authority for validation and persistence.
- The policy is absent for every non-initiative caller, preserving their current agent-loop behavior.

The six-call ceiling stays below the existing local-provider spinning guard at eight executed tool calls. It also bounds worst-case retrieval to six model-visible pages, while search allows the reviewer to target relevant sections rather than scan every line.

## Result serialization

DPF's native loop serializes `message` followed by JSON `data`. Removing file/search bytes from `message` eliminates the duplicate inside that model-facing string. The external MCP route continues to emit its protocol-compatible text block and `structuredContent`; this follows the MCP tool-result compatibility recommendation while avoiding the prior third copy of the same source bytes.

## Research and benchmarking

- [Model Context Protocol tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools): adopt structured tool results and keep a compatible text result at the transport boundary; do not make a DPF-only wire format.
- [Model Context Protocol schema reference](https://modelcontextprotocol.io/specification/2025-06-18/schema): adopt an opaque continuation cursor and explicit continuation metadata rather than silent truncation.
- [LangGraph Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api): adopt deterministic state-based routing for a multi-stage tool workflow; reject a separate graph runtime because DPF already has the canonical agent loop.
- [OpenAI Agents SDK model settings](https://openai.github.io/openai-agents-js/guides/models/): adopt the principle that a workflow may require tool use; reject provider-specific `toolChoice` as the authority because DPF routes across providers and must enforce the transition server-side.

## Architecture and scale

- **Single source of truth:** the immutable binding supplies identity and the new policy module supplies the one transition algorithm. Prompts may explain the contract but do not own it.
- **Data architecture:** no persisted state or parallel table is added. Existing TaskRun and ToolExecution rows remain the audit record.
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
- Unit tests for evidence-first, reader ceiling, writer-only transition, one nudge, fail-closed exit, and writer-attempt terminal behavior.
- Submission tests proving exact path/commit/blob schemas and policy propagation.
- An agent-loop regression proving a local initiative reviewer reaches the writer rather than the eight-call spinning diagnostic.
- A long-artifact functional fixture proving a reviewer can reach a late section and submit a writer call bound to the same immutable artifact.
- Negative cursor tests proving cross-ref, cross-path, malformed, and stale-blob replay all fail closed.
- Typecheck, source policy/pregate preflight, exact-tree local integration CI, independent semantic review, PR health, and protected merge.

## Documentation impact

This design and its implementation plan are the durable operator/contributor record. The MCP tool descriptions are updated in source so progressive tool discovery explains pagination. No end-user route or UI copy changes.
