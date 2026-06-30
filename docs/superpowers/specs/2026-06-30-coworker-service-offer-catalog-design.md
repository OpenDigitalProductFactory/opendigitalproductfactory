# Coworker Service Catalog, Offer Catalog, and Engagement Interface Design

**Date:** 2026-06-30  
**Status:** Approved for first implementation slice  
**Work capsule:** WC-80A6B6D6  
**Owner:** DPF platform

## Summary

DPF needs a formal way for humans and coworkers to discover, compare, and engage AI coworkers as service-capable providers. The four portfolios remain the Conway's-law structure for ownership, funding, and investment. The catalog is the persona-facing consumption surface: it explains what a coworker can do, how the work is packaged, what it costs, what authority it requires, what contractual boundary applies, and how an engagement becomes executable work.

The first slice adds a narrow catalog layer over the existing DPF coworker substrate rather than creating a parallel registry. `Agent` remains coworker identity. `SkillDefinition`, `SkillAssignment`, `AgentToolGrant`, and `TOOL_TO_GRANTS` remain the authority and execution backing. `ServiceOffering` remains the digital-product service/SLA model. `AgentActionProposal`, `CoworkerActionEnvelope`, `WorkCapsule`, and `ToolExecution` remain the approval, execution, and audit rails.

## Current-State Findings

Existing models already cover most foundations:

- `Agent` contains coworker identity, IT4IT value stream, portfolio, HITL default, lifecycle, supervisor, delegation, and authority profile.
- `SkillDefinition` and `SkillAssignment` describe invocable coworker skills and their allowed tools.
- `AgentToolGrant` and `TOOL_TO_GRANTS` bind tools to coworker authority.
- `ToolExecution` provides audit, cost, skill attribution, envelope linkage, and receipt linkage.
- `AgentActionProposal` and `CoworkerActionEnvelope` provide approval rails for consequential actions.
- `WorkCapsule` coordinates accepted/executable work and already supports `service-request` as an outcome anchor kind.
- `CoworkerCapabilityNeed` and self-assessment already capture coworker gaps.
- `DigitalProduct` is the product/funding anchor, with existing `ServiceOffering` records for product service/SLA metadata.

`ServiceOffering` is not enough by itself. It is product-owned service support metadata: digital product, consumers, availability, MTTR, RTO/RPO, support hours, CLA/OLA, status. It does not describe provider coworkers, persona-facing packaging, contractual authority, external provider terms, or actual request/order state.

## Standards Alignment

DPF treats IT4IT v3 as the operating-model substrate, with Digital Product as the backbone and the seven value streams: Evaluate, Explore, Integrate, Deploy, Release, Operate, and Consume. Service catalog management is the active, customer-facing slice of a broader service portfolio. This design adopts that separation:

- Digital Product remains the unit of organization, lifecycle, ownership, funding, and governance.
- The four portfolios organize investment and ownership.
- Service catalog and offer catalog expose what can be consumed.
- Engagements record actual demand and commitments.
- Work Capsules coordinate execution only after work is accepted.

This avoids treating portfolio structure as the request surface and avoids turning every service engagement into a backlog item.

Agent interoperability standards split the consumption surface by caller:

- MCP is the model-controlled discovery and request surface for external AI clients, coding agents, and humans using model-mediated tools. It should expose bounded, paginated, structured tools rather than dumping the entire coworker universe into model context.
- A2A is the peer engagement surface when one agent needs to find, evaluate, and directly collaborate with another agent. A2A discovery centers on Agent Cards that advertise identity, endpoint, authentication, capabilities, and skills. DPF should project eligible catalog entries into internal/private Agent Cards and, where appropriate, partner/public Agent Cards.
- GAID is the cross-boundary identity and governance layer. Internal-only coworkers can operate under private GAID. Any coworker exposed to customers, suppliers, partners, or public discovery needs a federated/public GAID posture, an AIDoc reference, revocation/status posture, and preserved delegation receipts.

The catalog is therefore not one payload for every consumer. It is the governed source from which UI views, MCP discovery tools, A2A Agent Cards, direct HTTP/API profiles, and future directory/SCIM projections are derived.

## Research & Benchmarking

Primary references reviewed for this design extension:

- A2A specification: Agent Cards are the discoverable metadata surface for agent identity, skills, endpoint, and security posture. Adopted: project selected catalog offers into Agent Cards for direct agent-to-agent engagement. Rejected: treating the full catalog as the A2A task protocol itself.
- Model Context Protocol tool documentation: tools are model-callable functions exposed by an MCP server. Adopted: bounded list/detail/request tools for catalog discovery. Rejected: injecting every coworker and offer into every agent context.
- DPF GAID architecture: GAID separates enduring identity, AIDoc, exposure state, protocol profiles, and delegation receipts. Adopted: private GAID for internal coworkers and federated/public posture for cross-organization exposure. Rejected: protocol-specific identifiers that fragment one agent identity across MCP, A2A, and HTTP.
- ASQ DMAIC overview: define, measure, analyze, improve, control is a durable improvement loop. Adopted: emergent coworker engagements can be measured, codified into aggregate offers, and continuously refined. Rejected: one-time catalog publication with no performance feedback loop.
- PCI Security Standards Council: PCI DSS applies to entities that store, process, transmit, or could affect cardholder data environments, and provides technical and operational requirements to protect payment account data. Adopted: payment/cardholder-data feature builds must trigger compliance/security/legal requirement engagement before implementation.
- D&B Direct+ and ADP developer surfaces: some capabilities require paid third-party data, identity, or payroll/workforce service providers. Adopted: provider-dependent feature builds must trigger procurement, finance, contract, data-boundary, and ongoing cost tracking before Build Studio treats the dependency as available.

## Conceptual Model

### Coworker Service

A `CoworkerService` describes a provider capability. It answers:

- who provides it;
- what the coworker can perform;
- what personas, portfolio roles, value streams, archetypes, jurisdictions, and digital products it serves;
- required inputs and produced outputs;
- risk and HITL posture;
- authority boundary: advice-only, proposal-only, approval-required, autonomous-allowed, or never-allowed;
- tools, skills, and grants backing the service;
- cost model and external provider contract/data boundary metadata.

It is provider-facing capability truth. It is not a priced/package offer and not a request for work.

### Coworker Offer

A `CoworkerOffer` packages one coworker service into a consumable offer. It answers:

- offer name and provider organization;
- eligible consumers/personas;
- portfolio and digital product association;
- budget envelope or price model;
- SLA/turnaround expectation;
- required approvals;
- legal/contractual terms;
- data boundary;
- deliverables;
- version, expiry, status;
- internal versus external availability.

It is the productized consumption unit. Multiple offers can derive from one service.

### Coworker Engagement

A `CoworkerEngagement` records an actual request/order for work. It answers:

- who requested work and for which persona/context;
- which offer and provider were selected;
- status, requested outcome, inputs, attachments, funding context, and contract context;
- required approval state;
- related proposal/envelope, Work Capsule, ToolExecution/audit, and evidence references.

It is demand and commitment state. It may remain proposed/rejected without ever creating a Work Capsule. When accepted and executable, it links a Work Capsule with outcome anchor kind `service-request`.

## Data Design

Add the smallest necessary schema:

- `CoworkerService`
  - stable `serviceId`;
  - `providerAgentId` referencing `Agent.agentId`;
  - optional `digitalProductId` referencing `DigitalProduct.productId`;
  - optional `serviceOfferingId` referencing `ServiceOffering.offeringId`;
  - typed string fields for status, riskTier, hitlTier, authorityBoundary, availabilityScope;
  - JSON arrays for personas, inputs, outputs, portfolio roles, value streams, archetypes, jurisdictions, skills, tools, grants, cost model, contract terms, data boundary, and metadata.
- `CoworkerOffer`
  - stable `offerId`;
  - `serviceId` referencing `CoworkerService.serviceId`;
  - optional `digitalProductId` and `providerOrganization`;
  - status, version, availabilityScope, riskTier, authorityBoundary;
  - JSON for eligible consumers, budget envelope, approvals, terms, data boundary, deliverables, filters, and metadata.
- `CoworkerEngagement`
  - stable `engagementId`;
  - `offerId`, `serviceId`, `providerAgentId`;
  - requester user/agent strings;
  - status, priority, requested outcome;
  - JSON for input payload, funding context, contract context, approval context, audit/evidence refs, and metadata;
  - optional `proposalId`, `envelopeId`, `workCapsuleId`, and `toolExecutionId`.

Closed application-level string sets:

- service/offer status: `draft`, `active`, `retired`;
- engagement status: `requested`, `needs-approval`, `accepted`, `rejected`, `in-progress`, `completed`, `cancelled`;
- risk tier: `low`, `medium`, `high`, `critical`;
- authority boundary: `advice-only`, `proposal-only`, `approval-required`, `autonomous-allowed`, `never-allowed`;
- availability scope: `internal`, `external`, `partner`.

## Projection and Seed Strategy

The first slice uses a catalog projection service that reads persisted catalog rows and enriches them with existing `Agent`, `SkillAssignment`, `AgentToolGrant`, `DigitalProduct`, and `ServiceOffering` data. It also includes a guarded Legal Operations Counsel example projection only when the legal coworker identity exists, so this branch does not need to duplicate the in-flight legal coworker branch.

Legal offers:

- Legal intake;
- Draft/review packet;
- Arcamanus legal packet;
- Counsel packet preparation;
- Legal corpus gap filing.

Legal metadata includes jurisdiction, archetype, attorney-review, legal-risk, data-boundary, and authority-boundary requirements. These offers default to `proposal-only` or `approval-required`; no legal offer is autonomous in the first slice.

## Engagement Flow

1. Browse/search/filter services and offers.
2. Inspect service/offer detail.
3. Request an engagement with desired outcome, inputs, funding context, and contract context.
4. The request creates `CoworkerEngagement`.
5. If the offer is high risk or external, status is `needs-approval` and the UI/tool response explains required approval rails.
6. Once approved/accepted, execution can create or link a `WorkCapsule` with a `service-request` outcome anchor.
7. Tool executions and evidence remain linked to existing audit tables.

## Access and Invocation Surfaces

Different callers need different catalog projections:

- Human portal: authenticated operators browse the catalog, compare offers, inspect authority/cost/terms, and request engagements. Legal Operations Counsel is internal-only by default and visible only to trusted authenticated humans and non-human actors with the right grants.
- MCP: external AI agents and model-mediated clients use `list_coworker_services`, `list_coworker_offers`, `get_coworker_offer`, and `request_coworker_engagement`. List tools must remain capped and filter-first; detail is fetched only after a candidate offer is selected.
- Build Studio/coding agents: build planners, coding agents, and review agents use a bounded catalog broker to identify business-level coworkers that must contribute feature requirements before implementation. Most feature builds will not need this path. It becomes mandatory when the brief, plan, dependencies, data model, or route surface matches regulated domains, paid providers, sensitive data movement, external-customer/supplier engagement, or operational authority changes.
- Internal A2A: trusted coworkers should engage peer coworkers through direct A2A task flows once a target has been selected. The catalog should supply the Agent Card projection and routing metadata, not replace A2A task exchange.
- Cross-organization A2A/API: sales, marketing, procurement, supplier-facing, and customer-facing coworkers require partner/external availability, GAID-federated or GAID-public identity, provider organization, authenticated card variants where needed, explicit terms, data boundary, audit, and revocation posture.
- Back-office specialist boundaries: legal, finance, security, and HR specialists can be invoked by internal coordinators, but their offers should stay narrow, approval-aware, and hidden from external discovery unless an explicitly reviewed partner-facing offer exists.

The first implementation slice delivers the human portal, MCP request surface, Build Studio requirements broker, a bounded Agent Card projection for selected coworker offers, and a read-only Agent Card endpoint at `/api/a2a/coworkers/[agentId]/offers/[offerId]`. It records enough cost, terms, availability, and data-boundary metadata to support later full A2A task exchange. It does not yet implement a stateful A2A task lifecycle endpoint or GAID authority verification service.

## Build Studio Requirements Surface

The catalog must support Build Studio without turning business coworkers into always-on context baggage for coding agents. The pattern is a build requirements broker:

1. During feature brief, design review, decomposition, and implementation review, Build Studio scans the feature for trigger signals.
2. If a trigger matches, the broker selects one or more coworker offers and requests a requirements engagement.
3. The engagement returns a requirements packet that becomes an input to the feature plan, acceptance criteria, implementation guardrails, and review checklist.
4. Coding agents receive only the resulting bounded requirements packet and links to underlying coworker engagement evidence, not the whole catalog.
5. If the implementation drifts into a newly triggered domain, review agents can request a late engagement, but the system should treat that as process debt to reduce over time.

Initial trigger families:

- payment/cardholder-data features: route to compliance, security, legal, finance, and possibly provider-management coworkers for PCI DSS scope, cardholder-data environment impact, tokenization/provider requirements, logging restrictions, evidence, and acceptance criteria;
- payroll/workforce compensation features, including ADP integration: route to HR/payroll, finance, legal, procurement, security, and data-governance coworkers for authority, privacy, payroll-cycle, audit, contract, and operational-risk criteria;
- company identity/data authority features, including D&B-style provider feeds: route to procurement, finance, data governance, customer/supplier master-data owners, and legal for paid-data terms, data lineage, refresh cadence, usage limits, and cost allocation;
- external paid services, model providers, data feeds, enrichment APIs, or token acquisition: route to procurement and finance for approval, cost center, renewal/usage tracking, termination rights, and budget evidence before the dependency is accepted;
- regulated or sensitive domains such as tax, employment, healthcare, financial reporting, identity/authentication, security monitoring, customer communications, and supplier onboarding: route to the relevant specialist aggregate offer before build execution.

The output should be structured, concise, and testable:

- applicable obligations and non-goals;
- required controls, acceptance criteria, and evidence artifacts;
- prohibited implementation patterns;
- approved providers or provider-selection requirements;
- cost model, funding context, and renewal/usage tracking requirements;
- required approvals and human checkpoints;
- data-boundary and retention constraints;
- citations or internal policy links used to derive the packet.

This turns business-level coworkers into early requirements contributors for coding agents. It reduces the common failure mode where PCI, payroll, paid data, contract, or procurement constraints are discovered only during late review, after implementation assumptions have already hardened.

Implementation note: the first broker slice is deterministic and bounded. `build-requirements.ts` detects the initial trigger families, returns concise packets, and `build-agent-prompts.ts` injects only that packet into Build Studio context. The packet becomes plan/review guidance; it does not load the whole coworker catalog into coding-agent prompts.

## Catalog Context Budget and Delegation

The catalog should encourage delegation without flooding every agent's context window:

- Agents should receive a small role-local capability set plus a catalog-search/broker affordance, not the full catalog.
- Catalog list responses should return summaries optimized for selection: offer id, provider, short outcome, availability, risk, authority, cost band, required inputs, and matching reasons.
- Offer detail should be pulled on demand when an agent is deciding whether to delegate, requesting approval, or creating an engagement.
- Coordinator agents should be prompted and instrumented to engage the right coworker when the requested work crosses their authority, skill, risk, jurisdiction, or cognitive-load boundary.
- Build Studio agents should be prompted and instrumented to request specialist requirement packets when a feature crosses regulated, paid-provider, sensitive-data, or operational-authority boundaries.
- Engagement requests should capture routing rationale: why this coworker/offer was chosen, what alternatives were considered, and whether the request is emergent, repeatable, or part of a codified process.
- The catalog broker/recommender should eventually use prior engagement outcomes, cost, latency, risk, and satisfaction signals to rank candidates, but ranking must remain explainable and overrideable.

This keeps cognitive load distributed across the AI workforce and human workforce: coordinators frame and route; specialists execute within bounded authority; humans approve consequential transitions.

## Aggregate Offers and Process Refinement

Individual coworker offers are leaves in the catalog. Repeatable combinations should be promoted into aggregate offers or playbooks so requesters can consume a higher-level outcome without manually coordinating each specialist.

Examples:

- supplier onboarding package: procurement intake, contract review, security/vendor-risk assessment, finance setup, and supplier communications;
- campaign launch package: marketing plan, sales enablement, legal claims review, analytics setup, and launch readiness;
- customer enterprise deal desk: sales qualification, pricing analysis, procurement negotiation support, legal packet preparation, and approval routing.

Aggregate offers should mature through explicit states:

- emergent: ad hoc multi-coworker delegation captured in engagement evidence;
- instrumented: repeated pattern has measurable handoffs, latency, rework, approval, cost, and defect data;
- codified: pattern becomes a named aggregate offer/playbook with owner, inputs, outputs, routing rules, and approval rails;
- optimized: process metrics are actively improved and controlled.

DPF should use a DMAIC-style refinement loop for these aggregate offers: define the outcome and consumers, measure actual engagement performance, analyze bottlenecks and rework, improve routing/automation/approval design, and control the process with ongoing metrics. The catalog is therefore both a consumption surface and a process-learning substrate.

## UI / IA

Route: `/platform/ai/catalog`

Navigation: a section-level AI Workforce tab, sibling to Directory, Skills, Providers & Routing, etc. Detail and engagement are local workflow states, not global navigation destinations.

Layout:

- dense filter bar across persona, portfolio, value stream, archetype, jurisdiction, risk tier, provider type, artifact/deliverable, and availability;
- split catalog table: offer name, provider coworker, service, personas, product/portfolio, risk, authority, SLA, availability, status;
- detail panel/section with six explicitly separated bands: Service, Offer, Authority, Funding, Contract/Data Boundary, Engagement;
- request form/drawer with explicit budget and terms fields;
- high-risk and external providers show approval and contract requirements before submission.

This is an operating interface. It should use restrained theme-token styling, compact typography, stable table/grid dimensions, and no marketing hero.

## MCP Tools

Add governed read/write tools:

- `list_coworker_services`: read-only, filterable, paginated.
- `list_coworker_offers`: read-only, filterable, paginated.
- `get_coworker_offer`: read-only offer detail.
- `request_coworker_engagement`: writes an engagement request and returns status/required approval/capsule guidance.

Add grant mappings:

- `coworker_catalog_read` for read tools.
- `coworker_engagement_write` for engagement request.

Future A2A/GAID tools should not expand this first MCP list into a huge universal tool surface. Prefer a small broker-oriented shape:

- search/select candidate offers with filters and explanation;
- fetch one offer detail;
- request an engagement;
- resolve one selected offer into an A2A Agent Card or GAID/AIDoc reference when the caller has authority. The first resolver is `resolve_coworker_offer_agent_card`; it projects one selected offer and rejects cross-boundary projection when GAID/AIDoc, legal terms, or data-boundary metadata is missing.

## Security and Governance

- External providers require provider identity, provider organization, terms, data boundary, authority boundary, cost model, revocation/audit posture, and legal review metadata.
- High-risk work routes through proposal/envelope approval rails before execution.
- Engagement creation is auditable even before execution.
- Work Capsules are not created for every engagement automatically; they are created or linked only when accepted/executable.
- Backlog remains for improving DPF, not for every service request.
- Internal specialist offers, especially legal, default to trusted internal humans and trusted non-human principals only.
- External/partner offers must be explicitly marked for that availability scope and must not inherit visibility from the provider coworker as a whole.
- Cross-organization calls must preserve acting, delegating, and delegated agent identities, including GAID where applicable, so receipts can reconstruct the chain of custody.
- Public or partner-facing Agent Cards must not disclose internal-only skills, prompts, tools, pricing details, or privileged data-boundary metadata unless a reviewed external offer requires that disclosure.

## Refactoring Allocation

Reserve roughly 20 percent of the implementation effort for targeted refactoring directly serving this feature:

1. Centralize catalog string value guards in `apps/web/lib/coworker-service-catalog/types.ts`.
2. Keep projection logic in a focused module instead of putting it in route code.
3. Add MCP handlers as thin adapters over the service layer.
4. Keep UI components focused: filter/table/detail/request form separated from server data loading.
5. Add tests around model boundaries so future features do not collapse service, offer, engagement, and work execution.

## Acceptance Criteria

- Spec and implementation plan exist under `docs/superpowers/`.
- Schema adds only the small catalog layer described above.
- Service layer projects coworker services/offers from existing agents, skills, grants, products, and persisted catalog rows.
- Legal Operations Counsel offers appear when the legal coworker identity is present.
- UI route supports browse/filter/detail/request initiation.
- MCP tools support coworker discovery and engagement request.
- Tests cover model boundaries, catalog projection, offer packaging, engagement creation, permissions/grants, and Legal Operations Counsel visibility.
- UX verification is run on a governed running portal or shared local-integration lease.
- Targeted tests and `pnpm --filter web build` are run before completion, with any pre-existing blocker clearly reported.
