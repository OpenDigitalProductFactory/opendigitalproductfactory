# Customer Surface Archetype Activation Design

**Date:** 2026-05-22
**Status:** Draft
**Author:** Claude (with Mark Bodman direction)
**Companion to:** [`2026-05-22-archetype-capability-applicability-and-msp-segmentation-design.md`](2026-05-22-archetype-capability-applicability-and-msp-segmentation-design.md)
**Related docs:**
- `docs/superpowers/specs/2026-04-23-it-service-provider-msp-archetype-design.md`
- `docs/superpowers/plans/2026-04-23-msp-customer-estate-foundation.md`
- `docs/superpowers/specs/2026-05-22-archetype-capability-applicability-and-msp-segmentation-design.md` (§6.5 axes, §6.6 portfolios)

## 1. Problem Statement

The customer-facing surface of the portal — what an operator sees when they click "Customers" — is the *primary daily interaction* for every business that has customers. It's also the surface that varies most across archetypes:

- A **managed service provider** has a small number of customer accounts, each with multiple office sites spread across a metro area; daily work means picking a customer, picking a site, opening tickets, scheduling support visits.
- An **HOA admin company** manages a small number of HOA boards. Each HOA contains one or more *communities* (often gated). Each community contains *many* individual properties with addresses and owners. Daily work means driving routes to observe violations, capturing geotagged photos as evidence, issuing citations, and notifying neighbors about nearby work.
- A **trade business** (AC repair, plumbing, electrical) has many customers, each at roughly one address, and daily work is reactive dispatch: which job is closest to my next tech, ordered by urgency and SLA.
- A **single-location service** (hair salon, dine-in restaurant) has many customers whose physical location is operationally irrelevant — they come to the business. The customer surface is appointment history and contact info; no map, no map UX considerations.
- An **online retailer** has customers whose physical location matters only at fulfillment time — geography appears as shipping zones and warehouse proximity, not as a daily-work map.

If the platform ships one customer page that tries to be all of these, it ends up being none of them well. If the platform ships five hand-crafted customer pages keyed by archetype id, the architecture pattern we just hardened for topology isolation (axes + portfolios → derived capabilities) is wasted.

The customer surface should be **the same single composition** in code, activated into different shapes by the same rules engine that already drives capability applicability. Geographic, dispatch, hierarchical, and evidence-capture concerns are independent capabilities that combine.

## 2. Live Backlog Context

Live DPF MCP reads were available on 2026-05-22. Relevant active overlap:

- `EP-SITE-7C4D2B`: first-class customer site records and location validation.
- `EP-CTRL-5E21A4`: automated control utility (touches customer scope).
- The just-landed `doc/customer-topology-isolation` branch introduced the axes/portfolios → capability-activation pattern in the storefront-templates package, and added customer/site/scope columns to the inventory layer. The customer surface design extends the *same* contract — no new architectural substrate.

Planning implication: this spec does not introduce a new architecture. It extends the capability registry with customer-surface concerns and uses the existing rules engine. The model addition (community tier) is small and self-relation-based.

## 3. Research & Benchmarking

### 3.1 Reference patterns

| Source | Pattern adopted | Pattern rejected |
| --- | --- | --- |
| NetBox tenant model | Tenant resources rolled into a map | Tenants as a separate identity boundary at the platform level |
| Auvik network map | Site-level operational view with click-through to detail | Defaulting to a single global map for all archetypes |
| ServiceTitan / Housecall Pro (trade dispatch) | Dispatch board with urgency × proximity sorting; tech availability column | Hard-coded "service area = 10 mile radius" assumption |
| Buildium / AppFolio (property management) | Property → unit → tenant hierarchy; per-property task lists | Building property mgmt into a single CustomerAccount row |
| FieldEdge / Jobber (trades) | Map view + dispatch board as alternates, not always both | Forcing every trade business to use both |
| OpenStreetMap + Leaflet | OSS-default map substrate (DPF is open source) | Vendor-locked map providers as a hard requirement |

### 3.2 HOA violation-capture workflow (concrete user story)

Mark's daughter manages an HOA portfolio. Her current daily routine includes physically driving to communities, walking or driving past properties looking for visible violations (e.g. trash bin left out, lawn unmaintained, unauthorized structure), taking a phone photo as evidence, recording the property address, and submitting the photo + observation to a violation tracking system for review and citation. She also needs to notify nearby owners when scheduled work (e.g. tree trimming) will affect them.

This is the kind of work the customer surface should *anticipate* in the HOA archetype, not bolt on later. The map is not decorative — it is the daily work surface. The capabilities needed:

- **Geotagged evidence capture** — phone-friendly camera workflow that pins the photo to GPS coordinates AND to a specific property record.
- **Property-resolution from coordinates** — given GPS coordinates, identify the property record (and owner) it belongs to.
- **Neighbor-of-work notification** — given a property and a work radius, list owners to notify.

Each of these is a *capability*, not an archetype-specific feature. The capabilities activate when the archetype's axes + portfolios indicate the work motion needs them. Trade businesses get geotagged evidence (proof of work performed) without needing property-resolution. HOA gets all three.

## 4. Design Goals

1. The customer surface is **one** composition (`<CustomerSurface>`) whose shape is derived from the normalized activation profile — never from `archetypeId` comparisons.
2. New capabilities express orthogonal operating concerns (geography, dispatch, hierarchy, evidence) so archetypes can mix-and-match.
3. The HOA 3-tier model (account → community → property) is supported without introducing a new top-level Prisma model. Re-uses `CustomerSite` with a self-relation.
4. Map pin click actions are declared by capability, not hardcoded in the map component.
5. Geographic functionality is *opt-in* — archetypes that don't need geography (salon, retail-online) never see a map UI or pay any geography-related load cost.
6. The OSS default map substrate is Leaflet + OpenStreetMap tiles. Commercial map providers are pluggable but never required.
7. Single-location archetypes get a clean list-only surface — no map widget hidden behind a feature flag, no "Upgrade to enable maps" upsells.

## 5. Non-Goals

- Building a full mobile field-work app. The spec covers what the *portal* shows; mobile capture is a separate slice if/when it's needed.
- Replacing fleet routing / TSP solvers. We surface urgency × proximity ordering; we do not optimize multi-stop routes in this slice.
- Integrating with specific commercial mapping APIs (Google Maps, Mapbox) in the first slice. Pluggable, not required.
- Building the violation citation workflow end-to-end (PDF generation, mail delivery). Capability is "capture evidence + create record"; citation execution is downstream.
- Property records from county assessors or external GIS sources. Customers/owners enter their own data; external import is a later slice.

## 6. Core Architecture Decision

Extend the existing capability registry with **four new capabilities**, all driven by the rules engine introduced in the companion spec:

| Capability key | What it activates | Primary axis the rule reads |
| --- | --- | --- |
| `customer-site-map` | Geographic map view alongside the customer list | `axes.consumptionChannel`, `axes.primaryConsumer`, `customer-estate.applicability` |
| `dispatch-routing` | Real-time dispatch board with urgency × proximity sorting | `axes.commercialModel`, `axes.primaryConsumer`, `axes.consumptionChannel` |
| `community-property-tier` | Three-level hierarchy (account → community → property) under one CustomerAccount | Archetype-level opt-in via portfolio decomposition; HOA/property-mgmt portfolio |
| `geotagged-evidence-capture` | Photo + GPS + property-record evidence capture workflow | `axes.consumptionChannel === "physical"` + archetype-level evidence-capture portfolio role |

Plus a new **per-capability `primaryActions`** declaration on `CapabilityActivation`:

```ts
interface CapabilityActivation {
  capabilityKey: string;
  applicability: CapabilityApplicability;
  ownershipScopes: OwnershipScope[];
  transactionContexts?: TransactionContext[];
  isolation: CapabilityIsolation;
  surfaces: string[];
  primaryActions?: PrimaryAction[];   // NEW
  sourceRules: string[];
  reason?: string;
  overrideReason?: string;
}

interface PrimaryAction {
  /** Stable id, e.g. "open-customer-detail", "dispatch-tech", "log-violation". */
  id: string;
  /** Verb label for the action button, e.g. "Open", "Dispatch", "Log violation". */
  label: string;
  /** Which UI scope this action fires from. E.g. "map-pin", "list-row", "selection". */
  surface: "map-pin" | "list-row" | "selection" | "detail-page";
  /** Whether this is the default action (e.g. single-click on map pin). */
  isDefault?: boolean;
}
```

The rules engine emits `primaryActions` per (capability × archetype). The `<CustomerSurface>` component reads them at render time and wires the action handlers; no archetype branching in component code.

### 6.1 WWMD pre-decisions

These are points where the spec could go several ways. I'm pre-deciding with stated reasoning so the user can override one at a time rather than answer a questionnaire. Each is marked with confidence (H/M/L).

**WWMD-1 (Cardinality model — H confidence):** Add `CustomerSite.parentSiteId` as a self-relation on the existing `CustomerSite` model. HOA hierarchy becomes: `CustomerAccount` (the HOA admin company's customer = the HOA board) → `CustomerSite` (community, `siteType: "community"`, `parentSiteId: null`) → `CustomerSite` (individual property, `siteType: "property"`, `parentSiteId: <community.id>`). Reasoning: avoids a new model layer, re-uses existing site-scoped helpers (`scope-policy.ts`, customer-estate query helpers), and trivially generalizes to MSP-with-sub-offices ("region" → "office"). Alternative: dedicated `CustomerCommunity` model — rejected because it doubles the surface area for relatively little semantic gain, and the recursive self-relation handles MSP-region-of-offices for free. Override only if HOA semantics turn out to need community-specific fields that don't apply to a generic site (e.g. board meeting minutes attached to community).

**WWMD-2 (Pin action declaration — H confidence):** `primaryActions` are declared by the rules engine and consumed by the UI; never hardcoded in the map component. Capability-driven (matches the user's explicit answer). Reasoning: this is the same pattern that makes adding archetype #50 a row of axis values rather than a UI edit.

**WWMD-3 (Map substrate — H confidence):** Leaflet + OpenStreetMap tiles as the OSS default. No external API key required for self-hosters. A `MapTileProvider` abstraction allows commercial providers (Mapbox / Google) as drop-in replacements once a self-hoster wants higher-fidelity tiles or address geocoding. First slice: Leaflet only. Reasoning: DPF is open source; baseline must work without commercial keys.

**WWMD-4 (Geocoding — M confidence):** Use Nominatim (OSS, OpenStreetMap-hosted) for address-to-coordinates resolution in the first slice. Self-host Nominatim if rate limits become an issue. Alternative: ship without geocoding and require operators to enter lat/lng manually — rejected; UX failure for trade businesses with hundreds of customer addresses. Override if the user prefers a commercial geocoder be available from day one.

**WWMD-5 (Violation-capture surface — M confidence):** Browser camera API (`getUserMedia` + `<input capture="environment">`) for the first slice, not a native mobile app. Mark's daughter uses her phone, and the phone's browser can access the camera and the GPS via standard web APIs. The evidence record is a `PortfolioQualityIssue` extension OR a new `EvidenceCapture` model — see §10. Reasoning: avoids the multi-week detour of building a React Native app before validating the workflow. Override if the user wants a mobile app from the start.

**WWMD-6 (Dispatch routing — H confidence):** First slice surfaces engagements + appointments ordered by `(slaUrgency desc, distanceFromCurrentTechLocation asc)` — no multi-stop TSP optimization, no live tech-location tracking. Reasoning: that's enough for the next-job decision without building a route optimizer that competes with FieldEdge. Override if a customer demand requires it.

**WWMD-7 (Geocoding privacy — H confidence):** Geocoding requests for customer addresses are routed through a **server-side proxy** (`POST /api/v1/geocode`). Browser code never sends customer addresses directly to a third-party geocoder. The proxy can switch between Nominatim, Mapbox, etc. based on portal config, and centralizes rate limiting + audit logging. Reasoning: customer data isolation is the whole point of the topology-isolation work — leaking customer addresses to a third party's logs would undo that.

## 7. Customer Surface Capabilities (detailed)

### 7.1 `customer-site-map`

**Applicability rules (illustrative):**

- `required` when `customer-estate.applicability` ∈ {`required`, `recommended`} AND `axes.consumptionChannel` ∈ {`onsite-plus-portal`, `physical`} AND `axes.primaryConsumer` ∈ {`business`, `household`}
- `recommended` when the above is true except `customer-estate.applicability === "recommended"`
- `optional` when only `axes.consumptionChannel === "physical"` is satisfied (e.g. trades that *could* use a map but their primary surface is dispatch)
- `hidden` when `axes.consumptionChannel === "web-app"` (online retail) OR `axes.primaryConsumer === "individual"` with no physical work motion

**UI activation:** the customer list page gains a tab switcher (`List` / `Map`). When activation is `required`, `Map` is the default tab. When `recommended`, `List` is default and `Map` is one click away. When `optional`, `Map` is buried under a kebab.

**Default primary action (map-pin click):** `open-customer-detail` — navigates to `/customers/[id]`. Overridable per archetype.

**Data:** consumes `CustomerSite.latitude`, `CustomerSite.longitude` (NEW columns). When coordinates are null, the site is hidden from the map but visible in the list, with a "Geocode address" prompt.

### 7.2 `dispatch-routing`

**Applicability rules (illustrative):**

- `required` when `axes.consumptionChannel === "physical"` AND `axes.commercialModel` ∈ {`transactional`, `appointment-checkout`} AND `axes.primaryConsumer === "individual"` AND `engagements.applicability` ∈ {`required`, `recommended`}
- `recommended` when the above is true except the customer is a `business` (commercial trade work — same routing motion, different customer cardinality)
- `hidden` for MSP, HOA, salon, retail — they're scheduled or remote, not dispatched.

**UI activation:** the customer list page gains a `Dispatch` tab (alongside `List` / `Map` when both are active). Dispatch is a map view PLUS a vertical job stack sorted by `(slaUrgency desc, distanceFromTech asc)`. Each job card has tech assignment, urgency chip, drive-time estimate.

**Default primary action (map-pin click):** `dispatch-tech` — opens the tech-assignment popover. Overridable.

**Data:** consumes `Engagement` (current open work orders) + `Appointment` (scheduled) + `CustomerSite.latitude/longitude` + a NEW `Engagement.urgencyTier` field (`emergency` | `same-day` | `next-day` | `scheduled`).

### 7.3 `community-property-tier`

**Applicability rules (illustrative):**

- `required` when the archetype's `productsAndServicesSold` portfolio scope is `primary` AND the archetype declares a `manages-physical-property` portfolio role (new portfolio role flag, see §8)
- `hidden` for MSP (offices are sites, not properties — but MSP can opt-in to use the `parentSiteId` for "region → office" hierarchies without activating this capability's UI)
- `hidden` for trades / salon / retail

**UI activation:** customer detail page navigation becomes: `Overview` | `Communities` | `Properties` | `Engagements` | `Billing` instead of the flat MSP-style `Overview | Sites | Estate | ...`. The Communities tab lists communities with property counts; clicking a community opens a community detail page with a property list + map.

**Default primary action (community map):** `open-community` — drills down to the community's property map.
**Default primary action (property pin):** `open-property` OR `log-violation` (when `geotagged-evidence-capture.applicability === "required"`).

**Data:** `CustomerSite.siteType ∈ {community, property, office, ...}`, `CustomerSite.parentSiteId` (self-relation), `CustomerSite.ownerName`, `CustomerSite.ownerContactId` (NEW — links property to a `CustomerContact` row for the property owner).

### 7.4 `geotagged-evidence-capture`

**Applicability rules (illustrative):**

- `required` when `community-property-tier.applicability === "required"` AND `axes.consumptionChannel === "physical"` (HOA: violation capture by driving observation)
- `recommended` when `dispatch-routing.applicability === "required"` (trades: proof-of-work photo at job site)
- `hidden` everywhere else

**UI activation:** the customer/community/property detail page gains a `Log evidence` action that opens a camera capture sheet (mobile-first; works on desktop with file upload as fallback). Capture includes auto-attached GPS coordinates, timestamp, optional violation category, free-text notes. On submit, the evidence record is created and routed to a review queue.

**Default primary action (map-pin click in violation-capture mode):** `log-violation` instead of `open-property`.

**Data:** new `EvidenceCapture` model OR extension of `PortfolioQualityIssue` (decision deferred to §10 WWMD-D2).

## 8. Activation Rules (detailed)

Add to the rules engine in `packages/storefront-templates/src/applicability-rules.ts`:

```ts
// customer-site-map
if (
  isApplicable(map.get("customer-estate"), ["required", "recommended"]) &&
  ["onsite-plus-portal", "physical"].includes(axes.consumptionChannel) &&
  ["business", "household"].includes(axes.primaryConsumer)
) {
  emit("customer-site-map", {
    applicability: "required",
    ownershipScopes: ["customer-account", "customer-site"],
    isolation: "strict-customer-scope",
    surfaces: ["customers", "map"],
    primaryActions: [
      { id: "open-customer-detail", label: "Open", surface: "map-pin", isDefault: true },
    ],
    sourceRules: ["customer-site-map-rule-1"],
  });
}

// dispatch-routing
if (
  axes.consumptionChannel === "physical" &&
  ["transactional", "appointment-checkout"].includes(axes.commercialModel) &&
  axes.primaryConsumer === "individual"
) {
  emit("dispatch-routing", {
    applicability: "required",
    ownershipScopes: ["customer-account", "engagement"],
    isolation: "strict-customer-scope",
    surfaces: ["customers", "dispatch"],
    primaryActions: [
      { id: "dispatch-tech", label: "Dispatch", surface: "map-pin", isDefault: true },
      { id: "open-customer-detail", label: "Open", surface: "list-row", isDefault: true },
    ],
    sourceRules: ["dispatch-routing-rule-1"],
  });
}

// community-property-tier
if (portfolios.productsAndServicesSold.scope === "primary" &&
    archetypePortfolioRoles.includes("manages-physical-property")) {
  emit("community-property-tier", {
    applicability: "required",
    ownershipScopes: ["customer-account", "customer-site"],
    isolation: "strict-customer-scope",
    surfaces: ["customers", "communities", "properties"],
    primaryActions: [
      { id: "open-community", label: "Open", surface: "map-pin", isDefault: true },
      { id: "open-property", label: "Open", surface: "list-row", isDefault: true },
    ],
    sourceRules: ["community-property-tier-rule-1"],
  });
}

// geotagged-evidence-capture
if (isApplicable(map.get("community-property-tier"), ["required"]) &&
    axes.consumptionChannel === "physical") {
  emit("geotagged-evidence-capture", {
    applicability: "required",
    ownershipScopes: ["customer-site"],
    transactionContexts: ["engagement"],
    isolation: "strict-customer-scope",
    surfaces: ["customers", "properties", "evidence"],
    primaryActions: [
      { id: "log-violation", label: "Log violation", surface: "map-pin", isDefault: false },
    ],
    sourceRules: ["geotagged-evidence-capture-rule-1"],
  });
}
```

### Portfolio role addition

Add a new portfolio role flag: `manages-physical-property`. Lives on `PortfolioDecomposition` per archetype, distinguishing archetypes that *operate against* physical property (HOA, property mgmt, building inspection, pest control) from archetypes that merely *visit* property (trades, MSP). Reasoning: visiting ≠ managing; the community-property-tier capability is only for managers.

## 9. Worked Examples

| Archetype | List | Map | Dispatch | Community/property tier | Evidence capture |
| --- | --- | --- | --- | --- | --- |
| MSP (`it-managed-services`) | required | required (site clusters) | hidden | hidden | hidden |
| HOA admin / property mgmt | required | required (community boundaries + property pins) | hidden | required | required |
| Trades (AC, plumbing, electrical) | required | optional | required (urgency × proximity) | hidden | recommended (proof of work) |
| Salon / single-location service | required | hidden | hidden | hidden | hidden |
| Retail (in-store) | required | optional (multi-store locator) | hidden | hidden | hidden |
| Retail (e-commerce only) | required | hidden | hidden | hidden | hidden |

This table is a **rendered view** of rules-engine output, not the source of truth, same as the §9 matrix in the topology spec.

## 10. Data Model Direction

### 10.1 First slice: minimal additions

Existing models we extend:

```prisma
model CustomerSite {
  // ... existing fields ...
  parentSiteId    String?       // NEW: self-relation for community → property
  parentSite      CustomerSite?  @relation("CustomerSiteHierarchy", fields: [parentSiteId], references: [id], onDelete: SetNull)
  childSites      CustomerSite[] @relation("CustomerSiteHierarchy")
  latitude        Float?         // NEW: decimal degrees, WGS84
  longitude       Float?         // NEW: decimal degrees, WGS84
  geocodedAt      DateTime?      // NEW: when lat/lng was resolved
  geocoder        String?        // NEW: which provider (nominatim, mapbox, manual)
  ownerName       String?        // NEW: property owner display name (HOA-relevant)
  ownerContactId  String?        // NEW: link to CustomerContact for the owner
  ownerContact    CustomerContact? @relation("CustomerSiteOwner", fields: [ownerContactId], references: [id], onDelete: SetNull)

  @@index([parentSiteId])
  @@index([siteType])  // already exists
  @@index([latitude, longitude])  // for bounding-box queries on the map
}

model Engagement {
  // ... existing fields ...
  urgencyTier     String         @default("scheduled")  // emergency | same-day | next-day | scheduled
  assignedTechId  String?
  // ... etc ...

  @@index([urgencyTier, status])
}
```

### 10.2 WWMD-D2 (Evidence record — M confidence)

Two options for evidence storage:

(A) **Extend `PortfolioQualityIssue`** with `evidenceMediaUrls Json?`, `evidenceLatitude Float?`, `evidenceLongitude Float?`, `evidenceCapturedAt DateTime?`. Reasoning: reuses the existing review-queue substrate (the issue model already has status, severity, triage decisions). Trade-off: conflates platform quality issues with customer-domain violations.

(B) **New `EvidenceCapture` model** with its own status enum (`pending-review` | `confirmed-violation` | `dismissed`), media URLs, GPS, captured-by, captured-at, related-site-id, related-engagement-id. Reasoning: separates domain concerns; lets HOA violation flow have its own state machine without polluting platform quality issues.

**WWMD pre-decision:** Option B. The "violation" workflow has a distinct state machine (issue notice → response window → citation → escalation) that doesn't belong in `PortfolioQualityIssue`. The cost of one new model is small; the cost of conflating two state machines is large. Confidence: M (could swing to A if the new-model surface turns out to need every field PortfolioQualityIssue already has).

### 10.3 Migration concerns

- `CustomerSite.parentSiteId` is nullable — no backfill needed; existing sites become root sites.
- `latitude`/`longitude` are nullable — no backfill. Geocoding is a background process.
- `Engagement.urgencyTier` defaults to `scheduled` — existing engagements are correctly classified.
- New `EvidenceCapture` model — no migration concerns beyond creating the table.

## 11. Map Pin Action Model (UI contract)

```ts
// apps/web/lib/customer-surface/pin-actions.ts (NEW)

import type { CapabilityActivation, PrimaryAction } from "@dpf/storefront-templates";

export type PinSurfaceContext = {
  surface: "map-pin" | "list-row" | "selection" | "detail-page";
  scope: "customer-account" | "customer-site" | "engagement";
  activeCapabilityKey: string;  // which capability "owns" the surface right now
};

export function resolvePinActions(
  activations: CapabilityActivation[],
  ctx: PinSurfaceContext,
): PrimaryAction[] {
  // Find the capability whose surfaces include the current surface and
  // whose activation is required/recommended.
  return activations
    .filter((a) => a.surfaces.includes(ctx.activeCapabilityKey))
    .flatMap((a) => a.primaryActions ?? [])
    .filter((action) => action.surface === ctx.surface);
}

export function resolveDefaultPinAction(
  activations: CapabilityActivation[],
  ctx: PinSurfaceContext,
): PrimaryAction | null {
  const actions = resolvePinActions(activations, ctx);
  return actions.find((a) => a.isDefault) ?? actions[0] ?? null;
}
```

UI components consume `resolveDefaultPinAction()` for default behavior, `resolvePinActions()` for menus. No archetype branching in any component.

## 12. UI Composition

Single component tree:

```text
<CustomerSurface>
  <CustomerSurfaceToolbar />           // Tab switcher: List | Map | Dispatch (active tabs from rules)
  <CustomerSurfaceBody>
    {activeTab === "list" && <CustomerListView />}
    {activeTab === "map" && <CustomerMapView />}
    {activeTab === "dispatch" && <CustomerDispatchView />}
  </CustomerSurfaceBody>
</CustomerSurface>
```

`<CustomerSurfaceToolbar />` reads the normalized profile to decide which tabs to render. Defaults to whichever tab corresponds to a `required`-applicability capability; falls back to `List` if none.

`<CustomerListView />` is always available — that's the baseline.

`<CustomerMapView />`, `<CustomerDispatchView />`, and the community detail surface are conditional. When they're not active, they're not imported into the bundle (use Next.js dynamic imports + the capability gate) so single-location archetypes pay no bundle cost.

`<CommunityDetailView>` is rendered under `/customers/[id]/communities/[communityId]` and is only routed when `community-property-tier.applicability === "required"`.

## 13. Acceptance Criteria

The first implementation slice is successful when:

1. The customer surface page is a single composition (`<CustomerSurface>`) with no `archetypeId` conditionals; all branching reads from `getCapabilityActivation(profile, ...)`.
2. The MSP archetype shows a `List + Map` toolbar with map pins per `CustomerSite` (office), centered on the metro area covering all sites. Pin click defaults to `open-customer-detail`.
3. The HOA admin archetype shows a `List + Map + Communities` toolbar; map renders community boundaries (or community centroids with property counts when boundaries aren't set); drilling into a community shows individual property pins with owner info. Pin click on a property defaults to `open-property` AND surfaces a `Log violation` secondary action.
4. The HOA archetype's "Log violation" action opens a camera-capture sheet that records photo + GPS + property reference, and creates an `EvidenceCapture` row in `pending-review` status.
5. A trade archetype (AC repair / plumbing) shows a `List + Dispatch` toolbar; `Dispatch` is the default tab; pin click defaults to `dispatch-tech`.
6. A salon archetype shows only `List`; no map UI imports load.
7. Adding the HOA archetype to the seed data emits the §9 capability set entirely from rules — zero hand-curated capability rows.
8. The Leaflet + OSM map renders without requiring any commercial API keys.
9. Geocoding requests route through the server-side proxy (no client-side third-party calls with customer addresses).
10. Existing test suites for customer-estate, scope-policy, archetype-activation continue to pass; topology isolation invariants from the companion spec remain intact.

## 14. Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Leaflet bundle size hurts cold-start for non-map archetypes | Dynamic-import map components; cap by capability activation |
| Nominatim rate limits in production | Server-side proxy with cache + queue; pluggable provider for self-hosters with higher needs |
| HOA owner data (names, addresses) becomes a PII concentration | Customer-scope isolation invariants from the companion spec already enforce row-level access. Audit: confirm `CustomerSite.ownerContactId` join doesn't leak across customers in any query path. |
| Map pin action wiring becomes a giant switch | Capability-declared `primaryActions` enforced by the rules engine; component reads, doesn't branch |
| `parentSiteId` self-relation creates query complexity (recursive selects) | Limit nesting to 2 levels in the first slice (community → property). Application code rejects depths > 2 until use case proves otherwise. |
| Mobile camera capture browser-API quirks | Start with `<input type="file" capture="environment">` (universally supported); upgrade to `getUserMedia` only after live-stream-preview becomes a need |
| WWMD pre-decisions accumulate without review | Each pre-decision is tagged `WWMD-N` and listed in §6.1; user can override one at a time in PR review |

## 15. Recommended Next Slices

1. **Land the new capability registry entries + rules engine emissions** in `packages/storefront-templates`. Tests cover MSP / HOA / trade / salon producing the §9 capability set entirely from rules.
2. **Add `PrimaryAction` to the activation profile contract** + `resolvePinActions` / `resolveDefaultPinAction` helpers.
3. **Add `CustomerSite.parentSiteId` + lat/lng/owner fields + migration**. Tests cover that existing sites still load (backward-compat); HOA seed creates community → property hierarchy.
4. **Build `<CustomerSurface>` + `<CustomerListView />`** (baseline; works for every archetype). Wire it onto `/customers` and replace the existing customer list page.
5. **Build `<CustomerMapView />`** with Leaflet + OSM; dynamic-imported under capability gate. Server-side geocoding proxy at `/api/v1/geocode`.
6. **Build `<CustomerDispatchView />`** for the trades archetype. Test against a synthetic AC-repair seed.
7. **Build the community detail view + `<CommunityMapView>`** for HOA. Test against a synthetic HOA seed.
8. **Build the `<EvidenceCaptureSheet />`** (camera + GPS + property reference). Wire it as the secondary action on HOA property pins.
9. **Plan the field-mobile slice** (offline capture, sync queue) as a separate spec once §1–8 are in production.

## 16. Open Questions Left For Mark

These are the WWMD pre-decisions where my confidence is M (not H). Mark can override any of them without re-spec'ing:

- **WWMD-4 (geocoding provider):** Nominatim default, or a commercial provider from day one? My recommendation is Nominatim; override if your daughter's HOA volume is high enough that Nominatim's free tier won't keep up.
- **WWMD-5 (camera capture):** Browser-first or native mobile app first? My recommendation is browser-first.
- **WWMD-D2 (evidence record model):** New `EvidenceCapture` model or extend `PortfolioQualityIssue`? My recommendation is new model.

Everything else (H confidence) I'd land without re-asking.
