# Platform Adequacy Architecture Review

> Status: architecture + commercial-readiness review. Preserved from a Codex review thread on 2026-06-22; later extended with a chief-architect pass (security/data-protection, observability, AI-action integrity) and a business-development pass (competitive frame, go-to-market sequencing, commercial gating).
> Scope: resilience, security/data-protection, observability, scalability, reusability, AI-action integrity, UI/IA fit, and archetype-coverage adequacy for using DPF as the single operating platform for small-to-mid-size businesses in the covered archetypes - plus the commercial-readiness implications of that adequacy.
> Counts and backlog states in this document are point-in-time snapshots verified against live source and the DPF MCP backlog on 2026-06-22. Treat them as evidence with an expiry, not standing facts; re-verify before quoting externally.

## Executive Verdict

DPF is a strong platform foundation, but it is not yet adequate as the sole system of record for every small-to-mid-size business across its full archetype coverage.

The current architecture is best described as:

- **Strong foundation-ready:** governed local-first platform, broad business-domain model, archetype source of truth, AI/automation control plane, deployment doctrine, UI standards, and evidence-gated development process.
- **Pilot-ready for selected archetypes:** especially simpler professional services, appointment/service businesses, simple retail, storefront-led inquiry/booking businesses, software/product teams, and basic nonprofit/HOA operating flows where integrations and regulated workflows can be constrained.
- **Not yet sole-platform-ready for all covered archetypes:** especially regulated, high-throughput, asset/capacity-heavy, and mobile-workforce businesses such as banking, healthcare, public sector, field service, rental fleets, MSPs, logistics, and construction until resilience, vertical operations, connector readiness, and archetype-specific UX are proven.

The opportunity is real. DPF can plausibly become the one platform a small-to-mid-size business runs on. The immediate architectural risk is breadth outrunning operational depth.

**Commercial thesis.** DPF's true competitor is not another all-in-one suite; it is the *stack* a small business already rents - accounting, CRM, scheduling/dispatch, POS, payroll, point compliance tools - plus the integration tax of holding that stack together. DPF's wedge is to **collapse that stack into one governed install and run AI coworkers on top of it**, which reframes the buyer's budget from software seats to back-office labor. That is a large, defensible opportunity. The corresponding commercial risk is the mirror of the architectural one: selling breadth ("95 archetypes") ahead of proven depth produces failed implementations, and in tight SMB referral communities (trades, clinics, franchises) a failed implementation is a reputational event, not just a lost renewal. The same readiness discipline that protects the architecture is therefore the instrument that protects the brand and qualifies the pipeline.

## Evidence Base

This review combines:

- Source review in the repo, saved on branch `doc/platform-adequacy-review` from latest `origin/main` on 2026-06-22.
- Live DPF MCP backlog reads on 2026-06-22.
- A 2026-06-22 re-verification pass: every source count and backlog rollup cited in the original review was re-checked against then-current source and live MCP state. Those counts are point-in-time evidence; current source coverage has since moved to 95 archetypes across 21 categories per the 2026-07-18 documentation sweep noted below.
- The earlier review pass in this thread, which initially observed the root checkout on `dpf/deploy` behind `origin/main`; this file updates that finding where latest `origin/main` has moved.
- External standards used as review lenses:
  - [ISO/IEC 25010:2023](https://www.iso.org/standard/78176.html) for product quality characteristics.
  - [NIST Cybersecurity Framework 2.0](https://nvlpubs.nist.gov/nistpubs/CSWP/NIST.CSWP.29.pdf) for govern/identify/protect/detect/respond/recover resilience framing.
  - [The Twelve-Factor App](https://12factor.net/) for deployability, configuration, backing services, logs, and process discipline.
  - [WCAG 2.2 contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum) for user-facing readability and accessibility.
  - [NIST Privacy Framework](https://www.nist.gov/privacy-framework), plus SOC 2 / HIPAA / GDPR expectations, as the commercial gates for regulated-vertical sales.
  - [Crossing the Chasm](https://en.wikipedia.org/wiki/Crossing_the_Chasm) (Moore) for beachhead and bowling-pin go-to-market sequencing.

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
- Work workrooms and evidence-gated delivery doctrine.
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
- `EP-UPGRADE-LIFECYCLE` remains open with 14 total items: 8 open, 1 in progress, 3 done, and 2 deferred.
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

### 6. Security, Compliance Evidence, And Data Exit Are Not Yet Regulated-Grade

The governance *design* is strong (MCP token scopes, `ToolExecution` receipts, the propose->approve->commit envelope). But three things gate any regulated or finance-critical "sole platform" claim, and all three are observable in current source:

- **Encryption at rest is host-level only.** Integration credentials are application-encrypted (AES-256-GCM in `packages/integration-shared/src/credential-crypto.ts`), but the Postgres business data itself relies on volume/substrate encryption (per the secrets deployment contract) - there is no application-managed at-rest encryption for the system of record.
- **Compliance models capture evidence but do not attest.** `ComplianceEvidence`, `ComplianceAudit`, `ComplianceIncident`, and `CorrectiveAction` exist to *record* compliance, but there is no certified attestation (SOC 2 Type II, HIPAA BAA) or attestation-readiness surface - and for regulated buyers those artifacts gate the deal regardless of code quality.
- **The exit story is weak.** Data export is per-table CSV (`ExportButton` / `toCsv`); there is no whole-account export. A buyer betting an entire business on one platform needs a credible, demonstrable way to take all of it back.

**Adequacy implication:** non-regulated archetypes can proceed on the current security posture; regulated archetypes cannot be claimed until encryption-at-rest, certified-attestation readiness, and whole-account portability are routine release evidence. See the Security & Data Protection and AI-Action Integrity dimensions below, and the regulated-tier prerequisites in Business Development.

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

### Security And Data Protection

Rating: **medium for selected non-regulated archetypes; not yet regulated-grade.**

Strengths:

- MCP token scopes plus granular per-tool grants gate every agent action; `ToolExecution` (and `ToolExecutionReceipt` digests) record params, result, success, and cost.
- Role/capability-filtered navigation and authority surfaces make permissions legible.
- Application-level AES-256-GCM encryption for integration credentials/secrets (`credential-crypto.ts`), with PII redaction/log sanitization that strips SSN/DOB/bank patterns and flags injected content (`redact.ts`).
- Local-inference residency is enforced where it matters: build/codegen routes to the local provider (`residencyPolicy=local_only`) and fails loud rather than silently calling out, and outbound URLs are SSRF-gated (`assertSafeOutboundUrl`).
- A uniform, substrate-agnostic secrets deployment contract with a rotation protocol.
- Compliance-evidence data models (`ComplianceEvidence`/`ComplianceAudit`/`ComplianceIncident`/`CorrectiveAction`) provide a home for regulated obligations.

Gaps:

- Business data encryption-at-rest is host/volume-level only; only credentials are application-encrypted (see Critical Gap 6).
- Egress controls are point solutions, not a unified policy plane: inference residency (fail-loud) and SSRF URL gating exist, and destructive coworker sends pass the HITL envelope, but CADA/sovereignty is computed as an *assurance score* (`sovereignty-assessment.ts`, pure logic) rather than enforced as a runtime data-egress veto - there is no single policy plane governing arbitrary outbound data.
- Compliance models capture evidence but there is no certified attestation (SOC 2 Type II, HIPAA BAA) or attestation-readiness surface.
- This review cites NIST CSF 2.0 as a lens but the codebase does not yet map protect/detect/respond/recover to named owners and evidence.

Recommendation:

Define a security baseline as release evidence per archetype tier. Treat encryption-at-rest, egress governance, and certified-attestation readiness as the gating work for any regulated-archetype claim, and make the NIST CSF 2.0 mapping explicit so each function has an owner and an evidence definition rather than a citation.

### Observability And Operability

Rating: **medium-low for sole-platform day-2 operations; foundation in place.**

Strengths:

- A runtime-health surface (`/platform/ai/runtime-health`) shows the model/provider/engine routing verdict per build phase with remediation guidance.
- `PlatformNotification` is a real operator-alert primitive (severity/category/resolved-at), and `ToolExecution` carries token/cost metering.
- The governed self-upgrade path owns quiescence, recovery-point creation, health evidence, and rollback - a genuine operability contract for the highest-risk action.

Gaps:

- OpenTelemetry export is Phase-0 and feature-flagged (`DPF_GEAR_OTEL_EXPORT`, default off); it is not wired to a production observability pipeline, and there are no platform-wide metrics/traces/SLOs.
- The alerting fabric exists but is not uniformly applied: the open P1 `BI-EA67A758` shows trial-restore failure never creates a `PlatformNotification` - the canonical pattern is present but not yet everywhere it must be.
- Full-observability work should be treated as a readiness dependency rather than background plumbing.

Recommendation:

For a sole platform, day-2 operability is a feature, not plumbing. Make `PlatformNotification` the uniform alerting spine (closing `BI-EA67A758` as the canonical pattern), and decide whether OTel graduates from a flagged Phase-0 experiment to a supported observability contract before the platform is sold as a business's only system.

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
- Docs can drift from source counts, as shown by the 56/15 -> 87/19 -> 95/21 archetype coverage progression.

Recommendation:

Spend roughly 20 percent of every workstream on refactoring and convergence until the reusable substrate catches up with feature breadth.

### AI-Action Integrity And Trust

Rating: **medium-high in governance design; the platform's signature strength and its signature risk.**

Strengths:

- The propose->approve->commit pattern is real substrate, not a slogan: `AgentActionProposal` carries a proposed/decided/executed lifecycle with a human `decidedBy`; the `CoworkerActionEnvelope` state machine gates destructive/irreversible actions behind human approval; `ToolExecution` + `ToolExecutionReceipt` record every call.
- The horizontal engines are built the same way - the field-dispatch decision cores are explicitly *pure* ("dispatcher proposes; the runtime commits each through governance"), so the human-in-the-loop boundary is in the architecture, not bolted on.
- Authority/audit surfaces (`/platform/audit/authority`, the capability journal) make agent action observable and attributable.

Gaps:

- Reversibility is action-specific: the audit trail is comprehensive but there is no global undo, so a wrong AI action on a financial or compliance record is recoverable only by manual corrective workflow.
- The propose->commit envelope is not yet uniformly enforced across *every* side-effecting surface - it is strongest for destructive/browser-driving actions.
- For "sole platform," the blast radius of an unattended agent action on the system of record is the trust question that gates regulated and finance-critical archetypes.

Recommendation:

Make the propose->commit envelope the mandatory contract for every business-record-mutating agent action, not just destructive and browser-driving ones, and pair high-stakes actions (money movement, regulated submissions, irreversible external sends) with explicit reversibility or a hold/confirm window. This is both an architecture requirement and the single most important trust story for the sales motion.

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

## Business Development And Commercial Readiness

The architecture analysis above answers "can it work?" This section answers the questions a buyer, a partner, and a go-to-market team actually ask: what does it replace, who should we sell it to first, and what must be true before we say so? The readiness matrix is the hinge between the two - it is an engineering tracker and a sales-qualification instrument at the same time.

### What DPF Actually Displaces

DPF is usually mis-framed as competing with horizontal all-in-one suites. The real incumbent in each target archetype is a *stack of point solutions plus the integration tax of holding them together*:

- Professional services: accounting + CRM + time/billing + e-sign + docs.
- Field service / trades: accounting + a vertical FSM (ServiceTitan, Jobber, Housecall Pro) + scheduling + payments.
- Retail / storefront: POS (Square, Toast) + accounting + inventory + a website/booking tool.
- Healthcare / wellness: an EHR/practice-management system + scheduling + billing + a compliance binder.
- Banking / financial services: core/ledger systems + KYC/AML tooling + case management + audit evidence.

The buyer is not paying one vendor; they are paying five, plus the spreadsheets, the manual re-keying, and the part-time bookkeeper who reconciles them. DPF's wedge is to **collapse the stack into one governed install and run AI coworkers across it** - one source of truth, no integration tax, and labor leverage on top. That is the message; the readiness matrix governs *which archetypes can hear it yet*.

### The Two Value Propositions And The TAM Reframe

1. **Stack collapse.** Fewer subscriptions, one data model, no swivel-chair reconciliation. This is a cost-and-coherence argument any SMB understands immediately.
2. **AI coworkers that do the work.** The platform does not merely *record* the business; it *operates* it - drafts the invoice, proposes the dispatch, prepares the compliance evidence, with a human approving at the envelope. This reframes the budget from *software seats* (a few hundred dollars a month) to *back-office labor* (the bookkeeper, the dispatcher, the scheduler, the compliance clerk). That reframe is the real TAM expander and the reason "sole platform" is worth the difficulty - but it only lands where AI-action integrity (above) is proven, because an agent that mis-files a remittance is a trust-ending event.

Local-first compounds both: the data lives on the customer's infrastructure (a sovereignty and "no per-seat SaaS rent" argument, and a genuine differentiator for regulated and privacy-sensitive buyers), and the platform is an owned asset rather than a metered subscription.

### Local-First Is A Commercial Double-Edge

The same one-install, local-first model that is an architectural strength is a go-to-market constraint, and the commercial plan must hold both at once:

- **Asset, not edge:** no instant self-serve SaaS trial, a real install/onboarding step, and a support surface that lives on the customer's hardware. This raises cost-to-acquire and cost-to-support per logo relative to pure SaaS.
- **Implications:** pricing leans toward a license (asset) plus an optional managed/support subscription rather than per-seat SaaS; the partner/reseller channel is not optional polish but the primary mechanism for scaling installs and first-line support; and a managed-install / hosted-appliance option may be needed to reach buyers who will not run their own infrastructure.

### Readiness Matrix As A Go-To-Market Instrument

Re-read the five-state readiness matrix (Critical Gap 3) as a commercial gating ladder. Each state authorizes a specific motion and forbids the ones above it:

- **Template-ready -> demo and discovery only.** Show the vocabulary; do not sell production.
- **Ops-ready -> paid pilot / design partner.** Core internal workflows work and are UX-verified; sell a time-boxed pilot, not a system-of-record migration.
- **Connector-ready -> switch-from-incumbent deal.** Imports/syncs and reconciliation work; now you can credibly say "move off QuickBooks / your FSM."
- **Regulated-ready -> regulated-vertical sale.** Compliance obligations, audit evidence, role separation, and retention are verified *and the commercial/legal artifacts below are in place.*
- **Sole-platform-ready -> "run your business on it" GA.** Every gate passed with release evidence for that archetype.

The discipline is to **let the matrix, not the catalog, set the sales claim.** Overclaiming a tier converts pipeline into failed implementations, and SMB verticals are referral economies where one public failure poisons a segment. The matrix is how DPF scales its claims exactly as fast as its evidence - and no faster.

### Beachhead Sequencing (Bowling-Pin)

Following a Moore-style beachhead model, lead where depth already exists and let each win knock down the next pin via shared horizontal engines:

1. **Beachhead - software/product teams (dogfood).** DPF builds DPF; this is the strongest available reference and the lowest-risk first claim.
2. **First pins - professional services, appointment/service businesses, simple retail.** Lower regulated/field/inventory complexity; the workflows are mostly internal; pilots can be evidenced quickly.
3. **Adjacent expansion via the field-dispatch engine.** Dispatch is being generalized from HVAC into a horizontal (`BI-69A992A4` / `F9A64A54` / `3C3DD529` done as pure decision cores), so trades and field-service archetypes share one engine - land one and the rest get cheaper.
4. **Deferred - banking, healthcare, public sector, logistics, rental fleets, MSP, construction.** Pursue only with the regulated-tier prerequisites below; these are the highest-value but highest-liability segments.

Generate a referenceable case study at each pin *before* opening the next; the readiness gates are exactly the evidence that converts a pilot into that case study.

### Regulated-Tier Prerequisites Are Commercial, Not Just Technical

For banking, healthcare, and public sector, "regulated-ready" must bundle artifacts that are sales blockers regardless of code quality. These are absent today - the platform has compliance-*evidence* data models but no certified attestations:

- **Healthcare:** a HIPAA Business Associate Agreement and the safeguards behind it.
- **Cross-vertical trust:** a SOC 2 Type II report (or a credible roadmap to one) and a Data Processing Agreement / GDPR posture.
- **Data protection:** business-data encryption-at-rest (today host-level only) and data-residency attestations.
- **Examination support:** for banking, the ability to support a customer's examiner/auditor with evidence exports.

Sequence these legal and assurance artifacts *alongside* the engineering readiness for those archetypes; a regulated deal stalls on a missing BAA just as surely as on a missing feature, and these artifacts have long lead times.

### Trust, Lock-In, And The Exit Story

No owner bets an entire business on a single platform without a credible way out. Today the exit story is weak: data export is per-table CSV with no whole-account export. Local-first helps (the data physically lives on the customer's infrastructure), but "your data is here, and you can take all of it, in a usable shape, whenever you want" should be an explicit, demonstrable feature and a standard objection-handler. A strong portability story lowers the perceived risk of "sole platform" more than any feature checkbox.

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

### Commercial Track (Runs In Parallel)

The five phases above are the engineering gate ladder; the commercial motion runs alongside and is gated by it, not after it:

- **Name the beachhead and sign design partners** for the pilot-ready archetypes now; their pilots produce the readiness evidence Phases 2-3 depend on.
- **Adopt the readiness matrix as the sales-qualification gate** so no motion outruns its tier (demo -> pilot -> switch -> regulated -> GA).
- **Stand up the partner/reseller channel** (`EP-PARTNER-CHANNEL`) as the install and first-line support mechanism before logo count outruns direct support capacity.
- **Begin the regulated-tier legal/assurance artifacts** (BAA, SOC 2 roadmap, DPA, data-residency) in parallel with Phase 1 security work, since they have long lead times.
- **Define packaging** - license (asset) + managed/support subscription + AI-compute tier - and tie offer tiers to readiness tiers.

Give each engineering phase an owner and an evidence definition; a gate that cannot name its evidence is not a gate.

## Final Assessment

DPF has the architecture of a real SMB operating platform, not just a collection of pages. The combination of archetypes, governance, AI coworkers, MDM, finance/compliance/customer surfaces, and local-first deployment is strategically coherent.

The main risk is overclaiming readiness. The platform should not say "we cover 95 archetypes" as though every archetype is equally ready to run a business end to end. It should say "we have an archetype-governed platform, and each archetype progresses through explicit readiness gates."

Commercially, that same discipline is the growth strategy, not a brake on it. DPF's opportunity - collapse the SMB software stack and run AI coworkers across it - is large enough to be worth winning the hard way: a beachhead, evidenced pilots, referenceable case studies, and claims that expand exactly as fast as the readiness matrix fills in. The failure mode is not "too cautious"; it is selling depth that is not there into referral communities that remember.

With resilience hardening, a uniform security and AI-action-integrity baseline, concrete vertical workspace homes, connector and data-portability readiness, MDM completion, disciplined UI/refactoring, and a matrix-gated commercial motion, DPF can become the single platform for many small-to-mid-size businesses. Until those gates are passed, it is a strong foundation and a pilot platform - an exceptional one - not yet a universal sole-system replacement.
