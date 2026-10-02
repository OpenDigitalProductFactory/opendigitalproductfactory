---
status: draft
---

# Customer map and provider-swappable geocoding: design (BI-560128FB)

| Field | Value |
|-------|-------|
| **Created** | 2026-10-02 |
| **Author** | Claude Opus 5.5 for Mark Bodman |
| **Backlog** | `BI-560128FB` (P2) · epic `EP-SPATIAL-OPERATIONAL-VIEWS` |
| **Parents** | [Geographic footprint, coverage and live overlays](./2026-09-23-geographic-footprint-coverage-and-live-overlays-design.md) §3, §5, §7 P2 · [field dispatch ADR-9](./2026-06-13-field-dispatch-capability-design.md) |
| **Builds on** | The map engine, `BI-814F86E1` (PR #5906: `GeographicSceneCanvas`, map packs) · the address lookup made policy-compliant by `BI-3099EACD` (PR #5893) |
| **Decision** | WWMD `DI-45329D903094`: default to no provider, map what already has coordinates, fix the rest one at a time, and allow an opt-in bulk-permitted provider for backfill. High confidence, over auto-backfilling through public Nominatim or staying manual-only for good. |
| **Out of scope** | Routing and drive times, the phone map (`BI-3DAE2169`), coverage areas (`BI-6CC10E4C`), HOA lot maps (P4) |

## 1. Problem

The customer area has no map. The `customer-map` workspace slot is registered on the field-service and route homes in `apps/web/lib/workspace-home/profiles.ts` and points at the `geo-map` primitive, but nothing renders that primitive.

Coordinates exist only partly. Since the address lookup was introduced, a newly validated customer site stores `Address.latitude` and `Address.longitude` (`apps/web/lib/actions/customer-sites.ts`). Older addresses, and any address entered before a lookup existed, have none: this install has one address and no coordinates. Field-dispatch ADR-9 requires that a map view works without any geocoding provider, and forbids bulk geocoding against a public endpoint.

## 2. What this item delivers

1. **A map view of customer sites.** The customer page gains `?view=map` beside its existing grid and board views. It shows one point per customer site that has coordinates, labelled with the account name, using `GeographicSceneCanvas`. The existing list stays the accessible equivalent and is always shown with the map. Selecting a point highlights the account's row and links to the account.
2. **"Not on the map".** Sites without coordinates are counted and listed under the map. Each has two fixes:
   - **Check the address**, which opens the existing validated-address field for that site. A pick stores the lookup's coordinates, exactly as site creation does today.
   - **Place on the map**, which lets the owner click the point on the map. It stores `validationSource = "manual-pin"` and `validatedAt`.
3. **The `geo-map` workspace primitive** renders the same customer map in compact form for the homes that already declare a `customer-map` slot.
4. **A geocoding provider boundary**, `apps/web/lib/geocoding/`:
   - It exposes one interface, `geocodeAddresses(addresses)`, returning `{ latitude, longitude, precision, source }` or a typed "not found" result per address.
   - Providers are `none`, the default, which geocodes nothing; `census`, the US Census batch geocoder for US addresses; `opencage`, with a key from the credential store; and `self-hosted`, a Nominatim- or Photon-compatible URL the operator runs.
   - Public Nominatim and the Google and Mapbox geocoders are not providers here. Public Nominatim forbids bulk use, and the other two forbid keeping results.
   - The provider is a `PlatformConfig` key, `geocoding.provider`, set by an administrator.
5. **An opt-in backfill.** With a provider other than `none`, an administrator can backfill missing coordinates for customer sites. The backfill:
   - runs in the background at the provider's rate limit and caches by normalized address;
   - stores the result with `validationSource` set to the provider id;
   - never overwrites coordinates that came from a lookup pick or a manual pin.

   Progress shows as counts: placed, not found, and remaining.

## Objectives and acceptance

- **OBJ-CMAP-VIEW:** An owner can see their customer sites on a map from the customer area, with the list always alongside as the accessible equivalent.
- **OBJ-CMAP-FIX:** Every site that is not on the map is named, and the owner can place it by checking the address or pinning it by hand, with no geocoding provider configured.
- **OBJ-CMAP-PROVIDER:** Geocoding runs only through a provider an administrator chose, never in bulk against a public service, and never overwrites coordinates a person confirmed.

| Acceptance | Objectives | Statement |
|---|---|---|
| AC-CMAP-VIEW-1 | OBJ-CMAP-VIEW | `/customer?view=map` shows one point per customer site with coordinates, and the account list is rendered on the same page. |
| AC-CMAP-VIEW-2 | OBJ-CMAP-VIEW | The `geo-map` primitive renders the customer map on the workspace homes that declare a `customer-map` slot. |
| AC-CMAP-FIX-1 | OBJ-CMAP-FIX | Sites without coordinates are counted and listed, each with "Check the address" and "Place on the map". |
| AC-CMAP-FIX-2 | OBJ-CMAP-FIX | A manual pin stores the point with `validationSource = "manual-pin"`, and the site then appears on the map. |
| AC-CMAP-PROVIDER-1 | OBJ-CMAP-PROVIDER | With the default provider `none`, no geocoding request leaves the install and the backfill is unavailable. |
| AC-CMAP-PROVIDER-2 | OBJ-CMAP-PROVIDER | The backfill fills only missing coordinates, respects the provider's rate limit, and leaves lookup-picked and manual-pin coordinates untouched. |

## 3. Design choices and their reasons

| Choice | Alternatives rejected | Why |
|---|---|---|
| Default provider `none` | Auto-backfill through public Nominatim | ADR-9 and the OSMF policy forbid bulk use of the public service; WWMD `DI-45329D903094` |
| A map view of the existing customer page | A separate map page | One home per capability; the list and map show the same records |
| Manual pin stored in `Address` | A new location table | `Address` already has coordinates and a validation source; no schema change |
| Census, OpenCage and self-hosted adapters only | Google and Mapbox geocoders | Their terms forbid keeping results, which a cached map needs |

## 4. Research & Benchmarking

- **Frappe / ERPNext:** any record with a geolocation field gets a map view automatically. DPF adopts the idea of a map view of an existing record list, and rejects Leaflet (raster only; react-leaflet is not OSI-licensed).
- **SuiteCRM:** a bundled Google Maps module geocodes in a cron job and caches results in custom fields. DPF adopts batch geocode-and-cache, and rejects Google, whose terms allow caching coordinates for only 30 days.
- **Odoo:** depends on a Mapbox token for its map view. DPF rejects the keyed, single-vendor dependency; the map engine serves install-managed packs.
- **Standards:** RFC 7946 GeoJSON for points, and the US Census Geocoder batch interface for the `census` provider.

## 5. Security and privacy

- Customer addresses leave the install only when an administrator chooses a provider. The `none` default sends nothing.
- A provider key is stored through the existing credential store, never in `PlatformConfig`.
- The map, the list and the backfill controls need the same permission as the customer list (`view_customer`); changing the provider and starting a backfill need `manage_platform`.

## 6. Verification

- **Unit tests:**
  - map scene building from sites, and the not-on-the-map split;
  - the manual pin action;
  - the `none` provider sending nothing;
  - each adapter's request shape, with fetch mocked;
  - the backfill's rate limit, caching and refusal to overwrite confirmed coordinates.
- **UX:** the map view and its fallbacks in light and dark themes and at phone width, on the contributor preview.
- **Build gate:** typecheck, affected tests and the production build.

## 7. Documentation impact

- `docs/user-guide/customers/`: the map view and how to fix sites that are not on the map.
- `docs/user-guide/platform/address-validation-providers.md`: geocoding providers and the backfill.
