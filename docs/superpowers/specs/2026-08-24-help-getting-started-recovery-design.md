---
title: Help and Getting Started recovery
status: draft
date: 2026-08-24
owner: platform
epic: EP-56AE0F69
backlog:
  - BI-AE7C386B
relates:
  - docs/superpowers/specs/2026-07-16-documentation-system-design.md
  - docs/superpowers/specs/2026-07-22-shell-action-result-contract-design.md
---

# Help and Getting Started recovery

## Problem

The shell's route-aware Help action can send an operator to a documentation URL whose physical Markdown page is absent. The docs route then calls Next.js `notFound()`, leaving the operator at a generic record 404. The same mismatch affects direct area-root URLs: `/docs/getting-started` is the stable identity people expect, while the loader only recognizes the storage slug `getting-started/index`.

This is a routing and recovery defect. It does not require a new documentation store, a second Help control, or changes to permissions and organization context.

## Design grounding

The documentation-system design makes the source Markdown path the canonical document identity and treats public and portal URLs as projections. The shell action-result contract keeps Help route-aware and distinguishes it from All docs. Current source confirms those contracts in `apps/web/lib/docs-route-map.ts`, `apps/web/lib/shared/docs.ts`, `apps/web/components/docs/ContextualDocsButton.tsx`, and `apps/web/app/(shell)/docs/[[...slug]]/page.tsx`.

The defect is the remaining index-page convention leak: route mappings expose physical `/index` slugs, and the page loader has no area-root alias or honest recovery state.

## Decision

1. Treat `/docs/<area>` as the stable portal identity for an area's index page. Keep leaf pages at `/docs/<area>/<page>`.
2. Resolve an area root to `<area>/index` inside the docs loader. Physical Markdown layout stays an implementation detail.
3. Update route-aware Help mappings that target index pages to emit the stable area-root identity. Preserve `sourceRoute` so quick help and the return path keep their existing context.
4. When the requested document cannot be loaded, render the documentation catalog with a concise, truthful notice and a recovery action. Do not call the generic record 404.
5. Keep authorization, organization lookup, quick-help resolution, and document content ownership unchanged.

## Alternatives rejected

- **Hardcode Help to `/docs/getting-started/index`.** This still couples the shell to a physical filename and does not protect renamed or missing content.
- **Send every Help click to `/docs`.** This avoids the 404 but discards the route-aware Help contract and makes operators search for the answer they asked for.
- **Seed or repair a database row.** User-guide pages are filesystem-authored and Git-owned. A row repair would create a second source of truth and would not cover fresh installs.

## Implementation plan

1. Add regression tests first for direct `/docs/getting-started`, the header's stable mapped Help URL, and an unavailable document's catalog recovery.
2. Add one loader-level resolver for exact page slugs and area index aliases.
3. Replace mapped `.../index` destinations with stable area roots and teach the server-side existence check the same identity rule.
4. Replace `notFound()` with a docs-layout recovery state that names the unavailable guide without echoing unsafe input and exposes the existing catalog.
5. Run the related route-map, docs loader, docs page, quick-help, and shell-action tests; then typecheck and the prose/style guard obligations.

## Acceptance

- The compact header Help action resolves to an existing route-specific document through a stable portal identity.
- `/docs/getting-started` renders the authored Getting Started index.
- `/docs/getting-started/index` remains compatible for existing links.
- A missing or renamed document renders an honest recovery notice and the valid documentation catalog, never the generic record 404.
- `sourceRoute`, permissions, and organization-specific quick help remain intact.
- Tests demonstrate Red before implementation and Green afterward.

## Blast radius

The behavioral reach is limited to portal documentation URLs and the route-to-doc mapping. Existing `.../index` links remain valid, so bookmarks and generated manifests are not broken. Search results and inline document links continue to use their current leaf slugs. No database schema, migration, seed, public-site permalink, auth, or organization-context behavior changes.

The implementation must sweep `DOCS_ROUTE_MAP`, generated doc-impact edges, direct `/docs/**` links, and route tests because string-keyed links are outside normal import graphs.
