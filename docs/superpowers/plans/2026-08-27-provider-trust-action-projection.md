# Provider trust action projection implementation plan

**Backlog:** BI-9CFB483F  
**Workroom:** WC-73D771A9  
**Design:** `docs/superpowers/specs/2026-08-27-provider-trust-action-projection-design.md`  
**Decision:** DI-16D8DE623703

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Delivery boundary

This plan is one atomic medium-sized fix. The compiler projection, region persistence, and UI copy are internal phases of one observable behavior. Shipping any phase alone would either leave the false warning in place, display policy claims the save path cannot preserve, or change persistence without removing the avoidable question.

## Phase 1 — Establish failing behavior tests

Add red tests before production edits.

- Add pure projection tests covering:
  - U.S. operating locale with no explicit `dataResidency`: public/synthetic and eligible company work do not require region or DPA evidence.
  - missing canonical business context: public/synthetic work remains explicit, while company-work eligibility stays unproven.
  - explicit `dataResidency: ["us"]`: company work requires proven regional processing for `us`, while public/synthetic work remains usable.
  - source-code and restricted workload explanation codes map to their real account/evidence actions without treating DPA as universal.
  - OpenRouter keeps its bounded-router obligations for non-public work.
- Extend `ProviderAccountPostureForm.test.tsx` so no region control renders without a canonical requirement and the required-region control names the required region without a free-text field.
- Extend `ProviderTrustEvidencePanel.test.tsx` so optional missing evidence does not raise action, while a missing required claim does and names the blocked scope.
- Extend `ai-providers.test.ts` so omitting a region field preserves existing region entitlements/evidence and a positive required-region declaration records normalized regions plus regional-processing evidence.
- Extend `ProviderDetailForm.test.tsx` to require **Technical readiness** copy.

Verification: run each affected test file and observe the new assertions fail for the intended pre-fix behavior. The code graph returned no links for the three components, so colocated tests plus the provider-suitability compiler/onboarding suites are mandatory.

## Phase 2 — Refactor canonical context and add the projection

- Extract a focused `loadBusinessSuitabilityContext` from `provider-onboarding-data.ts`; make the existing onboarding loader reuse it and preserve the distinction between configured-empty residency and missing business context.
- Add a pure per-connection review projection beside the existing provider-suitability/onboarding code.
- Reuse `deriveOnboardingWorkloadClasses` and `compileAiProviderSuitabilityPolicy`; do not reproduce account, residency, or workload eligibility rules in the page.
- Keep explanation-code-to-action mapping in the suitability module with an exhaustive test table.
- Keep queries bounded to one organization/business context and one already-loaded connection on the provider detail route.

Verification: projection, onboarding recommendation, compiler, evidence, and onboarding-data tests pass. Review the diff specifically for duplicated policy conditions and unbounded provider inventory reads.

## Phase 3 — Make region persistence optional and truthful

- Make region declarations optional in the server action so saving account class/no-training does not erase hidden region evidence.
- Generalize regional-processing declaration persistence beyond OpenRouter when the canonical projection requires a direct provider account guarantee.
- Normalize the required region set once and record account-scoped `regional-processing` and `enabled-regions` evidence together.
- Preserve OpenRouter-only ZDR and underlying-provider controls.

Verification: action tests cover preserve, positive declaration, negative/unknown declaration, normalization, and exact connection scope.

## Phase 4 — Render one coherent provider story

- Load canonical business suitability context on the provider detail route and build the per-connection projection.
- Resolve/display the union of policy-required claims and existing evidence claims; pass the required subset separately to the panel.
- Make the account form requirement-driven. Remove the arbitrary region entry field; show a targeted guarantee question only when the projection requires regions.
- Make the evidence panel compute urgency only over required claims, distinguish optional history, and state the usable/blocked scope plus the smallest next action.
- Rename the separate configuration card to **Technical readiness** and explicitly bound what its ready state proves.
- Reuse existing theme tokens and components. Do not add a route, navigation item, dashboard, or coworker launch.

Verification: component tests, page/source assertions, keyboard/label semantics, empty/permission states, and prose/style ratchets.

## Phase 5 — Functional and UX gates

- Run targeted Vitest suites from this exact worktree and reconcile the runner root and test counts.
- Run `pnpm run check:prose-lint:test`, `pnpm run check:prose-lint`, and `node scripts/check-style-drift.mjs` from the exact worktree.
- Generate/update the docs index required by the impact contract.
- Run `pnpm run pregate:preflight` before the runtime gate.
- Claim the shared `local-integration-ci` lease and run the exact-tree pregate; do not turn the worktree into another runtime.
- Exercise `/platform/ai/providers/zai` against the governed shared/live install after the exact feature SHA is served:
  - dark and light themes;
  - desktop and narrow viewport;
  - no explicit region requirement;
  - explicit region-bound fixture;
  - missing required evidence and optional evidence states;
  - save, reload, and persisted value match.
- Record test, build, and screenshot evidence on WC-73D771A9.
- Obtain independent semantic review of the committed tree, run `pnpm pr:health`, and hand off through the DCO PR flow.

## Impact-contract obligations

- Test-impact resolution: colocated tests for `ProviderAccountPostureForm`, `ProviderDetailForm`, and `ProviderTrustEvidencePanel`; exact linked test `apps/web/lib/actions/ai-providers.test.ts`; expanded provider-suitability suites because graph advice was empty/stale for the components.
- Guard obligations: prose-lint test + scan, style-drift scan.
- Derived artifact: `apps/web/lib/docs/doc-index.generated.json`.
- PR design grounding: reference the 2026-07-19 suitability design, the current code substrate, the projection source of truth, and DI-16D8DE623703.
- UX-fit evidence: `docs/ux-fit/2026-08-27-provider-trust-action-projection.ux-fit.json`.

## Refactoring allocation

Approximately 20% of the implementation effort is reserved for extracting the canonical business-context loader, centralizing policy-to-action translation, and removing duplicated page-level status/checklist logic. This cleanup stays inside the BI's blast radius.

## Risks and rollback

- **Risk:** presentation projection diverges from enforced routing. **Control:** derive both from the same compiler and test explanation/action mappings.
- **Risk:** hiding a region control erases valid evidence on another save. **Control:** optional server-action fields and preservation tests.
- **Risk:** an optional evidence row is mistaken for authorization. **Control:** evidence resolver remains factual; only current required claims affect attention.
- **Risk:** new copy exceeds UI text budgets. **Control:** shrink the fixed checklist, use terse scope copy, and run route/prose measurement.
- **Rollback:** revert the PR. No migration or data rewrite is introduced.

## Backlog coverage

- Decision: `atomic`
- Parent BI: `BI-9CFB483F`
- Deliverable: `provider-trust-action-projection` → `BI-9CFB483F`
- Dependencies: none
- Rationale: compiler projection, persistence semantics, and UI rendering form one safety-sensitive behavior and are not independently shippable.
- Coverage receipt: pending committed-plan registration
