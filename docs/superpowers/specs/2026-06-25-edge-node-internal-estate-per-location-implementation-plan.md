# Implementation Plan: Internal Company-Owned Per-Location Edge-Node Scoping

**Date:** 2026-06-25
**Status:** Plan (Phase 1 landed; Phase 2 awaits review before migration)
**Audit / decision:** [2026-06-25-edge-node-internal-estate-per-location-substrate-audit.md](2026-06-25-edge-node-internal-estate-per-location-substrate-audit.md)
**Epic:** EP-EDGE-TOPOLOGY

This plan operationalizes Option A (extend `CustomerSite` to be org-ownable). It is sequenced so
the safe foundation ships first and the schema/enforcement change is a single reviewable unit.

---

## Phase 1 — Explicit organization scope (LANDED, no migration)

**Goal:** distinguish a deliberately internal-estate node from an unscoped one; lay the policy
foundation. **Shipped in this PR.**

- `apps/web/lib/edge-node/scope.ts` — `organizationScoped` input mints an explicit
  `organization` / `organization-scope` policy; rejects mixing with a customer target.
- `apps/web/lib/edge-node/enrollment.ts` — `issueBootstrapToken({ organizationScoped })` threads it.
- `apps/web/lib/edge-node/scope.test.ts` — 4 new assertions (explicit mint, columns-null,
  conflict throw, back-compat null). All green.
- **No behavior change** to request scoping; enforcement columns stay null.

**Acceptance:** `npx vitest run lib/edge-node/scope.test.ts lib/edge-node/enrollment.test.ts` → green (29 tests). ✅

## Phase 2 — Org-ownable site (schema + enforcement) — NEEDS REVIEW

**Why gated:** introduces a Prisma migration; per project rule the audit (done) precedes it and
a human reviews the migration before apply.

### 2.1 Schema (`packages/db/prisma/schema.prisma`)
- `CustomerSite.accountId` → nullable; `account` relation optional.
- `CustomerSite.organizationId String?` + `organization Organization?` relation + index.
- App-layer + DB check: exactly one of `accountId` / `organizationId` non-null.
- Migration must be backfill-safe (all existing rows keep `accountId`).

### 2.2 Enforcement (`apps/web/app/api/v1/edge/**`)
- Extend `buildAdapterScopeWhere` + discovery/metrics/events scope filters with an
  **org-owned-site** branch keyed on the (now org-ownable) `customerSiteId`.
- Auth context resolves the site owner (customer vs organization) and selects the branch.

### 2.3 Isolation tests (the non-negotiable gate)
- Org-scoped node never receives a customer-owned row; customer-scoped node never receives an
  org-owned row; cross-customer isolation unchanged. Table-driven, per route.

### 2.4 Provisioning UX (`apps/web` — `/platform/edge-nodes`)
- "Add a node" offers **Internal location** vs **Customer site** as distinct choices.
- `remote-provisioning.ts` renders the command unchanged (scope rides the token).

### 2.5 Fleet-by-location view
- Group the fleet by org location for single-org estates (parallel to MSP customer grouping).

### 2.6 Sequence
2.1 → 2.3 (write isolation tests against the new schema first, TDD) → 2.2 → 2.4 → 2.5.

## Ready-to-file BI specs (canonical backlog)

> The session-local MCP backlog instance is a sparse/non-canonical snapshot (5 epics, no
> EP-EDGE-TOPOLOGY), so these are specified here for filing against the real backlog rather than
> written blindly.

1. **[feature] Internal-estate per-location: org-ownable CustomerSite schema** — §2.1; migration
   backfill-safe; "exactly one owner" invariant. Epic EP-EDGE-TOPOLOGY.
2. **[feature] Org-owned-site edge scope enforcement + estate-isolation tests** — §2.2–2.3.
   Epic EP-EDGE-TOPOLOGY; relates EP-ESTATE-SOVEREIGNTY. *Blocks on #1.*
3. **[feature] Internal-location provisioning UX** — §2.4. Epic EP-EDGE-TOPOLOGY. *Blocks on #2.*
4. **[feature] Fleet-by-location view (single-org estate)** — §2.5. Epic EP-EDGE-TOPOLOGY
   (may link EP-ARCH-8D4F2A). *Blocks on #2.*
5. **[chore] Phase-1 explicit organization minting** — satisfied by this PR; file for record + link.

## Out of scope (tracked elsewhere)
- Fleet scale controls (heartbeat jitter, rate limits, backpressure) — EP-EDGE-TOPOLOGY §13 items 8/11.
- Signed Go-binary remote artifact — §13 item 3 / Risk #3.
- Partner/reseller scope axis — [2026-06-04 spec](2026-06-04-partner-reseller-archetype-identity-design.md); the owner-enum design here anticipates it.
