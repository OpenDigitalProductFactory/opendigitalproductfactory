# Platform Adequacy Architecture Review

> Status: architecture review, preserved from a Codex review thread on 2026-06-22.
> Scope: resilience, scalability, reusability, UI/IA fit, and archetype coverage adequacy for using DPF as the single operating platform for small-to-mid-size businesses in the covered archetypes.

## Executive Verdict

DPF is a strong platform foundation, but it is not yet adequate as the sole system of record for every small-to-mid-size business across its full archetype coverage.

The current architecture is best described as:

- **Strong foundation-ready:** governed local-first platform, broad business-domain model, archetype source of truth, AI/automation control plane, deployment doctrine, UI standards, and evidence-gated development process.
- **Pilot-ready for selected archetypes:** especially simpler professional services, appointment/service businesses, simple retail, storefront-led inquiry/booking businesses, software/product teams, and basic nonprofit/HOA operating flows where integrations and regulated workflows can be constrained.
- **Not yet sole-platform-ready for all covered archetypes:** especially regulated, high-throughput, asset/capacity-heavy, and mobile-workforce businesses such as banking, healthcare, public sector, field service, rental fleets, MSPs, logistics, and construction until resilience, vertical operations, connector readiness, and archetype-specific UX are proven.

The opportunity is real. DPF can plausibly become the one platform a small-to-mid-size business runs on. The immediate architectural risk is breadth outrunning operational depth.

## Evidence Base

This review combines:

- Source review in the repo, saved on branch `doc/platform-adequacy-review` from latest `origin/main` on 2026-06-22.
- Live DPF MCP backlog reads on 2026-06-22.
- The earlier review pass in this thread, which initially observed the root checkout on `dpf/deploy` behind `origin/main`; this file updates that finding where latest `origin/main` has moved.
- External standards used as review lenses:
  - [ISO/IEC 25010:2023](https://www.iso.org/standard/78176.html) for product quality characteristics.
  - [NIST Cybersecurity Framework 2.0](https://nvlpubs.nist.gov/nistpubs/CSWP/NIST.CSWP.29.pdf) for govern/identify/protect/detect/respond/recover resilience framing.
  - [The Twelve-Factor App](https://12factor.net/) for deployability, configuration, backing services, logs, and process discipline.
  - [WCAG 2.2 contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum) for user-facing readability and accessibility.

This is a review artifact, not a build-gate artifact. No production build, browser UX walkthrough, or migration gate was run for this document because no runtime behavior was changed.

## Architectural Strengths

### Archetype-First Foundation

The source now contains **95 archetypes across 21 categories** in `packages/storefront-templates/src/archetypes` as of the 2026-07-18 documentation sweep. This supersedes the older 87/19 review baseline and the still older 56/15 user-facing coverage copy. Treat any raw count in dated evidence as a point-in-time observation, not as the current acceptance target.

The root doctrine is architecturally correct: `StorefrontConfig.archetypeId` is the single source of truth for portal industry, while `Organization.industry` and `BusinessContext.industry` are derived. That is the right pattern for a platform that must change vocabulary, workflow emphasis, capability activation, and coworker behavior by archetype without creating forked products.

### Broad Operating Surface

The app route tree covers many of the domains a small-to-mid-size business expects from an operating platform:

- Customer/CRM and marketing surfaces.
- Finance, invoices, bills, purchase orders, payment runs, assets, spend, and suppliers.
- Compliance, controls, risks, obligations, evidence, policies, audits, incidents, and submissions.
- Employee/people surfaces.
- Storefront management and customer portal separation.
- Rental, service request, governance, member equity, workspace, workbooks, knowledge, and platform authority.
- AI/coworker operations, tool grants, MCP, audit, integrations, edge nodes, and Build Studio.

That breadth is an important strategic advantage. The missing layer is not "does the repo know these business concepts exist?" It does. The gap is "can a non-technical operator safely rely on them as the primary day-to-day system of record for their specific business?"

### Governance and Control Plane

DPF has unusually strong governance primitives for a young SMB platform:

- MCP token scopes and tool grants.
- `ToolExecution` receipts.
- Role/capability filtered navigation.
- Work capsules and evidence-gated delivery doctrine.
- Deployment contracts for lifecycle, identity, secrets, observability, edge nodes, and provider routing.
- Master-data management design that avoids duplicating canonical customer/product/supplier records.

This control plane is a major differentiator if the product goal is "AI coworker plus business operating system," because agent action, auditability, and authority are not bolt-ons.

### UI System Direction

The platform has the right design doctrine: theme tokens, CSS variables, report-kit components, no hardcoded colors, and WCAG-aligned readability standards. That gives the system a reusable visual grammar.

The gap is consistency. The direction is strong, but one-off cards, badges, dashboard metrics, and dense platform/admin screens still need convergence before the product feels like one polished operating system.

## Critical Gaps

### 1. Resilience Is Not Yet Sole-Platform Grade

If DPF is the one platform a business runs on, backup, restore, update, and state integrity are existential. The live backlog still has open disaster-recovery and upgrade-lifecycle work:

- `EP-DR-HARDENING-2026-05-23` remains open with 17 total items, 8 open, 1 in progress, and 8 done.
- `EP-UPGRADE-LIFECYCLE` remains open with 14 total items, 8 open, 1 in progress, and 3 done.
- `BI-EA67A758` is open P1: "Silent backup corruption - trial-restore failure never alerts operator."

The Postgres backup design is valuable, but it explicitly scopes out Neo4j/Qdrant backup, off-host/cloud backups, encryption, PITR, partial restore, and cross-install federation in the current slice. That is acceptable for an early self-hosted local platform, but not enough to claim appliance-grade business continuity.

**Adequacy implication:** DPF should not be positioned as the sole system of record for a business that cannot tolerate data loss until trial restores, proactive critical alerts, update rollback, volume identity checks, and restore drills are routine release evidence.

### 2. Archetype Templates Are Ahead Of Vertical Operations

The archetype catalog is broad and increasingly sophisticated, but vertical operations are not yet complete across that breadth.

Current main has made real progress on field dispatch:

- `BI-69A992A4` is done: axes-derived `field-dispatch` module plus `FieldDispatchProfile`.
- `BI-F9A64A54` is done: value-aware assignment scoring.
- `BI-3C3DD529` is done: dispatcher decision core.
- `BI-MOBAPP-FIELD` is in progress: field-service mobile "My Jobs" surface.

That is a good sign. However, the backlog records themselves distinguish these from the runtime/mobile/live-integration tiers. Field dispatch is becoming a horizontal capability, but it should still be treated as readiness-in-progress until archetype-specific runtime flows, mobile signals, human-in-the-loop governance, and UX verification are proven.

The workspace-home architecture has moved past the empty-registry boundary this review originally found. As of the 2026-07-18 sweep, `defaultWorkspaceHomeRegistry` is populated through `DEFAULT_WORKSPACE_HOME_CONTRIBUTIONS`, and `/workspace` can render the operational twin hero, operator cockpit, vertical workspace home, or platform fallback. The remaining adequacy risk is no longer "no substrate"; it is whether every archetype's derived workspace contribution, twin profile, cockpit language, setup activation summary, and first-screen operator task are UX-verified against the live catalog.

**Adequacy implication:** DPF has the vocabulary and activation substrate for many archetypes, but the first screen a worker sees is not yet consistently the operational cockpit for that archetype.

### 3. The Platform Needs A Readiness Matrix, Not A Binary Coverage Claim

"95 archetypes" is a coverage count, not an adequacy claim. A small professional-services business and a regulated bank branch have very different thresholds for "one platform."

DPF should publish and maintain an archetype readiness matrix with at least these states:

- **Template-ready:** archetype exists, vocabulary and storefront defaults are present.
- **Ops-ready:** core internal workflows are implemented and UX-verified.
- **Connector-ready:** required third-party imports/syncs have working setup, health, degraded states, and data reconciliation.
- **Regulated-ready:** compliance obligations, audit evidence, role separation, retention, and exception handling are verified for the archetype.
- **Sole-platform-ready:** backup/restore/update gates, core workflows, connectors, reporting, and operator UX have passed release evidence for that archetype.

Without this matrix, market coverage claims will overstate product readiness.

### 4. Master Data Is Architecturally Right But Not Fully Realized

The MDM design is the correct approach: canonical records stay in domain tables, source observations live as crosswalk/evidence, and merge/survivorship is governed and audited.

Live backlog still shows `EP-MDM` open with 9 total items, 7 open, and 2 in progress. During review, local source contained `MasterDataSourceRef`, while live MCP model introspection in the earlier pass did not recognize that model. That source/runtime/tooling drift is itself a platform adequacy risk.

**Adequacy implication:** A one-platform SMB system needs canonical customers, suppliers, products, locations, assets, and accounts to survive imports, merges, sync conflicts, and human correction. DPF is pointed in the right direction, but this must be finished before deeper connector expansion.

### 5. UI/IA Is Improving But Still Too Platform-Shaped

The five-area shell model is directionally strong:

- Workspace.
- Business.
- Products.
- Platform.
- Knowledge.

But route breadth, legacy labels, and platform/admin surfaces can still leak complexity to non-technical operators. Earlier portal UX work identified examples such as `People`/`Employee` mismatch, `/storefront` reached from a rail item labeled "Portal," dense `/platform/ai` surfaces, and workspace screens with too many links/buttons.

For an SMB operator, the platform must feel like:

- "What needs attention today?"
- "Who is waiting on us?"
- "What work is scheduled?"
- "What money is owed or due?"
- "What risk or compliance item is urgent?"
- "What did the AI do, and what needs my approval?"

It should not feel like a map of the platform's internal architecture.

## Dimension Review

### Resilience

Rating: **medium-low for sole-platform use; improving foundation.**

Strengths:

- Deployment contracts cover lifecycle, config, identity, edge, observability, secrets, provider routing, and API/client boundaries.
- Backup and restore models exist.
- DR hardening is tracked as an explicit epic.
- Trial-restore thinking exists, which is the right direction.

Gaps:

- Open P1 backup corruption alerting.
- Open DR hardening and upgrade lifecycle epics.
- Current backup design is Postgres-first and leaves Neo4j/Qdrant/off-host/PITR/federated backup as future work.
- Upgrade and volume identity risks still appear in live backlog search.

Recommendation:

Treat resilience as the first readiness gate for any "sole system" claim. Close DR and upgrade P1s before market-facing language says DPF can run an entire business without caveat.

### Scalability

Rating: **medium for one-install-per-business; not proven for hosted multi-tenant scale.**

Strengths:

- Single-org local-first architecture is plausible for SMB appliances.
- Edge node doctrine fits distributed local networks and private infrastructure.
- Worktree and local-CI doctrine show serious thinking about delivery scale.
- OpenAI-compatible inference routing and local-provider strategy provide provider flexibility.

Gaps:

- 424-model Prisma schema indicates broad domain scope and raises boundary/refactoring pressure.
- Deployment contracts still mark several non-Windows/cloud/provider paths as planned.
- Build Studio, AI operations, cost governance, and long-running agentic process resilience are still open epics.
- Multi-tenant SaaS scale is a different claim than "one install per business"; the current design is stronger for the latter.

Recommendation:

Define the scaling claim precisely. If DPF means one governed install per SMB, the architecture is plausible. If DPF means one hosted platform serving many unrelated SMB tenants, more isolation, tenancy, billing, rate limiting, backup segmentation, and compliance evidence are needed.

### Reusability

Rating: **medium-high in architecture; medium in implementation consistency.**

Strengths:

- Archetype activation profiles, vocabulary resolution, capability registries, workspace contribution types, report-kit, and MDM design are reusable foundations.
- Field dispatch is being generalized from HVAC/trades into a horizontal capability.
- Workspace-home design avoids creating a new dashboard/page-builder substrate.

Gaps:

- Some UI surfaces still implement local metric/status/card patterns instead of converging on report-kit.
- Finding/assurance/risk/issue-shaped models need unification before additional parallel models appear.
- Workspace contribution substrate exists, but concrete category/default contributions are not yet broadly registered.
- Docs can drift from source counts, as shown by the 56/15 → 87/19 → 95/21 archetype coverage progression.

Recommendation:

Spend roughly 20 percent of every workstream on refactoring and convergence until the reusable substrate catches up with feature breadth.

### UI And Operator Experience

Rating: **medium; strong doctrine, inconsistent lived experience.**

Strengths:

- Platform usability standards are explicit.
- Report-kit and theme tokens are the right primitives.
- Navigation simplification plan is directionally correct.
- Archetype-aware workspace design identifies the correct UX problem: workers need a role/archetype operating screen, not a generic command center.

Gaps:

- Platform complexity still leaks into operator-facing views.
- Some labels and route semantics remain confusing.
- Empty states and setup states need to become action-oriented and non-technical.
- Archetype-specific first screens are not yet widespread.

Recommendation:

Make `/workspace` the operational home for the selected archetype. Platform, AI, diagnostics, and Build Studio complexity should be progressively disclosed and admin/operator-gated.

## Adequacy By Archetype Class

### Likely Pilot-Ready Sooner

These categories are better candidates for early "one platform" pilots, assuming connectors and finance workflows are scoped:

- Professional services.
- Simple appointment-based services.
- Simple retail or storefront-led businesses.
- Non-regulated education/training providers.
- Small nonprofits and community organizations with modest compliance needs.
- Software/product teams using DPF itself as the operating environment.

Why: their core workflows are less dependent on regulated audit depth, mobile offline field execution, complex inventory, or high-stakes capacity dispatch.

### Needs More Before Sole-Platform Positioning

These categories need stronger vertical proof:

- Banking and financial services.
- Healthcare and wellness where regulated records, retention, consent, and privacy workflows are load-bearing.
- Public sector and regulated submissions.
- Trades, field service, logistics, and mobile workforce operations.
- Rental fleets, shared assets, and capacity/availability businesses.
- MSP/security/IT operations where integrations, alerting, and incident response are primary.
- Construction/real estate where project, documents, contracts, change orders, and compliance workflows are deeply intertwined.

Why: their hardest business decisions depend on capacity, compliance, field signals, assets, routing, regulated evidence, or external systems. DPF has the beginnings of those engines, but readiness must be proven archetype by archetype.

## Refactoring Spine

To keep breadth from becoming debt, reserve about 20 percent of related work for architectural refactoring. Prioritize:

1. **Report-kit convergence.** Replace local metric cards, status badges, tables, filters, and color maps with report-kit primitives.
2. **Finding substrate convergence.** Unify finding/assurance/risk/remediation-shaped models before adding more parallel records.
3. **Workspace contribution registration.** Move from substrate-only workspace-home architecture to concrete category defaults plus exact archetype overrides.
4. **MDM runtime alignment.** Ensure source, migration, live schema, MCP introspection, and docs agree for `MasterDataSourceRef` and related steward flows.
5. **Archetype docs from source.** Generate or regularly test archetype counts in docs to prevent stale market-coverage claims.
6. **Route and label cleanup.** Keep `/storefront` internal and `/portal` external; remove ambiguous labels from operator navigation.
7. **Connector pattern reuse.** Every connector should share health, last-sync, degraded-mode, mapping, and conflict-resolution patterns.
8. **AI action receipts.** Keep coworker actions observable, confirmable, reversible where possible, and tied to business records rather than chat-only state.

## Recommended Roadmap

### Phase 1: Sole-Platform Safety Gate

- Close open P1 backup/restore/update risks.
- Require trial-restore evidence and proactive alerting.
- Add explicit health checks for stateful volume identity and migration order.
- Define what "restore tested" means for Postgres, Neo4j, Qdrant, files, and vector/code-derived stores.

### Phase 2: Archetype Readiness Matrix

- Publish readiness states for all 95 current archetypes.
- Mark each archetype as template-ready, ops-ready, connector-ready, regulated-ready, or sole-platform-ready.
- Tie each readiness level to evidence, not judgment.
- Stop using raw archetype count as a proxy for market readiness.

### Phase 3: Vertical Workspace Activation

- Verify category-level workspace-home contributions for all 21 current categories.
- Add exact overrides for the highest-value archetypes first.
- Make missing data obvious and actionable.
- Route role-specific views through the same contribution substrate rather than parallel dashboards.

### Phase 4: Horizontal Operating Engines

- Finish and verify field dispatch runtime integration.
- Finish asset-pool/capacity operations for rental and shared resources.
- Finish native finance flows to QuickBooks-equivalence where DPF intends to replace, not merely integrate with, external accounting.
- Finish MDM/source crosswalk and stewardship queues before expanding connector count.

### Phase 5: SMB Operator Polish

- Simplify first-run setup.
- Convert platform/admin terminology into business language.
- Make every empty state actionable.
- Hide AI/build/runtime plumbing unless the user is in an admin/operator context.
- Enforce report-kit, theme-token, and WCAG checks on every UI-impacting change.

## Final Assessment

DPF has the architecture of a real SMB operating platform, not just a collection of pages. The combination of archetypes, governance, AI coworkers, MDM, finance/compliance/customer surfaces, and local-first deployment is strategically coherent.

The main risk is overclaiming readiness. The platform should not say "we cover 95 archetypes" as though every archetype is equally ready to run a business end to end. It should say "we have an archetype-governed platform, and each archetype progresses through explicit readiness gates."

With resilience hardening, concrete vertical workspace homes, connector readiness, MDM completion, and disciplined UI/refactoring, DPF can become the single platform for many small-to-mid-size businesses. Until those gates are passed, it is a strong foundation and pilot platform, not yet a universal sole-system replacement.
