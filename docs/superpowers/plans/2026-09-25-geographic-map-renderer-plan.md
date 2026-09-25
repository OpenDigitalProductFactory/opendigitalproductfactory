---
status: draft
---

# Geographic map renderer — implementation plan

**Backlog item:** `BI-814F86E1`
**Epic:** `EP-SPATIAL-OPERATIONAL-VIEWS`
**Design:** [2026-09-25-geographic-map-renderer-design.md](../specs/2026-09-25-geographic-map-renderer-design.md)
**Supersedes the unexecuted steps 1 and 3–5 of:** [2026-08-01-territory-map-substrate.md](./2026-08-01-territory-map-substrate.md). That plan's pure-contract step (step 2) is merged.
**Downstream, separately filed:** `BI-4EC1D572` (P1 market footprint, first mounted surface), `BI-3DAE2169` (phone renderer), `BI-560128FB` (customer map)

> **For agentic workers:** one BI, one branch, one PR. Use `dpf-tdd` red-green for each phase, run the fast local gate before push, and use `dpf-pr-with-dco` for handoff.

## Coverage decision: atomic

The phases below are one indivisible capability. A dependency with no renderer ships unused code. A renderer with no worker route cannot start. A range route with no renderer has no caller. So there is no independently usable owner outcome short of all four phases, and the coverage receipt records `atomic` against `BI-814F86E1`.

## Phase 1 — Dependency gate

- Pin `maplibre-gl@6.11.2` and `pmtiles@4.5.0` exactly in `apps/web/package.json` and update `pnpm-lock.yaml`.
- Record both in `packages/db/data/approved_tools_registry.json`, with evidence in `docs/security/tool-evaluations/2026-09-25-maplibre-pmtiles.md`.
- Run `pnpm audit` for the two packages; record the result in the PR.

**Requirements:** design §2.1 and the tool-evaluation conditions 1–2.

## Phase 2 — Map-data store and asset routes

Files:
- `apps/web/lib/twin/map-assets.server.ts`, which provides:
  - `resolveMapDataDir()` (reads `DPF_MAP_DATA_DIR`, defaulting to `/var/lib/dpf/maps`);
  - `listInstalledMapPacks()`, which returns only packs whose manifest is valid;
  - `openMapPack(packId)`, which resolves an allowlisted id to a file under the root, checks its length against the manifest, and returns the typed result `missing | invalid | ok`.
- `apps/web/app/api/map-assets/route.ts`: the catalogue.
- `apps/web/app/api/map-assets/[packId]/route.ts`: `GET` and `HEAD`, a single range, ETag equal to the manifest SHA-256, and `206`/`416`/`404`/`409` responses.
- `apps/web/app/api/map-assets/runtime/[file]/route.ts`: serves exactly `maplibre-gl-worker.mjs` and `maplibre-gl-shared.mjs` from the pinned package.
- `apps/web/next.config.mjs`: `outputFileTracingIncludes` for those two files.
- `docker-compose.yml`: a `map_data` named volume mounted at `/var/lib/dpf/maps` on the portal.
- `docs/install/platform-support-watchlist.md`: rows for the volume and for the future CSP worker directive.

Tests (vitest), written before the code:
- a full response;
- a partial response;
- a suffix range;
- a multi-range request refused with `416`;
- `HEAD`;
- a missing pack;
- a length mismatch;
- traversal attempts, including `..` and encoded separators;
- a pack id that fails the pattern;
- an unauthenticated call;
- a runtime file outside the allowlist.

**Requirements:** design §2.2–2.3 and §5.

## Phase 3 — Style, capability and renderer

Files:
- `apps/web/components/twin/geographic/geographic-style.ts`: a pure builder from `--dpf-*` token values plus an optional pack. It emits no `glyphs`, `sprite` or off-origin URL.
- `apps/web/components/twin/geographic/geographic-capability.ts`: a pure resolver returning `renderer-ready`, `webgl-unavailable`, `region-pack-missing` or `region-out-of-coverage`.
- `apps/web/components/twin/geographic/GeographicSceneCanvas.tsx`, a client component that:
  - dynamically imports both packages;
  - calls `setWorkerUrl` and registers the PMTiles protocol once;
  - adds the zone and placement sources and layers from `buildGeographicSceneModel`;
  - handles selection in and out;
  - rebuilds the style on theme change;
  - cleans up on unmount;
  - renders the typed fallback states.

Tests:
- the style builder, light and dark, with and without a pack, plus an assertion that no URL is off-origin;
- every branch of the capability resolver;
- the component's fallback states and cleanup, with the dynamic import mocked;
- the protocol registering only once.

**Requirements:** design §2.4–2.5.

## Phase 4 — Gate and documentation

- `pnpm --filter web typecheck`, the affected vitest files, and `pnpm --filter web build`. Confirm from the build output that `maplibre-gl` is not in any shared or initial chunk.
- Operator guide: `docs/user-guide/platform/map-packs.md`.
- The first mounted user surface, and its UX verification, belong to `BI-4EC1D572`.

**Requirements:** design §6–7.
