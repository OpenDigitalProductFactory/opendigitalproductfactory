# Archetype-Aware Workspace Design

| Field | Value |
| --- | --- |
| Status | Draft — architect-revised 2026-05-31 (alignment corrections folded; awaiting founder review) |
| Date | 2026-05-31 |
| Author | Codex; architect revisions by Enterprise Architect persona (Mark Bodman session) |
| Scope | Internal `/workspace` composition, archetype-aware operational blocks, WWWD/coworker guidance |
| Anchor specs | [Vertical Workspace Home Design](2026-05-24-vertical-workspace-home-design.md) (canonical contribution/resolver/projection contract), [Workspace-home primitive registry](2026-05-24-workspace-home-primitive-registry-design.md) (canonical 11-primitive typed registry) |
| Extends | The two anchor specs. This spec adds the *configuration layering* model (DPF-seed → category → exact → org → role → coworker → user) and audited explanation/recommendation contract on top of the existing contribution + primitive substrate. It does NOT introduce a new "block" registry. |
| Related epics | EP-CORPUS-BOOTSTRAP, EP-COWORKER-INTERACTIVITY, EP-REDUCTION-GEAR-ARCH, EP-TRADES-FIELD-SERVICE, EP-AI-OPSMAP |
| Related backlog | BI-1CCC6264, BI-5B8FE5C1, BI-3E8D2CF5, BI-CE6AF925, BI-FE002675, BI-89C19AAF, BI-5656E9C3, BI-34936764, BI-8A58C65A, BI-846C297F |
| Related personas | [Dale (HVAC)](../../personas/dale-hvac.md), [Linda (clinic)](../../personas/linda-clinic.md), [Marisol (retail)](../../personas/marisol-retail.md) |
| Related docs | [Customer Surface Archetype Activation](2026-05-22-customer-surface-archetype-activation-design.md), [Continuous Corpus Enrichment](2026-05-31-continuous-corpus-enrichment-design.md), [Decision Perspective & Persona Voice](../../user-guide/ai-workforce/decision-perspective.md), [Dale's AC Repair workspace-home visual design](2026-05-24-dales-ac-repair-workspace-home-visual-design.md) |

## Architect Verdict (2026-05-31)

**Verdict:** the configuration-layering model and the audited recommendation/explanation contract are keepable and a useful extension of the existing substrate. The original v1 draft, however, invented a parallel `WorkspaceBlock*` registry and cited the wrong WWWD substrate; both are corrected in this revision. After folding, this spec is positioned as the **layering + audit extension** on top of the canonical contribution + primitive substrate, not a replacement of it.

**Required corrections folded into this revision:**

1. **No second substrate.** The 14 proposed "block kinds" are reframed as *configured slot instances* (`WorkspaceHomeSlotSpec`) of the canonical 11 `WorkspaceHomePrimitiveKey` primitives defined in the parent specs. The mapping is made explicit in §"Workspace Block ↔ Primitive Mapping". No new `WorkspaceBlock*` types or `blocks.ts` module are introduced. (`single-source-of-truth`, `verify-substrate-before-proposing-new`, `architecture-over-shortcuts`.)
2. **WWWD lever is org WikiPages.** The canonical workspace explanation path is `recallWikiContext({ organizationId, preferredPageKinds: ["stance","heuristic","principle","decision"] })` (`apps/web/lib/actions/agent-coworker.ts`), grounded in published+embedded `WikiPage` rows seeded by `apps/web/lib/onboarding/seed-org-wwwd-corpus.ts`. The `DecisionPerspectiveProfile` / `PerspectiveMaterial` chain is **not yet wired** — `DecisionPerspectiveProfile.ownerOrganizationId` is unread and `resolveProfileMaterial` always enters at `mark-dpf-platform`. The profile chain becomes a workspace input only after BI-230C9EF7 lands a per-org profile resolver. (Schema-grounded; see [[wwwd-corpus-lever-is-org-wikipages]] context memory.)
3. **Slot covenant remains mandatory.** Every contribution still carries the parent-mandated `today-now`, `exceptions-needs-review`, and `coworker-handoffs` baseline slots. The new zone vocabulary (`critical-strip` / `primary` / `secondary` / `briefing` / `setup`) is presentation *above* the covenant, not a replacement. (Parent spec §5.5 slot covenant.)
4. **Projection service is the canonical signal source.** Block "why-this-matters" and confidence overlays flow through `loadWorkspaceHomeSignals(...)` from `apps/web/lib/workspace-home/signals/` (BI-3E8D2CF5), which unifies GearInterface raw stream + Calibrator + Governor outputs. Block components MUST NOT call `prisma.gearInterface` or `getSlipByReason` directly. (Parent §5.7.)
5. **Ring-scope discipline (BI-4AA1074B).** Any wiki recall/decide MCP call from a workspace block scopes by `principleRingScope = worker`. Platform-engineering principles must not surface into the in-trench surface.
6. **Banned-copy lint applies.** Worker-facing strings from any configured slot pass the parent's banned-copy token list (`gear`, `ring`, `torque`, `slip`, `wear`, `triple`, `shaft`, `calibration`, `contribution model`, `cockpit`, `reduction-gear`, `GearInterface`, architecture-loop language). Every new component ships at least one fixture exercising rendered slot output against the lint. (Parent primitive-registry spec §7.)
7. **Resolver type reused.** The resolver returns the canonical `WorkspaceHomeResolution` (or a typed extension carrying `omittedSlots` / `explanations` / `sourceLayers` audit fields), not a new parallel resolution type.
8. **Archetype identity match-key clarified.** Composition matches on `StorefrontArchetype.archetypeId` *semantic slug* only. `StorefrontConfig.archetypeId` is the FK used to load the row; it is never the match key. (Parent §5.3; gated on BI-44C34478 normalization.)
9. **Plan file boundary aligns to parent.** The implementation plan's "Files likely to change" lists are updated to land under `apps/web/lib/workspace-home/{contributions,primitives,signals}/` per parent §9, not a new `blocks.ts` / `block-resolution.ts` boundary.

**Not folded in (deferred to implementation BI):**
- Whether `WorkspaceHomeSlotSpec` should grow new optional fields (`explanationPolicy`, `recommendationsConsumed`, `zone`) or whether the audit fields ride on the resolver result only. Implementer to pick after grepping current `WorkspaceHomeSlotSpec` consumers — both options preserve the no-second-substrate constraint.

### Terminology

"**Block**" in this spec is the user-facing name for a *configured slot* — a `WorkspaceHomeSlotSpec` instance bound to a canonical `WorkspaceHomePrimitiveKey`. "Block" ↔ "slot" map 1:1; no `Block` schema, registry, or type family exists. The body uses "block" because that is what workers say at the screen; "slot" and "primitive" are the implementation-layer names. When the spec describes something a worker would point at, it says "block"; when it names a contract, it says "slot" or "primitive".

"**Primitive**" is the reusable widget family (`decision-queue`, `appointment-schedule`, `health-board`, etc.) from the parent primitive-registry spec — the unit of compose-by-binding.

"**Contribution**" is the `WorkspaceHomeContribution` manifest that names an archetype's full slot composition.

## Problem Statement

The current Workspace route is useful as a platform operator home, but it is still too generic for the businesses DPF is meant to run. A field-service dispatcher, retail owner, restaurant manager, professional-services partner, SaaS founder, and MSP operator should not all land on the same command-center composition. They need the same governed platform underneath, but different first-screen concerns: schedule risk, customer updates, inventory, open decisions, revenue movement, supplier exposure, service health, setup gaps, and coworker handoffs.

The Workspace must become an archetype-aware operational screen. It should bring each business archetype's daily concerns forward without becoming a per-customer drag-and-drop page builder. The design should use typed, testable composition: DPF seeds a canonical archetype layout, org owners can make bounded overrides, coworkers can recommend changes with explanation and audit, and end users can save low-risk preferences.

## Current Substrate Inventory

### Existing route and composition

- `apps/web/app/(shell)/workspace/page.tsx` authenticates, loads `loadPlatformWorkspaceHomeData`, resolves a workspace-home contribution, renders an unconfigured notice when needed, and falls back to `PlatformWorkspaceHome`.
- `apps/web/components/workspace-home/PlatformWorkspaceHome.tsx` renders the existing platform home: command center, attention strip, permission-derived tile sections, calendar, and activity feed.
- `apps/web/lib/workspace-home/platform-loader.ts` centralizes current platform-home data loading and already includes `StorefrontConfig -> StorefrontArchetype` data.
- `apps/web/lib/workspace-home/registry.ts` defines a first workspace-home contribution registry and exact/category matching against the active storefront archetype.
- `apps/web/lib/workspace-home/types.ts` defines `WorkspaceHomeContribution`, baseline slots, component descriptors, setup activation metadata, and the `WorkspaceHomeResolution` union.
- `apps/web/lib/workspace-home/activation-summary.ts` is exposed through setup to show which workspace-home primitives activate for an archetype.

### Existing archetype and business-context substrate

- `StorefrontConfig.archetypeId` is the canonical installed archetype source, linked to `StorefrontArchetype.id`.
- `StorefrontArchetype.archetypeId` is the semantic archetype slug and must be the matching key for workspace contributions.
- `StorefrontArchetype` already carries `category`, `activationProfile`, `customVocabulary`, `itemTemplates`, `sectionTemplates`, `formSchema`, and `marketingSkillRules`.
- `BusinessContext.industry` and `BusinessContext.archetypeId` are derived/deprecated context fields, not the workspace resolver source.
- `Organization` is the canonical identity model for name, slug, contact, address, logo, and design tokens.

### Existing WWWD/corpus substrate

**Canonical WWWD lever as of 2026-05-31: org-overlay `WikiPage` rows, retrieved by `recallWikiContext`.** The workspace explanation/guidance path is `apps/web/lib/actions/agent-coworker.ts → recallWikiContext({ organizationId, preferredPageKinds: ["stance","heuristic","principle","decision"] })`, which calls `searchWikiPages` / `apps/web/lib/wiki/embeddings.ts`. Retrieval requires `status="published"` + a Qdrant embedding (written by `storeWikiPage`, fail-open if Ollama is down) + matching `organizationId`. The seed path is `apps/web/lib/onboarding/seed-org-wwwd-corpus.ts`.

`DecisionPerspectiveProfile` / `DecisionPerspectiveProfileVersion` / `PerspectiveMaterial` / `DecisionInteraction` and the continuous-corpus chain (`RawSource`, `WikiPage`, `WikiPageRevision`, `WikiPageSource`, `WikiIngestEvent`) exist in schema, **but `DecisionPerspectiveProfile.ownerOrganizationId` is never read by any decision path today**. `resolveProfileMaterial` always enters at `mark-dpf-platform`; no caller selects a per-org profile. The profile chain becomes a Workspace input only after **BI-230C9EF7** lands a per-org profile resolution entry-point. Until then, the Workspace MUST consume WWWD through `recallWikiContext` and treat profile-chain references as forward-looking.

The Decision Perspective Gate already returns governed outcomes (`recommend`, `arbitrate`, `escalate`, `defer`) with confidence and cited material. Once BI-230C9EF7 lands, Workspace composition may show "why this block matters" and "what context is missing" by calling that surface. Until then, "why this block matters" cites the `WikiPage`(s) recall returned, plus, where applicable, the `loadWorkspaceHomeSignals` source (§"Existing UI/reporting substrate").

**Ring-scope discipline (BI-4AA1074B).** Any wiki recall/decide call from a workspace block scopes by `principleRingScope = worker`. Platform-engineering principles must not surface into the in-trench surface; the Cockpit owns broader ring scopes.

### Existing coworker/action substrate

- `Agent`, `SkillDefinition`, `SkillAssignment`, and coworker route context already define who can advise or act.
- `CoworkerActionEnvelope` captures proposed destructive or side-effecting coworker actions before user approval.
- `ToolExecution` and receipts capture tool calls, route context, delegated user identity, and action envelope linkage.
- `EP-COWORKER-INTERACTIVITY` and the Pseudo-User Contract work provide the intended path for coworker-driven screen actions.

### Existing UI/reporting substrate

- Reporting and data-display UX should use `apps/web/components/ui/report-kit/`: `StatusBadge`, `StatCard`, `DataTable`, `FilterBar`, `ExportButton`, `Chart`, and the `statusColors` intent registry.
- Workspace-home code already has a primitive registry concept. This spec should extend that substrate rather than inventing an unrelated "dashboard widget" system.
- Theme-aware styling is mandatory: slot renderers must use `var(--dpf-*)` tokens and report-kit status intent helpers. No raw hex or local status color maps.

### Live backlog and overlap verification

MCP/backlog sweep on 2026-05-31 found no need for a new epic. Relevant existing work:

- `EP-CORPUS-BOOTSTRAP`: onboarding-seeded, continuously enriched org WWWD corpus.
- `EP-COWORKER-INTERACTIVITY`: coworker drives the screen with symmetric authority and audit.
- `EP-REDUCTION-GEAR-ARCH`: contains vertical workspace-home substrate and MSP workspace-home follow-up work.
- `EP-TRADES-FIELD-SERVICE`: field-service archetype, dispatcher coworker, notification skills, and lifecycle work.
- `EP-AI-OPSMAP`: operations map and functional-failure routing.
- `BI-1CCC6264`: workspace-home contribution registry, resolver, and platform fallback implementation.
- `BI-5B8FE5C1`: vertical workspace primitive library.
- `BI-3E8D2CF5`: translated workspace-home projections from GearInterface, Calibrator, and Governor signals.
- `BI-CE6AF925`: HVAC dispatcher workspace home implementation.
- `BI-FE002675`: direct overlap for MSP workspace-home research/design.
- `BI-5656E9C3`: Dale's AC Repair workspace-home research/design, already completed.

Open PR sweep found one open PR on this branch (`#1380`, onboarding document upload to DMS), not a competing Workspace design PR.

Follow-up sweep after review confirmed the cross-cutting implementation work should be routed through those existing BIs rather than filed as new backlog items. The only new work that should be filed later is a narrow gap proven not to fit the existing BI bodies, such as a missing persistence store for bounded workspace preferences.

## Research & Benchmarking

### Open-source and source-available systems

| System | Configuration model | Pattern to adopt | Pattern to reject |
| --- | --- | --- | --- |
| [ERPNext/Frappe Workspaces](https://docs.frappe.io/erpnext/workspace) | Workspaces represent modules, combine dashboard, shortcuts, masters, reports, and optional user-specific customization. | Module/work-domain homes made from typed sections are a proven model. DPF should expose a stable home for the work domain, not one giant dashboard. | User-specific arbitrary workspace documents as the primary DPF model. DPF needs seedable, archetype-owned defaults and governed overrides. |
| [Apache Superset dashboards](https://superset.apache.org/user-docs/using-superset/creating-your-first-dashboard/) | Charts are stored with query/type/options; dashboard access can use dataset permissions or dashboard-level roles. | Separate data contract, visual block definition, and access model. Published vs draft dashboard state is useful precedent for override review. | Free-form analytical dashboards as the day-one workspace. Superset optimizes exploration, while DPF's Workspace optimizes daily operation and action. |
| [Grafana folders and permissions](https://grafana.com/docs/grafana/latest/administration/roles-and-permissions/folder-access-control/) | Folders organize dashboards and cascade permissions across contained resources. | Configuration and visibility must inherit from a higher container while keeping effective permissions explainable. | Folder-style dashboard sprawl. DPF blocks should be few, governed, and archetype-relevant. |

### Commercial products

| Product | Configuration model | Pattern to adopt | Pattern to reject |
| --- | --- | --- | --- |
| [Microsoft Dynamics 365 Finance & Operations workspaces](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/user-interface/page-navigation) | Workspaces are activity-oriented pages tied to targeted user questions and frequent tasks; access depends on roles. | Workspace purpose should be "answer the targeted user's most pressing activity questions and initiate frequent tasks." This is the strongest benchmark for DPF. | Generic dashboard-as-landing-page when the user really needs an activity board. |
| [Shopify Analytics overview](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/overview-dashboard) | Customizable metric cards can be added, removed, rearranged, sectioned, resized; insights and targets are surfaced. | Bounded card customization, labeled sections, and system-generated insights are useful for owner/admin reporting blocks. | Letting metric-card rearrangement become the whole Workspace model; operations queues and decisions must outrank vanity metrics. |
| [HubSpot record cards](https://knowledge.hubspot.com/object-settings/create-cards-on-records?product=crm) | Cards display data/actions in fixed regions of record views; customization requires admin permissions. | Region-specific cards with permissions are a good model for bounded owner/admin overrides. | Object-record page customization as the default mental model. Workspace blocks should be operating concerns, not schema-object decoration. |
| [Salesforce Dynamic Forms / visibility rules](https://help.salesforce.com/s/articleView?id=sf.lightning_page_components_visibility.htm&language=en_US&type=5) | Page fields/sections can show/hide based on record data, user details, permission, or device, with documented caveats. | Conditional visibility is useful only when explainable and testable. DPF should record why a block is present or absent. | Complex hidden layout rules that make required or important content disappear without an audit trail. |

### Adopted Patterns

- Activity-oriented workspaces beat generic dashboards.
- Layered configuration is viable when each layer has clear authority.
- Blocks need typed data contracts and fixed renderers, not arbitrary HTML or script.
- Role/access constraints must be part of the configuration model, not an afterthought.
- User customization should be bounded to ordering, collapse, and saved filters until the system proves a need for deeper overrides.
- AI insights are valuable when they cite source material, explain why, and produce auditable recommendations.

### Rejected Patterns

- Drag-and-drop dashboard builder as V1.
- Per-customer React component injection.
- Hidden AI layout generation that silently changes the workspace.
- Local per-page status colors and one-off table/card implementations.
- Forcing every archetype into KPI-first analytics.
- Treating `BusinessContext.industry` as equivalent to active archetype.

### DPF-Specific Gaps

- The current registry names primitive/component concepts, but it does not yet express the full layered configuration model: seed default, org override, role projection, coworker recommendation, user preference.
- Existing first-screen Workspace still renders the platform home even when a vertical contribution could be resolved.
- WWWD guidance can inform recommendations, but there is no block-level explanation/audit model yet.
- Coworker handoffs exist as a concept, but Workspace blocks do not yet consume `CoworkerActionEnvelope` and `ToolExecution` as a first-class operational queue.
- Setup activation summaries exist, but missing-data behavior needs to be user-facing: setup prompt, empty positive state, degraded block, or hidden block.

## Design Principles

1. **Archetype first, role second.** The active archetype determines the operating model; role determines which blocks/actions within that model are visible or actionable.
2. **Configuration is layered, not bespoke.** DPF seeds the default; org admins make bounded overrides; coworkers recommend with citations; users save personal display preferences.
3. **Blocks are operational units.** A block answers a daily question, supports a workflow, and has a data contract.
4. **WWWD explains and prioritizes, it does not secretly lay out the page.** Layout changes from WWWD/coworkers are recommendations with rationale and audit.
5. **Data gaps are first-class.** Missing integrations, empty canonical records, and unseeded capabilities render setup/action prompts instead of blank charts.
6. **No second substrate.** Extend the workspace-home contribution + primitive registries, report-kit, `recallWikiContext` corpus retrieval, the projection service, and `ToolExecution`/`CoworkerActionEnvelope` audit substrate before adding schema. The `DecisionPerspectiveProfile` chain is forward-looking and gated on BI-230C9EF7.
7. **Dense and repeatable.** The screen is for people who use it every day. It should be compact, scannable, and action-oriented.
8. **Theme-aware and report-kit composed.** Any KPI, status, table, filter, CSV export, or chart uses the shared palette.

## Proposed Information Architecture

The Workspace route remains `/workspace`, but the page should resolve into one of three modes:

| Mode | When | First-screen behavior |
| --- | --- | --- |
| `archetype-workspace` | Active `StorefrontConfig` includes a `StorefrontArchetype` whose `archetypeId` semantic slug matches an exact or category workspace contribution | Render archetype-specific block composition and active coworker briefing. |
| `configured-fallback` | Archetype exists but no contribution matches | Render platform home with a compact setup notice and "workspace home not configured for this archetype" telemetry. |
| `unconfigured` | No storefront/archetype setup | Render setup notice and platform home fallback. |

The first viewport should have:

1. **Operating header:** business-native title, current day/window, primary action.
2. **Critical strip:** exceptions and next-best actions, not marketing copy.
3. **Primary block row:** 2-4 high-priority blocks for the archetype.
4. **Coworker briefing rail/dock:** current handoffs, explanation, missing-context prompts.

Secondary blocks follow in dense sections. Reporting-heavy blocks use report-kit, but the page should not become KPI-card wallpaper.

## Configuration Layering Model

Workspace resolution should produce an audited extension of the canonical `WorkspaceHomeResolution` at render time. The extension carries source-layer and explanation metadata; it does not replace the resolver type from the anchor spec.

```ts
type WorkspaceConfigurationLayer =
  | "dpf-seed"
  | "archetype-category"
  | "exact-archetype"
  | "organization-override"
  | "role-projection"
  | "coworker-recommendation"
  | "user-preference";

type WorkspaceCompositionAudit = {
  sourceLayers: WorkspaceConfigurationLayer[];
  omittedSlots: WorkspaceOmittedSlot[];
  explanations: WorkspaceSlotExplanation[];
};

type AuditedWorkspaceHomeResolution = WorkspaceHomeResolution & {
  audit: WorkspaceCompositionAudit;
};
```

Layer order:

1. **DPF seed:** baseline primitive registry and universal slot constraints.
2. **Archetype category:** default composition for broad category, such as field service, retail, hospitality, professional services, SaaS, MSP.
3. **Exact archetype:** semantic slug-specific overrides, such as `hvac-contractor`.
4. **Organization override:** bounded admin choices: enable/disable optional slots, reorder within allowed zones, choose saved filters, set target thresholds.
5. **Role projection:** hide or down-rank slots/actions the user cannot use.
6. **Coworker recommendation:** pending proposed change, not automatic mutation.
7. **User preference:** collapse/expand, density, saved filters, default time window.

Conflict rule: a lower layer cannot re-enable a slot/action forbidden by a higher governed layer or by permissions. The UI must be able to show "hidden because role lacks X" or "recommended because WWWD material Y says Z."

## Workspace Block ↔ Primitive Mapping

**No new registry.** This spec's "blocks" are *configured slot instances* of the canonical primitives defined in the parent [primitive-registry spec](2026-05-24-workspace-home-primitive-registry-design.md) and bound through `WorkspaceHomeSlotSpec` (parent vertical-workspace-home spec §5.5). A configured slot is `{ slotId, primitive, component, title, tone, dataRef, priority, mobileCollapse }` — the layering model below adds presentation metadata around the existing shape, it does not replace it.

The 14 conceptual "blocks" enumerated in earlier drafts collapse onto the 11 canonical primitives as follows. New work composes by selecting a primitive, binding a `dataRef`, and (optionally) attaching the new audit fields below — it does NOT introduce new primitive keys without amending the parent spec.

| Conceptual block | Canonical primitive | Notes |
| --- | --- | --- |
| `work-queue`, `next-best-actions`, `open-decisions` | `decision-queue` | Three flavours of "what needs human sequencing" — distinguished by `dataRef` loader (e.g. `work-queue-by-role`, `priority-tasks`, governor `require-hitl`), not by a new primitive. |
| `schedule` | `appointment-schedule` | Time-slotted view. Capacity view of the same dataset uses `capacity-lanes`; period view uses `service-period-board`. |
| `coworker-briefing` | `handoff-queue` | Bound to the mandatory `coworker-handoffs` baseline slot — PAR acknowledge/reassign capabilities, 30s staleness. Briefing prose is the slot's vocabulary, not a separate primitive. |
| `communication-exceptions` | `communication-exceptions` | 1-to-1. |
| `inventory-supplier-risk` | `inventory-watch` | Supplier exposure is `inventory-watch` with a supplier-aware loader binding. |
| `integration-health`, `service-health` | `health-board` | Source freshness, MSP/SaaS estate, and connector status are all `health-board` flavours, distinguished by loader (`managed-estate-health` vs `service-uptime` vs connector inventory). |
| `customer-activity` | `case-board` (longer-running) or `decision-queue` (short-lived activity) | Pick by operating model — open `case-board` for relationship/case streams, `decision-queue` for daily activity needing action. |
| `revenue-snapshot`, `kpi-strip` | `kpi-strip` (parent-spec extension request) | The parent's 11 primitives do NOT include a generic header-strip KPI primitive. If the implementer concludes one is genuinely warranted (likely yes for retail/SaaS), the addition is filed as a parent-spec amendment, not as a new substrate in this spec. Open in §"Open Questions". |
| `wwwd-guidance` | Not a primitive — a *signal overlay* on top of any block | WWWD guidance is rendered by attaching `recallWikiContext` citations to a block's explanation, not as its own primitive. |
| `setup-gaps` | Not a primitive — the `missing-data behavior` of every primitive | Per the parent primitive-registry spec §8: setup-gap is the slot's empty/setup state aggregated by the setup-activation summary, not a separate slot. |

If a future archetype proves an operating model the existing 11 primitives genuinely cannot express (the parent spec's bar is "different sort, density, and action semantics"), the path is a primitive-registry-spec amendment + parent-spec table edit, then a new `WorkspaceHomePrimitiveKey` value — NOT a new "block" layer.

### Audit fields layered onto the resolver

The Configuration Layering Model (above) produces an audited resolution. The audit type is defined once in §"Configuration Layering Model" — see `WorkspaceCompositionAudit` and `AuditedWorkspaceHomeResolution` there.

Implementation MAY put the audit on the existing resolution union; implementation MUST NOT replace `WorkspaceHomeResolution` with a parallel type. Slot priority / zone / explanation-policy fields are either added as optional members of `WorkspaceHomeSlotSpec` (preferred, parent-spec amendment per §"Archetype-to-Block Mapping Strategy") or ride on the audit (acceptable fallback). The implementation BI picks one after sweeping current `WorkspaceHomeSlotSpec` consumers.

## Archetype-to-Block Mapping Strategy

Archetype mapping uses the canonical `WorkspaceHomeContribution` shape from parent §5.5 directly — no new type. The contribution already carries everything needed: `semanticArchetypeIds`, `archetypeCategories`, `slots[]` with priorities, `setupActivation.requiredCanonicalData` / `requiredSignals` / `missingDataBehavior`. **Composition matches on `StorefrontArchetype.archetypeId` semantic slug only; the `StorefrontConfig.archetypeId` FK is the read path, never the match key** (parent §5.3, gated on BI-44C34478 normalization). Each contribution still satisfies the mandatory slot covenant (today/now, exceptions/needs-review, coworker-handoffs).

This spec proposes two parent-spec amendments rather than a parallel shape:

1. **`primaryOperatingQuestion`** — a presentation field naming "what one question the worker arrives asking" (HVAC: "what's on the board today?"; MSP: "what's red on the estate?"). Adds clarity to setup-activation summaries. Lands as an optional field on `WorkspaceHomeContribution` (parent §5.5 amendment).
2. **`zone`** on `WorkspaceHomeSlotSpec` — presentation grouping above the slot covenant (`critical-strip` / `primary` / `secondary` / `briefing` / `setup`). Lands as an optional field on the existing `WorkspaceHomeSlotSpec` (parent §5.5 amendment). Default zone derives from existing `priority` if absent.

Neither amendment changes the resolver type, the slot covenant, or the primitive registry. Both are filed as edits to the parent spec, not a new shape here.

Recommended category defaults:

| Category | Front-and-center blocks | Secondary blocks |
| --- | --- | --- |
| Trades / field service | `schedule`, `work-queue`, `communication-exceptions`, `inventory-supplier-risk`, `coworker-briefing` | `revenue-snapshot`, `customer-activity`, `setup-gaps` |
| MSP / IT services | `service-health`, `open-decisions`, `work-queue`, `integration-health`, `coworker-briefing` | `customer-activity`, `revenue-snapshot`, `setup-gaps` |
| Retail / ecommerce | `revenue-snapshot`, `inventory-supplier-risk`, `customer-activity`, `next-best-actions` | `integration-health`, `setup-gaps`, `coworker-briefing` |
| Hospitality / restaurant | `schedule`, `inventory-supplier-risk`, `communication-exceptions`, `next-best-actions` | `revenue-snapshot`, `setup-gaps`, `coworker-briefing` |
| Professional services | `work-queue`, `open-decisions`, `schedule`, `revenue-snapshot` | `customer-activity`, `wwwd-guidance`, `setup-gaps` |
| SaaS / software operator | `service-health`, `open-decisions`, `integration-health`, `customer-activity` | `revenue-snapshot`, `coworker-briefing`, `setup-gaps` |

Exact archetypes may reorder or specialize labels, but they should not invent one-off primitives without first extending the shared registry.

## WWWD and Coworker Integration Model

WWWD participates in three explicit ways. **Today (2026-05-31) all three flow through `recallWikiContext` against org-overlay `WikiPage` rows; the `DecisionPerspectiveProfile` chain is a forward-looking input that activates only after BI-230C9EF7 lands a per-org profile resolver.**

1. **Block explanation:** show why a block is present, based on the active archetype, org corpus material, and DPF seed. The explanation cites the `WikiPage`(s) `recallWikiContext` returned and (where applicable) the `loadWorkspaceHomeSignals` source. Example: "This is high priority because your operating stance — [stance: same-day response for emergency calls](wiki-page-ref) — emphasizes immediate dispatch."
2. **Recommendation ranking:** next-best actions can include a rationale and confidence drawn from `recallWikiContext` results, especially when trade-offs exist. Once BI-230C9EF7 lands, `DecisionPerspective` outcomes (`recommend` / `arbitrate` / `escalate` / `defer`) become an additional input.
3. **Gap detection:** if a block lacks required data, or `recallWikiContext` returns no published WikiPages for the archetype's expected stance keys, create or link an enrichment/setup gap instead of silently hiding the block. Once the perspective chain is wired, a `defer` outcome also routes to gap creation.

**Ring scope.** All wiki recall calls from workspace blocks scope by `principleRingScope = worker` (BI-4AA1074B). Block-rendered principles must filter the same way — platform-engineering principles must not surface into the in-trench workspace.

Coworkers participate through:

- Static assigned coworker briefings where an archetype has known helper roles, such as dispatcher, bookkeeper, inventory assistant, customer-success coworker.
- Dynamic recommendations that produce `CoworkerActionEnvelope` proposals for layout changes or operational actions.
- "Ask why this matters" explanations that cite block data, corpus material, and decision interactions.
- Gap detection when archetype-critical blocks have missing canonical data, stale integrations, or low-confidence guidance.

Coworker recommendations are not automatic layout mutations in V1. They render as explainable proposals derived from `CoworkerActionEnvelope`:

```ts
// View shape projected from CoworkerActionEnvelope payload + cited references.
// NOT a new persistence model — persistence lives in CoworkerActionEnvelope.
// `status` projects the envelope's lifecycle into workspace-friendly states.
type WorkspaceRecommendationView = {
  id: string;                       // CoworkerActionEnvelope.id
  kind: "pin-block" | "unpin-block" | "change-threshold" | "setup-source" | "open-decision";
  rationale: string;                // human-readable, drawn from envelope payload
  citedWikiPageIds: string[];       // recallWikiContext citations (ring-scope: worker)
  citedToolExecutionIds: string[];  // ToolExecution refs from the envelope's audit trail
  confidence: "low" | "medium" | "high";
  status: "proposed" | "accepted" | "dismissed" | "expired";  // projection of envelope lifecycle
};
```

The view is rendered server-side per page load against the envelope rows scoped to the current organization, role, and workspace. No new table.

## Configurability Rules

### Configurable by DPF seed/archetype definition

- Which block kinds are available for an archetype/category.
- Required baseline blocks for that archetype.
- Default priority zones and density.
- Vocabulary tokens and empty-state copy keys.
- Required canonical data and default missing-data behavior.
- Which coworker roles are suggested for briefings.

### Configurable by org owner/admin

- Enable/disable optional blocks.
- Reorder blocks within allowed zones.
- Choose saved filters, target thresholds, and "business hours" windows.
- Accept or dismiss coworker layout/setup recommendations.
- Configure integrations that power blocks.

### Configurable by coworker recommendation

- Proposed priority changes based on recent signals.
- Proposed setup tasks or corpus enrichment prompts.
- Suggested block additions when an archetype-critical concern lacks visibility.
- Suggested threshold changes with cited evidence.

### Configurable by end user

- Collapse/expand secondary blocks.
- Saved filters and date windows.
- Personal ordering within a zone when it does not hide required blocks.
- Notification preferences for block alerts.

### Not configurable in V1

- Removing the critical strip or all baseline blocks.
- Re-enabling blocks/actions hidden by role/capability.
- Adding arbitrary custom React/HTML blocks.
- Changing the active archetype outside the canonical storefront/business setup flow.
- Bypassing WWWD review/audit for recommendations.
- Local color/status maps or non-report-kit data-display components.

## Degraded and Missing-Data Behavior

Each block must choose one of four missing-data modes:

| Mode | Use when | Worker output |
| --- | --- | --- |
| `positive-empty` | Empty is a good state, such as no failed updates | Compact "nothing needs attention" state. |
| `setup-action` | The data source is required for the archetype | Clear setup prompt for admins; worker-safe explanation for non-admins. |
| `degraded` | Partial data exists but is incomplete/stale | Render available facts and mark what is missing. |
| `hide` | Optional block has no meaningful data | Omit and record explainable omission for admins. |

Integrations and corpus gaps should fail open: the page still renders, but the relevant block shows stale/missing state. Failures must be observable in `ToolExecution`/integration status and in setup gaps where appropriate.

## Data Model Impact

Preferred V1 data model impact: none.

Use code-owned registries plus existing tables:

- `StorefrontConfig` and `StorefrontArchetype` for active archetype resolution. Match key is `StorefrontArchetype.archetypeId` semantic slug; `StorefrontConfig.archetypeId` is the FK read path.
- `Organization` and `BusinessContext` for identity/context display only.
- **WWWD/corpus today (canonical):** `WikiPage`, `WikiPageRevision`, `WikiPageSource`, `RawSource`, `WikiIngestEvent` — retrieved via `recallWikiContext`/`searchWikiPages` (`apps/web/lib/wiki/embeddings.ts`).
- **WWWD/corpus forward-looking (gated on BI-230C9EF7):** `DecisionPerspectiveProfile`, `DecisionPerspectiveProfileVersion`, `PerspectiveMaterial`, `DecisionInteraction` — workspace must not assume these are wired until the per-org profile resolver lands.
- **Signal source (canonical):** `loadWorkspaceHomeSignals(...)` (BI-3E8D2CF5) — unifies GearInterface raw stream + Calibrator + Governor outputs behind one translated `WorkspaceHomeSignal` type. Block components MUST NOT call `prisma.gearInterface` or `getSlipByReason` directly.
- `Agent`, `AgentThread`, `AgentMessage`, `ToolExecution`, and `CoworkerActionEnvelope` for coworker participation and action audit.
- Existing domain records for block data.

Potential later addition, only after V1 proves the need:

- `WorkspacePreference` for org/user-level saved overrides if existing preference/config stores cannot carry it. File as a separate schema BI.
- Parent primitive-registry amendment to add a `kpi-strip` primitive key if retail/SaaS implementation proves the existing 11 cannot express it.

Do not add a generic `Dashboard`, `Widget`, or `PageBuilder` table for V1.

## UI/UX Behavior

- The first screen is the operational workspace, not a hero or marketing page.
- Blocks render in stable zones with predictable density. Large charts belong below the primary operating row unless the archetype's daily job truly depends on the chart.
- Critical strip items are terse and actionable.
- Coworker briefing is a dock/rail or compact section, not a chat transcript takeover.
- Every block has ready, empty, missing-source, stale, loading, and permission-hidden states — per the canonical primitive's state contract in the parent registry spec §6.
- Reporting/data blocks use report-kit primitives.
- Status badges use `StatusBadge` and `statusColors`, never local color maps.
- Tables use `DataTable`; filters use `FilterBar`; exports use `ExportButton`; charts use `Chart` by subpath when needed.
- `<option>` elements and custom controls must use DPF tokens.
- Mobile order follows block priority: critical strip, current/next work, handoffs, then secondary metrics.
- **Banned-copy lint applies** (parent primitive-registry spec §7). Worker-facing strings — titles, labels, action labels, empty-state copy, tooltips — must pass the lint over the token list (`gear`, `ring`, `torque`, `slip`, `wear`, `triple`, `shaft`, `calibration`, `contribution model`, `cockpit`, `reduction-gear`, `GearInterface`, architecture-loop language). Every new component ships at least one fixture exercising rendered slot output against the lint.
- **Times use shared `LocalTime`** (viewer browser TZ), never raw UTC in worker-facing copy.

## Permission and Configuration Rules

- Workspace route remains authenticated.
- Block visibility is resolved from organization archetype, role/capability, and block definition.
- Actions inside blocks require the same platform permissions/tool grants as their destination flows.
- Admin-only setup and configuration affordances must not render for ordinary workers.
- Coworker layout recommendations must be proposed through auditable action/recommendation records, not silent mutations.
- If a user lacks permission for a required block, the resolution records `permission-hidden` and, where appropriate, shows an admin-facing configuration warning elsewhere.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Duplicate substrate with prior vertical workspace-home work | Extend `apps/web/lib/workspace-home` and existing specs; do not create a parallel dashboard registry. |
| Dashboard builder sprawl | V1 allows bounded seed/admin/user layers only; no arbitrary custom components. |
| Hidden AI layout decisions | Coworker/WWWD changes are recommendations with citations, confidence, and audit. |
| Blank widgets when data is missing | Every block declares missing-data behavior and setup prompts. |
| Role leakage | Block resolution includes capability checks and explainable omissions. |
| Hardcoded colors/status maps | Use report-kit and token-backed styling only. |
| Archetype mismatch via FK vs semantic slug | Match contribution manifests on `StorefrontArchetype.archetypeId` semantic slug only. |
| Page becomes card-heavy and slow | Limit primary blocks, prioritize queues/actions, lazy-load secondary charts. |

## Resolved Review Questions

1. **Preference persistence.** No existing general-purpose org/user workspace preference store was found in schema. `CommunicationChannelBinding.preferences` is channel-specific, and `BuildPhaseHandoff.userPreferences` is build-evidence context, not portal UI preference storage. V1 therefore implements no durable user reordering beyond server-rendered defaults. If Slice 7 needs persistence, file a narrow `WorkspacePreference` schema BI after another substrate sweep.
2. **Accepted coworker recommendations.** Accepted recommendations do not mutate layout directly. They resolve through PAR (`CoworkerActionEnvelope`) into the same admin/org override command path a human would use. Until a durable override store exists, coworker recommendations can open setup tasks or explain gaps, but they cannot create persistent layout changes.
3. **Next exact archetype after HVAC and MSP.** Retail/ecommerce is the next proving archetype because it stress-tests revenue snapshot, inventory/supplier risk, customer activity, and the likely `kpi-strip` primitive amendment. It should route through existing `BI-3F3B535D` / `BI-E0D7B790` work rather than a new BI.
4. **Configuration authority.** V1 uses existing grants (verified at `apps/web/lib/govern/permissions.ts` lines 19/38/54/73): `manage_business_models` owns org/archetype workspace composition choices; `manage_platform` owns registry/primitive definitions and platform fallback behavior; `view_storefront` remains read/setup visibility only. A new `manage_workspace_home` grant is deferred until implementation proves the existing split is too coarse.
5. **Platform fallback visibility.** When an archetype workspace is active, `PlatformWorkspaceHome` is not blended into the worker home. Authorized operators with `view_platform` or `manage_platform` get an explicit operator switch or link to the platform fallback. Ordinary workers stay in the archetype workspace.

## Remaining Open Questions

1. Should `WorkspaceHomeSlotSpec` grow optional fields (`explanationPolicy`, `recommendationsConsumed`, `zone`) or should all audit metadata ride on `AuditedWorkspaceHomeResolution`? This is deliberately left to `BI-1CCC6264` after a local consumer sweep.
2. Is `kpi-strip` a justified primitive-registry amendment, or can retail/SaaS express header metrics with existing primitives plus report-kit `StatCard` composition? Decide in `BI-5B8FE5C1` / retail implementation evidence.

## Acceptance Criteria

- `/workspace` resolves the active archetype from `StorefrontConfig -> StorefrontArchetype`, matching on `StorefrontArchetype.archetypeId` semantic slug, then `category`.
- V1 reuses the existing `WorkspaceHomeContribution` + `WorkspaceHomePrimitiveSpec` substrate. No new `WorkspaceBlock*` registry, no new dashboard/page-builder substrate, no new `Dashboard`/`Widget` tables.
- Every contribution satisfies the parent-mandated slot covenant (today/now, exceptions/needs-review, coworker-handoffs).
- At least one exact/category archetype composition renders a prioritized slot set with critical strip, primary slots, coworker-handoffs briefing, and setup-gap surfacing.
- Missing data renders the primitive's declared empty/setup-action/degraded state per the canonical contract.
- WWWD/coworker explanations cite `WikiPage` ids retrieved by `recallWikiContext` (ring-scope `worker`) and, where applicable, `WorkspaceHomeSignal.source` from `loadWorkspaceHomeSignals`. Once BI-230C9EF7 lands, profile-chain outcomes are an additional input.
- Admin/org/user configurability is bounded by the layer model. Coworker recommendations are projected from `CoworkerActionEnvelope` (no new persistence model) and never mutate layout without acknowledgement (PAR).
- All reporting/data-display UI uses report-kit primitives and DPF tokens. Banned-copy lint passes.
- All time-bound block content (schedule slots, "running late", "ETA", "today's window") renders through shared `LocalTime` (viewer browser TZ); server components emit UTC only at serialization boundaries.
- Unit tests cover resolver layering, slot covenant enforcement, missing-data states, ring-scope filtering on wiki recall, banned-copy assertion, and role/capability filtering.
- UX verification exercises `/workspace` for configured and unconfigured archetype states on the Live portal at `http://localhost:3000/workspace`, desktop AND mobile viewports, with the structured dynamic-analysis report shape (drove X → observed Y → signed off Z).
- Production build passes before implementation work is considered complete.
