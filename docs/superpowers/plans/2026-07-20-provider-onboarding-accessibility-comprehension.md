# Provider-onboarding accessibility and comprehension completion plan

**Backlog item:** BI-BF3DFDB8
**Epic:** EP-AI-PROVIDER-SUITABILITY
**Work capsule:** WC-549A2A33
**Status:** In progress

## Outcome

A nontechnical owner can complete or safely defer provider onboarding with a keyboard or screen reader, on desktop or mobile, and can identify the recommendation, what may leave, what stays controlled, what DPF blocks, the missing action, and the COO's specialist-coordination role. Edge states remain explicit and recoverable without changing provider posture.

## Grounded substrate

- Reuse `SetupOverlay`, `SetupProgressBar`, `SetupActionButtons`, `ProviderSuitabilityGuide`, `AskCoworkerButton`, and the existing COO panel.
- Reuse the `ProviderOnboardingRecommendation` projection; accessibility copy cannot become a second policy result.
- Reuse native buttons, details/summary, dialog semantics, delivery retry, and setup progress actions.
- Add no route, navigation item, dashboard, compliance wizard, provider state, or activation authority.

## Design grounding

- Existing specs/plans reviewed:
  - `docs/superpowers/plans/2026-07-19-governed-llm-provider-onboarding.md`
  - `docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md`
- Current code substrate reviewed:
  - `SetupOverlay`, `SetupProgressBar`, and `SetupActionButtons`
  - `ProviderSuitabilityGuide`, `ProviderOnboardingRecommendation`, `AskCoworkerButton`, and the existing COO panel
- Source of truth:
  - The deterministic `ProviderOnboardingRecommendation` projection remains authoritative for recommendation and restriction status; setup lifecycle state remains authoritative for continue, skip, pause, and completion.
- Decision:
  - Extend the existing provider/setup components with semantic labels, live status, focus affordances, safe-defer explanation, responsive containment, and edge fixtures. Add no alternate recommendation logic, activation authority, route, or wizard.

## UX fit

- Decision: `fits-with-guardrails`.
- Primary persona: a solo founder or business operator unfamiliar with provider account, data-processing, or sovereignty terminology.
- First viewport: retain one recommendation, one reason, one next action, and one COO consultation action.
- Safe defer: explain the effect of skipping; missing evidence remains restricted and is never converted into approval.
- Failure: denied or unavailable consultation leaves the deterministic recommendation visible, provides retry/review-later recovery, and does not mutate provider posture.
- Responsive behavior: long provider names and all-empty groups wrap without horizontal page overflow; detailed status remains text, not color alone.

## Backlog coverage

- Decision: atomic
- Parent: `BI-BF3DFDB8`
- Rationale: Accessibility semantics, keyboard/focus behavior, responsive fixtures, safe skip/failure recovery, and nontechnical comprehension evidence validate one existing provider-onboarding journey; splitting them would allow the parent acceptance to claim usability without complete journey evidence.
- Accessible and comprehensible provider-onboarding projection, setup navigation, edge-case fixtures, automated checks, and authenticated desktop/mobile evidence -> `BI-BF3DFDB8`
- Dependencies: `BI-26684747`, `BI-EDAAD429`, and `BI-CA5B5AB9`, all completed.
- Receipt: `cmrsvlell0b9b01pg32vd6qzn`

The deployed MCP `tools/list` does not expose `record_plan_backlog_coverage`, so this receipt uses the governed `record_execution_evidence` compatibility path already documented by the provider-onboarding plan.

## TDD slices

1. Add failing component tests for status text in the accessibility tree, contextual empty states, long names, recommendation comprehension landmarks, and keyboard activation of the COO consultation.
2. Add failing setup tests for current/completed/skipped progress semantics, safe-skip explanation, explicit action names, focus-visible affordances, and mobile overflow containment.
3. Make the smallest semantic/responsive changes to the existing components; keep provider recommendations and setup lifecycle authoritative.
4. Add route fixtures for no-local, no-cloud, unknown account/evidence, denied consultation, citation uncertainty, and safe defer without duplicating policy logic.
5. Run targeted tests, web typecheck, module/diff guards, merged-code local CI, and authenticated desktop/mobile keyboard and accessibility-tree verification.
6. Record the comprehension evaluation against the six operator questions and prove no provider posture changes during the journey.

## Documentation impact

Update the existing provider-connection and first-login guides only where the safe-defer or accessibility-facing behavior changes. Record authenticated evidence in this plan and on the BI. No schema, migration, architecture route-map, or public positioning change is required.

## Verification evidence

- TDD red: seven expected component failures proved the status, safe-skip, progress semantics, contextual empty-state, and long-name coverage was absent before implementation.
- TDD green: 99 affected tests pass across 12 files, covering the provider route, recommendation and advisory projections, COO shell and message recovery, setup controls, denied consultation, explicit no-local/no-cloud configurations, and citation uncertainty.
- Source gates: web typecheck, `git diff --check`, module-size guard, documentation-index guard, and documentation-link check pass.
- Production build: passed with Next.js 16.2.10; 136 static pages generated and the full route bundle completed successfully. Existing Edge-runtime compatibility warnings remained non-fatal.
- Authenticated desktop (1440x900): the recommendation is a labelled region with a live text status, three named outcome regions, an explicitly described COO action, and a keyboard-focus outline measured at 2px. The page measured 1440px scroll width against a 1440px viewport.
- Authenticated mobile (390x844): the provider guide measured 358px wide, its content measured 356px scroll width against 356px client width, all three cards fit, and no guide descendant overflowed. Long real provider names wrapped in the guide.
- Unrelated mobile overflow: the global navigation measured the document at 409px against a 390px viewport. This is already tracked by `BI-E9CB5775`; the independent reproduction was attached there as evidence `cmrsw4dpj0c1k01pgp39gsi2w` instead of filing a duplicate.
- COO consultation: the authenticated journey returned `Cannot confirm this yet`, distinguished missing account evidence, kept non-public work local or blocked, required human review, and linked the supporting WSID article. Earlier denied-consultation rows remained explicit status messages with retry or qualified-review recovery.
- Provider-posture invariant: before and after the consultation, all 31 `AiProviderConnection` posture rows produced the same digest, `3e85a7ab5eef0823a606de2f3232da89`; the consultation did not change account class, evidence status, activation status, or routing posture.
- Safe skip/review-later and setup-progress states are covered by the component test fixtures because this installation has already completed setup and the overlay is intentionally not active.
- Merged-code local CI: pending.
