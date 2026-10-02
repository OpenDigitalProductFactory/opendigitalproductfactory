---
status: draft
---

# Customer map and provider-swappable geocoding — implementation plan

- **Backlog item:** `BI-560128FB`
- **Epic:** `EP-SPATIAL-OPERATIONAL-VIEWS`
- **Design:** [2026-10-02-customer-map-and-geocoding-design.md](../specs/2026-10-02-customer-map-and-geocoding-design.md)

> **For agentic workers:** one BI, one branch, one PR. Use `dpf-tdd` red-green for each phase, run the fast local gate before push, and use `dpf-pr-with-dco` for handoff.

## Backlog coverage

- Parent: `BI-560128FB`
- Decision: atomic
- Baseline: the spec-approval baseline minted from the design's objective and acceptance markers
- Receipt: blocked-by: record_plan_backlog_coverage binds the immutable blob of this exact file, so the receipt can only be minted after this commit is pushed; it is then held in the live backlog against BI-560128FB rather than copied back here, because copying it would change the blob it binds
- Rationale: the map view, its "not on the map" fixes and the provider boundary are one owner outcome: seeing every customer site on a map. A map with no way to place the missing sites shows an incomplete picture, and a provider with no map has nothing to feed.
- Dependencies: `BI-814F86E1` (the map engine, PR #5906)

### Traceability

| Deliverable | Objectives | Contracts | Flow | Acceptance |
|---|---|---|---|---|
| customer-map-and-geocoding (`BI-560128FB`, phases 1–4) | OBJ-CMAP-VIEW, OBJ-CMAP-FIX, OBJ-CMAP-PROVIDER | `apps/web/lib/crm/customer-map.ts`, `apps/web/lib/geocoding/providers.ts`, `apps/web/lib/geocoding/backfill.server.ts` | An owner sees customer sites on the map, places the missing ones, and optionally backfills through a chosen provider | AC-CMAP-VIEW-1, AC-CMAP-VIEW-2, AC-CMAP-FIX-1, AC-CMAP-FIX-2, AC-CMAP-PROVIDER-1, AC-CMAP-PROVIDER-2 |

## Phase 1 — Customer map scene

- `apps/web/lib/crm/customer-map.ts` builds a `GeographicSceneLayout` of customer-site placements from addresses that have coordinates, and returns the sites that do not.

**Tests:** placements only for sites with coordinates; the not-on-the-map list; bounds; an empty install.

## Phase 2 — Map view, fixes and the workspace primitive

- `/customer?view=map` renders `GeographicSceneCanvas` above the existing account list. A "Not on the map" disclosure lists sites, each with "Check the address" (the existing validated-address field) and "Place on the map".
- The manual pin is a server action gated on `view_customer`. It writes `latitude`, `longitude`, `validatedAt` and `validationSource = "manual-pin"` on the site's `Address`.
- `GeographicSceneCanvas` gains an optional `onPlacePoint(latitude, longitude)` for pin placement.
- The `geo-map` primitive renders the compact customer map for the `customer-map` slot.

**Tests:** the view switch; the not-on-the-map list and both fixes; the manual pin action, including permissions; the primitive rendering.

## Phase 3 — Provider boundary and backfill

- `apps/web/lib/geocoding/providers.ts` defines the `geocodeAddresses` interface and the `none`, `census`, `opencage` and `self-hosted` adapters. The provider choice is the `PlatformConfig` key `geocoding.provider`; the OpenCage key comes from the credential store.
- `apps/web/lib/geocoding/backfill.server.ts` runs a throttled, cached background backfill of missing coordinates. It never overwrites `manual-pin` or lookup-picked coordinates.
- Administrator controls, gated on `manage_platform`: choose the provider and start the backfill, with counts for placed, not found and remaining.

**Tests:**
- the `none` provider sends nothing;
- each adapter's request shape, with fetch mocked;
- the rate limit and cache;
- confirmed coordinates are never overwritten.

## Phase 4 — Gate, UX and documentation

- UX-fit record; typecheck, affected tests and the build gate.
- UX check on the contributor preview: light and dark themes, phone width, and keyboard use.
- User guide for the customer map, and the geocoding provider section.
