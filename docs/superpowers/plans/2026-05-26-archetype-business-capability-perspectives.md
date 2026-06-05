# Archetype Business Capability Perspectives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed the Business Capability Map from the selected business archetype so `/portfolio/architecture` is not empty after setup or restore.

**Architecture:** Keep `BusinessCapability` as the active install projection for this first slice. Add a typed source catalog of capability perspectives keyed by archetype/category and an idempotent projector that applies `common-small-business` plus the selected archetype overlay. This avoids loading every vertical into the active map while leaving room for a later `BusinessCapabilityPerspective` model when multiple simultaneous maps are needed.

**Tech Stack:** Next.js 16 App Router, Prisma 7, PostgreSQL, TypeScript, vitest, existing storefront archetype activation profiles.

---

## Scope

This first slice implements:

- a common small-business baseline capability perspective
- an `it-managed-services` overlay for the current MSP archetype
- projection during storefront setup and archetype reset
- restore-safe seeding through the normal database seed path

This first slice does not implement the full BIAN/APQC/SCOR/TM Forum library, a perspective selector UI, or governed external standard import. Those remain follow-on slices after the projection contract is proven.

## Design Notes

`BusinessCapability` is already the active map table. It has no organization, archetype, or perspective scope today, so the source catalog must not preload every archetype into that table. Instead, the catalog is source data and the projector writes only the selected install perspective.

Seed-created capabilities use deterministic IDs with the `BCAP-SEED-` prefix. The projector preserves existing maturity fields when a seed capability already exists, updates names/descriptions/order/value-streams, and deactivates obsolete seed rows that are no longer part of the selected perspective. Non-seed/manual capabilities are left alone.

The initial standards posture is:

- APQC: reference language for common small-business process families
- BIAN: future banking overlay source
- SCOR: future supply-chain-heavy overlay source
- TM Forum eTOM: future telecom/service-provider overlay source
- NIST CSF: future IT/security/compliance overlay source

## Files

- Create: `packages/db/src/business-capability-perspectives.ts`
- Create: `packages/db/test/business-capability-perspectives.test.ts`
- Modify: `packages/db/src/seed.ts`
- Modify: `apps/web/app/api/storefront/admin/setup/route.ts`
- Modify: `apps/web/lib/storefront/archetype-reset.ts`

## Acceptance

- Selecting or resetting `it-managed-services` applies the common baseline plus MSP overlay.
- Selecting a non-MSP archetype applies the common baseline only.
- Re-running the projector is idempotent.
- Existing maturity values are preserved across re-projection.
- Obsolete seed capabilities are marked inactive, not deleted.
- Live seed runs leave `BusinessCapability` non-empty after restore.

## Next Smallest Slice

After this lands, add a read-only provenance badge to `/portfolio/architecture` showing which archetype/category perspective supplied the active map, then add additional overlays category by category.
