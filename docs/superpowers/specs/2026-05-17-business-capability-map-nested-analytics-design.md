# Business Capability Map Nested Analytics Design

**Status:** Draft for human review
**Date:** 2026-05-17
**Owner:** Enterprise Architecture surface
**Backlog:** `EP-BIZ-CAP`, refinement item `BI-8EFA2370`
**Route:** `/portfolio/architecture`

## Purpose

The Business Capability Map needs to behave like a Business Architecture artifact, not like a generic list of classifications. The first implementation in this branch creates the model, authoring surface, maturity fields, trace links, and IT4IT alignment. This refinement specifies the next UX and view-model pass: a nested L1/L2/L3 capability heat map that can light up operational evidence for strategy, planning, impact, and gap analysis.

This spec does not replace the `BusinessCapability` model with `TaxonomyNode`, `EaElement`, product inventory, or backlog records. Those records remain traceability targets. A capability is the stable, organization- and technology-agnostic statement of what the enterprise must be able to do. Operational details explain how well the capability is supported, where change is planned, and where gaps exist.

## Scope

In scope:

- Nested capability-map browsing with L1 bands, L2 capability tiles, and optional L3 sub-capability tiles.
- Authoring that supports at least L1 and L2 creation, while preserving L3 where present.
- Maturity overlays showing current state, target state, and gap severity.
- Operational overlays derived from trace links to `TaxonomyNode`, `DigitalProduct`, `BacklogItem`, and `EaElement`.
- IT4IT value-stream alignment using the platform's existing value-stream slugs.
- A capability detail panel that keeps operational detail available without overcrowding the map.

Out of scope for this refinement:

- Importing BIZBOK, ArchiMate, TOGAF, or IT4IT catalogs wholesale.
- Adding a fourth capability level.
- Turning the map into a freeform diagram canvas.
- Replacing existing taxonomy, product, backlog, or EA graph models.
- Adding new schema before implementation verifies that the existing trace-link model cannot support the required overlays.

## Standards Reading

The standards are used as language and pattern references, not as imported content.

- Business Architecture Guild / BIZBOK: capability maps are stable business architecture views of what the business can do. The public BIZBOK glossary also reinforces capability-map levels and tiers as structural devices for representation.
- ArchiMate 3.2: the capability concept belongs in the strategic/motivation side of the architecture language and can be realized by other architecture elements. DPF should preserve that separation: a capability is not the application, team, process, taxonomy label, or backlog item that supports it.
- TOGAF capability-based planning: capability assessment should create line of sight from desired outcomes to increments of change, not stop at a decorative heat map.
- IT4IT v3.0.1: IT4IT is valuable here as a value-stream alignment frame for digital product management. DPF already has the canonical slugs `evaluate`, `explore`, `integrate`, `deploy`, `release`, `consume`, and `operate`; the capability map should reuse them.

Reference URLs:

- Business Architecture Guild public glossary excerpt: https://www.businessarchitectureguild.org/resource/resmgr/bizbok_10/glossary_v10_final.pdf
- Business Architecture Guild public metamodel whitepaper: https://www.businessarchitectureguild.org/resource/resmgr/whitepapers/Business_Architecture_Metamo.pdf
- The Open Group ArchiMate 3.2 licensed downloads: https://www.opengroup.org/archimate-licensed-downloads
- The Open Group capability-based planning guide: https://publications.opengroup.org/g193
- Public TOGAF capability-based planning chapter mirror used because the current Open Group online chapter requires sign-in: https://coe.qualiware.com/resources/togaf/9-1/part3-admguide/capability-based-planning/
- The Open Group IT4IT: https://www.opengroup.org/it4it
- IT4IT 3.0.1 publication page: https://publications.opengroup.org/c24a

## Research And Benchmarking

### Open-Source And Open-Standard Tooling

**Archi / ArchiMate tooling.** Archi is a free, open-source ArchiMate modeling tool and is useful as the standard-modeling benchmark. It shows why DPF should preserve ArchiMate-style semantics and model exchange thinking, but it also highlights what DPF should not do in the portal: the product surface should not require users to draw a formal EA diagram before they can assess capabilities.

Adopt:

- Respect ArchiMate-inspired terms and relationships.
- Keep the map interoperable with EA concepts such as capability, realization, and composition.
- Keep hierarchy deterministic and inspectable.

Reject:

- Forcing first-time users into a notation-heavy diagram editor.
- Treating `EaElement` as the only persisted capability representation.

Reference: https://github.com/archimatetool/archi

**Essential Architecture and repository-style EA tools.** Repository-driven EA tools show the value of separating the underlying model from the views and dashboards drawn from it. The relevant pattern is not a giant ontology for the first slice; it is a clean model with multiple projections: heat map, traceability view, product impact view, and planning view.

Adopt:

- Keep Business Capability data separate from the rendered map view.
- Treat heat maps as computed views over repository facts.
- Let capability links feed analysis instead of becoming tile text noise.

Reject:

- Over-modeling assessment dimensions before DPF has real usage evidence.
- Deep metamodel customization in the first nested-map pass.

Reference: https://enterprise-architecture.org/

**Structurizr DSL.** Structurizr is not a business architecture tool, but it is a strong benchmark for model/view separation and readable hierarchical modeling. Its lesson for DPF is that the map should be deterministic from structured data, with view-specific layout helpers rather than hand-positioned shapes.

Adopt:

- Keep the map generated from the canonical capability tree.
- Put layout and overlay derivation into tested helpers.
- Avoid manually authored coordinates for the first refinement.

Reject:

- Importing C4 semantics into the business capability model.

Reference: https://docs.structurizr.com/dsl

### Commercial Benchmarks

**SAP LeanIX.** LeanIX emphasizes three-level capability maps, application alignment, current versus target assessment, and technology rationalization. It also calls out common guardrails: define what, not how; keep the map stable; and avoid going past three levels because that usually slips into process detail.

Adopt:

- Three-level maximum.
- Heat maps for assessment and target-state communication.
- Application/product and backlog evidence as overlays.
- Capability tiles that stay readable before operational drill-down.

Reject:

- Using reference catalogs as DPF seed truth without DPF-specific validation.

References:

- https://www.leanix.net/en/sap-leanix-business-capability-map
- https://www.leanix.net/en/wiki/ea/business-capability-assessment

**Ardoq.** Ardoq frames business capability modeling as the bridge between strategic "what" and tactical "how", with graph relationships and conditional heat maps. That aligns well with DPF because traceability links already connect capabilities to product, backlog, taxonomy, and architecture facts.

Adopt:

- Graph-backed operational evidence.
- Conditional overlays instead of one permanent visual meaning.
- Questions-driven views: what do we do, how is it implemented, where is it differentiating or weak?

Reject:

- Making every operational dimension required before a capability can exist.

References:

- https://help.ardoq.com/en/articles/44051-getting-started-with-business-capability-modeling
- https://www.ardoq.com/

**Bizzdesign and ServiceNow EA/APM.** Bizzdesign emphasizes map, assess, plan, and control as a capability-based planning cycle. ServiceNow's EA/APM documentation exposes hierarchy maps and connects business capabilities to application portfolio analysis. The shared pattern is that the capability map is the planning and assessment surface, while applications and work items supply evidence.

Adopt:

- Map, assess, plan, and control as the DPF surface rhythm.
- A hierarchy map with drill-down into applications/products and backlog work.
- Planning overlays that distinguish "gap with no work" from "gap with active work".

Reject:

- Treating application portfolio health as the capability score itself.
- Flattening capability management into APM inventory management.

References:

- https://bizzdesign.com/blog/an-approach-how-to-assess-business-capabilities/
- https://www.servicenow.com/docs/r/application-portfolio-management/application-portfolio-management-home.html?contentId=bdaRIwG7igbibO6QJdfo2Q

## Existing DPF Audit

The current branch already added the right model spine:

- `BusinessCapability` owns stable capability identity, hierarchy, maturity, status, ordering, and IT4IT value-stream alignment.
- `BusinessCapabilityTraceLink` links capabilities to `TaxonomyNode`, `DigitalProduct`, `BacklogItem`, and `EaElement`.
- `TaxonomyNode` remains the classification system.
- `DigitalProduct` remains the product portfolio anchor.
- `BacklogItem` remains the planning and delivery work anchor.
- `EaElement` remains the architecture graph anchor.
- `ValueStreamTeam.valueStream` already uses the IT4IT value-stream slugs, so the capability map should keep using those strings rather than introducing a parallel value-stream taxonomy.

The current UI is functional but too flat for the target experience. It stacks L1 sections, renders L2 cards, and lists L3 rows, but it does not yet feel like the nested capability-map examples. Trace links are rendered inside every card, which makes operational evidence visible but risks overpowering the map. The next pass should move from "cards with evidence lists" to "nested heat-map tiles with evidence overlays and drill-down."

## Design Options

### Option A: Nested Heat Map With Overlay Modes

Render the capability map as a deterministic nested grid:

- L1 family bands define the major capability areas.
- L2 tiles sit inside each L1 band.
- L3 sub-capabilities render as smaller nested tiles or chips inside L2 tiles.
- Overlay modes change the tile signal without changing the underlying capability definition.

This is the recommended option. It matches the user's screenshots, fits the existing model, and keeps the map readable.

### Option B: EA Diagram Canvas

Represent capabilities as `EaElement` nodes in a diagram-like canvas and use EA relationships for all traceability.

This is useful later for formal architecture views, but it is not the right first refinement. It would conflate the business capability product surface with the generic EA graph and would make basic authoring harder.

### Option C: Operational Intelligence Model Expansion

Add assessment tables, scoring dimensions, time-phased roadmaps, ownership, confidence, and financial metrics now.

This may become necessary, but it is premature. The existing model can support the next nested-map pass. DPF should learn from real usage before adding assessment schema.

## Recommended Product Design

### Page Structure

The `/portfolio/architecture` first screen should be a working EA surface, not a landing page.

- Header: "Business Capability Map", compact summary metrics, and a create action.
- Control bar: overlay selector, maturity legend, IT4IT filter, level visibility toggle, and search.
- Map canvas: nested L1/L2/L3 heat map.
- Detail panel: selected capability, maturity edit, trace links, operational evidence, and planning prompts.
- Authoring panel: create/edit capability with minimum fields first and advanced fields behind disclosure.

The map should be visually primary. Forms should not consume the top of the page when users are browsing or doing planning analysis.

### Nested Map Layout

The nested map should follow these rules:

- L1 families render as full-width or row-spanning bands depending on viewport and child count.
- Each L1 band has a title, optional description, maturity summary, and child count.
- L2 capabilities render as stable tiles inside the family.
- L3 sub-capabilities render within their parent L2 tile when space allows; on narrow screens they collapse into a count plus expandable list.
- Empty L1 and L2 containers are allowed but visibly incomplete.
- Tile dimensions should use responsive grid constraints and minimum heights so hover states, labels, chips, and counts do not shift the layout.

The visual target is closer to the user's provided examples: parent containers visibly hold child capability tiles. The UI should not look like unrelated cards separated by page whitespace.

### Overlay Modes

Overlay modes should be explicit because a capability can have several strategic meanings.

1. **Maturity Gap**: default. Color and label come from current versus target maturity.
   - `aligned`: current maturity is greater than or equal to target.
   - `watch`: target exceeds current by 1.
   - `gap`: target exceeds current by 2 or more.
2. **Operational Coverage**: shows whether the capability has linked products, architecture elements, taxonomy classifications, and backlog items.
3. **Planning Impact**: highlights capabilities with open or in-progress backlog work, gaps without work, and work linked to capabilities already aligned.
4. **IT4IT Alignment**: shows value-stream tags and optional filtering by `evaluate`, `explore`, `integrate`, `deploy`, `release`, `consume`, and `operate`.

The implementation should use both color and text/icon labels so the heat map does not depend on color alone.

### Traceability Treatment

Trace links should not be dumped into every tile by default. The map should show compact evidence signals:

- Taxonomy: count and classification icon.
- Products: count and product icon.
- Backlog: count plus open/in-progress indicator.
- Architecture: count and architecture icon.

Selecting a capability opens the detail panel with full grouped links, relationship labels, notes, and destination URLs. This preserves the strategic map while still making operational details immediately available.

### Strategic And Gap Analysis Behavior

The detail panel should answer four planning questions without requiring the user to reconstruct the graph manually:

- What is the target state for this capability?
- What supports it today?
- What work is planned or active?
- What gaps remain unsupported by products, architecture, or backlog work?

For the first refinement, these answers can be derived from existing maturity fields and trace links. Later slices may add richer assessment history, ownership, time horizons, or investment measures if usage proves the need.

## View-Model Design

No new schema is required for the next refinement. Add view-model helpers around the existing data shape.

Recommended additions:

- `CapabilityOverlayMode = "maturity" | "coverage" | "planning" | "it4it"`.
- `CapabilityEvidenceSummary` with counts for taxonomy, products, backlog, architecture, active backlog, and missing evidence.
- `CapabilityOverlayState` with `tone`, `label`, `shortLabel`, `description`, and `sortWeight`.
- `buildCapabilityEvidenceSummary(node)`.
- `deriveCapabilityOverlayState(node, mode)`.
- `buildCapabilityMapRows(tree)` if deterministic row grouping is needed after testing real child counts.

The `getBusinessCapabilityMapData()` query should enrich backlog trace links with status where possible, because planning impact needs to distinguish open/in-progress work from done/deferred work. If the current select shape does not include backlog status, add it as a read-model field only.

## UI Implementation Guidance

Later implementation must follow DPF theme rules:

- Use `var(--dpf-text)`, `var(--dpf-muted)`, `var(--dpf-surface-1)`, `var(--dpf-surface-2)`, `var(--dpf-border)`, `var(--dpf-accent)`, and semantic status tokens.
- Do not use hardcoded hex, Tailwind gray/white/black text colors, or inline literal colors.
- Prefer icons from `lucide-react`.
- Use cards only for repeated items, modals, and framed tools. The map itself should be a full work surface with nested containers.
- Keep text inside tiles small, stable, and wrapped. Avoid viewport-width font scaling.
- Keep trace detail in the panel rather than forcing every link into the map tile.

## Accessibility And Responsiveness

- L1 bands should be semantic sections with labelled headings.
- Tiles should be keyboard reachable and expose selected state.
- Overlay controls should be real buttons, tabs, or segmented controls.
- Color-coded heat states must include text labels such as "Gap", "Watch", or "Aligned".
- Mobile should stack L1 bands vertically and collapse L3 sub-capabilities behind an expandable count.
- The detail panel should become a full-width drawer or section on narrow screens.

## Acceptance Criteria

- Users can create and browse at least L1 and L2 capabilities without interacting with taxonomy.
- The map visually nests L2 capabilities inside L1 families and L3 sub-capabilities inside L2 capabilities.
- Current versus target maturity is visible on the map and in detail view.
- Overlay mode can switch between maturity, operational coverage, planning impact, and IT4IT alignment.
- Traceability to taxonomy, products, backlog, and architecture is visible as compact map evidence and full detail-panel links.
- IT4IT alignment uses the existing platform slugs.
- No new database schema is added for this refinement unless an implementation spike proves a blocker and updates this spec first.
- Unit tests cover evidence summary and overlay-state derivation.
- UX verification captures desktop and mobile screenshots of the nested map and selected-capability detail panel.

## Implementation Slices After Spec Approval

1. **Read-model tests and helpers.** Add failing tests for evidence summaries, backlog-status-aware planning overlay, and overlay-state derivation. Implement helpers in `apps/web/lib/business-capabilities/`.
2. **Nested map UI.** Replace the flat section/card rendering with nested L1/L2/L3 containers while preserving existing create and maturity behavior.
3. **Overlay controls and detail panel.** Add overlay selector, compact evidence chips, selected-capability state, and detail panel grouped by trace target.
4. **Responsive and UX verification.** Exercise `/portfolio/architecture` in desktop and mobile viewports, capture screenshots, and adjust layout until tiles and labels are stable.

## Risks And Mitigations

- **Risk:** The map becomes unreadable when the number of capabilities grows.
  **Mitigation:** Use L3 collapse, search/filter, and a selected-capability detail panel instead of showing every detail inline.
- **Risk:** Operational overlays make users think products or backlog items define the capability.
  **Mitigation:** Keep the capability label and description primary; use evidence chips and panel sections as support signals.
- **Risk:** Maturity colors are interpreted as objective truth without context.
  **Mitigation:** Show current/target numbers, rationale, and linked work so the score remains explainable.
- **Risk:** IT4IT alignment becomes a second taxonomy.
  **Mitigation:** Use the existing value-stream slugs as tags/filters only, not as a replacement hierarchy.

## Decision

Proceed with Option A: a nested heat-map work surface with overlay modes and a drill-down detail panel. Preserve the current schema, reserve refactoring effort for view-model helpers and component boundaries, and require user approval of this spec before writing the implementation plan.
