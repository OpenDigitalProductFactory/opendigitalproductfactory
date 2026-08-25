# Anthropic-style textual tool-call normalization plan

**Backlog item:** BI-B87D7A69  
**Workroom:** WC-B97E2869  
**Design:** `docs/superpowers/specs/2026-08-25-antml-tool-call-normalization-design.md`  
**Backlog coverage:** Pending the independent initiative baseline and immutable
provider-verified plan receipt.

## Delivery shape

This is one atomic repair. Parser normalization and chat-adapter activation are
not independently useful: shipping either alone leaves the observed reviewer
route broken. Both source edits and their regression tests remain in
BI-B87D7A69 and one PR.

## Phase 1 — Establish the failing contract

**Requirements:** OBJ-ANTML-RECOVERY, OBJ-FAIL-CLOSED, AC-OBSERVED-FORM,
AC-TYPED-PARAMS, AC-FAIL-CLOSED.

1. Add focused tests to
   `apps/web/lib/inference/ai-inference-toolcalls.test.ts` for the exact observed
   reader call, typed parameters, escaping, deterministic IDs, and rejected
   malformed/duplicate/truncated cases.
2. Add a `chat-adapter.test.ts` response fixture proving an OpenAI-compatible
   local response containing a complete `antml:invoke` reaches the textual
   normalizer.
3. Run both focused suites and preserve the expected RED caused by zero
   extracted calls.

**Verification:** the new observed-form tests fail against the design-only tree
for the missing normalization, while existing structured/textual tests retain
their prior result.

## Phase 2 — Implement the narrow normalization

**Requirements:** OBJ-CANONICAL-PATH, OBJ-SCOPE, AC-CANONICAL-AUTHORITY.

1. Add the bounded `antml` grammar and entity/scalar decoder inside
   `extractTextualToolCalls`.
2. Add the new complete-start marker to the chat adapter's existing textual
   fallback condition.
3. Keep the internal tool-call shape and downstream availability, grant,
   schema, subject, approval, and audit gates unchanged.
4. Refactor only within the existing normalizer when the green tests expose a
   simpler pure helper boundary.

**Verification:** both focused suites pass; graph-linked
`ai-inference.call-provider.test.ts` and `ai-inference.test.ts` also pass; source
inspection confirms `agentic-loop.ts` still rejects names absent from the
attached tools.

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
