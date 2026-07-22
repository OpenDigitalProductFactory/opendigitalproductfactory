# Route Audience & Destination-Kind Registry — design

**BI:** BI-8C0F219A (EP-UX-COGLOAD — Live UX cognitive-load audit follow-up)
**Date:** 2026-07-22
**Status:** implemented (this PR)

## Problem

The live navigation/audience audit found **330 page routes** but the hand-authored
navigation model lists ~71 nav paths — 261 page routes are not represented. That is not
automatically wrong (many are detail, workflow, settings, auth, or direct-link pages),
but the *purpose* of most routes is **implicit** and hard to police as the portal grows.
The audit also found the largest audience bucket is technical/admin/knowledge (139
routes), and section homes like `/finance` expose long destination catalogs in the same
owner-facing flow. Without an explicit, machine-checkable classification there is no way
to enforce rules like "global nav is limited to durable domains" or "advanced/technical
routes must sit behind a progressive-disclosure boundary" (the latter is what BI-1D718FCA
needs).

## Design

Layer an **explicit classification registry** on top of the existing route-inventory
single source of truth — do **not** fork the inventory or re-walk the filesystem.

- **Inventory SSOT (existing):** `apps/web/lib/ea/route-manifest.json`, produced by
  `apps/web/scripts/build-route-manifest.ts` and kept fresh by the
  `audit-route-manifest.yml` workflow (Parity Engine, domain 4). It already enumerates
  every page/route with `segments`, `dynamicParams`, and `redirectTo`.
- **Classifier (new, pure):** `apps/web/lib/navigation/route-audience.ts` —
  `classifyRoute(route)` returns `{ audience, destinationKind, confidence, source }`.
  - **Audience** (who it's for): `owner`, `worker`, `customer`, `builder`, `admin`,
    `public`, `auth-setup`. Derived from a first-segment map + an auth/setup segment set.
  - **Destination kind** (what shape): `section-home`, `detail`, `workflow-step`,
    `settings-config`, `advanced-diagnostic`, `legacy-internal`. Derived by precedence:
    redirect shim → settings/config segment → create/edit workflow segment → dynamic
    param → top-level root → deep-under-technical-segment → best-effort detail.
  - **Confidence** keys on the AUDIENCE (the classification that matters for policing
    nav + disclosure). A route with an unrecognised first segment is `low` — genuinely
    unclassified and worth a human override. Destination kind is always best-effort, so
    it never drops confidence on its own (avoids ~150 noise warnings across 330 routes).
  - **Overrides:** `ROUTE_AUDIENCE_OVERRIDES` — the pin registry for routes the heuristic
    gets wrong or classifies low-confidence (e.g. `/workspace/my-queue` → worker).
- **Generated registry (new, committed):**
  `apps/web/lib/navigation/route-audience.generated.json`, built by
  `apps/web/scripts/build-route-audience.ts` (deterministic, `--check` mode). Carries the
  per-route classification plus a summary (`byAudience`, `byDestinationKind`,
  `overrideCount`, `lowConfidenceCount`, `lowConfidencePaths`).
- **CI gate (extended):** `audit-route-manifest.yml` runs `check:route-audience` right
  after `check:route-manifest`. A new page route makes the registry stale → the check
  fails → regenerate + commit, and the route's classification shows up in the diff.
  Low-confidence routes with no override are printed as a **non-fatal warning** listing
  their paths — the "warns when a new page route is unclassified" acceptance.
- **Consumer helpers:** `isAdvancedRoute()` / `isSectionHome()` expose the progressive-
  disclosure boundary and the durable-domain set for nav + BI-1D718FCA to consume.

Initial run: 330 page routes → owner 148, admin 140, public 16, auth-setup 11,
customer 10, builder 3, worker 2; kinds detail 154, advanced-diagnostic 94, section-home
32, legacy-internal 29, settings-config 12, workflow-step 9; 5 overrides, 0 low-confidence.

## Research & benchmarking

- **Next.js App Router has no runtime route registry** — routes are filesystem
  convention, compiled away in a standalone build. Both this registry and the existing
  manifest solve that with a build-time walker + committed JSON (the pattern Nx and
  Turborepo use for their project graphs: derive-and-commit, check-for-drift in CI).
- **Route-metadata-as-data** mirrors how Remix/TanStack Router attach `handle`/route
  metadata, and how design systems tag surfaces by audience — adopted: classification as
  data, not scattered per-page constants. Rejected: a per-page `export const audience`
  convention (330 edit sites, no central view, easy to forget) in favour of a central
  heuristic + override registry with a freshness gate.
- **Anti-pattern avoided:** duplicating the route inventory. The registry reads the EA
  manifest so there is one enumeration of routes (single-source-of-truth, AGENTS §11).

## Non-goals / next slice

This PR delivers the registry + gate + query helpers. **Rewiring navigation** to consume
it (global nav limited to durable `section-home`s, advanced routes gated behind
disclosure) is **BI-1D718FCA**'s progressive-disclosure work, which builds on
`isAdvancedRoute()` / the `advanced-diagnostic` set here.
