# Archetype Business Capability Perspectives Implementation Plan

> **For DPF-native agent workers:** Follow `AGENTS.md`, use live DPF MCP/backlog tools first, and keep implementation work in an isolated worktree. This plan owns the selected-archetype Business Capability projection contract; extend it rather than creating a competing plan for the same substrate.

**Goal:** Seed the Business Capability Map from the selected business archetype so `/portfolio/architecture` is not empty after setup or restore.

**Architecture:** Keep `BusinessCapability` as the active install projection for this first slice. Add a typed source catalog of capability perspectives keyed by archetype/category and an idempotent projector that applies `common-small-business` plus the selected archetype overlay. This avoids loading every vertical into the active map while leaving room for a later `BusinessCapabilityPerspective` model when multiple simultaneous maps are needed.

**Tech Stack:** Next.js 16 App Router, Prisma 7, PostgreSQL, TypeScript, vitest, existing storefront archetype activation profiles.

---

## Scope

The initial slice implemented:

- a common small-business baseline capability perspective
- an `it-managed-services` overlay for the current MSP archetype
- projection during storefront setup and archetype reset
- restore-safe seeding through the normal database seed path

The 2026-08-01 expansion adds category overlays for every active storefront archetype category so restored installs and newly selected archetypes no longer fall back to a generic capability map. Existing detailed overlays remain authoritative where they exist: BIAN v14 for `banking-financial-services`, the beauty/trades/fabric care overlays, and the leaf-specific MSP overlay on top of the `professional-services` category.

This plan still does not implement the full BIAN/APQC/SCOR/TM Forum library, a perspective selector UI, or governed external standard import. Those remain follow-on slices after the projection contract is proven.

## Design Notes

`BusinessCapability` is already the active map table. It has no organization, archetype, or perspective scope today, so the source catalog must not preload every archetype into that table. Instead, the catalog is source data and the projector writes only the selected install perspective.

Seed-created capabilities use deterministic IDs with the `BCAP-SEED-` prefix. The projector preserves existing maturity fields when a seed capability already exists, updates names/descriptions/order/value-streams, and deactivates obsolete seed rows that are no longer part of the selected perspective. Non-seed/manual capabilities are left alone.

The standards posture is:

- APQC: reference language for common small-business process families
- BIAN: banking overlay source for the active `banking-financial-services` category
- SCOR: future supply-chain-heavy overlay source
- TM Forum eTOM: future telecom/service-provider overlay source
- NIST CSF: IT/security/compliance reference source for the MSP and assurance lanes

## Files

- Create: `packages/db/src/business-capability-perspectives.ts`
- Create: `packages/db/test/business-capability-perspectives.test.ts`
- Modify: `packages/db/src/seed.ts`
- Modify: `apps/web/app/api/storefront/admin/setup/route.ts`
- Modify: `apps/web/lib/storefront/archetype-reset.ts`

## Acceptance

- Selecting or resetting `it-managed-services` applies the common baseline plus MSP overlay.
- Selecting any active storefront archetype applies the common baseline plus its category overlay.
- Selecting `it-managed-services` composes common baseline, `professional-services`, and the MSP leaf overlay.
- The test suite fails if an active storefront archetype category is missing from the category overlay registry.
- Re-running the projector is idempotent.
- Existing maturity values are preserved across re-projection.
- Obsolete seed capabilities are marked inactive, not deleted.
- Live seed runs leave `BusinessCapability` non-empty after restore.

## Next Smallest Slice

After category overlay coverage lands, add a read-only provenance badge to `/portfolio/architecture` showing which archetype/category perspective supplied the active map, then deepen high-priority overlays from compact DPF-authored seed rows into governed standard-backed models where a mature standard exists.
