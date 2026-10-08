---
title: "Address Validation Providers"
area: platform
order: 6
---

## Use This Doc For

- Choosing a commercial address provider for customer site create/edit
- Understanding the one-active-provider rule
- `/platform/tools/built-ins` address validation guidance

## Why It Matters

Customer site records need a validated address before save. Without a provider, create/edit cannot resolve a verified street location. Pick one commercial provider that matches where your customers live, keep only that key active, and treat free OSM lookup as a fallback — not the primary field path.

## Choose A Provider

| Provider | Best for | Key needed |
| --- | --- | --- |
| **Smarty** | US postal accuracy and suite/unit detail | Yes |
| **Mapbox** | Multi-country sites and map-aligned coordinates | Yes |
| **Nominatim (OSM)** | Offline / no-key installs (lower commercial precision) | No |

**Rule:** enable **one commercial** provider at a time. Two live commercial keys can return conflicting candidates for the same site.

### Geography hint

- Mostly US sites → start with **Smarty**
- Sites in several countries → start with **Mapbox**
- No commercial key available → Nominatim only, accept weaker precision

### Using the free Nominatim service

Nominatim is run by the OpenStreetMap Foundation under a [usage policy](https://operations.osmfoundation.org/policies/nominatim/). DPF follows it, and the site form behaves accordingly:

- **Search is explicit.** Type at least three characters of the street address, then press **Search** or Enter. Results do not appear as you type, because the policy forbids search-as-you-type.
- **One request per second.** Searches from everyone on the install are spaced at least one second apart, so a busy moment can add a short wait.
- **Repeat searches come from a cache** for 24 hours instead of asking the service again.
- **Attribution.** The form shows "© OpenStreetMap contributors" under the search box.

If many people add sites at once, configure a commercial provider instead. Heavy use of the free service can get the install's address blocked.

## Finding Map Locations For Existing Sites

Validation places a site when it is saved. For sites saved without a position,
the [Customer Map](../customers/customer-map.md) can find locations in bulk with a
service you choose: US Census, OpenCage, or your own Nominatim or Photon server.
It is off by default. The free public Nominatim service is never used for this,
because its usage policy does not allow bulk lookups.

With one of those services chosen, a site, a business location or the
business's own address saved without a position is looked up automatically in
the background, one address at a time at the service's pace. A position a
person chose is never replaced.

## Setup Steps

1. Open **Platform → Tools → Built-in Tools** and read the Address validation card.
2. Register or configure the chosen provider under **Platform → Tools → Services** (or the catalog activation path).
3. Confirm the Built-in Tools card shows the provider as registered.
4. Create a test customer site with a real street address and confirm validation succeeds.
5. After key rotation, re-check that only one commercial provider is still active.

## What To Watch

- Two commercial providers both marked active
- Site create failing with “validated address selection is required” when no provider is configured
- Using Nominatim as primary for delivery or field-service routes

## Related

- [Tools and Integrations](tools-and-integrations.md)
- Customer site create under CRM account detail
- [Customer Map](../customers/customer-map.md)
