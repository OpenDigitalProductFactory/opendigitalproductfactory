# Anthropic-style textual tool-call normalization plan

**Backlog item:** BI-B87D7A69  
**Workroom:** WC-B97E2869  
**Design:** `docs/superpowers/specs/2026-08-25-antml-tool-call-normalization-design.md`  
**Backlog coverage:** Pending the independent initiative baseline and immutable
provider-verified plan receipt.

## Delivery shape

This is one atomic repair. Shared-parser consolidation and chat-adapter
activation are not independently useful: shipping either alone leaves either
the observed reviewer route broken or two divergent parsers. All source edits
and their regression tests remain in BI-B87D7A69 and one PR. The chosen shape
is governed by DI-2A4178058018 (`consolidate-shared-extractor`).

## Phase 1 — Establish the failing contract

**Requirements:** OBJ-ANTML-RECOVERY, OBJ-FAIL-CLOSED, AC-OBSERVED-FORM,
AC-TYPED-PARAMS, AC-FAIL-CLOSED.

1. Extend `apps/web/lib/routing/codex-cli-tool-extract.test.ts` with the exact
   observed reader call, typed parameters, escaping, deterministic IDs, and
   rejected malformed/duplicate/truncated cases.
2. Change its historical fenced-JSON expectation: an explanatory
   `json`-labelled block or inline `{name:...}` object without an explicit
   invocation envelope must produce no call, while an explicit
   `tool_use`-labelled fence remains valid.
3. Run the focused suite and preserve the expected RED: `antml` is not
   extracted and ambiguous JSON is still accepted.

**Verification:** the new observed-form tests fail against the design-only tree
for the missing normalization, while existing structured/textual tests retain
their prior result.

## Phase 2 — Implement the narrow normalization

**Requirements:** OBJ-CANONICAL-PATH, OBJ-SCOPE, AC-CANONICAL-AUTHORITY.

1. Consolidate JSON `<tool_call>`, Gemma/Llama, explicit `tool_use`, and the
   bounded `antml` grammar inside `routing/extract-tool-calls.ts`.
2. Remove the duplicate `extractTextualToolCalls` helper from
   `inference/ai-inference.ts`; route non-structured chat text through the shared
   normalizer and its `cleanText` result.
3. Reject bare/`json`-labelled fenced name/tool objects while preserving
   explicit invocation wrappers and canonical inline `type:"tool_use"` calls.
4. Keep the internal tool-call shape and downstream availability, grant,
   schema, subject, approval, and audit gates unchanged.
5. Refactor only within the existing normalizer when the green tests expose a
   simpler pure helper boundary.

**Verification:** the shared-extractor suite and graph-linked
`chat-adapter.test.ts`, `cli-adapter.test.ts`, `codex-cli-adapter.test.ts`,
`agentic-loop.test.ts`, `ai-inference.call-provider.test.ts`, and
`ai-inference.test.ts` pass; source inspection confirms `agentic-loop.ts` still
rejects names absent from the attached tools.

## Phase 3 — Functional and architectural gate

**Requirements:** AC-CANONICAL-AUTHORITY, AC-LIVE-REVIEWER.

1. Run web typecheck and `node scripts/check-style-drift.mjs`.
2. Run blast-radius and architecture review against the stable committed tree.
3. Run `pnpm run pregate:preflight`, obtain one fresh exact-tree semantic PASS,
   then run the governed exact-tree local-CI gate.
4. Publish a DCO-signed branch, open the PR, read bot findings, run
   `pnpm pr:health`, and enter protected merge.
5. Serve the merged candidate through the governed full-clone preview and run
   one fresh immutable BI-9DC21917 reviewer identity. Accept only persisted
   reader/writer ToolExecutions and the initiative receipt/baseline.

**Verification:** protected merge is green and the live preview evidence meets
AC-LIVE-REVIEWER.

## Backlog coverage

Decision: `atomic`. Parser and adapter activation form one inseparable runtime
contract; neither is independently shippable. The final plan update will record
the immutable coverage receipt and provider-derived plan blob after the
initiative baseline exists.

## Risk and rollback

The highest risk is interpreting malformed model text as a tool call. The test
matrix therefore treats ambiguity as text and leaves authorization downstream.
Rollback is a normal PR revert; there are no migrations or persisted-data
changes.
