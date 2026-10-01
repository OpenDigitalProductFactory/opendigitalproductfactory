---
status: draft
---

# Market footprint world view — implementation plan

**Backlog item:** `BI-4EC1D572`
**Epic:** `EP-SPATIAL-OPERATIONAL-VIEWS`
**Design:** [2026-09-26-market-footprint-world-view-design.md](../specs/2026-09-26-market-footprint-world-view-design.md)

> **For agentic workers:** one BI, one branch, one PR. Use `dpf-tdd` red-green for each phase, run the fast local gate before push, and use `dpf-pr-with-dco` for handoff.

## Backlog coverage

- Parent: `BI-4EC1D572`
- Decision: atomic
- Receipt: blocked-by: record_plan_backlog_coverage returned traceability-incomplete on 2026-09-29 because no initiative scope baseline exists for BI-4EC1D572; the implementation claim itself was allowed at medium shape
- Rationale: The projection alone has no screen, the outlines alone have no data, and the route renders nothing without both, so no phase is usable by an owner on its own.
- Dependencies: none (the MapLibre renderer, BI-814F86E1, is deliberately not a dependency; the world view is a static SVG)

## Phase 1 — Country outlines (vendored data)

Generate the country outline data once, from Natural Earth 1:110m admin-0 (public domain). A one-off script uses throwaway tooling outside the repo, and adds no dependency to any workspace. It projects the outlines with Equal Earth, simplifies them to a size budget of 250 KB or less, and writes `apps/web/lib/footprint/world-country-paths.generated.json` with this shape:

```
{ viewBox, source, generatedAt, countries: [{ isoNumeric, isoA2, name, d }] }
```

The regeneration steps are recorded in `apps/web/lib/footprint/README.md`.

**Test:** every entry has a valid path, the `isoNumeric` values are unique, and there are at least 170 countries.

## Phase 2 — Projection

`apps/web/lib/footprint/market-footprint.server.ts` provides `loadMarketFootprint(orgId)`, built from:

- `BusinessContext` (`sellsTo`, `operatesIn`);
- `MarketingStrategy.serviceTerritories`;
- `CustomerSite → Address → City → Region → Country`;
- `EdgeNode.customerSiteId` joined to active `ProductFulfillmentInstance`s;
- `OrgSettings.locale`.

The pure core in `market-footprint.ts` maps these rows to country summaries plus `unplacedCustomers`.

**Tests:**
- an account with sites in two countries counts once in each;
- the unplaced count;
- language fit;
- target-market union;
- empty data.

## Phase 3 — Map and page

- `apps/web/components/customer/footprint/WorldFootprintMap.tsx`: a server-rendered SVG coloured from `--dpf-*` tokens, where each state carries a pattern or outline as well as colour.
- `apps/web/components/customer/footprint/FootprintTable.tsx`: the table at parity with the map.
- `apps/web/components/customer/footprint/FootprintLayerSwitch.tsx`: the layer control, the only client component.
- `apps/web/app/(shell)/customer/footprint/page.tsx`: the page.
- Register the "Market footprint" tab in the Customer section navigation and in `resolveCustomerSurface`.

**Tests:**
- the map fill for each layer;
- table parity with the map;
- the empty state;
- the tab appears for `software-platform` and not for local-only archetypes.

## Phase 4 — Gate, UX and documentation

- Run the typecheck, the affected tests and the production build.
- UX-verify on the Contributor preview: light and dark themes, phone width, and keyboard selection. Record screenshots.
- Write the user guide, `docs/user-guide/customers/market-footprint.md`.
