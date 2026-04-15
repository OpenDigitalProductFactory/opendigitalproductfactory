# Taxonomy-to-Action V4/V5 Design

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Date** | 2026-04-14 |
| **Author** | Codex + Mark Bodman |
| **Primary Objective** | Evolve the four-portfolio taxonomy from a descriptive workbook into an operating model the platform can execute against |
| **Execution Order** | `B` taxonomy revision first, then `C` platform gap analysis, then `A` research reconciliation |
| **Primary Inputs** | `docs/Reference/4_portfolio_Reworked_V3_Definitions_IT4IT.xlsx`, `docs/Reference/shift_to_digital_product.txt`, `docs/Reference/digital_product_portfolio_mgmt.txt`, existing ontology/product-centric platform specs |

## 1. Overview

This design defines a `V4` and `V5` evolution path for the four portfolios/taxonomies used by the platform.

The key conclusion is that the taxonomy can no longer act as a static classification tree. In this platform, it must become a `taxonomy-to-action` model that can drive:

- product placement
- offering and product-boundary guidance
- discovery attribution
- backlog and epic routing
- coworker specialization and governance
- workflow/tool activation
- cost, quality, and accountability views

`V4` is the operating revision. It should optimize for the platform's current small-to-mid scale reality while preserving a principled path to elaborate at larger enterprise scale.

`V5` is the elaboration revision. It should deepen selected areas proven necessary by real usage, discovery pressure, governance demands, and larger organizational scale.

## 2. Problem Statement

The current workbook and seeded taxonomy capture important theory from the digital-product and DPPM papers, but they are not yet fully operational for the platform as implemented.

Three gaps are now visible:

1. **Classification without enough action semantics**
   The taxonomy names domains, but often does not tell the platform what to do once something is mapped there.

2. **Portfolio drift and catch-all behavior**
   Large parts of the current taxonomy, especially under `For Employees`, are carrying cross-portfolio governance, architecture, planning, and coordination concepts that do not behave like ordinary employee-consumed products.

3. **Real-world attribution pressure**
   Discovery and runtime evidence produce entities like Grafana, Prometheus, network/topology elements, and shared platform services that do not always have an obvious or stable home in the current taxonomy.

An additional inflection point has emerged that the original taxonomy work did not fully address:

4. **AI coworker as mixed-workforce operating reality**
   The platform now treats AI coworkers as governed actors with roles, tool grants, audit, HITL supervision, and spend/performance implications. This changes how much human-only elaboration is required and introduces new action semantics that the taxonomy must express.

## 3. Current-State Constraints

### 3.1 Live-state verification failure

Per repository guardrails, live backlog/epic/portfolio state should be verified in the database before making current-state claims. That verification was attempted during this design session and failed because the configured database host was unreachable:

- Prisma error: `P1001`
- Host resolved from `DATABASE_URL`: `postgres`
- Result: live runtime backlog/portfolio state could not be confirmed from this workspace

Therefore, any current-state observations in this design are based on:

- workbook content
- repository specs
- current Prisma schema
- seed/reference data

They should be treated as `repository/design context`, not authoritative live runtime truth.

### 3.2 Signals from the current workbook and seed data

The current workbook and `packages/db/data/taxonomy_v3.json` already show unresolved design debt:

- notes such as `consider moving to the respective portfolio`
- notes such as `need to incorporate into the 4 portfolio approach`
- implicit duplication across portfolios
- governance and coordination capabilities mixed into ordinary business taxonomy branches
- inconsistent readiness for discovery attribution and Digital Product boundary decisions

This means `V4` is not just a refinement. It is a necessary normalization pass.

## 4. Design Goals

1. Keep the four portfolios as the primary top-level partition.
2. Preserve the `0..3` layering model so the taxonomy can elaborate or consolidate as scale requires.
3. Optimize `V4` for current platform use at small-to-mid scale, not for maximum enterprise detail by default.
4. Make each mature node capable of driving action in the platform.
5. Make Digital Product boundaries explicit enough to support discovery, governance, and cross-product coordination.
6. Add AI coworker semantics without collapsing human and AI workforce governance into one undifferentiated model.
7. Keep `V5` focused on deliberate elaboration, not delayed cleanup.

## 5. Non-Goals

- Replacing the four-portfolio model
- Flattening the taxonomy into a tag list
- Forcing maximum enterprise detail into all deployments
- Treating every discovered component as a Digital Product
- Treating AI coworkers as fully autonomous actors without human accountability

## 6. Design Summary

### 6.1 Recommendation

Adopt `V4` as a `taxonomy + action model`, not merely a cleaned-up workbook.

This keeps the four portfolios and the existing layered structure, but makes each mature node carry three kinds of truth:

1. **Classification truth**
   Where something belongs.
2. **Product truth**
   Whether it is a Digital Product, offering, dependency/resource, governance capability, or workforce capability.
3. **Execution truth**
   What the platform should do when the node is selected or when evidence maps to it.

### 6.2 Why this approach

This approach is preferred because it:

- preserves the original DPPM/Conway logic
- fits the platform's product-centric direction
- supports discovery attribution
- makes AI coworker governance first-class
- gives a clear path from `V4` operational fit to `V5` enterprise elaboration

## 7. V4 Operating Model

### 7.1 Core rule

In `V4`, a taxonomy row is not just a category. It is an `actionable operating context` for one or more Digital Products and their adjacent dependencies, offerings, workforce patterns, and workflows.

### 7.2 Semantics every mature node should carry

- `Portfolio context`
- `Digital product boundary hint`
- `Offering model hint`
- `Action model`
- `Discovery attribution hint`
- `Scale guidance`

### 7.3 Goldilocks scale posture

`V4` should target the middle of the road:

- small organizations should not be forced into unnecessary depth
- larger organizations should have a clear path to elaborate where justified
- offering considerations and deeper layers should act as structured elaboration hints, not as passive commentary

## 8. Structural Changes for V4

### 8.1 Conceptual node types

Even if the workbook remains tabular, `V4` should treat each node as one of:

- `product_domain`
- `shared_foundation`
- `coordination_governance`
- `discovery_attribution`
- `workforce_human`
- `workforce_ai`

This separation is necessary because current rows often mix product, resource, governance, and workforce concerns.

### 8.2 Portfolio boundary tightening

`V4` should tighten the meaning of the four portfolios:

- **Foundational**
  Shared technical capabilities, enabling services, infrastructure/platform building blocks, identity/data/network/observability foundations.

- **Manufacturing and Delivery**
  Capabilities used to build, integrate, test, release, deploy, operate, and control Digital Products.

- **For Employees**
  Products and capabilities primarily consumed by employees, plus the primary home for mixed-workforce governance because AI coworkers report to humans and remain HITL-governed.

- **Products and Services Sold**
  Externally consumed offers, subscriptions, entitlements, customer-facing digital products, and physical/digital hybrids sold or contracted externally.

### 8.3 Explicit coordination branches

`V4` should make cross-portfolio control-plane functions explicit instead of burying them in ordinary product rows:

- cross-portfolio investment planning
- digital product governance
- portfolio taxonomy management
- enterprise architecture and product-boundary management
- AI workforce coordination and spend arbitration

### 8.4 Explicit discovery-fit branches

`V4` should add explicit homes or attribution patterns for:

- observability platforms such as Grafana and Prometheus
- topology and network elements
- shared platform/runtime services
- integration and data-movement infrastructure
- discovered dependencies that are not themselves customer-facing products

### 8.5 Product-boundary guidance

For ambiguous domains, `V4` should state whether the row usually represents:

- a Digital Product
- a Service Offering
- a supporting dependency/resource
- a shared platform
- a coordination capability

This is the missing bridge between theory and platform execution.

## 9. AI Coworker and Mixed Workforce Model

### 9.1 AI as a cross-cutting operating attribute

Many taxonomy nodes should carry AI execution semantics:

- likely coworker archetypes
- generalist vs specialist vs coordinator/reviewer preference
- authority mode
- tool-grant expectations
- human-approval requirements

This allows smaller organizations to avoid over-elaborating the human org structure while still expressing specialization and coordination.

### 9.2 AI as a first-class managed domain

AI coworkers should also appear explicitly in the taxonomy because the platform now governs:

- AI identity and role
- tool grants and authority boundaries
- skills/specialization
- spend and provider/model usage
- feedback and quality loops
- performance and audit
- trust/oversight/escalation

### 9.3 Placement rule

Because every AI coworker reports to a human and remains HITL-governed, the primary taxonomy home should be under a broader workforce/governance area, not under an isolated technical branch.

Recommended structure:

- `For Employees`
  - `Workforce and Coordination`
    - `Human Workforce`
    - `AI Workforce`
    - `Shared Governance`

This keeps human and AI workforce governance parallel rather than collapsed.

### 9.4 Shared governance concepts

The sibling human/AI workforce model should align:

- identity and role
- RBAC and authority
- skills and specialization
- cost and spend
- feedback and performance
- oversight and escalation

But it should preserve distinctions such as:

- employment relationship vs agent governance profile
- compensation vs provider/model/tool spend
- manager chain vs supervising/approving authority chain

## 10. Taxonomy-to-Action Data Shape

### 10.1 Core fields

Each node in `V4` should be representable with the following structured data:

- `portfolio`
- `level_1`
- `level_2`
- `level_3`
- `node_type`
- `scope_pattern`
- `scale_hint`

### 10.2 Digital Product boundary fields

- `default_object_kind`
- `product_boundary_rule`
- `offering_model`
- `consumer_type`

### 10.3 Execution fields

- `default_owner_role`
- `default_accountable_human_role`
- `default_coworker_pattern`
- `coworker_governance_mode`
- `candidate_tools_or_grants`
- `default_workflows`
- `default_metrics`

### 10.4 Discovery fields

- `discovery_fit`
- `discovery_examples`
- `attribution_rule`

### 10.5 Elaboration fields

- `offering_considerations`
- `enterprise_elaboration_trigger`
- `notes_resolved_in_v4`

### 10.6 Workbook shape recommendation

To keep the workbook usable, `V4` should likely split content into multiple sheets:

1. `taxonomy_nodes`
2. `action_model`
3. `discovery_mapping`
4. `workforce_governance` (optional if the action sheet remains manageable)

This allows the taxonomy to remain readable while still becoming executable.

## 11. Concrete V4 Change Categories

### 11.1 Structural/editorial debt cleanup

`V4` must resolve:

- open-ended notes
- obvious naming/quality issues
- provisional portfolio placements
- duplication that was never normalized

This is required cleanup, not optional polish.

### 11.2 Re-home `For Employees` catch-all branches

`V4` should review current `For Employees` rows and distinguish:

- true employee-consumed product areas
- cross-portfolio governance and control-plane functions
- workforce/governance domains
- foundation or manufacturing domains that were parked there temporarily

### 11.3 Add missing discovery-ready foundation areas

The taxonomy should explicitly support attribution of:

- observability platforms
- telemetry pipelines
- network and topology services
- shared runtime/control planes
- integration/data movement platforms

### 11.4 Add explicit product/dependency distinctions

`V4` should encode whether each ambiguous area usually maps to:

- Digital Product
- Service Offering
- shared enabling platform
- discovered dependency/resource
- governance/control-plane function

### 11.5 Add workforce refactor

Create a deliberate workforce/governance area with:

- human workforce
- AI workforce
- shared governance constructs including RBAC, skills, spend, performance, feedback, oversight, escalation

### 11.6 Normalize action semantics

Repeated operational meaning currently trapped in prose should move into explicit fields.

## 12. V5 Strategy

`V5` should be an elaboration release, not a rescue release.

It should deepen only where `V4` usage proves additional structure is justified, such as:

- richer workforce governance
- more detailed offering and contract models
- more granular discovery/resource classes
- industry-specific overlays
- more formal cross-product boundary patterns

## 13. Platform Gap Areas to Analyze After V4 Taxonomy Design

Once the `V4` workbook proposal is prepared, the next design step (`C`) should map taxonomy needs to platform gaps in:

- Prisma schema and persisted metadata
- discovery attribution and entity classification
- product/offering/boundary workflows
- AI coworker governance and tool-grant routing
- route/UI surfaces for portfolio/product/workforce management
- backlog, epic, and workflow automation

## 14. Research Reconciliation to Analyze After Platform Gap Review

After the platform gap analysis, the final research pass (`A`) should reconcile the revised taxonomy to the source papers:

- where the original DPPM/shift-to-product theory still holds
- where the platform exercise exposed missing concepts
- how mixed human/AI workforce governance extends the original model
- where Conway's Law assumptions are softened or reshaped by AI coworkers rather than removed

## 15. Sources Used

- `docs/Reference/4_portfolio_Reworked_V3_Definitions_IT4IT.xlsx`
- `docs/Reference/shift_to_digital_product.txt`
- `docs/Reference/digital_product_portfolio_mgmt.txt`
- `packages/db/data/portfolio_registry.json`
- `packages/db/data/taxonomy_v3.json`
- `packages/db/prisma/schema.prisma`
- `docs/user-guide/portfolios/index.md`
- `docs/superpowers/specs/2026-03-21-digital-product-unified-ontology-design.md`
- `docs/superpowers/specs/2026-03-21-csdm6-digital-product-metamodel-and-ontology-design.md`
- `docs/superpowers/specs/2026-03-21-ea-digital-product-first-class-design.md`
- `docs/superpowers/specs/2026-04-02-product-centric-navigation-refactoring.md`

## 16. Decision

Proceed with:

1. `B1` decision memo/spec completion
2. `B2` `V4` workbook revision proposal and `V5` elaboration outline
3. `C` platform gap analysis
4. `A` research reconciliation memo
