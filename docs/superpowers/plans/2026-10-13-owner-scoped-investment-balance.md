---
status: draft
---

# Deliver owner-scoped investment balance

**Backlog:** BI-0ACB97B5. **Workroom:** WC-B5D4B788.
**Design:** [Investment balance belongs to the budget owner](../specs/2026-09-27-owner-scoped-investment-balance-design.md).

This plan is pending scope approval and live coverage. No implementation is authorized by this document alone.

## Delivery boundary

Deliver one coherent policy-to-observation feature in one protected PR. The phases below are internal sequencing, not separate usable releases: configuration without authority and usage provenance misrepresents control; an isolated token percentage cannot steer funded work; a UI without the shared server resolver diverges from agent behavior. Release only after the complete authority, attribution, steering and presentation chain passes. This atomic rationale requires a governed coverage receipt before implementation. The design's four candidate slices are consolidated into this single acceptance boundary; no independently shippable work is left only in Markdown.

## Design grounding

Extend `platform-dev-policy.ts` for shared targets and contracts, `portfolio/accountable-owner.ts` for canonical accountable identity (never its fallback as funding proof), existing `PlatformConfig` revisions, Workroom policy references and `DecisionPerspectiveProfile` ownership. Preserve quarterly points and run/grow/transform as separate concepts. Use `AdapterRunTelemetry` for cumulative attempt accounting: `build/build-phase-run.ts` resets phase counters on retry and cannot supply lifetime investment totals. Reuse `portfolio/ai-resource.ts` presentation helpers. Every persisted user-facing action re-enters governed execution through the existing portfolio-budget tool pack.

## Sequence and verification

### A. Authority, configuration and installation lifecycle

- Extend the shared target contract with validated owner/purpose scope and explicit unresolved/default/bound states. Read founder ownership through the canonical platform decision profile; match canonical principal identity, never a display name, install label or admin bit. WWWD retains its organization's authority; WSID supplies craft and obligation constraints.
- Add server policy functions beside `portfolio/portfolio-budget.ts`: per-owner/scope PlatformConfig immutable revisions, transactional current-pointer compare-and-swap, actor/reason provenance, version and validity checks. Validate canonical organization, principal and profile ownership on writes. Preserve explicit choices on setup and upgrade; cloning a config is not authority.
- Extend the existing portfolio-budget MCP pack and grants with scoped read/write/bind actions, plus governance classification and authorized-surface registry entries. Require exact expected revision and a recorded reason; reject cross-owner writes and stale reads. UI and MCP use these same handlers.
- Tests: owner/purpose matrix across both environment classes, unset authority, explicit override, competing writers, expiry/revocation, setup rerun and clone mismatch. References: AC-BAL-1, AC-BAL-2, authority-contract, setup-flow, authority-tests.

### B. Workroom and execution parity

- Bind policies in `Workroom.promotionPolicy` without replacing other keys. Resolve per funded item, then bounded parent containment, portfolio and installation defaults within one authority. Reject cycles, overflow and equal-precedence conflicts. Coordinator/executor changes never transfer funding.
- Add the shared projection to `work-capsules/mcp-handlers.ts`, claim readback and Build Studio context; retain generic connection guidance in `mcp/agent-host-instructions.ts`. Re-resolve at governed claim and dispatch, not just session creation.
- Tests: identical Build Studio/MCP fixture results, stale revision, executor handoff, funding transfer, mixed-purpose room, parent cycles/conflicts. References: AC-BAL-2, AC-BAL-3, binding-contract, claim-dispatch-flow, parity-tests.

### C. Cumulative observation and bounded steering

- Add nullable typed attribution columns to `AdapterRunTelemetry` with an additive migration and field classification: canonical funding principal/organization, funded item, source installation, immutable policy revision, purpose/classification enums and capture timestamp. Generate enum unions; use canonical reference deletion behavior that preserves history and a composite index for the scoped time-window query. Reporting dimensions never live in JSON metadata. Resolve a snapshot before `inference/ai-inference.ts` dispatch and carry it unchanged to both success/error telemetry writes. Existing rows stay unknown; do not fabricate a backfill.
- Read aggregate attempt tokens by bounded six-week `startedAt` window and immutable owner/purpose snapshot. Count every real retry once; exclude overlapping phase/budget/token ledgers. Show unassigned rows, missing token counts, external coverage limitations and freshness separately. Query at database level; test a million-row fixture/query plan before claiming the scale target.
- Extend `demand/start-ranking.ts` and its context loader, used by `governed-backlog-tee-up.ts` and capacity drain. Bias only eligible candidates belonging to the same funding scope, within bounded weights and configured tolerance. Do not bypass demand readiness, urgent obligations, spend ceilings, dependencies or WIP. No measured steering when observation is insufficient/stale. Preserve deterministic category ordering; report supply gaps.
- Precedence: preserve urgency/obligation handling, scored-before-unscored and the existing starved run/grow/transform bucket tier. Apply refactor/new preference only inside that tier and the same verified funding scope, then preserve demand score and existing tie-breaks within each category. Do not let the context loader's no-bucket-target early return suppress this independent policy. Test opposed starved-bucket and refactor targets explicitly; the owner sees when the pre-existing tier constrains the desired balance.
- Executable initial evidence defaults: 42-day window, at least 20 owned attempts with known token totals, at least 10,000 known owned tokens, at least 80% classification coverage among owned known tokens, and a latest owned observation no older than seven days. Validate configurable bounds, with window at most the telemetry retention (180 days). Unknown owners are a separate installation-wide coverage gap, never attributed to an owner's denominator; null token counts remain unknown attempts. Return a typed suppression reason for each insufficient/freshness/window failure. External usage remains an explicit unmeasured limitation: steering is opt-in to the observed pipeline, not a claim that the complete account is measured. Owner enablement and threshold revisions use the same governed policy write. Use a five-percentage-point tolerance and category preference, not synthetic token estimates or cross-scope score arithmetic.
- Tests: retries and failed attempts count, duplicate source identities do not; mutable owner changes cannot move old usage; null counts remain unknown; multiple dispatch simulation tends toward target with balanced demand; emergencies remain eligible and scope boundaries never cross. References: AC-BAL-4, AC-BAL-5, attribution-contract, steering-flow, accounting-steering-tests.

### D. Owner-facing presentation, corpus and delivery

- Compose existing `PortfolioTieOutPanel`/report-kit controls with a compact owner, purpose, target and observed/coverage summary. Keep source/revision detail behind disclosure. Changes require a reason and use the same governed actions. Reuse this component in the installation identity/setup journey; no second policy editor or raw token target input.
- Update active contradictory refactoring guidance, point operational AGENTS guidance to the canonical principle, and document WWWD ownership and WSID repair classification. Update the user guide and agent-visible context with honest unknown states and rolling-target semantics.
- Tests: keyboard, narrow viewport and both themes; denied writer and stale editor errors; served setup, budget and Workroom happy paths. Measure UX-fit with the existing route budget or governed propose-and-pick evidence.
- Run affected tests and package typechecks, data-impact and schema checks; shared governed local-CI build/migration/UX gates; exact-source independent review; protected PR and queue; `pr:health`; canonical deployment and live verification when the maintenance window permits. References: AC-BAL-6, presentation-contract, owner-edit-flow, ux-and-deployment-tests.

## Impact obligations

Before implementation claim exact edit paths and refresh `gate:context`. Carry every returned test impact and guard obligation into the affected phase. The current documentation-only context requires a fresh doc index; runtime/schema additions require a new context and data-impact manifest, not reuse of the documentation exemption. Run migration against old populated and empty telemetry data. Use only the canonical runtime/shared lease for runtime evidence.

## Backlog coverage

Parent and all internal phases: BI-0ACB97B5. Proposed decision: atomic, for the acceptance-boundary rationale above. Dependencies: B after A; C after A/B; D integrates A/B/C. Governed receipt: pending; this text is not coverage evidence.

## Risks and rollback

Incorrect authority could spend customer capacity under founder priorities; reject unresolved or mismatched owner boundaries. Telemetry duplication or missing snapshots could mislead steering; use one source and suppress steering without sufficient evidence. Revised policy can race a dispatch; snapshot before inference and use transactional revision binding. UI complexity can obscure the reason for a target; use one compact shared summary with progressive disclosure. Roll back steering/code while preserving immutable policy revisions and attribution; nullable schema addition remains. Never mutate the paired production install from this DEV connection.
