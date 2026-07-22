# Route Classification Registry & Ratchet — Design

- **Backlog:** BI-8C0F219A (EP-UX-COGLOAD — Live UX cognitive-load audit follow-up)
- **Date:** 2026-07-21
- **Status:** Phase 1 shipped (census + ratchet); Phase 2 (full audience/kind backfill) deferred

## Problem

The live navigation/audience audit found **330 App Router page routes** but the
canonical navigation model (`apps/web/lib/navigation/portal-navigation-model.ts`)
represents only ~71 nav paths. That is not automatically wrong — many routes are
detail, workflow, settings, auth, or direct-link pages — but the *purpose* of each
route is implicit and impossible to police as the portal grows. A new page route
can be added with no audience or destination-kind, invisible to the canonical
nav/breadcrumb/IA model, and nothing flags it.

## Source of truth (do not duplicate)

The nav model already carries the classification vocabulary the BI asks for:

- `PortalAudienceMode` = `worker | operator | customer | diagnostic`
- `PortalDestinationKind` = `domain-home | section-page | detail | workflow-step | settings | contextual-action | legacy-redirect`
- ~57 literal `path:` records (plus `platformAiRoute(...)`-generated ones), each
  already tagged with `audienceModes` + `destinationKind`.

Per **single-source-of-truth**, the classification of a *classified* route lives
in the nav model — the registry layer must **not** copy audience/kind into a
second file. What was missing is the **census + enforcement** layer: which of the
330 page routes are *not yet* in the model.

## Phase 1 — census + ratchet (this change)

- `scripts/lib/route-classification.mjs` — pure classifier. Walks `apps/web/app`
  for `page.tsx`/`page.ts`, resolves each route path (stripping `(group)`
  segments), and classifies it in precedence order:
  `nav-model` (path present in the model) → `detail` (dynamic `[param]` route) →
  `legacy-redirect` (a small body that calls `redirect()`/`permanentRedirect()`) →
  `unclassified` (a static route invisible to the canonical model).
- `scripts/generate-route-manifest.mjs` — emits
  `apps/web/lib/navigation/route-manifest.generated.json`, a point-in-time
  registry enumerating every page route with its group, dynamic flag, nav-model
  membership, and classification. Regenerate with `pnpm route:manifest`.
- `scripts/check-no-unclassified-routes.mjs` — the ratchet. Auto-discovered by
  the **Repo Guard Loop** (`scripts/check-guards.mjs` runs every `check-no-*.mjs`),
  so it needs no `ci.yml` or `package.json` wiring. It compares the current
  distinct unclassified route set to a **shrink-only baseline**
  (`scripts/unclassified-routes-baseline.txt`) and fails when a *new* unclassified
  route appears. `--update` re-baselines after a deliberate reduction.

Baseline at authoring time: **330 page routes → 57 nav-model, 75 detail,
44 legacy-redirect, 154 unclassified.**

### Classification rules (Phase 1)

| Bucket | Meaning | Enforced |
| --- | --- | --- |
| `nav-model` | Represented in the canonical model with audience + destination-kind | Classified |
| `detail` | Dynamic `[param]` route reached by direct link / breadcrumb, not global nav | Classified (expected) |
| `legacy-redirect` | Small body that redirects to the canonical route | Classified (expected) |
| `unclassified` | Static route invisible to the model — the IA debt the ratchet freezes | Baselined, shrink-only |

## Phase 2 — deferred (not in this change)

The full backlog acceptance also asks that global nav be limited to durable
domains, section nav list only siblings, detail/workflow routes use breadcrumbs,
and advanced technical/admin routes be flagged for progressive disclosure. That
is a per-route IA pass over the 154 unclassified routes (add a `PortalNavRecord`,
or promote a genuinely advanced/diagnostic route behind disclosure). It is
sequenced after Phase 1 because the ratchet must exist first to stop the debt
growing while the backfill proceeds. Each backfill PR shrinks the baseline.

## Research & benchmarking

- **Next.js route manifests** (`.next/app-path-routes-manifest.json`) enumerate
  routes but carry no audience/IA semantics — hence a DPF-owned classification
  layer over the nav model rather than the framework manifest.
- **Ratchet/baseline pattern** mirrors the existing repo guards
  (`scripts/check-no-raw-route-error.mjs`, `check-module-size.mjs`): a committed
  baseline that may only shrink, `--update` to retighten, auto-discovered by the
  guard loop. Adopted wholesale so this check behaves like every other DPF guard.
