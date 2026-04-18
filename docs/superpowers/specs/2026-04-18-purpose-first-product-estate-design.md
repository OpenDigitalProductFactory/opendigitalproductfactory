# Purpose-First Product Estate Design

**Date:** 2026-04-18  
**Status:** Draft  
**Author:** Codex navigation audit  
**Purpose:** Replace the current top-level inventory concept with a purpose-first, dependency-aware product estate model that keeps discovery, posture, and specialist analysis cohesive inside the platform rather than as disconnected scanner outputs.

## 1. Inputs

This spec extends and reinterprets:

- `docs/superpowers/specs/2026-04-17-portal-navigation-consolidation-design.md`
- `docs/superpowers/specs/2026-04-17-business-first-portal-workflow-consolidation-design.md`
- `docs/superpowers/specs/2026-03-11-phase-3a-inventory-route-design.md`
- `docs/architecture/platform-overview.md`

It is grounded in the current implementation:

- `apps/web/app/(shell)/inventory/page.tsx`
- `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx`
- `apps/web/app/(shell)/portfolio/product/[id]/page.tsx`
- `apps/web/app/(shell)/portfolio/product/[id]/inventory/page.tsx`
- `apps/web/components/product/ProductTabNav.tsx`
- `apps/web/components/portfolio/PortfolioNodeDetail.tsx`
- `apps/web/components/inventory/InventoryEntityPanel.tsx`
- `apps/web/lib/govern/permissions.ts`
- `apps/web/lib/tak/agent-routing.ts`
- `apps/web/lib/actions/discovery.ts`
- `apps/web/lib/actions/inventory.ts`
- `packages/db/prisma/schema.prisma`

Operational note:

- Live portfolio data could not be re-verified from the current shell session because database authentication failed during this design pass. References to the `Foundational` portfolio and existing portfolio structure in this spec are therefore grounded in the current codebase, schema, route behavior, and architecture docs rather than a fresh runtime query.

## 2. Problem Statement

The current inventory experience is solving the wrong user problem at the wrong layer.

Today:

- `Inventory` is still treated as a durable destination in shell/workspace navigation.
- `/inventory` mixes discovery operations, attribution review, topology plumbing, and digital product listing in one page.
- product-level inventory already exists under `/portfolio/product/[id]/inventory`, which is closer to where users expect estate information to live.
- the user-facing framing is still closer to a traditional CMDB or scanner result list than to Digital Product Portfolio Management.

That creates four failures.

### 2.1 Navigation failure

`Inventory` competes with `Portfolio` as if it were a peer domain, even though the platform already treats portfolios and taxonomy as the primary meaning structure for digital products.

### 2.2 Context failure

Traditional discovery tools answer:

- what was found
- where it was found
- whether it appears vulnerable

They often fail to answer:

- why it exists
- what digital product or purpose area it supports
- what depends on it
- what breaks if it fails

The user explicitly wants the platform to solve the second set of questions.

### 2.3 Model failure

The current implementation already contains the raw ingredients for a stronger model:

- `InventoryEntity` for discovered elements
- `InventoryRelationship` for dependency edges
- `TaxonomyNode` and `DigitalProduct` for purpose and ownership
- `DiscoveredSoftwareEvidence` for vendor/version evidence
- `PortfolioQualityIssue` for posture and quality signals

But the UI still foregrounds technical discovery output instead of purpose, dependency, and impact.

### 2.4 Specialist failure

Historically, discovery, vulnerability, and inventory tools behave like separate silos. Each one creates a partial list. Humans have to reconstruct the full story manually.

This platform should do the opposite:

- keep specialist functions
- but make them operate on one shared estate model
- and present one coherent explanation to the human

## 3. Design Goals

This design should:

1. Make portfolio purpose the primary organizing principle.
2. Treat technical classification as valid but secondary.
3. Make dependencies and blast radius first-class.
4. Keep the data model lean enough for a small human team.
5. Preserve enough rigor to scale into larger, cross-department environments.
6. Keep raw discovery evidence available without making it the main UX.
7. Integrate specialists into one cohesive platform story instead of siloing them.

This design must not:

1. Turn DPF into a sprawling CMDB clone.
2. Create a new parallel asset truth separate from the existing inventory/discovery models.
3. Force users to navigate by scanner output or hardware categories.
4. Guess at manufacturer, version, support, or vulnerability status when the evidence is weak.

## 4. Research & Benchmarking

### 4.1 Open source systems reviewed

#### NetBox

Sources:

- [DeviceRole - NetBox Documentation](https://netbox.readthedocs.io/en/stable/models/dcim/devicerole/)
- [Platform - NetBox Documentation](https://netbox.readthedocs.io/en/feature/models/dcim/platform/)
- [Planning - NetBox Documentation](https://netbox.readthedocs.io/en/stable/getting-started/planning/)
- [InventoryItem - NetBox Documentation](https://netbox.readthedocs.io/en/stable/models/dcim/inventoryitem/)

What it teaches:

- manufacturer, platform, and device role are useful normalized concepts
- technical classification matters for management and filtering
- infrastructure relationships benefit from explicit modeling

What it does not solve well for this portal:

- NetBox is fundamentally infrastructure-first
- its model is excellent for intended-state documentation and operational inventory, but weak as a purpose-first digital product management surface
- it reinforces the idea that technical form is primary

Pattern adopted:

- keep normalized technical identity where it helps with query, filtering, and display

Pattern rejected:

- using infrastructure type as the primary human navigation model

#### Backstage Software Catalog

Sources:

- [Backstage Software Catalog](https://backstage.io/docs/features/software-catalog/)
- [Technical overview](https://backstage.io/docs/overview/technical-overview)
- [Descriptor Format of Catalog Entities](https://backstage.io/docs/features/software-catalog/descriptor-format)
- [RELATION_DEPENDS_ON](https://backstage.io/docs/reference/catalog-model.relation_depends_on)

What it teaches:

- entities should carry ownership, system context, and resource relationships
- `dependsOn` / `dependencyOf` style relations are foundational to understanding impact
- infrastructure and software resources become much more useful when attached to a larger system model

Pattern adopted:

- purpose and ownership must sit above raw technical elements
- dependency relations should be first-class and queryable

Pattern rejected:

- maintaining separate product catalog truth and technical inventory truth with no shared context

#### Dependency-Track

Sources:

- [Dependency-Track Introduction](https://docs.dependencytrack.org/)
- [Dependency-Track overview](https://dependencytrack.org/)
- [Dependency-Track Best Practices](https://docs.dependencytrack.org/best-practices/)

What it teaches:

- BOMs and discovered component facts should be treated as evidence, not opinion
- vulnerability analysis becomes far more useful when tied to a shared component record
- findings should not remain siloed in one specialist tool

Pattern adopted:

- version, component, and vulnerability posture should be evidence-driven
- the user-facing estate surface should summarize posture from the shared model, not from one tool's private list

Pattern rejected:

- scanner-specific vulnerability lists as the main operating surface

### 4.2 Commercial systems reviewed

#### ServiceNow CSDM and Service Mapping

Sources:

- [Common Services Data Model](https://www.servicenow.com/now-platform/common-services-data-model.html)
- [CSDM docs landing page](https://www.servicenow.com/docs/r/yokohama/servicenow-platform/common-service-data-model-csdm/csdm-landing-page.html)
- [Service Mapping](https://www.servicenow.com/products/service-mapping.html)
- [CMDB design guidance](https://blogs.servicenow.com/content/dam/servicenow-assets/public/en-us/doc-type/resource-center/white-paper/wp-cmdb-design-guidance.pdf)

What it teaches:

- the common model matters more than the individual discovery source
- technical CIs become more valuable when mapped to services and service delivery context
- discovery without service context leads to noisy, low-trust inventories

Pattern adopted:

- DPF should maintain one common product-estate model and let specialists enrich it

Pattern rejected:

- presenting discovered items without a product, service, or purpose frame

#### Device42

Sources:

- [Application Dependency Mapping](https://www.device42.com/dependency-mapping/)
- [Dependency diagrams](https://www.device42.com/dependency-diagrams/)
- [What is Device42](https://docs.device42.com/what-is-device42/)
- [Application Dependency Mapping docs](https://docs.device42.com/apps/enterprise-application-dependency-mapping/)

What it teaches:

- discovery becomes materially more useful once application groups and dependency maps exist
- manufacturer, software, version, and dependency diagrams belong together
- users need both topology and impact, not just inventory rows

Pattern adopted:

- the estate surface must show dependency structure and item detail together

Pattern rejected:

- showing only flat discovered element lists when dependency maps are available

#### runZero

Sources:

- [Exposure management](https://help.runzero.com/docs/exposure-management/)
- [runZero vulnerability management collateral](https://www.runzero.com/uploads/documents/product-pdfs/2025_03_COLLATERAL_SB_Vulnerability-Management.pdf)

What it teaches:

- unified discovery across IT, OT, IoT, mobile, and cloud is valuable
- combining active, passive, and integrated evidence improves asset confidence
- vulnerability and exposure context must be built on top of a unified inventory

Pattern adopted:

- support multiple evidence sources feeding one estate record

Pattern rejected:

- treating the presence of broad discovery coverage as sufficient business context

### 4.3 Domain anti-patterns to avoid

1. **CMDB sprawl**
   - endless subtype modeling
   - dozens of partially populated fields
   - humans maintaining classification manually because the system got too clever

2. **Scanner silos**
   - discovery, vulnerability, version, and lifecycle tools each holding separate truths

3. **Hardware-first UX**
   - forcing users to navigate by device category before purpose or impact

4. **Unqualified certainty**
   - displaying guessed manufacturer, version, lifecycle, or vulnerability data as authoritative

5. **Topology without meaning**
   - pretty network graphs that do not explain why a dependency matters to a portfolio or product

## 5. Core Decision

The platform should replace the concept of a top-level `Inventory` destination with a **purpose-first product estate model**.

That means:

- discovery remains important
- technical classification remains valid
- vulnerability and lifecycle posture remain important

But all three become subordinate to a stronger question:

> What role does this element play in the portfolio, what does it support, and what depends on it?

This platform therefore adopts:

**One shared estate model, many specialist lenses.**

Not:

**Many separate inventory tools living under one shell.**

## 6. Shared Estate Model

### 6.1 Canonical models

Use the existing schema as the canonical backbone:

- `Portfolio` = durable business grouping
- `TaxonomyNode` = purpose and capability placement
- `DigitalProduct` = owned product context
- `InventoryEntity` = canonical technical estate element
- `InventoryRelationship` = canonical estate dependency edge
- `DiscoveredSoftwareEvidence` = raw software/vendor/version evidence
- `PortfolioQualityIssue` = canonical posture and quality signal surface

### 6.2 Model layering

Each discovered or managed element should be understood in five layers.

#### Layer 1: Purpose

- which taxonomy node it belongs to
- why it exists
- which portfolio/product context it serves

Examples:

- connectivity
- facility
- security
- media
- shared platform service

#### Layer 2: Technical form

- what it is technically

Examples:

- router
- access point
- camera
- host
- container
- service
- database
- package

#### Layer 3: Dependency role

- what it depends on
- what depends on it
- whether it is a shared upstream dependency or a leaf capability element

#### Layer 4: Operational posture

- vendor / manufacturer
- observed version
- normalized version
- latest known version if available
- support lifecycle state
- update available / version drift
- vulnerability or advisory posture

#### Layer 5: Evidence quality

- last seen
- source of evidence
- attribution confidence
- whether the data is directly observed or inferred

### 6.3 Keep the model lean

Do not create a large subtype hierarchy of CMDB records.

The model should distinguish between:

- **cross-cutting summary data** that users need to filter/sort/report on
- **type-specific technical detail** that should stay in `properties` or source evidence

Recommended normalized, cross-type fields to add to `InventoryEntity`:

- `technicalClass`
- `iconKey`
- `manufacturer`
- `productModel`
- `observedVersion`
- `normalizedVersion`
- `latestKnownVersion`
- `supportStatus`
- `supportEndsAt`

Keep type-specific details in `properties`, for example:

- MAC addresses
- radio details
- camera lens or resolution data
- garage door channel data
- network ports and protocol specifics

This preserves queryability without turning the schema into a subtype maze.

### 6.4 Posture signals

Use `PortfolioQualityIssue` as the canonical posture issue surface in the first phase.

That means it should carry issues such as:

- vulnerability or advisory findings
- stale discovery
- low-confidence attribution
- unsupported lifecycle status
- update drift
- broken or stale dependency mapping

If posture scale later requires high-volume finding storage, introduce a dedicated finding model in a later phase. Do not do that in the initial refactor.

## 7. Relationship Model

Dependencies are the point, not an optional decoration.

`InventoryRelationship.relationshipType` should move toward a controlled vocabulary that explains both topology and impact.

Recommended core relationship verbs:

- `connected_to`
- `depends_on`
- `runs_on`
- `hosts`
- `calls`
- `stores_data_in`
- `monitored_by`
- `authenticated_by`
- `managed_by`
- `secured_by`

Design rule:

- `connected_to` explains adjacency or transport
- `depends_on` explains operational reliance

This distinction matters. A Wi-Fi router may be network-adjacent to many devices, but it is also a shared dependency whose failure affects security, facility, and media functions.

## 8. Information Architecture and Routes

### 8.1 Global navigation

Remove `Inventory` from:

- the app rail
- the workspace tiles
- the durable `Products` navigation group

`Portfolio` remains the primary home for product estate understanding.

### 8.2 Discovery operations

The current `/inventory` page should be demoted and reframed as:

- label: `Discovery Operations`
- area: `Platform > Tools & Services`
- recommended canonical route: `/platform/tools/discovery`

During migration:

- `/inventory` may remain as a redirect or legacy alias
- but it should stop being presented as a top-level destination

`Discovery Operations` becomes the home for:

- discovery sweep execution
- discovery connection setup
- connection testing
- attribution review queue
- normalization review
- subnet or collector views
- low-level topology troubleshooting

### 8.3 Portfolio node surfaces

Portfolio and taxonomy nodes should become the primary human-facing estate view.

Recommended node-level surfaces:

- `Overview`
- `Products`
- `Dependencies`
- `Posture`

Examples:

- `Foundational > Connectivity`
- `Foundational > Security`
- `Foundational > Facility`
- `Foundational > Media`

Each node view should answer:

- what belongs here
- why it belongs here
- what shared dependencies matter
- what is at risk

### 8.4 Product surfaces

The current product `Inventory` tab should evolve into **Dependencies & Estate**.

Preferred long-term label:

- `Dependencies & Estate`

Preferred short-term path strategy:

- keep `/portfolio/product/[id]/inventory` as the route during migration
- change the UI label and page framing first
- only rename the route path later if it remains worth the churn

Within the product page, this surface should foreground:

- purpose and product role
- upstream dependencies
- downstream impact
- posture summary
- evidence confidence

Not:

- a flat technical list as the opening story

## 9. UX Surface Design

### 9.1 Portfolio node page

Each portfolio or taxonomy node should feel like a managed purpose area, not a passive category page.

Recommended structure:

#### Summary strip

- product count
- shared dependency count
- unsupported items
- vulnerable items
- stale or low-confidence items

#### Purpose groupings

- elements grouped by taxonomy meaning first

#### Dependency map

- critical upstream services
- high-blast-radius shared dependencies
- downstream affected areas

#### Posture panel

- unsupported or end-of-support items
- known vulnerability/advisory issues
- update drift
- attribution or topology quality issues

### 9.2 Product Dependencies & Estate page

Each product should have a coherent estate view with four panels:

1. `Role in product`
   - what each element does in the product

2. `Dependencies`
   - upstream and downstream edges
   - blast radius explanations

3. `Posture`
   - version, lifecycle, support, update, vulnerability state

4. `Evidence`
   - last seen
   - confidence
   - discovery source

### 9.3 Discovery Operations page

This is the specialist workspace.

Recommended panels:

- sweep status and connection health
- discovery connections
- attribution queue
- topology/troubleshooting view
- normalization or evidence gaps
- promotion quality issues

This page is for specialists and operators who need to manage the mechanics of discovery. It is not the primary place ordinary users should go to understand the estate.

### 9.4 Item detail card

Every estate item should have a compact, high-signal identity card.

Required visible details:

- icon
- display name
- purpose/taxonomy placement
- product or portfolio context
- dependency role
- manufacturer
- current observed version
- support status
- posture indicator
- last seen
- evidence confidence

## 10. Icon and Detail Strategy

### 10.1 Icon rules

Icons should represent technical form clearly without trying to replace the taxonomy.

Use a small controlled icon set keyed by `technicalClass`, for example:

- connectivity
- compute/runtime
- storage/data
- security/control
- facility/device
- media/experience
- external service
- observability

Do not use:

- emojis
- arbitrary vendor logos as the primary identifier
- overly specific icon variants for every subtype

The icon tells the user what kind of thing it is.
The taxonomy tells the user why it exists.

### 10.2 Manufacturer and product identity

When available, show:

- manufacturer
- product/model
- platform/software identity

When not available:

- show `Unknown`
- do not infer certainty the system does not have

### 10.3 Version accuracy

Version display must be evidence-driven.

Show clearly separated states:

- `Observed version`
- `Normalized version`
- `Latest known version` when available
- `Confidence` when version is inferred or stale

Never present an inferred version as if it were directly observed.

### 10.4 Support lifecycle

Keep support lifecycle simple and durable:

- `supported`
- `attention_needed`
- `out_of_support`
- `unknown`

The user-facing labels can be friendlier, but the state machine should stay small.

## 11. Specialist Design

### 11.1 User-facing specialist

Repurpose the current `inventory-specialist` into a **Digital Product Estate Specialist**.

Current mismatch:

- `/inventory` already routes to `inventory-specialist`
- but the current prompt frames it as a generic `Product Manager`
- that prompt is lifecycle-centric rather than purpose/dependency/posture-centric

New primary job:

- explain product estate in business and product terms
- reason about dependency impact
- help users understand posture and confidence
- guide attribution and discovery quality review where needed

### 11.2 Specialist reasoning order

The specialist should reason in this order:

1. purpose in taxonomy
2. owning product / portfolio
3. dependency role
4. blast radius and operational impact
5. posture
6. confidence and freshness
7. raw technical classification

This order is deliberate. It prevents the specialist from answering like a scanner report.

### 11.3 Prompt rules

The specialist prompt should enforce:

- explain why an item exists before listing what it is
- use product and portfolio language first
- mention technical classification as supporting context
- never guess manufacturer, version, support, or vulnerability state
- clearly label inferred or stale conclusions
- explain blast radius in plain language

### 11.4 Skills menu

Recommended user-facing skills:

- `What breaks if this fails?`
- `Show upstream dependencies`
- `Show downstream impact`
- `Review taxonomy placement`
- `Check support posture`
- `Check version confidence`
- `Review discovery quality`
- `Run discovery sweep`

### 11.5 Underlying specialist composition

Long-term, the user-facing estate specialist can be backed by narrower specialist functions, but they should not appear as separate inventory products to the human.

Useful internal lenses:

- discovery specialist
- identity/version specialist
- dependency specialist
- taxonomy specialist
- posture specialist

Outwardly, this should still feel like one coherent platform capability.

## 12. Tooling Direction

### 12.1 Existing actions to preserve and reuse

The current platform already has useful operational primitives:

- discovery sweep
- connection configuration
- connection testing
- attribution acceptance
- taxonomy reassignment
- entity dismissal

These should be preserved and moved under the new `Discovery Operations` framing.

### 12.2 Proposed new tool surfaces

Add or expose estate-oriented tools that operate on the shared model:

- `summarize_estate_dependencies(scope)`
- `explain_blast_radius(entityId)`
- `summarize_estate_posture(scope)`
- `review_estate_attribution(entityId)`
- `validate_version_confidence(entityId)`
- `list_discovery_connections()`
- `run_discovery_sweep()`

Tool design rule:

- tools should read from and write to the shared estate context
- tools should not create separate, private specialist inventories

## 13. Governance Rules

1. **Discovery is evidence, not the user-facing truth.**
2. **Taxonomy provides meaning.**
3. **Dependencies explain impact.**
4. **Posture summarizes risk and supportability.**
5. **Confidence must be explicit when data quality is incomplete.**
6. **Do not add new normalized fields unless users need to query/filter/report on them cross-type.**
7. **Keep type-specific details in `properties` or raw evidence.**

## 14. Migration Plan

### Phase 1. Reframe and demote

- remove `Inventory` from shell/workspace durable nav
- add `Discovery Operations` under `Platform > Tools & Services`
- keep `/inventory` as legacy alias or redirect
- update user-facing copy from `Inventory` to `Product Estate` / `Discovery Operations` depending on context

### Phase 2. Product estate framing

- relabel product `Inventory` as `Dependencies & Estate`
- update product page summaries to show posture and dependency context
- add estate identity cards with icon/manufacturer/version/support signals

### Phase 3. Portfolio node estate views

- add node-level `Overview`, `Products`, `Dependencies`, and `Posture` surfaces
- introduce shared dependency and blast radius summaries

### Phase 4. Specialist prompt and skills refactor

- repurpose `inventory-specialist`
- update route prompts and skills
- align coworker guidance with purpose/dependency/posture framing

### Phase 5. Schema refinement

- add minimal normalized cross-type detail fields to `InventoryEntity`
- reuse `PortfolioQualityIssue` for posture signals
- tighten `InventoryRelationship.relationshipType` vocabulary

## 15. Success Criteria

This refactor is successful when:

- users navigate to estate information through `Portfolio`, not a top-level `Inventory` silo
- portfolio nodes explain purpose and dependency impact, not just discovered things
- product pages show estate role, posture, and blast radius, not only flat entity lists
- the specialist explains items in context rather than echoing scanner output
- manufacturer, version, lifecycle, and posture are visible where evidence exists
- the system stays small enough for a 1-10 person human team to manage confidently
- the design still scales when shared dependencies span multiple products or organizational areas

## 16. Final Decision

DPF should evolve from a traditional inventory/discovery surface into a **purpose-first digital product estate platform**.

The correct model is:

- portfolios and taxonomy provide meaning
- technical discovery provides evidence
- dependency mapping provides impact
- posture signals provide actionability
- specialists operate as coordinated lenses over one shared estate model

This direction preserves the value of discovery, vulnerability, lifecycle, and topology specialists without repeating the historical failure mode of siloed tools that produce disconnected lists with no explanation of why those things are there.
