# Documentation Freshness Checklist

Use this checklist when a release or feature wave changes public claims, visible routes, in-app help, or architecture boundaries.

## Evidence Pass

- Scan recent first-parent history: `git log --since="14 days ago" --first-parent --oneline origin/main -- docs README.md apps/web/lib/docs-route-map.ts apps/web/lib/docs-route-map.test.ts`.
- Scan visible shell routes under `apps/web/app/(shell)` and compare new pages to `apps/web/lib/docs-route-map.ts`.
- Search README, public site, user guide, and architecture docs for future-state language that may have become stale.
- Query live backlog through the DPF MCP tools first; if MCP is unavailable, label live-DB fallback explicitly.

## Update Pass

- Keep `README.md` focused on overview, install posture, and current capability inventory.
- Keep `docs/index.html` focused on the public pre-install story and externally visible maturity claims.
- Keep `docs/user-guide/**` operational and route-specific.
- Keep `docs/architecture/**` focused on current architecture and standards.
- Keep `docs/superpowers/**` as design history, audits, and implementation planning.

## Verification Pass

- Run route-map tests: `pnpm --filter web exec vitest run lib/docs-route-map.test.ts`.
- Run typecheck and production build when app code changed.
- Check README and public-site links to local docs.
- Exercise public site responsive widths when `docs/index.html` changes.
- Exercise Docker-served portal docs pages and contextual docs links when in-app docs navigation changes.

## Closeout

- Record the PR URL and verification output on the matching backlog item.
- Do not mark the backlog item done until the PR merges.
- Confirm the parent epic closes only after all child items are done or deferred.
