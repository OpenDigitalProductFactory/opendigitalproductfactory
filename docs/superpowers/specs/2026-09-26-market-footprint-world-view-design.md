---
status: draft
---

# Market footprint world view — design (BI-4EC1D572)

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-09-26 |
| **Author** | Claude Opus 5.5 for Mark Bodman |
| **Backlog** | `BI-4EC1D572` · epic `EP-SPATIAL-OPERATIONAL-VIEWS` |
| **Parent** | [Geographic footprint, coverage and live overlays](./2026-09-23-geographic-footprint-coverage-and-live-overlays-design.md) §3.1 and §9 (placement and deployment-source decisions) |
| **Decisions** | WWMD 2026-09-26 `static-svg-choropleth` (high confidence, margin 0.25) · operator 2026-09-23: deployments come from CRM first |
| **Out of scope** | Opt-in federation country sharing (`BI-06EA3167`), street-level zoom (needs `BI-814F86E1`), geocoding |

## 1. Problem

A software-platform business, DPF itself included, cannot see where it sells, where its customers are, or where it is deployed. The platform is English-only, so market fit is a real constraint, and today nothing shows it. The data exists but is never put together:

- `BusinessContext.sellsTo` and `operatesIn` (ISO 3166-1 alpha-2 arrays);
- `MarketingStrategy.serviceTerritories`;
- customer site addresses (`CustomerSite → Address → City → Region → Country`);
- `OrgSettings.locale`.

## 2. What this item delivers

1. **The route `/customer/footprint`, a "Market footprint" tab.** It sits in the Customer area and is gated by `view_customer`. The tab resolves through the existing `resolveCustomerSurface` archetype surface, so it appears for `software-platform` and for any archetype whose marketing strategy has a non-local `localityModel`.
2. **The projection `loadMarketFootprint(orgId)`,** a server-only function built from existing models only. Each ISO-2 country carries:
   - `targetMarket` (in `sellsTo ∪ operatesIn`);
   - `customerCount` (distinct `CustomerAccount` with at least one site whose address resolves to that country);
   - `deploymentCount`: distinct `CustomerSite`s in that country hosting an `EdgeNode` with an `active` `ProductFulfillmentInstance`. The path is `ProductFulfillmentInstance.edgeNodeId → EdgeNode.customerSiteId → CustomerSite → Address`. This is the CRM-derived source the operator chose on 2026-09-23. Self-installed users stay invisible until `BI-06EA3167`;
   - `languageFit` (the country's primary language is among the platform's supported locales).

   It also returns `unplacedCustomers`: accounts with no site, or a site with no country. This figure is always shown and never dropped.
3. **The world map.** A server-rendered SVG choropleth drawn from vendored Natural Earth 1:110m country outlines, which are public domain. The outlines are pre-projected once with the Equal Earth projection and committed as path data keyed by ISO 3166-1 numeric code, joined through `Country.numericCode`. It has no runtime dependency, no WebGL and no network call, and it works on every install.
4. **Layers are selected with a segmented control, not overlaid:**
   - Target markets;
   - Customers (sequential shading by count);
   - Deployments;
   - Language fit.

   Each state is carried by a pattern or outline as well as colour, and every colour comes from a `--dpf-*` token.
5. **The accessible table at parity:** country, target market, customers, deployments and language fit, sortable, with the "unplaced" row pinned at the top. Selecting a country on the map or in the table highlights it in both.

## 3. Design choices

| Choice | Rejected | Why |
|---|---|---|
| Static SVG choropleth | MapLibre with a GeoJSON country layer | Country-level only; keeps no-WebGL and SSR paths; no wait on `BI-814F86E1` (WWMD, margin 0.25) |
| Vendored pre-projected paths | A runtime geo library (d3-geo, topojson) | Absorb, don't adopt: generate once and commit, and record how to regenerate |
| Own tab in the Customer area | A workspace-home component | Workspace-home components render as identity labels only (`VerticalWorkspaceHome.tsx`); a live map needs a page |
| Counts come from site addresses | A new country field on `CustomerAccount` | Use the existing substrate and create no parallel location store (parent §2) |

## 4. Research & Benchmarking

See parent §5. Specific to country choropleths:
- Grafana's Geomap and most BI tools use Natural Earth with ISO-joined fills.
- Natural Earth is public domain and needs no attribution.

Standards: ISO 3166-1 (alpha-2 in data, numeric for the join) and WCAG 2.2 AA (1.4.1 use of colour, 1.4.11 non-text contrast).

## 5. Verification

- **Unit tests:**
  - the projection: counts, the unplaced figure, language fit, and a multi-site account counted once per country;
  - the SVG builder: every country is present, the ISO join is correct, and no path is left unmatched;
  - the page: fallback text when there is no data, and table parity with the map.
- **UX, on the Contributor preview:** light and dark themes, phone width, and keyboard selection. Screenshots are recorded as evidence.
- **Build gate:** typecheck, the affected tests, and a production build.

## 6. Documentation impact

A new user-guide page, `docs/user-guide/customers/market-footprint.md`.
