---
status: draft
---

# Install the recommended street-map pack: design (BI-43BBCC26)

| Field | Value |
|-------|-------|
| **Created** | 2026-10-07 |
| **Author** | Claude Opus 5.5 for Mark Bodman |
| **Backlog** | `BI-43BBCC26` · epic `EP-SPATIAL-OPERATIONAL-VIEWS` |
| **Parent** | [Automatic location capture](./2026-10-07-automatic-location-capture-design.md) §2.3, which recommends the region and left fetching to this item |
| **Builds on** | Map packs and manifests (`BI-814F86E1`), region recommendation (`BI-8C76920D`), the pinned `pmtiles@4.5.0` reader ([tool evaluation](../../security/tool-evaluations/2026-09-25-maplibre-pmtiles.md)) |
| **Decision** | WWMD `DI-438A1ECEABA3`: extract inside the portal with the pinned reader and a small v3 writer, run as a job, started by one administrator click. High confidence, margin 2.07 over a host-side `go-pmtiles` script and over adding that binary to the image. It supersedes `DI-B48FA1D225B4`'s host-side step, which was chosen only to avoid a new binary. |

## 1. Problem

The Street maps panel now names the pack each uncovered region needs, such as `us-kansas`. Someone still has to cut that region from the Protomaps planet build and copy two files into `/var/lib/dpf/maps`. The operator had to do this by hand for Texas.

## 2. What this item delivers

1. **Install from the panel.** Each region the panel lists as not covered gets **Install this street map**.
   - The server recomputes the recommendation and installs only a pack it recommends for an uncovered region. The browser names a pack id and never supplies bounds.
   - The button requires `manage_platform`.
   - Only one install runs at a time.
2. **A resumable install job.** `map-pack/install` runs through the `@/lib/jobs` facade in three kinds of step:
   - **plan:** read the newest build from `build-metadata.protomaps.dev/builds.json`. Read the source header, root directory and metadata, and only the leaf directories that overlap the region. Lay out the extract, and write its header, directories and metadata into a staging file in the map volume.
   - **one step per download chunk:** each chunk is at most 32 MiB of merged byte ranges, read with `Range` and `If-Match` on the build's ETag, so a rebuilt object can never be mixed in. The tiles are written in place. A retried step rewrites the same bytes.
   - **finalize:**
     - check the staged size and that the pinned reader parses the header and root directory;
     - hash the file with SHA-256;
     - write a manifest that `validateMapPackManifest` accepts;
     - move the pack into place first, then the manifest.

     A pack is listed only once its manifest exists and its size matches, so a half-written pack is never served.
3. **Bounded size.** The maximum zoom is the source's (15), lowered for a region whose tiles from z0 up would exceed 4 million. Texas is about 2.2 million tiles at z15, so a state keeps full street detail and a very large region still installs.
4. **Progress.** The panel shows preparing, part *n* of *m*, checking, installed, or failed. Progress is kept in `PlatformConfig` key `map-packs.install.status`, the pattern the geocoding backfill uses.

## Acceptance

- **AC-1:** For a region the panel lists as not covered, **Install this street map** installs a pack and manifest into the map directory. The panel then lists the region as covered by that pack, and `/api/map-assets` lists it.
- **AC-2:** The extract contains exactly the source's tiles inside the recommended bounds from z0 to the chosen maximum zoom, byte for byte, and no tiles outside them.
- **AC-3:** An install that stops part way resumes at its next step. A source that changes during the install is refused rather than mixed in. Nothing is listed until the manifest is written.
- **AC-4:** Only an administrator can start an install. Only a recommended, uncovered pack id is accepted, and only one install runs at a time.

## 3. Research & Benchmarking

- **go-pmtiles `extract` (open source, BSD-3).** The reference extractor.
  - It computes the wanted tile set per zoom for a bounding box, walks the directory reading only the overlapping leaves, deduplicates contents, merges nearby byte ranges with a small over-fetch allowance, and writes a two-level directory.
  - **Adopted:** each of those steps, rewritten in TypeScript with the same constants: a 16 KiB header-plus-root budget and leaves sized in powers of two.
  - **Rejected:** shipping the binary. Absorb-don't-adopt applies, and the pinned reader already parses the source.
- **OpenMapTiles / MapTiler data downloads (commercial).** Region packs are bought or downloaded as fixed country or state files.
  - **Adopted:** naming packs by region.
  - **Rejected:** fixed boundaries, which this design replaces with bounds padded around the business's own locations, and the licence key.
- **Mapbox and Google offline regions (commercial SDKs).** Offline packs are downloaded by bounding box and zoom range, with a tile-count limit enforced before download.
  - **Adopted:** the tile-count budget checked before anything is downloaded.
- **Standards:**
  - [PMTiles v3 specification](https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md) for the header, varint directories and clustering;
  - RFC 9110 range requests and `If-Match` for consistent reads of an immutable object.

## 4. Security and privacy

- The only outbound requests go to the Protomaps build host. They carry tile ranges and no customer data. The bounds are padded, so the requests reveal a region, not addresses.
- Requests are made only on an administrator's click. Nothing downloads on a schedule.
- Every file write stays inside the map volume. Pack ids are checked against the manifest's pattern before any path is built.
- The ODbL and ESA WorldCover attribution is recorded in the manifest and shown on the map, as for hand-installed packs.

## 5. Verification

- **Unit tests:** v3 encoding round trips, header bytes read back by the pinned reader, the leaf split, tile ranges, the directory walk, and layout and chunking.
- **End to end, offline:** a synthetic clustered archive with leaf directories is served through a range-honouring fake `fetch`. The install runs plan, every chunk, a repeated chunk, and finalize. The pinned reader then returns each tile inside the bounds byte for byte and none outside. A changed ETag is refused.
- **Action tests:** the permission check, recommended and uncovered packs only, and one install at a time.
- **Runtime:** on a nonproduction install, install a small region from the real build and see it served and listed as covered.
