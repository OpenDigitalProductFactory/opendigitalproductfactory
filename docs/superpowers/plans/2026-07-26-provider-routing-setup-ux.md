# Provider routing setup UX simplification plan

**Backlog item:** BI-ECBD6924
**Epic:** EP-UX-COGLOAD
**Status:** In progress

## Outcome

The Providers & Routing setup surface should help a non-technical operator make the next provider decision without reading routing internals. The first viewport must show one recommendation, one plain reason, one active safeguard summary, and one next action. Provider policy, route eligibility, model scoring, quota, cost, and evidence stay available, but move into progressive disclosure or row drilldown.

## Grounding

- User evidence: screenshot of `/platform/ai/providers` showing dense provider setup and a COO response that reads as an unhelpful compliance wall.
- WWMD: `DI-98F2A9800453` recommended guided task-first setup with high confidence.
- Existing UX contract: `docs/superpowers/plans/2026-07-20-provider-onboarding-accessibility-comprehension.md` requires one recommendation, one reason, one next action in the first viewport.
- Existing provider policy contract: `docs/superpowers/specs/2026-07-19-ai-provider-suitability-routing-design.md` keeps provider suitability as a policy projection, not a second router.
- Existing code: `ProviderSuitabilityGuide`, `ServiceRow`, `/platform/ai/providers/page.tsx`, and `AskCoworkerButton`.

## UX fit review

- Decision: fits-with-guardrails.
- Owning area: Platform.
- Route family: `/platform/ai/providers`.
- Primary persona: founder/operator setting up AI providers without provider-account, routing, or compliance expertise.
- Navigation layer touched: local page composition and contextual coworker action only.
- Reuse/convergence: reuse `ProviderSuitabilityGuide`, `ServiceSection`, `ServiceRow`, `StatusBadge`, and native `details`; add no new route, dashboard, policy store, or compliance chatbot.
- Source truth: `ProviderOnboardingRecommendation`, `deriveRoutingEligibility`, provider model summaries, CLI pool status, budget/spend read models.
- Empty/failure behavior: no approved provider remains a clear restricted state with one recovery action; review evidence remains reachable.
- AI boundary: clicking the COO action sends only the minimized provider-review packet and asks for a short answer, safe interim behavior, and one next action. It cannot activate providers or widen posture.
- Required edits: compact the guide, move operational evidence behind disclosure, simplify default provider rows, improve the coworker prompt, and keep policy internals available.
- Evidence before merge: component/route tests, diff/style checks, desktop/mobile UX verification or CI-backed route evidence, and PR health.
- Captured in: this plan and the PR body.

## Backlog coverage

Decision: atomic. The guide, provider rows, route composition, COO prompt, and tests are not independently shippable because a partial change would either hide safety evidence without simplifying setup, or simplify copy while leaving the provider list to recreate the same overload.

Deliverables:

| Key | Deliverable | BI | Independently shippable |
| --- | --- | --- | --- |
| compact-guide | Compact provider suitability guide with advanced review disclosure | BI-ECBD6924 | No |
| row-simplification | Simplified provider row default with advanced diagnostics in expansion | BI-ECBD6924 | No |
| coworker-prompt | COO prompt contract for brief, grounded next-action answers | BI-ECBD6924 | No |
| tests-docs | Tests and documentation/evidence updates | BI-ECBD6924 | No |

Coverage receipt: `cms1xvncg01j201lhhwz7xdz7`.

## Implementation steps

1. TDD red: update `ProviderSuitabilityGuide.test.tsx`, `ServiceRow.test.tsx`, and `providers/page.test.tsx` to assert the compact first-viewport contract, advanced evidence disclosure, simplified row defaults, and prompt shape.
2. Green: refactor `ProviderSuitabilityGuide` into a compact decision card plus native disclosures for protected work, recommendation lanes, safeguards, telemetry, and caveat.
3. Green: simplify `ServiceRow` collapsed content to provider name, plain routing status/action, optional resolves-phase signal, provider type, and toggle. Move weekly allocation, model count, non-chat classes, sensitivity abbreviations, routing scores, and tier into expanded diagnostics.
4. Green: move page-level operational panels (`CliPoolStatusPanel`, `AgentBudgetEventsPanel`, local-only toggle, token spend, scheduled jobs) under lower-priority disclosure bands where they do not compete with setup.
5. Refactor: keep inline style changes minimal and use DPF theme variables/tokens. Do not create a new provider wizard route or duplicate policy projection.
6. Verification: run targeted Vitest if available in the worktree; otherwise record source-only limitation and rely on pushed CI. Run `git diff --check`. For runtime UX, use governed shared/nonprod verification when available.

## Risks and rollback

- Risk: hiding a safety signal too deeply. Mitigation: keep the primary allowed/blocked behavior visible and only collapse evidence/diagnostics.
- Risk: tests that previously assert dense copy fail. Mitigation: update them to the new first-viewport contract rather than deleting coverage.
- Risk: source-only worktree cannot run local tests. Mitigation: capture the limitation, use CI/PR health, and avoid claiming unrun local gates.
- Rollback: revert this branch; it does not change schema, provider policy, credentials, routing eligibility, or persisted posture.

## Documentation impact

This plan is the durable implementation record. User-facing docs may need a short update only if the visible provider setup workflow changes labels or safe-defer behavior beyond the existing provider-onboarding guide; decide after implementation diff.
