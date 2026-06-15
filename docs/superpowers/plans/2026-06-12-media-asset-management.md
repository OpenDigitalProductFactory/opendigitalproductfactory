---
title: Media Asset Management — implementation plan
status: in-progress
date: 2026-06-12
spec: docs/superpowers/specs/2026-06-12-media-asset-management-design.md
backlog: BI-TBD (media-asset-management)
---

# Media Asset Management — Implementation Plan

Goal: give every archetype real image storage + retrieval, with per-archetype
affordances derived from existing signals. Build the substrate first, then wire
the image-bearing entities, then rendering/upload UI, then seeding.

## Phase 1 — Substrate (this PR)

**1a. Derived media profiles (`packages/storefront-templates`)** — DONE in this PR
- `types.ts`: add `MediaRole`, `MediaSlot`, `MediaProfile`; add optional
  `mediaRole` to `ItemTemplate`; add optional `mediaProfile` override to
  `ArchetypeDefinition`.
- `media-profile.ts`: `deriveMediaProfile(def)` + `getMediaProfile(id)` reading
  sections/ctaType/category/axes. Pure, no DB.
- Export from `index.ts`. Unit tests over representative archetypes.
- *Verifiable now*: `pnpm --filter @dpf/storefront-templates test` + typecheck.

**1b. Prisma substrate (`packages/db`)**
- Add `MediaAsset`, `MediaAttachment`, `AdoptableAnimal` models.
- Add back-relations: `Organization.mediaAssets`, `StorefrontConfig.animals`.
- Keep scalar `imageUrl`/`logoUrl`/`avatarUrl`/`heroImageUrl` as primary cache.
- `prisma migrate dev --name media_asset_management` → committed migration.
- *Verifiable*: source-only worktree migration check (shadow postgres) + CI.

**1c. Storage service + routes (`apps/web/lib/media`, `apps/web/app/api/media`)**
- `media-storage.ts`: content-addressed write/read, `MediaStorageDriver`
  interface + `FilesystemDriver`, reuse `getDocumentBlobStorageRoot()`.
- `image-probe.ts`: dimensions + mime sniff + dominant colour (lightweight; no
  hard `sharp` dependency — degrade gracefully).
- `POST /api/media`: auth → hash → dedupe `MediaAsset` → optional
  `MediaAttachment`. Point `/api/v1/upload` stub at it.
- `GET /api/media/:id`: stream with immutable cache headers + `?w=` hint
  (rendition generation behind a capability check; original otherwise).
- `attachments.ts`: `attachMedia`, `reorderMedia`, `deleteMediaForOwner`,
  `syncPrimaryImage`.

## Phase 2 — Per-entity wiring + API

- Storefront items: gallery CRUD endpoints; `syncPrimaryImage` on change.
- Rentable units: equipment gallery; supersede `RentalConditionRecord.mediaRefs`
  with `inspection-*` attachments (keep `mediaRefs` one release, then migrate).
- Adoptable animals: CRUD endpoints under the storefront admin; primary photo +
  gallery; `animals-available` section renders real records.
- Providers/team: avatar upload.
- Brand extraction: write captured logo as a `MediaAsset` + `role="logo"`
  attachment instead of base64-in-JSON.

## Phase 3 — Rendering

- Storefront public renderer: gallery section (grid/carousel), product cards with
  image + focal-point crop, hero image, before/after pair component, adoptable-
  animal cards (photo, name, age, status), equipment cards.
- LQIP: `dominantColor`/`blurhash` placeholder while images load.
- `<MediaImage>` shared component: `srcset` from `?w=` widths + focal-point
  `object-position`.

## Phase 4 — Upload UI

- Reusable `MediaUploader` (drag-drop, reorder, set-primary, alt text, focal
  point) in the storefront editor, keyed by `ownerType`/`ownerId`/`role`,
  driven by `getMediaProfile()` so each archetype shows exactly the slots it
  needs (required ones flagged).

## Phase 5 — Seeding

- Seed a small set of royalty-free placeholder images per archetype category so
  fresh installs render non-empty galleries (resolves the audit "image
  placeholders" checkpoint). Placeholders are clearly marked and replaceable.
- Backfill: one-off to populate `MediaAttachment` primaries from any existing
  non-null scalar `imageUrl`/`logoUrl` values.

## Verification

- Phase 1a: unit tests (profiles) — local + CI.
- Phase 1b: migration applies on shadow postgres; `prisma validate`.
- Phase 1c: integration test for upload→asset→serve round-trip.
- Functional (per `structural-verification-is-not-functional`): on a live install,
  drive a real upload on a retail storefront item and an adoptable animal, confirm
  the image stores, the gallery renders publicly, and the primary cache updates.

## Test-scenario coverage (drives validation)

| Run | Archetypes | Image slot proven |
|---|---|---|
| 4 | pet-grooming, pet-boarding | before/after, facility gallery |
| 5 | restaurant, catering, bakery | product (food) gallery |
| 6 | retail, artisan, florist, wholesale | product gallery |
| 11 | pet-rescue, animal-shelter | adoptable-animal photos |
| 17 | equipment-rental, self-storage | equipment + facility, inspection photos |
| 2 | hair/nail/beauty | before/after gallery |
