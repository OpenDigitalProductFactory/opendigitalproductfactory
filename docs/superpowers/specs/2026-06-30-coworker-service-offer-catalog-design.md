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

## Security and Governance

- External providers require provider identity, provider organization, terms, data boundary, authority boundary, cost model, revocation/audit posture, and legal review metadata.
- High-risk work routes through proposal/envelope approval rails before execution.
- Engagement creation is auditable even before execution.
- Work Capsules are not created for every engagement automatically; they are created or linked only when accepted/executable.
- Backlog remains for improving DPF, not for every service request.

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

