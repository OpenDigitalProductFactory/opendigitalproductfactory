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

## Which Map Pack You Need

You do not have to work out which region to install. Administrators see a
**Street maps** list on the customer map, under **Find locations automatically**.
It groups your placed locations (customer sites, your business locations and
your business's own address) by state or province, and for each one says either:

- that an installed pack already covers it, naming the pack; or
- that no pack covers it yet, how many locations are there, and the pack to
  install, such as `us-kansas`.

The same answer, with the exact area each pack should cover, is available to
installation tooling at `/api/map-assets/recommendation` (administrators only).

## Install A Recommended Map Pack

Next to a region that no pack covers, select **Install the <region> street
map**. DPF downloads just that region's street data from the Protomaps build of
OpenStreetMap, checks it, and adds it to your map packs. You can leave the page
while it works. While it stays open, the panel updates as each step finishes
and says when the map is installed, or why it didn't. Installation tooling can
read the same status at `/api/map-assets/install-status` (administrators only).

- It covers the region around your own locations, with full street detail for a
  state or province. A very large region is installed with slightly less
  detail so the download stays a sensible size.
- Only administrators can start it, and one map installs at a time.
- Only the region's map tiles are requested. No customer data is sent.
- A pack is only offered to maps once it is complete and checked, so a stopped
  install never shows a half-drawn map. A brief interruption is retried
  automatically and continues from the part it reached. If the install fails,
  its partly downloaded file is removed and **Install** starts the download
  again from the beginning.
- If an install stops making progress for 30 minutes, the panel says so and
  **Install** becomes available again.

## Attribution

Street data in map packs comes from OpenStreetMap contributors under the ODbL. Each map shows the attribution recorded in its pack's manifest. Do not hide it.

## Privacy

Map data is served only to signed-in users of your installation. Nothing about what you look at on a map leaves your installation.
