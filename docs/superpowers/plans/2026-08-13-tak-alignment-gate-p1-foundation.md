# TAK alignment gate — P1 foundation implementation plan

**Epic:** EP-1C37C089

**Slices:** BI-1452AD76, BI-7E1F128A, BI-B6690C11

**Spec:** `docs/superpowers/specs/2026-08-13-wwwd-constitutional-alignment-gate.md`

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time. The three slices intentionally share one batch branch and PR, while each BI retains its own test-first commit and evidence. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Standards contract

The execution order is `GAID identity -> JSI qualification -> TAK intersection at execution -> GAID receipt`. This batch adds the WWWD alignment signal and TAK interception point. It must preserve the no-widening invariants: an identity claim is not authorization, qualification is not permission, and permission is not competence.

The implementation composes the existing axis registry, stance material, decision evaluator, authority gate, lifecycle hooks, `ToolExecution`, and `ToolExecutionReceipt`. It does not add a parallel decision engine, permission layer, or audit ledger.

## Backlog coverage

- Decision: `decomposed`
- Receipt: `cmss8h3l7000w01p26b5foxls`
- Parent BI: `BI-1452AD76`
- `axes` -> BI-1452AD76
- `criteria-veto` -> BI-7E1F128A; depends on `axes`
- `interception` -> BI-B6690C11; depends on `axes`, `criteria-veto`

## Slice 1 — alignment axes and stance projection (BI-1452AD76)

### Red

- Extend `packages/db/src/seed-wiki-kernel.test.ts`, `packages/db/src/enterprise-architecture-decision-pack.test.ts`, and dimension-catalog tests so `mission_fit`, `market_fit`, `product_fit`, and `gtm_fit` are required closed axes with caller guidance and explicit spine scope.
- Extend `apps/web/lib/decision-perspective/stance-dimension-map.test.ts` and `packages/db/src/wiki-store.test.ts` to prove a published `pageKind: stance` persists a non-null alignment vector and dimensions while forbidden/cost sign invariants remain intact.

### Green/refactor

- Add the four benefit axes to the single registry in `packages/db/src/wiki-taxonomy.ts`, classify them as spine axes in `packages/db/src/dimension-scope.ts`, and document their high-score meaning in `apps/web/lib/decision/dimension-catalog.ts`.
- Extend `apps/web/lib/decision-perspective/stance-dimension-map.ts` with a deterministic stance projection contract. Project only the alignment axes supported by the stance's declared purpose/content; keep the existing commercial-stance magnitude ceiling and never infer safety or authority.
- Allow stance pages—not arbitrary non-principle kinds—to persist the projected `principleDimensionVector` and `principleDimensions` through `packages/db/src/wiki-store.ts`. Wire the existing publish/confirm/seed paths in `apps/web/lib/actions/business-stance.ts`, `apps/web/lib/actions/stance-confirm.ts`, and `apps/web/lib/onboarding/seed-org-wwwd-corpus.ts` through that projection.

### Verify

- Targeted Vitest for registry, scope, stance projection, wiki persistence, and WWWD seed/publish actions.
- Production web build. No migration is expected because the existing nullable JSON/vector columns are reused.

## Slice 2 — criteria extraction and veto (BI-7E1F128A)

### Red

- Add focused cases under `apps/web/lib/decision-perspective/` for criteria `{market, segment, product, motion, geography, customerType}`.
- Reproduce the live defect: toaster/Alaskan fishermen and coffee-shop chain decline; MSP partner and self-host support subscription approve; a concrete option is selected; a hard rejection cannot be averaged away by generic positive stances.
- Cover malformed/ambiguous input with fail-closed escalation rather than an invented fit score.

### Green/refactor

- Add a pure criteria-extraction module beside `option-recommendation.ts`; keep its typed output stable and evidence-bearing.
- Extend the org business gate/evaluator to load relevant org stance and portfolio/GTM evidence, score each alignment corpus independently, and apply a hard-boundary veto before aggregate recommendation.
- Return the failing corpus, criterion, rationale, and evidence refs in the existing `DecisionInteraction` outcome payload. Keep WWMD and WSID material advisory outside their owning scope.
- Reuse the existing option scorer for a concrete `recommendedOptionId`; do not duplicate the scoring math.

### Verify

- Targeted decision-perspective and `org-decision-pack` tests, including semantic and lexical-fallback behavior.
- Confirm revert-to-red by disabling veto selection and observing the toaster regression test fail.

## Slice 3 — consequential write-time interception (BI-B6690C11)

### Red

- Extend `apps/web/lib/mcp-governed-execute.test.ts` to prove routine reads skip the expensive alignment path, consequential mutations are gated before `executeTool`, rejection prevents the side effect, and owner/direct-human plus coworker calls reach the same interceptor.
- Add receipt assertions for allow, deny, and escalate outcomes and ensure authority/grant denial cannot be widened by alignment approval.

### Green/refactor

- Add a closed consequential-tool classification/policy module under `apps/web/lib/tak/`, derived from existing `ToolDefinition.sideEffect`, audit classes, Work Case action metadata, and explicit tool policy—not model judgment.
- Register the alignment control as a first-class pre-execution stage inside `apps/web/lib/mcp-governed-execute.ts`, after identity/grant/authority resolution and before the tool handler. Preserve existing authority outcomes; alignment can only narrow.
- Bind the gate result to the existing `ToolExecution` audit and `ToolExecutionReceipt`; return structured misalignment to the originating caller. Do not add a bypass flag.

### Verify

- Targeted governed-execute/authority tests plus the P1 decision suite.
- Production build and canonical-runtime MCP acceptance for one routine read, one approved consequential call, and one rejected consequential call.

## Batch completion gate

- All affected Vitest suites pass from the batch worktree with the runner root confirmed.
- `pnpm --filter web build` passes.
- Canonical Arcamanus acceptance: toaster and coffee shop decline; MSP partner and self-host support approve; a specialist `create_digital_product` toaster attempt is blocked before mutation; every consequential attempt has a receipt.
- Documentation impact: update the standards/conformance documentation only where implemented DPF conformance changes; do not rewrite TAK, GAID, or TAK-JSI ownership.

## Risks and rollback

- **False veto:** keep criteria/corpus evidence in the receipt and default ambiguous extraction to escalation, not rejection.
- **Latency:** deterministic consequential classification runs first; only consequential calls load corpora/delegation.
- **Audit gap:** a missing required receipt is a failed gate outcome, not a silent success.
- **Rollback:** revert the batch PR. Existing operational-axis evaluation and authority gate remain intact because the implementation extends their seams and adds no schema migration.
