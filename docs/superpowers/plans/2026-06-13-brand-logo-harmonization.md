---
title: Harmonize the brand-logo flow — one natural, format-agnostic path
status: in-progress
date: 2026-06-13
relatedSpecs:
  - 2026-06-12-media-asset-management-design.md
---

# Brand-logo harmonization

## Problem (UX, not plumbing)

A non-technical operator meets the logo in **three disjoint ways**, and each
leaks technical detail or fails differently:

1. **Onboarding wizard → Import from URL** — extracts a logo *URL string* and
   stores it on `Organization.logoUrl` as a **link to someone else's server**
   (breaks when that page changes).
2. **Onboarding wizard → Upload brand document** — the file input is **disabled**.
   The copy says "Accepts PDF, PNG, JPG, JPEG, SVG" — format jargon the user
   shouldn't have to reason about.
3. **Brand extraction (Coworker)** — stores the logo as **base64 inside
   `designSystem` JSON**; only now (PR #1809) promoted to a served asset.

The wizard also exposes a raw **"Logo URL"** field and a **font-family** dropdown —
technical surface the operator shouldn't need.

## Principle

One pipeline. However a logo arrives — pasted website, uploaded file of *any*
common type, or Coworker extraction — it ends as a **durable, self-hosted,
format-normalized `MediaAsset`** that sets `Organization.logoUrl`. The operator
never picks a format, never learns what SVG is, never pastes a URL unless they
want to. Code + Coworkers handle the technical normalization.

## Design

### 1. Format-agnostic normalization (handles SVG/etc. for them)

`normalizeLogoForStore(content, mime)` in the media lib:
- If the bytes are **SVG** (or sharp detects a vector/unsupported raster), it
  **rasterizes to PNG** (~512px, transparent) via lazy `sharp` — verified working
  in this install. Output is raster, so the same-origin SVG XSS risk disappears
  *and* the user's SVG "just works".
- Otherwise passthrough (the raster path `createMediaAsset` already accepts).
- If sharp is unavailable, raster passes through and SVG degrades to "not stored"
  exactly as today — never an error.

### 2. One ingest entry, two shapes

- `ingestOrganizationLogo({ ref })` — from an extracted AssetRef (data: URI or
  URL); now normalizes first (so extracted SVG logos work).
- `ingestLogoUpload({ content, mimeType })` — from a direct file upload.
Both → `normalizeLogoForStore` → `createMediaAsset` → `attachMedia(role="logo")`
→ `Organization.logoUrl = /api/media/...`.

### 3. Wizard `saveSimpleBrand` routes the logo through ingest

When the operator applies a brand, if the logo is an external URL or data: URI
(not already `/api/media/`), ingest it → the stored `logoUrl` becomes the durable
served asset. So **Import-from-URL logos stop being fragile external links** with
no extra step.

### 4. Enable the wizard upload (de-jargoned)

- `POST /api/brand/logo` — accepts a file (any common image incl SVG), runs
  `ingestLogoUpload`, returns `{ url }` (the served asset).
- Wizard: enable the upload control; copy becomes "**Upload your logo** — any
  common image works", no format list. On success, the preview shows the hosted
  logo immediately.
- Relabel the raw "Logo URL" field to "Logo" with upload-first; keep direct-URL
  entry only behind "Advanced".

### 5. Coworker auto-capture (fewest steps)

The natural onboarding moment is the operator giving their **website** (already
collected for market context / brand). The brand-extraction Coworker path already
runs from there; with §1 it now also lands the logo as a served asset
automatically — so for most operators the logo needs **zero dedicated steps**.

## Phasing

- **This PR**: §1 normalization (+ SVG), §2 `ingestLogoUpload`, §3 saveSimpleBrand
  routing, §4 upload route + wizard enable/de-jargon.
- **Follow-up**: light-mode logo variant through the same path; PDF brand-doc
  logo extraction; Coworker copy that confirms "I set your logo from your site".

## Verification

Unit-test `normalizeLogoForStore` (SVG→PNG, raster passthrough) and the data-URI
decode. Typecheck. Functionally drive: upload an SVG in the wizard → confirm
`Organization.logoUrl` is a served `/api/media` PNG and the header renders it.
