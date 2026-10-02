---
title: "Map Packs"
area: platform
order: 7
---

## Use This Doc For

- Knowing what DPF maps need, and what they work without
- Where an installation keeps its street-map data
- Map attribution and privacy

## Why It Matters

DPF draws maps inside your own installation. There is no Google or Mapbox account, no API key, and your data never goes to a map company. Territories, service areas, and your customers' and homes' locations stay on your server.

## What Works Without A Map Pack

Every map works without a map pack. Zones, service areas and pins are drawn at their real positions on a plain background, and the world view of markets and customers needs no pack at all. Every map screen also has a list alongside it, so no task depends on seeing the map.

## What A Map Pack Adds

A map pack adds the street layer: roads, water, parks and names. Each pack is a single file covering one region, and it is kept outside the portal image so that upgrades stay small.

| Setting | Default |
| --- | --- |
| Where packs live | `/var/lib/dpf/maps` (the `map_data` volume); override with `DPF_MAP_DATA_DIR` |
| Files per pack | `<pack-id>.pmtiles` and `<pack-id>.manifest.json` |
| Checks before use | The manifest must be valid and the file size must match it. Otherwise the pack is ignored and the map says so. |

A map screen tells you when it has no pack for the area you are looking at. It does not show a blank grey box.

## Attribution

Street data in map packs comes from OpenStreetMap contributors under the ODbL. Each map shows the attribution recorded in its pack's manifest. Do not hide it.

## Privacy

Map data is served only to signed-in users of your installation. Nothing about what you look at on a map leaves your installation.
