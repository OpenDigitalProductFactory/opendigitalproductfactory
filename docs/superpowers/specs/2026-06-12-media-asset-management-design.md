---
title: Media Asset Management — first-class images for every archetype
status: design
date: 2026-06-12
backlog: BI-TBD (media-asset-management)
relatedSpecs:
  - 2026-05-29-vehicle-equipment-rental-archetype-design.md
  - 2026-05-22-customer-surface-archetype-activation-design.md
  - 2026-06-09-civic-and-member-governed-archetypes-design.md
relatedDocs:
  - docs/testing/archetype-audit-plan.md
  - docs/architecture/archetype-business-value-streams.md
---

# Media Asset Management

## 1. Problem

Most archetypes have **no usable image capability**. A storefront sells products,
rents equipment, rehomes animals, or showcases before/after work — but today the
data model carries only a handful of **single scalar URL strings**, set by hand,
with no upload, no storage, no galleries, and no per-archetype guidance for where
images even matter.

Current state (verified against `packages/db/prisma/schema.prisma`):

| Field | Model | Shape | Gap |
|---|---|---|---|
| `imageUrl` | `StorefrontItem` | one string | products need a **gallery**, not one photo |
| `heroImageUrl` | `StorefrontConfig` | one string | manual only; no upload path |
| `avatarUrl` | `ServiceProvider`, `User`, `CustomerContact` | one string | manual only |
| `logoUrl` | `Organization` | one string | only set by brand-extraction (base64-in-JSON) |
| `mediaRefs` | `RentalConditionRecord` | untyped JSON | structure undefined, no storage behind it |
| — | `RentableUnit` (equipment) | **no field at all** | equipment can't show photos |
| — | adoptable animals | **no model at all** | `animals-available` section has nowhere to store animal photos |

The public `/api/v1/upload` route is a **validation-only stub** — it accepts a
file, validates size/type, then returns a fake `url` and writes nothing. The only
real, working blob storage is `apps/web/lib/documents/blob-storage.ts` (content-
addressed SHA-256, used for agent documents).

There is **no central media model, no upload-to-entity flow, and no gallery
rendering**. "Verify product catalog renders with image placeholders" appears in
the Run-2 audit plan precisely because the images never arrive.

## 2. Goals

1. One **first-class, org-scoped media substrate** that any entity can attach
   ordered, captioned, alt-texted images to — without adding a column per entity.
2. **Real storage + retrieval**: content-addressed, deduplicated, self-hostable
   (filesystem default, pluggable to S3/blob later — no provider pinning).
3. **Per-archetype image affordances are derived, not hand-authored** — the
   platform already knows each archetype's sections, CTA type, category, and
   operating-model axes; the set of image slots a business needs follows from
   those signals (the same way `BillingPatternProfile` is derived from
   `commercialModel`).
4. Close the three concrete entity gaps that block real businesses today:
   **product/equipment galleries**, **adoptable-animal photos**, and
   **rental-unit + inspection photos**.
5. Backward compatible: existing scalar `imageUrl`/`logoUrl`/`avatarUrl`/
   `heroImageUrl` fields keep working as a **denormalized primary-image cache**,
   so nothing that renders today breaks.

Non-goals (this spec): video transcoding, a full DAM UI with folders/tags,
AI alt-text generation, CDN edge config. Designed-for but phased later.

## 3. How first-class solutions model this

Researched 2026-06-12; informs the model below.

- **Shopify** — `Media` is a first-class ordered node attached to a product
  (`image`/`video`/`model3d`), each with **alt text** (SEO + a11y) and a
  **position**; variants reference media by position/alt convention. Takeaway:
  *media is its own entity, ordered, alt-texted; the owner references it.*
  ([cleancanvas](https://support.cleancanvas.co.uk/hc/en-us/articles/11591150146845-Multiple-variant-images),
  [alttext.ai](https://alttext.ai/docs/integrations/shopify/))
- **Petfinder** — an animal has a `photos[]` array plus a designated
  `primary_photo_cropped` rendered at `small`/`medium`/`large`/`full`, alongside
  `videos[]` and status fields. Takeaway: *the adoptable animal is its own
  entity with a gallery and a designated primary photo at multiple sizes.*
  ([Petfinder API guide](https://gomakethings.com/working-with-the-petfinder-api/),
  [petfindeR fields](https://github.com/joseandresmontes/petfindeR))
- **Booqable** (equipment rental) — each product carries **multiple images**, a
  chosen **thumbnail**, a **focal point** to prevent crop damage, and alt text.
  Takeaway: *rental units need galleries + focal point, not one photo.*
  ([Booqable: multiple product images](https://booqable.com/blog/introducing-shortages-and-multiple-product-images/),
  [product photography guide](https://booqable.com/blog/product-photography-rental-business/))
- **Headless CMS / DAM (Hygraph, DatoCMS)** — `Asset` is a **system content
  model** of its own, **polymorphically** related to other content, CDN-served,
  with on-the-fly **responsive variants/transformations** (resize/crop) and
  alt-text/metadata. Takeaway: *one Asset model + a polymorphic attachment +
  derived responsive sizes beats a column-per-entity.*
  ([Hygraph image SEO](https://hygraph.com/blog/image-seo-with-headless-cms),
  [headlesscreator: extending assets](https://www.headlesscreator.com/extending-asset-and-media-objects-in-a-headless-cms))

**Convergent pattern**: a single first-class **Asset** model + an **ordered,
role-tagged attachment** to any owner + a **designated primary** + **alt text** +
**focal point** + **derived responsive sizes**. That is exactly the model below.

## 4. Data model

### 4.1 `MediaAsset` — the first-class, content-addressed asset

Org-scoped. Storage mirrors the proven document blob pattern (SHA-256, atomic
write, dedup) under a `media/sha256/aa/bb/<hash>` prefix.

```prisma
model MediaAsset {
  id             String   @id @default(cuid())
  organizationId String
  sha256         String                       // content hash; dedup within org
  storageKey     String                       // path within the blob store
  storageDriver  String   @default("filesystem") // filesystem|s3|gcs — pluggable
  kind           String   @default("image")   // image|video|document
  mimeType       String
  sizeBytes      Int
  width          Int?
  height         Int?
  durationMs     Int?                          // video
  altText        String?                       // SEO + a11y (Shopify/Hygraph)
  dominantColor  String?                       // hex, LQIP background
  blurhash       String?                       // tiny placeholder string
  focalX         Float?   @default(0.5)        // 0..1 crop anchor (Booqable)
  focalY         Float?   @default(0.5)
  originalName   String?
  status         String   @default("ready")    // uploading|ready|failed|quarantined
  createdById    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization      @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  attachments  MediaAttachment[]

  @@unique([organizationId, sha256])           // same bytes uploaded twice → one row
  @@index([organizationId, kind, status])
}
```

### 4.2 `MediaAttachment` — the polymorphic, ordered, role-tagged join

This is the key to "images on every entity without a column on every model." One
asset can be attached to many owners; one owner can have an ordered gallery per
role.

```prisma
model MediaAttachment {
  id             String   @id @default(cuid())
  organizationId String
  mediaAssetId   String
  ownerType      String   // StorefrontItem|RentableUnit|AdoptableAnimal|ServiceProvider|StorefrontConfig|StorefrontSection|Organization
  ownerId        String
  role           String   @default("gallery") // primary|gallery|hero|logo|avatar|equipment|inspection-checkout|inspection-return|before|after
  sortOrder      Int      @default(0)
  caption        String?
  createdAt      DateTime @default(now())

  asset MediaAsset @relation(fields: [mediaAssetId], references: [id], onDelete: Cascade)

  @@index([ownerType, ownerId, role, sortOrder]) // gallery fetch
  @@index([organizationId])
  @@index([mediaAssetId])
}
```

`ownerType` is a string discriminator (not a hard FK) because owners span many
tables — this is the standard polymorphic-attachment trade-off; referential
integrity for the *asset* side is enforced by the FK, and orphan attachments are
swept when an owner is deleted via a `deleteMediaForOwner(type,id)` helper called
from each owner's delete path.

### 4.3 `AdoptableAnimal` — the missing entity (Petfinder-shaped)

`pet-rescue` and `animal-shelter` declare an `animals-available` section, but
there is no model behind it — the section content is free JSON with no animal
records and no photos. This adds the entity; its gallery is `MediaAttachment`
rows with `ownerType="AdoptableAnimal"`, and `primaryPhotoAssetId` is the
designated lead photo (Petfinder `primary_photo`).

```prisma
model AdoptableAnimal {
  id                  String    @id @default(cuid())
  animalRef           String    @unique
  storefrontId        String
  organizationId      String
  name                String
  species             String?   // dog|cat|rabbit|other
  breed               String?
  age                 String?   // baby|young|adult|senior | free text
  sex                 String?
  size                String?   // small|medium|large|xl
  description         String?   @db.Text
  status              String    @default("available") // available|pending|adopted|hold
  primaryPhotoAssetId String?
  attributes          Json?     // spayed/neutered, good-with-kids/dogs/cats, house-trained
  publishedAt         DateTime?
  adoptedAt           DateTime?
  sortOrder           Int       @default(0)
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  storefront StorefrontConfig @relation(fields: [storefrontId], references: [id], onDelete: Cascade)

  @@index([storefrontId, status, sortOrder])
}
```

### 4.4 Equipment + inspection photos (no schema change to owners)

`RentableUnit` gets equipment photos purely through `MediaAttachment`
(`ownerType="RentableUnit"`, `role="equipment"`). `RentalConditionRecord.mediaRefs`
JSON is **superseded** by `MediaAttachment` rows
(`ownerType="RentalConditionRecord"`, `role="inspection-checkout|return"`);
`mediaRefs` is kept for one release for back-compat, then migrated and dropped.

### 4.5 Backward-compatible primary-image cache

Existing scalar fields stay and become a **denormalized cache of the primary
attachment's served URL**, written by `syncPrimaryImage(ownerType, ownerId)`:

- `StorefrontItem.imageUrl` ← primary `MediaAttachment` for that item
- `StorefrontConfig.heroImageUrl` ← `role="hero"`
- `ServiceProvider.avatarUrl` ← `role="avatar"`
- `Organization.logoUrl` ← `role="logo"`

Result: **every surface that renders `imageUrl` today keeps working unchanged**;
galleries are purely additive.

## 5. Storage & retrieval

- **Service** `apps/web/lib/media/media-storage.ts` mirrors `blob-storage.ts`:
  content-addressed write under prefix `media/sha256/<aa>/<bb>/<sha256>`, atomic
  temp-then-rename, dedup on existing hash. Reuses `getDocumentBlobStorageRoot()`
  config (`PlatformConfig.upload_storage_path` / `UPLOAD_STORAGE_PATH`).
- **Driver interface** `MediaStorageDriver { put, get, url }` with a
  `FilesystemDriver` default. S3/GCS drivers slot in later behind the same
  interface — keeps the platform self-hostable and provider-agnostic.
- **Upload** `POST /api/media` (authenticated, org-scoped): hash → dedupe →
  probe dimensions/mime → create `MediaAsset` → optionally create a
  `MediaAttachment` when `ownerType`/`ownerId`/`role` are supplied. The existing
  `/api/v1/upload` stub is redirected to this real implementation.
- **Retrieval** `GET /api/media/:id` streams the asset with long-lived,
  immutable cache headers (content-addressed → safe). Accepts a `?w=` width hint;
  Phase 2 generates and caches responsive renditions with `sharp` if present,
  otherwise serves the original (graceful degrade). Public storefront images use
  the same route; access is allowed for assets attached to a published
  storefront, otherwise org-auth is required.

## 6. Per-archetype media profiles (derived)

A new `MediaProfile` is **derived** from each archetype's existing signals, so
adding image support to an archetype is a function of its axes — never a
hand-authored per-archetype flag. Lives in
`packages/storefront-templates/src/media-profile.ts`; surfaced via
`getMediaProfile(archetypeId)`.

```ts
type MediaRole =
  | "logo" | "hero" | "gallery" | "product" | "equipment"
  | "avatar" | "animal" | "before-after" | "facility" | "certificate";

interface MediaSlot {
  role: MediaRole;
  owner: "organization" | "storefront" | "item" | "provider" | "section" | "animal" | "rentable-unit";
  applicability: "required" | "recommended" | "optional";
  multiple: boolean;          // gallery vs single
  label: string;
  reason: string;             // ties to the journey/value stream
}
interface MediaProfile { slots: MediaSlot[] }
```

Derivation rules (read off sections + ctaType + category + axes):

| Signal | Slot derived |
|---|---|
| always | `logo` (org, recommended), `hero` (storefront, recommended) |
| `items` section + ctaType `purchase` | `product` on items — **required** (catalog is unusable without it) |
| `items` section + ctaType `rental` / category `asset-rental` | `equipment` on rentable-unit — **required** |
| category `food-hospitality` | `product` on items — **required** (food photography is the channel) |
| `gallery` section | `gallery` (recommended); beauty / pet-grooming / fitness → `before-after` |
| `team` section | `avatar` on providers (recommended) |
| `animals-available` section | `animal` gallery — **required** (adoption can't convert without photos) |
| category `nonprofit-community` (non-animal) | `gallery` impact photos (recommended) |
| professional-services / banking / public-sector | `avatar` (recommended), `facility` (optional) — image-light |

This makes the "where do images matter" mapping a **property of the catalog**,
queryable by setup wizards, the storefront editor, and the marketing coworker
(which already reasons about `proofAssets`). It is unit-tested against
representative archetypes (retail→product-required, pet-rescue→animal-required,
equipment-rental→equipment-required, hair-salon→before-after, accounting→light).

## 7. Value-stream alignment

Images are a **Consume**-stream (request-to-fulfill / customer-facing) concern
primarily, with a **Operate** touchpoint for rental inspection evidence:

| Value stream | Where media lives |
|---|---|
| **Consume** | storefront hero, product/equipment galleries, adoptable-animal photos, team avatars, before/after galleries — everything a customer sees before they book/buy/adopt/rent |
| **Operate** | rental checkout/return inspection photos (condition evidence, dispute defence) |
| **Explore/Release** | brand logo captured at setup (brand-extraction feeds `role="logo"`) |

The audit/test scenarios that most depend on this (and therefore validate it):
pet-grooming & beauty (before/after), retail/artisan/florist & food (product),
equipment-rental & self-storage (equipment/facility), pet-rescue & animal-shelter
(adoptable animals). These are exactly the Run-4/5/6/11/17 scenarios in
`docs/testing/archetype-audit-plan.md`.

## 8. Phasing

See `docs/superpowers/plans/2026-06-12-media-asset-management.md`. Substrate
(schema + storage + routes + derived profiles) is Phase 1; per-entity wiring,
gallery rendering, upload UI, and seeding follow.

## 9. Risks & decisions

- **Polymorphic attachment vs FK-per-owner** — chose polymorphic
  (`ownerType`+`ownerId`) to avoid a migration + column every time an archetype
  gains an image-bearing entity. Cost: no DB-level FK on the owner side; mitigated
  by `deleteMediaForOwner` in each owner's delete path + a periodic orphan sweep.
- **Filesystem default vs cloud** — filesystem keeps single-container installs
  zero-config and self-hostable (kernel: no-provider-pinning); the driver
  interface keeps S3 a config change, not a rewrite.
- **Derived vs authored profiles** — derived keeps 50+ archetypes in sync for
  free and means new archetypes get sensible image affordances automatically;
  an archetype can still override via an optional `mediaProfile` on its definition
  if a real exception appears (none needed today).
