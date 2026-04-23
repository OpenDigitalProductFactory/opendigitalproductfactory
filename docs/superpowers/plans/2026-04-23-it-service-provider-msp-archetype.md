# IT Service Provider / MSP Archetype Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing storefront-era `it-managed-services` archetype into the first stronger business-profile-aware archetype foundation, starting with archetype activation metadata, setup/context wiring, and MSP defaults that the rest of the customer-estate work can build on.

**Architecture:** Add an explicit archetype activation profile to the storefront template catalog and persisted `StorefrontArchetype` records, then expose that profile through setup and agent route context so the app can understand that the MSP archetype activates real operating modules. Land this as a narrow foundation slice first; customer sites, managed assets/CIs, agreements, and graph projection will follow in separate tasks once the activation contract exists.

**Tech Stack:** Next.js App Router, TypeScript, Prisma 7, PostgreSQL, vitest, pnpm workspaces.

---

## File Structure

- Create: `apps/web/lib/storefront/archetype-activation.ts`
  Shared runtime helpers and types for reading activation profiles from archetypes.
- Create: `apps/web/lib/storefront/archetype-activation.test.ts`
  Unit tests for activation profile parsing and MSP behavior.
- Create: `apps/web/app/api/storefront/admin/setup/route.test.ts`
  Route tests for setup behavior once activation profiles are present.
- Modify: `packages/storefront-templates/src/types.ts`
  Extend the archetype contract with explicit activation profile types.
- Modify: `packages/storefront-templates/src/archetypes/professional-services.ts`
  Add the stronger MSP activation profile to `it-managed-services`.
- Modify: `packages/storefront-templates/src/archetypes/archetypes.test.ts`
  Assert the MSP archetype carries the required activation metadata.
- Modify: `packages/storefront-templates/src/seed.ts`
  Ensure the new activation profile is exported through seed data.
- Modify: `packages/db/prisma/schema.prisma`
  Add a nullable JSON field for persisted archetype activation profiles.
- Modify: `packages/db/src/seed-storefront-archetypes.ts`
  Persist activation profile data during archetype upsert.
- Modify: `apps/web/app/api/storefront/admin/setup/route.ts`
  Surface activation-profile-aware setup defaults into `BusinessContext`.
- Modify: `apps/web/lib/tak/route-context.ts`
  Include activation-profile-aware MSP context in the storefront/page data block.

## Chunk 1: Activation Profile Contract

### Task 1: Add explicit archetype activation profile types

**Files:**
- Modify: `packages/storefront-templates/src/types.ts`
- Modify: `packages/storefront-templates/src/archetypes/professional-services.ts`
- Modify: `packages/storefront-templates/src/archetypes/archetypes.test.ts`

- [ ] **Step 1: Write the failing catalog test**

Add a test in `packages/storefront-templates/src/archetypes/archetypes.test.ts` that asserts:

```ts
it("it-managed-services carries a strong activation profile", () => {
  const msp = ALL_ARCHETYPES.find((a) => a.archetypeId === "it-managed-services");
  expect(msp).toBeDefined();
  expect(msp?.activationProfile?.profileType).toBe("managed-service-provider");
  expect(msp?.activationProfile?.modules).toContain("customer-estate");
  expect(msp?.activationProfile?.modules).toContain("service-agreements");
  expect(msp?.activationProfile?.modules).toContain("service-operations");
  expect(msp?.activationProfile?.customerGraph).toBe("separate-customer-projection");
  expect(msp?.activationProfile?.estateSeparation).toBe("strict");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @dpf/storefront-templates exec vitest run src/archetypes/archetypes.test.ts
```

Expected: type/module failure because `activationProfile` does not exist yet.

- [ ] **Step 3: Add the activation profile types**

Extend `packages/storefront-templates/src/types.ts` with:

- `ArchetypeModule`
- `BillingReadinessMode`
- `CustomerGraphMode`
- `EstateSeparationMode`
- `ActivationProfile`

Keep the contract small and specific to the current MSP foundation slice. Do not model future agreement or CI tables here yet.

- [ ] **Step 4: Add MSP activation metadata to the template**

Update `packages/storefront-templates/src/archetypes/professional-services.ts` so `it-managed-services` includes:

- `profileType: "managed-service-provider"`
- modules for customer estate, service agreements, billing readiness, service operations, projects, lifecycle signals, integrations
- `billingReadinessMode: "prepared-not-prescribed"`
- `customerGraph: "separate-customer-projection"`
- `estateSeparation: "strict"`
- seeded service categories aligned with the approved spec

- [ ] **Step 5: Re-run the archetype test**

Run:

```bash
pnpm --filter @dpf/storefront-templates exec vitest run src/archetypes/archetypes.test.ts
```

Expected: passing.

- [ ] **Step 6: Commit**

```bash
git add packages/storefront-templates/src/types.ts packages/storefront-templates/src/archetypes/professional-services.ts packages/storefront-templates/src/archetypes/archetypes.test.ts
git commit -m "feat(archetypes): add MSP activation profile metadata"
```

## Chunk 2: Persist Activation Profiles In Prisma Seed Data

### Task 2: Store activation profiles on `StorefrontArchetype`

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/storefront-templates/src/seed.ts`
- Modify: `packages/db/src/seed-storefront-archetypes.ts`

- [ ] **Step 1: Write the failing seed/runtime test**

Create or extend a small unit test near the seed path (prefer a new focused test if needed) asserting the seed payload includes `activationProfile` for `it-managed-services`.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @dpf/storefront-templates exec vitest run
```

Expected: missing-field failure.

- [ ] **Step 3: Add nullable Prisma field**

Add `activationProfile Json?` to `StorefrontArchetype`.

Create a new migration with only additive DDL. No backfill SQL needed because the field is nullable and seed-driven.

- [ ] **Step 4: Update seed export and upsert**

Ensure `ARCHETYPE_SEED_DATA` carries the new field and `seed-storefront-archetypes.ts` writes it on create/update.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm --filter @dpf/storefront-templates exec vitest run
pnpm --filter @dpf/db exec vitest run
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/storefront-templates/src/seed.ts packages/db/prisma/schema.prisma packages/db/src/seed-storefront-archetypes.ts packages/db/prisma/migrations
git commit -m "feat(db): persist archetype activation profiles"
```

## Chunk 3: Runtime Helper And Setup Wiring

### Task 3: Add runtime helper for activation profiles

**Files:**
- Create: `apps/web/lib/storefront/archetype-activation.ts`
- Create: `apps/web/lib/storefront/archetype-activation.test.ts`

- [ ] **Step 1: Write the failing helper test**

Test:

- parsing nullable DB JSON into a typed activation profile
- detecting whether an archetype is MSP-strength
- returning safe defaults for archetypes without activation metadata

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/storefront/archetype-activation.test.ts
```

Expected: module-not-found.

- [ ] **Step 3: Implement the helper**

Keep it pure and small. Export:

- `type ArchetypeActivationProfile`
- `readActivationProfile(raw: unknown)`
- `isManagedServiceProviderProfile(profile)`

- [ ] **Step 4: Re-run the helper test**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/storefront/archetype-activation.test.ts
```

Expected: passing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/storefront/archetype-activation.ts apps/web/lib/storefront/archetype-activation.test.ts
git commit -m "feat(storefront): add archetype activation profile helpers"
```

### Task 4: Wire activation profiles into setup and route context

**Files:**
- Create: `apps/web/app/api/storefront/admin/setup/route.test.ts`
- Modify: `apps/web/app/api/storefront/admin/setup/route.ts`
- Modify: `apps/web/lib/tak/route-context.ts`

- [ ] **Step 1: Write failing route tests**

Add tests that prove:

- storefront setup carries MSP activation context into `BusinessContext.revenueModel` or another existing summary field without inventing new tables
- route context includes activation-profile-aware language for the storefront page data block when the active archetype is MSP-strength

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:

```bash
pnpm --filter web exec vitest run apps/web/app/api/storefront/admin/setup/route.test.ts apps/web/lib/tak/route-context-map.test.ts
```

Expected: failing expectations.

- [ ] **Step 3: Implement the minimal setup wiring**

Use the activation helper in `setup/route.ts` to enrich existing setup behavior only. Good targets for this slice:

- richer `BusinessContext.revenueModel`
- optional setup context payloads if already present

Do not create MSP operational tables here.

- [ ] **Step 4: Implement route-context wiring**

Make storefront/page context mention when the archetype activates MSP operating modules so the coworker sees more than portal vocabulary.

- [ ] **Step 5: Re-run the targeted tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/app/api/storefront/admin/setup/route.test.ts apps/web/lib/tak/route-context-map.test.ts
```

Expected: passing.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/storefront/admin/setup/route.ts apps/web/app/api/storefront/admin/setup/route.test.ts apps/web/lib/tak/route-context.ts apps/web/lib/tak/route-context-map.test.ts
git commit -m "feat(storefront): surface MSP activation context in setup and routing"
```

## Chunk 4: Verification Gate

### Task 5: Verify the first slice end to end

**Files:**
- No new files required unless fixing failures.

- [ ] **Step 1: Run targeted package tests**

```bash
pnpm --filter @dpf/storefront-templates exec vitest run src/archetypes/archetypes.test.ts
pnpm --filter @dpf/db exec vitest run
pnpm --filter web exec vitest run apps/web/lib/storefront/archetype-activation.test.ts apps/web/app/api/storefront/admin/setup/route.test.ts apps/web/lib/tak/route-context-map.test.ts
```

Expected: all green.

- [ ] **Step 2: Run the production build gate**

```bash
cd apps/web && npx next build
```

Expected: zero errors.

- [ ] **Step 3: Commit any verification fixes**

```bash
git add <files-fixed>
git commit -m "fix(storefront): address MSP activation verification issues"
```

## Deferred Follow-On Plans

These are intentionally not implemented in this first slice:

- customer site first-class model and location mapping
- managed asset / configuration item schema
- service agreement tables
- billing period snapshots
- customer environment Neo4j projection
- internal-vs-customer estate UI separation

Those should be executed as later chunks once the activation-profile foundation is merged.
