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
