# Layer-Scoped Work Capsules and Portfolio Activity Coordination

| Field | Value |
| --- | --- |
| Status | Implemented - first product slice |
| Date | 2026-06-29 |
| Owner surface | Work Case / Company Work Management, AI Workforce, Portfolio |
| Related epic | EP-2984B02B - Work Case / Company Work Management |
| Related backlog | BI-5F70A7DA - Work Capsule initiation should attach to the right layer-specific work outcome |
| Related capsule | WC-68DB68F8 |
| Extends | 2026-06-07-business-operating-model-portfolio-wiring-design.md; 2026-06-19-unified-build-studio-tracking-all-surfaces-design.md |

## 1. Problem

The existing Work Capsule designs correctly identify the capsule as the executor-agnostic unit for development tracking and cross-agent handoff. That is necessary, but not sufficient for company-level work management.

The platform has been focused on foundation, manufacture, and delivery work for DPF itself. As DPF moves toward employee work, customer offerings, archetype development, and AI coworker operations, not every coordinated activity is a platform backlog item. Some activities are platform-development work, some are company business work, and some are profession/coworker craft work.

Forcing every Work Capsule through the platform backlog would blur the decision scopes:

- WWMD - platform and factory doctrine: how DPF should build, govern, and evolve itself.
- WWWD - organization doctrine: how this company should operate and make business decisions.
- WSID - profession doctrine: how a competent professional/coworker should reason in a role.

The same blur would weaken the four-portfolio model. A capsule may coordinate work in `productsAndServicesSold`, `forEmployees`, `foundational`, or `manufactureAndDeliver`, and `manufactureAndDeliver` is special: it serves the other three portfolios and also recursively serves itself.

## 2. Existing Substrate

This design does not introduce a new primary work substrate.

- `WorkCapsule` already provides the coordination envelope: title, objective, status, executor, lease, scope claims, evidence timeline, branch/worktree/PR fields, and optional links to backlog, epic, build, task run, runtime targets, and verification.
- `BacklogItem` and `Epic` remain the platform delivery intake for DPF build work.
- The Business Operating Model spec already defines the four portfolio roles and the need to populate Products & Services Sold and For Employees / Workforce for each company.
- The Decision Perspective docs already distinguish WWMD, WWWD, and WSID and require business decisions to resolve in the correct scope.
- The Trusted AI Agent Governance white paper frames AI agents as managed identities requiring inventory, authority, oversight, evidence, and lifecycle governance.

The gap is binding and projection: the capsule needs enough typed scope to point at the correct human-facing outcome without pretending every outcome is a platform backlog item.

## 3. WWMD Consultation

WWMD was consulted on the design direction after the ambiguity was identified.

Options scored:

1. Store layer scope as loose JSON metadata on `WorkCapsule`.
2. Add typed Work Capsule scope fields plus a generic outcome anchor.
3. Create a new Activity / Work Case substrate and leave Work Capsule only for execution coordination.

WWMD recommended option 2 with high confidence. The typed-field option scored best because it preserves Work Capsule as the single coordination plane, avoids a parallel substrate, and makes the layer/portfolio/outcome relationship queryable, governable, and visible to the right surfaces.

This spec adopts that direction.

## 4. Design Decision

Work Capsules coordinate activity. They do not define the business object being worked.

A capsule may be anchored to a platform backlog item, but that is one anchor type among several. The human-facing object is the outcome: a Work Case, a business activity, a Digital Product change, a service request, a coworker improvement, a decision, or a platform backlog item.

The capsule should carry typed scope that answers:

- Which decision scope governs this activity?
- Which portfolio context does it belong to?
- Who or what is served?
- What kind of activity is this?
- What visible outcome is being coordinated?
- Which portfolios does the activity serve or depend on?

## 5. Proposed Scope Model

Add first-class, queryable scope to `WorkCapsule`:

| Field | Purpose |
| --- | --- |
| `decisionScope` | `wwmd`, `wwwd`, or `wsid`. Determines which governed perspective owns ambiguous decisions. |
| `portfolioRole` | Primary portfolio context: `foundational`, `manufactureAndDeliver`, `forEmployees`, or `productsAndServicesSold`. |
| `servedPersona` | Human-readable served party: customer, member, resident, employee, AI coworker, operator, platform, public stakeholder, etc. |
| `activityKind` | Delivery, support, improvement, governance, launch-readiness, craft-judgment, lifecycle, remediation, or another closed enum. |
| `outcomeAnchor` | Typed reference to the visible work object. Examples: backlog item, Work Case, Digital Product, service request, customer account, coworker, DecisionInteraction, document. |
| `servesPortfolioRoles` | Zero or more portfolio roles this activity serves. Required for cross-portfolio and recursive delivery work. |
| `dependsOnPortfolioRoles` | Zero or more portfolio roles this activity depends on. Used for line-of-sight, readiness, and delivery risk. |

Implementation decision: use direct nullable `WorkCapsule` columns for `decisionScope`, `portfolioRole`, `servedPersona`, and `activityKind`; use JSON for `outcomeAnchor`, `servesPortfolioRoles`, and `dependsOnPortfolioRoles`. This keeps the core routing dimensions queryable while leaving heterogeneous work-object anchors flexible.

## 6. Portfolio Semantics

### 6.1 Products And Services Sold

This portfolio serves external customers, members, ratepayers, patients, clients, or other archetype-specific consumers. Work Capsules here usually coordinate market-offer work, service readiness, lifecycle transitions, statutory services, product changes, or customer-facing commitments.

### 6.2 For Employees / Workforce

This portfolio serves the workforce: humans and AI coworkers. AI coworkers should be managed as Digital Products where appropriate, especially when they have lifecycle, authority, budget, skill, tool, supervision, evidence, or availability concerns.

The user-facing label may become Workforce, but the registry key can remain `forEmployees` / `for_employees` to avoid churn.

### 6.3 Foundational

This portfolio serves the substrate: identity, data, runtime, integration, governance, security, observability, and other platform capabilities. For DPF itself, much current work has lived here.

### 6.4 Manufacture And Deliver

This portfolio is not merely a peer. It is the operating loop that manufactures, fulfills, supports, and improves the other portfolios.

It serves:

- Products and Services Sold - delivering the company offer.
- For Employees - enabling the workforce and AI coworkers.
- Foundational - operating and improving the substrate.
- Manufacture and Deliver itself - recursive improvement of the delivery system.

The model therefore needs `servesPortfolioRoles` and `dependsOnPortfolioRoles`, not only a single `portfolioRole`.

## 7. Initiation Flow

The default initiation flow should be:

1. A human or coworker states an outcome in business language.
2. The system identifies the decision scope: WWMD, WWWD, or WSID.
3. The system identifies the portfolio context and served persona.
4. The system creates or reuses the visible work object, if one exists.
5. The system creates or adopts a Work Capsule behind the scenes.
6. The capsule receives typed scope and an `outcomeAnchor`.
7. Evidence, decisions, handoffs, blockers, and status updates attach to the capsule.
8. User-facing surfaces render the outcome, not the internal `WC-*` identifier.

Examples:

| Human-facing outcome | Scope | Portfolio | Anchor |
| --- | --- | --- | --- |
| Improve AI readiness routing in DPF | WWMD | foundational | Backlog item / spec / PR |
| Prepare municipal services launch package | WWWD | productsAndServicesSold | Work Case / Digital Product / document |
| Resolve a 311 service request | WWWD | manufactureAndDeliver | Service request / customer account |
| Improve the finance coworker close process | WSID + WWWD | forEmployees | AI coworker Digital Product / decision / task |
| Harden the delivery workflow for service requests | WWWD | manufactureAndDeliver | Work Case / process improvement |

## 8. User Experience Rules

The human should see the work outcome, not the coordination plumbing.

Default surfaces should show:

- outcome title and summary
- decision scope
- portfolio context
- served persona
- current status
- active coworkers or owners
- open blockers and decisions
- evidence and receipts
- next human action, when needed

Operator/admin drill-down may show `WC-*`, leases, branch, worktree, PR, and raw evidence. Ordinary business users should not need to know those identifiers.

## 9. Relationship To Backlog

Backlog remains essential, but scoped.

- Platform backlog items are the right anchor for WWMD platform-development work.
- Business activity should anchor to company work objects, Work Cases, Digital Products, service requests, documents, or portfolio items.
- WSID craft work may anchor to a coworker, skill, profession material, decision, or the business activity it supports.

A Work Capsule may link to a backlog item when the outcome really is backlog work. It should not require a backlog item when the outcome is company business activity.

## 10. Acceptance Criteria

The design is successful when later implementation can prove:

1. A Work Capsule can coordinate activity without a backlog item.
2. A capsule can declare its decision scope as WWMD, WWWD, or WSID.
3. A capsule can declare its primary portfolio context.
4. A capsule can declare cross-portfolio service/dependency relationships, including manufacture-and-deliver recursion.
5. A capsule can point to a human-facing outcome anchor that is not a backlog item.
6. AI coworkers can be represented and governed as Digital Products under the Workforce / For Employees portfolio where appropriate.
7. User-facing surfaces render the outcome summary first and keep `WC-*` as admin/debug metadata.
8. Business decisions do not inherit platform doctrine as authority; they resolve against WWWD or escalate/defer.
9. Profession/craft decisions resolve against WSID when role doctrine exists.
10. The implementation reuses Work Capsule as the coordination plane instead of creating a parallel execution tracker.

## 11. Implementation Decisions

The first product slice is implemented by `docs/superpowers/plans/2026-06-30-layer-scoped-work-capsules.md`.

Resolved decisions:

1. `decisionScope`, `portfolioRole`, `servedPersona`, and `activityKind` are direct fields on `WorkCapsule`.
2. `activityKind` is a closed enum in code: `delivery`, `support`, `improvement`, `governance`, `launch-readiness`, `craft-judgment`, `lifecycle`, and `remediation`.
3. `outcomeAnchor` starts as a typed JSON envelope with `kind`, optional `id`, `label`, `url`, and `source`.
4. `servesPortfolioRoles` and `dependsOnPortfolioRoles` are JSON arrays validated against the four portfolio roles.
5. Backlog links remain optional anchors. A scoped Work Capsule can be valid without `backlogItemId` or `epicId`.
6. Work Control and Contributor Change Lanes project scope context; status and lane semantics remain unchanged.

## 12. Open Questions

1. Which existing Work Case models should become valid outcome anchors?
2. Which AI coworker records should be promoted into Digital Product records, and what lifecycle states apply?
3. Should the `forEmployees` display label become Workforce everywhere, or only on business/user-facing views?
4. How should WWMD/WWWD/WSID routing be enforced at capsule initiation time beyond MCP/input validation?
5. When should `outcomeAnchor` graduate from JSON to normalized relationships?

## 13. Implementation Posture

This spec should produce a small implementation plan, not a broad rewrite.

Recommended phases:

1. Read-model and schema audit: confirm existing Work Case, Digital Product, DecisionInteraction, service request, and coworker anchors.
2. Minimal typed scope storage: add the smallest durable scope shape that satisfies queryability.
3. MCP/API initiation update: create/adopt capsules with typed scope and optional outcome anchor.
4. UI projection: render outcome-first capsule cards with scope/portfolio badges.
5. Governance routing: select WWMD/WWWD/WSID based on scope before ambiguous decisions.

The implementation must remain compatible with the existing Unified Tracking work. This design extends the capsule; it does not replace it.

## 14. Internal References

- `docs/superpowers/specs/2026-06-07-business-operating-model-portfolio-wiring-design.md` - four-portfolio Business Operating Model and Workforce / Products and Services Sold wiring.
- `docs/superpowers/plans/2026-06-30-layer-scoped-work-capsules.md` - implementation plan for the first product slice.
- `docs/architecture/archetype-business-value-streams.md` - customer operational value streams and WWWD-vs-WWMD separation.
- `docs/superpowers/specs/2026-06-19-unified-build-studio-tracking-all-surfaces-design.md` - Work Capsule as the executor-agnostic coordination unit for development activity.
- `docs/user-guide/ai-workforce/decision-perspective.md` - WWMD, WWWD, and WSID decision scopes.
- `docs/architecture/2026-04-18-trusted-ai-agent-governance-white-paper.md` - AI agent inventory, identity, authority, oversight, evidence, and lifecycle governance framing.
- `packages/storefront-templates/src/types.ts` - `PortfolioRole` and `PortfolioDecomposition`.
