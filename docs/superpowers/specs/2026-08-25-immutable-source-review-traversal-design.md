---
status: active
---

# Immutable Source Review Traversal Design

**Backlog item:** BI-SIG-463E478D  
**Workroom:** WC-C4836AC0  
**Kernel decision:** DI-5B59E245E250  
**BI-DE58CFE8 review profile:** fix
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

## BI-DE58CFE8 objective and acceptance contract

BI-DE58CFE8 owns the terminal-writer resumability extensions in this design. The
original BI-SIG delivery established immutable traversal; the BI-DE extensions
make every incomplete review exit recoverable on the same governed identity
without weakening the writer or approval boundary.

- **OBJ-DE-001:** Preserve the exact TaskRun, request digest, immutable artifact
  binding, reviewer identity, and grants across every missing-writer exit and
  bounded recovery.
- **OBJ-DE-002:** After immutable evidence is available, expose and require only
  the bound governed writer; prose, duration, iteration, cancellation, routing,
  or provider exits cannot complete the review without that writer.
- **OBJ-DE-003:** Keep approval and persistence authoritative: the model selects
  writer arguments independently, a current exact approval remains mandatory,
  and no recovery path fabricates a proposal, envelope, receipt, or baseline.
- **OBJ-DE-004:** Hydrate only complete, successful, exact-bound reader evidence
  from one coherent attempt, with bounded deterministic reread as the sole
  fallback; failed, conflicting, unauthorized, malformed, or over-budget
  evidence remains fail closed.
- **OBJ-DE-005:** Preserve ordinary non-review task behavior while shipping each
  material repair through DCO, protected checks, canonical publication,
  governed upgrade, exact served-SHA readiness, and live same-identity proof.

| Acceptance ID | Objectives | Acceptance criterion |
| --- | --- | --- |
| AC-DE-001 | OBJ-DE-001, OBJ-DE-002 | The exact two-read, zero-writer, attempt-two fixture remains input-required and resumable on the same TaskRun instead of becoming irrecoverable or completed. |
| AC-DE-002 | OBJ-DE-002 | A terminal initiative-review turn with satisfied immutable evidence receives a single-writer required-tool surface; prose or any non-writer exit remains `missing-terminal-writer`. |
| AC-DE-003 | OBJ-DE-001, OBJ-DE-004 | Proof-only rows, multiple historical attempts, zero-reader bootstrap, and an exact-bound failed read can recover only through one coherent successful attempt or the bounded server reread, never by combining attempts. |
| AC-DE-004 | OBJ-DE-003 | Writer execution uses independently selected arguments and a fresh exact approval; stale, expired, mismatched, ambiguous, or already-consumed authority cannot write a receipt. |
| AC-DE-005 | OBJ-DE-001, OBJ-DE-003 | Expired proposal and repaired-prerequisite recovery retain one TaskRun and audit chain without rerunning inference or creating a sibling identity. |
| AC-DE-006 | OBJ-DE-004 | Unauthorized tools, immutable path/version/blob conflicts, malformed non-empty content, invalid page order, conflicting complete attempts, or unavailable bounded hydration fail closed with no writer receipt. |
| AC-DE-007 | OBJ-DE-005 | Non-review TaskRuns preserve their prior completion behavior, and protected CI plus live same-identity recovery prove the terminal-writer postcondition at the served runtime. |

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

## CLI terminal-writer dispatch extension (2026-08-30; superseded 2026-09-06)

Live WordPress completion TaskRun `TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-8139EEF334F5` exposed a final routing dead end. The same immutable request remained resumable through five attempts, but every writer-only turn ended with zero executions: the Codex CLI endpoint was rejected before inference because it cannot express provider-native `tool_choice: required`, while the Gemini and local endpoints were transiently unavailable. The terminal policy already owned the stronger invariant—only the one bound writer was exposed, prose could not complete the TaskRun, and no receipt could be inferred—but the adapter boundary did not distinguish that caller-enforced contract from an ordinary unguarded required-tool request.

The caller now binds the exact terminal writer name into the resolved execution plan only while the provider surface contains exactly that writer. A CLI adapter may attempt this one call only when all of the following are true: the plan still requires tool choice, the attached surface has exactly one function, its name exactly matches the bound terminal writer, and a governed MCP session is present. Ordinary required-tool CLI requests, missing sessions, mismatched names, and multi-tool surfaces retain the existing pre-inference refusal. API adapters continue to compile native required tool choice unchanged.

That delegation is now superseded by live evidence from TaskRun `...7ECDD7A53D18`: two native-MCP writer-only CLI turns returned prose despite a write-capable token, the exact writer grant, and a sole writer surface. An MCP allow-list plus an outer postcondition is not a server-verifiable required-call mechanism.

Required terminal-writer turns therefore fail-route known non-enforcing CLI adapters before inference with `required-terminal-writer-not-enforceable`. The normal fallback chain may continue only through an adapter that independently passes the same enforcement boundary. If none does, the same TaskRun returns the typed capability refusal and remains receipt-free. No judgment, mapping, envelope, or receipt is synthesized by routing.

## Zero-reader same-TaskRun recovery extension (2026-08-31)

Live Portfolio Advisor TaskRun `TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-634F7FF63BF8` exposed a bootstrap gap in the same-TaskRun recovery contract. The initial governed request became `input-required/missing-terminal-writer` before any tool dispatch and persisted zero reader executions, zero writer executions, zero envelopes, and zero receipts. An identical replay retained the exact request digest and immutable artifact binding but returned the cached resumable projection because `reserveTerminalWriterReplay` rejected `readerExecutions.length === 0` before reserving the run. The advertised recovery was therefore unreachable precisely when dispatch failed before the first read.

The recovery reservation may bootstrap evidence only for an explicit `input-required` terminal-writer wait with an identical request digest, exact server-owned initiative-review binding, and no successful writer. A generic completed route exit with no evidence remains closed. The existing compare-and-set reservation happens before any bootstrap tool call, so concurrent replays cannot create duplicate reads.

After reservation, the server invokes the already-governed `read_source_at_version` tool once at line one under the existing bounded page controls. The call uses only the immutable repository, path, commit, and blob identity from the terminal policy. Its returned content is never passed directly to the writer. The server re-queries durable ToolExecution rows for the same TaskRun, and the existing terminal-writer hydration validator must independently validate those persisted rows before evidence can enter the writer context. A failed bootstrap read, absent persisted row, binding mismatch, malformed result, or incomplete bounded hydration returns the same TaskRun to `input-required/terminal-writer-context-unavailable`; it creates no writer, envelope, baseline, mapping, or receipt.

This is orchestration recovery, not an alternate evidence model. It changes no request identity, approval semantics, writer arguments, provider routing, tool grants, or receipt rules. WWMD decision `DI-6A51BE456F49` selected this repair over a replacement review identity because it preserves the immutable audit chain and makes the platform's existing resumability promise true.

### Provider noncompliance rotation

A required-writer provider that returns prose has demonstrated noncompliance for that bounded turn. The same TaskRun keeps its immutable binding, evidence, grants, and approval boundary, while the next in-turn writer nudge denies only that provider and lets the canonical router select another eligible endpoint. The platform never pins a replacement provider and never converts prose into a decision. If no alternative is eligible, the existing typed fail-closed refusal remains authoritative.

### Named-reference research

- Source reference: `fix/initiative-review-terminal-writer-resume` at `c6c1380e828a65ca9552806d057c66833fb6c403`.
- Live reproduction: TaskRun `...634F7FF63BF8` remained identical-key and resumable with zero ToolExecutions; no approval envelope existed to recover.
- Code cause: `reserveTerminalWriterReplay` returned `null` solely when the persisted reader list was empty, so context hydration and its deterministic exact-bound reread were never reached.
- Ruled out: a replacement key would split the audit identity; approval recovery was impossible without an envelope; reader validation was not the failing layer because it never ran; cached replay did not reach provider capacity or inference.

## Expired proposal same-TaskRun recovery extension (2026-08-31)

Live design-review TaskRun `TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-57CC78DB3778` reached its independently selected terminal writer and created proposal ToolExecution `cmthhuxly00a501qmsogavxv5` plus approval envelope `cmthhuxlm00a201qmftzezz1k`. The envelope expired while still `proposed`. An identical request replay preserved the TaskRun and digest but could neither execute the writer nor create a fresh envelope: approval recovery searched only `approved` and `failed` envelopes, while terminal-writer reservation accepted a prior proposal only after it was explicitly declined. The run remained `input-required/missing-terminal-writer` with no receipt or baseline.

An expired `proposed` envelope is now a recovery source under the same transaction as expired approved/failed recovery. Recovery requires the exact TaskRun, request digest, delegating user, acting agent, writer tool, stored approval-binding fingerprint, and original proposal parameters. It refuses an unexpired proposal, a conflicting binding, an absent or ambiguous proposal, or any completed writer/receipt. The transaction compare-and-sets the source envelope from `proposed` to `cancelled`, creates exactly one replacement `proposed` envelope and rebound proposal ToolExecution with the identical stored arguments, and parks the same TaskRun for fresh exact approval. A race rolls back the transaction.

This recovery does not rerun inference, change the independent disposition, synthesize approval, or alter receipt validation. The expired envelope and original proposal remain immutable audit history. The replacement has a fresh bounded expiry and still requires the human approval boundary before the writer can execute.

### Named-reference research

- Source reference: `origin/main` at `7961b6846da00450a4ac61b93e0636677ef66292`, `recoverStaleApprovedRemoteTask` and `reserveTerminalWriterReplay`.
- Live reproduction: TaskRun `...57CC78DB3778`, expired proposed envelope `cmthhuxlm00a201qmftzezz1k`, proposal execution `cmthhuxly00a501qmsogavxv5`, zero writer receipt/baseline.
- Code cause: the recovery query excluded `proposed`, and reservation required the prior proposal envelope to be `declined`.
- Ruled out: stale approval would violate expiry; a new review identity would rerun inference and split the audit chain; bypassing the receipt would fabricate governance evidence.

## Executor postcondition for every terminal-writer exit (2026-09-01)

Live BI-FFBDDD96 research TaskRun `TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-7991D9CAE467` persisted one successful exact-bound immutable read after an earlier malformed read attempt, then reached the agent-loop duration ceiling before invoking `record_initiative_evidence`. The loop returned its last prose as an ordinary result, so the remote-task executor persisted `completed` with `executedToolCount: 2`, zero writer executions, zero envelopes, and zero receipts. This bypassed the text-exit policy because duration and iteration exits occur outside that branch.

The remote-task executor is the final completion boundary for initiative reviews. When an immutable review binding creates a terminal-writer policy, the executor may persist ordinary completion only after the bound writer appears in the governed execution history or as the active bound proposal. Any other loop result—including duration, iteration, cancellation, route, circuit-breaker, or prose exits—is converted to the existing `input-required/missing-terminal-writer` projection on the same TaskRun. The conversion clears `completedAt`, preserves the request digest and immutable binding, records the bounded attempt, and creates no envelope, decision, mapping, or receipt.

This is a postcondition, not a second inference policy. The agent loop still controls reader/writer surfaces and required tool choice; the executor independently prevents an incomplete result from escaping as completed. A genuine writer attempt retains existing approval and receipt handling, and non-review tasks remain unchanged.

## Exact-bound stalled and failed replay liveness (BI-E2B632D2)

Two live states expose the same false resumability promise. A Build Lead review
was reaped to `stalled` while it remained in governed inference admission; a
later objective-mapping review was left `failed` after an approved writer used
an argument that a subsequently deployed binding repair now constrains. Both
TaskRuns retain their request digest, immutable artifact binding, valid
`missing-terminal-writer` marker, and zero successful writers. The replay read
model reports both as resumable, but `reserveTerminalWriterReplay` admits neither
state and returns the cached terminal result.

- **OBJ-E2B-001:** Make every TaskRun projected as a resumable exact-bound
  terminal-writer wait executable through the same TaskRun and request digest.
- **OBJ-E2B-002:** Preserve the immutable review binding, writer identity,
  evidence hydration, approval boundary, and receipt validators during replay.
- **OBJ-E2B-003:** Keep ordinary stalled, failed, completed, and non-review
  TaskRuns terminal; only an exact marked terminal-writer wait is eligible.
- **OBJ-E2B-004:** Bound replay attempts and stop with the existing escalation
  rather than retrying a rejected or unavailable writer forever.

| Acceptance ID | Objectives | Acceptance criterion |
| --- | --- | --- |
| AC-E2B-001 | OBJ-E2B-001, OBJ-E2B-002 | An exact-bound reaper-stalled wait compare-and-sets the same TaskRun back to `working` and reaches the existing writer-only turn. |
| AC-E2B-002 | OBJ-E2B-001, OBJ-E2B-002 | A failed exact-bound wait with a prior non-successful, non-proposal writer attempt may run a new bounded writer-only turn on the same TaskRun; no sibling identity is created. |
| AC-E2B-003 | OBJ-E2B-002 | A live proposal or approval remains owned by approval recovery; replay neither executes stored arguments nor bypasses fresh exact approval. |
| AC-E2B-004 | OBJ-E2B-003 | A generic stalled/failed run, changed request digest, changed writer binding, or successful writer remains unrecoverable through this path. |
| AC-E2B-005 | OBJ-E2B-004 | The existing attempt ceiling applies to stalled and failed waits and produces the existing bounded escalation when exhausted. |
| AC-E2B-006 | OBJ-E2B-001, OBJ-E2B-002, OBJ-E2B-003 | Canonical replay of the original objective-mapping packet records the governed mapping and allows its BI and Workroom to close. |

### Ordered fix sequence

1. Add regressions for the reaper-stalled wait, the corrected-prerequisite
   failed wait, and the fail-closed exclusions above.
2. Extend only the existing reservation eligibility and prior-attempt handling;
   retain the request digest, immutable policy reconstruction, successful-writer
   check, compare-and-set, hydration, approval, and receipt paths.
3. Run the graph-linked TaskRun suites and build gates, publish through the merge
   queue, self-upgrade canonically, then replay the unchanged original packet.

This is an orchestration-liveness correction, not a second evidence or approval
model. The prior failed attempts remain immutable audit history. Rollback is the
single eligibility change and its tests; no schema or stored contract changes.

### Approval projection is part of the same replay contract (2026-09-03)

Canonical acceptance replay for BI-BFBF1BBB reached
`record_initiative_evidence`, persisted proposal execution
`cmtmgbxya03ke01qisordc4tb`, and created exact-bound envelope
`cmtmgbxy603kd01qid8kg6261`. The tool result was
`approval_required`, but the remote executor then overwrote the TaskRun as
`completed`. After the envelope was approved, identical replay returned that
cached completion and never executed the writer. The TaskRun therefore held an
approved, unconsumed exact writer and no objective-mapping receipt.

The executor must treat an `approval_required` result from the bound terminal
writer as an explicit `input-required` projection even when the lower tool path
did not mutate TaskRun state. It records the envelope id, clears `completedAt`,
and returns the existing approval location. For already-persisted historical
misprojections, replay may recover a `completed` TaskRun only when the current
request digest matches, the server reconstructs an initiative-review terminal
policy, an unexpired approved envelope belongs to that same TaskRun and user,
and its action is the exact bound writer. The existing proposal execution
remains the sole source of writer arguments. Generic completed tasks and writer
mismatches remain terminal.

This correction realizes AC-E2B-003 rather than weakening it: approval recovery
continues to own live proposals, inference is not rerun, stored arguments are
not synthesized, and the writer still passes through its ordinary authority and
receipt validators.
