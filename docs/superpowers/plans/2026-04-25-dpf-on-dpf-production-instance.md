# DPF on DPF Production Instance Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert this install into the real Open Digital Product Factory production instance, keep production runtime isolated from dev/build runtime, and use existing DPF surfaces to market, capture demand, and route customer-zero product work.

**Architecture:** Keep the first slice narrow and truth-first. Reuse the existing storefront stack (`StorefrontConfig`, `StorefrontItem`, inquiry pages, inbox) for the sold-product layer, add a new canonical `software-platform` industry/archetype foundation so DPF is not forced into the training taxonomy, and introduce an admin/support reset path that safely re-homes an already-initialized install without pretending archetype is end-user editable. The runtime boundary stays aligned with Docker production on `localhost:3000`, dev overlay on `dev-portal` / `3001`, and sandbox runtime on `3035`.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/Postgres, Vitest, Docker Compose, existing storefront templates + setup routes

---

## Resolved Planning Decisions

1. **Starter prospect loop:** `/s/[slug]` public storefront -> `/s/[slug]/inquire` inquiry capture -> `/storefront/inbox` operator handling -> governed backlog workflow for product follow-up.
2. **Sold-product model for phase 1:** use existing `StorefrontItem` / `StorefrontSection` / `StorefrontConfig` instead of inventing a new product package model immediately.
3. **Archetype collision resolution:** add a new canonical `software-platform` industry slug and a built-in DPF-oriented archetype rather than forcing `professional-services` or building a full user-facing archetype reset flow first.

## File Map

### Existing files to modify

- `docker-compose.yml`
  - Production/dev/sandbox runtime boundary already exists here; make it explicit and safe to operate.
- `package.json`
  - Add clear runtime scripts so local work does not default to production-port behavior.
- `apps/web/lib/storefront/industries.ts`
  - Canonical industry slug list.
- `apps/web/lib/storefront/industries.test.ts`
  - Verifies canonical industry slugs.
- `packages/storefront-templates/src/archetypes/index.ts`
  - Built-in archetype registry.
- `packages/storefront-templates/src/archetypes/archetypes.test.ts`
  - Verifies archetype catalog integrity.
- `packages/db/src/seed-storefront-archetypes.ts`
  - Upserts built-in storefront archetypes into the DB.
- `packages/db/src/seed-storefront-archetypes.test.ts`
  - Verifies seeding behavior / marketing skill defaults.
- `apps/web/app/api/storefront/admin/setup/route.ts`
  - Setup flow that seeds `StorefrontConfig`, `StorefrontItem`, `StorefrontSection`, and derived industry values.
- `apps/web/app/api/business-context/setup/route.ts`
  - Canonical business-context persistence used by settings.
- `apps/web/components/admin/BusinessContextForm.tsx`
  - Business identity / context form.
- `apps/web/app/(shell)/storefront/settings/page.tsx`
  - Live storefront presentation and org slug/settings.
- `apps/web/app/(shell)/storefront/settings/business/page.tsx`
  - Business-side settings page that hosts `BusinessContextForm`.
- `apps/web/components/storefront-admin/SetupWizard.tsx`
  - Setup copy and archetype selection UX.
- `apps/web/components/storefront-admin/ItemsManager.tsx`
  - Existing item-management surface that can host phase-1 sold-product content editing.
- `apps/web/app/(storefront)/s/[slug]/page.tsx`
  - Public storefront home.
- `apps/web/app/(storefront)/s/[slug]/inquire/page.tsx`
  - Public inquiry entry point.
- `apps/web/components/storefront-admin/StorefrontInbox.tsx`
  - Operator handling of inquiries/orders/bookings.
- `apps/web/lib/governed-backlog-workflow.ts`
  - Existing product-work conversion logic.
- `tests/e2e/platform-qa-plan.md`
  - Add customer-zero / storefront / setup verification cases.

### New files to create

- `packages/storefront-templates/src/archetypes/software-platform.ts`
  - Built-in archetype/template for DPF as a software-platform seller/operator.
- `apps/web/lib/storefront/archetype-reset.ts`
  - Admin/support helper to swap an existing install from one archetype to another and re-sync derived fields safely.
- `apps/web/lib/storefront/archetype-reset.test.ts`
  - Unit tests for reset behavior and guardrails.
- `apps/web/app/api/storefront/admin/archetype-reset/route.ts`
  - Admin/support-only route to trigger the reset on an initialized install.
- `apps/web/app/api/storefront/admin/archetype-reset/route.test.ts`
  - Route auth/validation tests.
- `apps/web/lib/actions/dpf-production-instance.ts`
  - One focused server-side operation that applies the DPF production-instance preset (org/business/storefront/item truth) after archetype support exists.
- `apps/web/lib/actions/dpf-production-instance.test.ts`
  - Tests for preset application and idempotency.
- `docs/operations/dpf-production-runtime.md`
  - Operator doc explaining `3000` production, `3001` dev-portal, `3035` sandbox, and promotion flow.

---

## Chunk 1: Runtime Boundary and Canonical DPF Archetype

### Task 1: Codify the production/dev runtime boundary

**Files:**
- Create: `docs/operations/dpf-production-runtime.md`
- Modify: `docker-compose.yml`
- Modify: `package.json`

- [ ] **Step 1: Add the operator runtime matrix doc**

Write `docs/operations/dpf-production-runtime.md` with:

```md
# DPF Production Runtime

- `http://localhost:3000` = production-served portal
- `http://localhost:3001` = `dev-portal` developer runtime
- `http://localhost:3035` = sandbox runtime / Build Studio isolation

Rules:
- Never use `pnpm dev` on port 3000 for customer-zero verification
- Verify shipped behavior against Docker `portal`
- Promote changes through branch/PR + rebuild flow
```

- [ ] **Step 2: Make the boundary obvious in Compose**

Update `docker-compose.yml` comments around:

- `portal` (`3000`, `1455`)
- `sandbox` (`3035`)
- `dev-portal` (`3001`)

Add a short comment block near `dev-portal` and `portal` that explicitly says `3000` is production-served and `3001` is the developer runtime.

- [ ] **Step 3: Add explicit package scripts**

Extend `package.json` scripts with names that match the runtime roles, for example:

```json
{
  "scripts": {
    "dev:web": "pnpm --filter web dev",
    "dev:portal": "docker compose up -d dev-portal",
    "dev:prod-runtime": "docker compose up -d portal",
    "dev:sandbox": "docker compose up -d sandbox"
  }
}
```

Keep existing scripts intact; this task adds clarity, not a repo-wide script rename.

- [ ] **Step 4: Verify the compose/runtime config**

Run:

```bash
docker compose config > NUL
pnpm --filter web typecheck
```

Expected:

- `docker compose config` exits `0`
- web typecheck still passes

- [ ] **Step 5: Commit**

```bash
git add docs/operations/dpf-production-runtime.md docker-compose.yml package.json
git commit -s -m "docs(ops): codify DPF production runtime boundary"
```

### Task 2: Add a canonical `software-platform` industry and DPF archetype

**Files:**
- Modify: `apps/web/lib/storefront/industries.ts`
- Modify: `apps/web/lib/storefront/industries.test.ts`
- Create: `packages/storefront-templates/src/archetypes/software-platform.ts`
- Modify: `packages/storefront-templates/src/archetypes/index.ts`
- Modify: `packages/storefront-templates/src/archetypes/archetypes.test.ts`
- Modify: `packages/db/src/seed-storefront-archetypes.ts`
- Modify: `packages/db/src/seed-storefront-archetypes.test.ts`

- [ ] **Step 1: Write the failing industry test**

Add a case to `apps/web/lib/storefront/industries.test.ts`:

```ts
it("includes software-platform as a canonical industry slug", () => {
  expect(INDUSTRY_SLUGS).toContain("software-platform");
  expect(industryLabel("software-platform")).toBe("Software Platform");
});
```

- [ ] **Step 2: Run the industry test to see it fail**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/storefront/industries.test.ts
```

Expected: failure because `software-platform` is not yet in `INDUSTRY_OPTIONS`.

- [ ] **Step 3: Add the new industry slug**

Update `apps/web/lib/storefront/industries.ts`:

```ts
{ value: "software-platform", label: "Software Platform" },
```

Keep the strongly-typed `IndustrySlug` pattern intact.

- [ ] **Step 4: Write the failing archetype tests**

Add test cases in:

- `packages/storefront-templates/src/archetypes/archetypes.test.ts`
- `packages/db/src/seed-storefront-archetypes.test.ts`

Example expectations:

```ts
expect(ALL_ARCHETYPES.some((a) => a.category === "software-platform")).toBe(true);
expect(ALL_ARCHETYPES.find((a) => a.category === "software-platform")?.ctaType).toBe("inquiry");
```

- [ ] **Step 5: Run the archetype tests to see them fail**

Run:

```bash
pnpm --filter @dpf/storefront-templates exec vitest run src/archetypes/archetypes.test.ts
pnpm --filter @dpf/db exec vitest run src/seed-storefront-archetypes.test.ts
```

Expected: failure because no `software-platform` archetype exists.

- [ ] **Step 6: Add the built-in DPF archetype**

Create `packages/storefront-templates/src/archetypes/software-platform.ts` with a focused template:

```ts
export const SOFTWARE_PLATFORM_ARCHETYPE = {
  archetypeId: "software-platform",
  name: "Software Platform",
  category: "software-platform",
  ctaType: "inquiry",
  sectionTemplates: [
    { type: "hero", title: "Hero", sortOrder: 0 },
    { type: "features", title: "Capabilities", sortOrder: 1 },
    { type: "proof", title: "Customer Zero", sortOrder: 2 },
  ],
  itemTemplates: [
    { name: "Open Digital Product Factory", description: "AI-native platform for operating and improving digital products", priceType: "quote", ctaType: "inquiry" },
  ],
  tags: ["software", "platform", "operations", "ai"],
  ...
} as const;
```

Then export it from `packages/storefront-templates/src/archetypes/index.ts`.

- [ ] **Step 7: Update DB seed expectations**

In `packages/db/src/seed-storefront-archetypes.ts`, verify `MARKETING_SKILL_RULES` safely handles the new category. Add an explicit empty/default mapping only if needed for readability; do not special-case behavior without evidence.

- [ ] **Step 8: Re-run archetype and industry tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/storefront/industries.test.ts
pnpm --filter @dpf/storefront-templates exec vitest run src/archetypes/archetypes.test.ts
pnpm --filter @dpf/db exec vitest run src/seed-storefront-archetypes.test.ts
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add apps/web/lib/storefront/industries.ts apps/web/lib/storefront/industries.test.ts packages/storefront-templates/src/archetypes/software-platform.ts packages/storefront-templates/src/archetypes/index.ts packages/storefront-templates/src/archetypes/archetypes.test.ts packages/db/src/seed-storefront-archetypes.ts packages/db/src/seed-storefront-archetypes.test.ts
git commit -s -m "feat(storefront): add software platform archetype"
```

---

## Chunk 2: Safe Reset and DPF Production-Instance Preset

### Task 3: Add an admin/support archetype reset operation for initialized installs

**Files:**
- Create: `apps/web/lib/storefront/archetype-reset.ts`
- Create: `apps/web/lib/storefront/archetype-reset.test.ts`
- Create: `apps/web/app/api/storefront/admin/archetype-reset/route.ts`
- Create: `apps/web/app/api/storefront/admin/archetype-reset/route.test.ts`
- Modify: `apps/web/app/api/storefront/admin/setup/route.ts`

- [ ] **Step 1: Write the failing reset helper tests**

Create `apps/web/lib/storefront/archetype-reset.test.ts` with cases for:

```ts
it("re-syncs Organization.industry and BusinessContext.industry from the new archetype");
it("replaces seeded items/sections when reset is run in replace mode");
it("preserves manually managed contact fields and org slug");
it("refuses to run when the target archetype is missing");
```

- [ ] **Step 2: Run the helper tests to verify they fail**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/storefront/archetype-reset.test.ts
```

Expected: failure because helper does not exist.

- [ ] **Step 3: Implement the reset helper**

Create `apps/web/lib/storefront/archetype-reset.ts` with a single entry point such as:

```ts
export async function resetStorefrontArchetype(input: {
  organizationId: string;
  targetArchetypeId: string;
  mode: "replace-seeded-content";
}) { ... }
```

Implementation responsibilities:

- load current `Organization`, `StorefrontConfig`, `BusinessContext`
- load target `StorefrontArchetype`
- update `StorefrontConfig.archetypeId`
- update derived `Organization.industry` / `BusinessContext.industry` / `BusinessContext.ctaType`
- replace seeded `StorefrontSection` / `StorefrontItem` rows in one transaction
- preserve org slug, contact details, and non-derived business text unless explicitly overwritten later

- [ ] **Step 4: Add the admin/support route**

Create `apps/web/app/api/storefront/admin/archetype-reset/route.ts`:

```ts
POST /api/storefront/admin/archetype-reset
{
  "targetArchetypeId": "software-platform"
}
```

Behavior:

- admin-only auth
- resolves current organization
- calls `resetStorefrontArchetype`
- returns JSON summary of changed rows

- [ ] **Step 5: Add route tests**

Create `route.test.ts` covering:

```ts
it("returns 401 for non-admin");
it("returns 400 when target archetype is missing");
it("returns 200 with reset summary for admin");
```

- [ ] **Step 6: Re-run tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/storefront/archetype-reset.test.ts apps/web/app/api/storefront/admin/archetype-reset/route.test.ts
pnpm --filter web typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/storefront/archetype-reset.ts apps/web/lib/storefront/archetype-reset.test.ts apps/web/app/api/storefront/admin/archetype-reset/route.ts apps/web/app/api/storefront/admin/archetype-reset/route.test.ts apps/web/app/api/storefront/admin/setup/route.ts
git commit -s -m "feat(storefront): add admin archetype reset operation"
```

### Task 4: Add an idempotent DPF production-instance preset action

**Files:**
- Create: `apps/web/lib/actions/dpf-production-instance.ts`
- Create: `apps/web/lib/actions/dpf-production-instance.test.ts`
- Modify: `apps/web/app/api/business-context/setup/route.ts`
- Modify: `apps/web/app/(shell)/storefront/settings/page.tsx`
- Modify: `apps/web/app/(shell)/storefront/settings/business/page.tsx`

- [ ] **Step 1: Write the failing preset tests**

Create tests for:

```ts
it("updates Organization name/slug/contact fields to DPF truth");
it("updates BusinessContext to DPF operating-business truth");
it("updates StorefrontConfig presentation fields");
it("is idempotent when run twice");
```

- [ ] **Step 2: Run the preset tests to see them fail**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/actions/dpf-production-instance.test.ts
```

- [ ] **Step 3: Implement the preset action**

Create `apps/web/lib/actions/dpf-production-instance.ts` with a shape like:

```ts
export async function applyDpfProductionInstancePreset() {
  return prisma.$transaction(async (tx) => {
    // Update Organization
    // Update BusinessContext
    // Update StorefrontConfig
    // Leave archetype reset to Task 3 helper
  });
}
```

Phase-1 preset content should include:

- org name: `Open Digital Product Factory`
- slug: a DPF slug agreed in execution (`open-digital-product-factory` unless live URL constraints require otherwise)
- business description / target market / revenue model oriented around DPF as operator + sold platform
- storefront tagline/description/contact fields aligned with the product

- [ ] **Step 4: Expose it in an internal settings surface**

Add a clearly labeled admin/support action on one existing settings page, for example:

- `apps/web/app/(shell)/storefront/settings/page.tsx` or
- `apps/web/app/(shell)/storefront/settings/business/page.tsx`

The UI should make clear this is an internal support operation for the DPF install, not a generic end-user flow.

- [ ] **Step 5: Preserve existing edit paths**

Update `apps/web/app/api/business-context/setup/route.ts` only as needed so later manual edits do not undo archetype-derived rules. Keep industry derived from archetype, but allow DPF business text/contact fields to be edited safely.

- [ ] **Step 6: Re-run tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/actions/dpf-production-instance.test.ts apps/web/app/api/business-context/setup/route.test.ts
pnpm --filter web typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/actions/dpf-production-instance.ts apps/web/lib/actions/dpf-production-instance.test.ts apps/web/app/api/business-context/setup/route.ts apps/web/app/(shell)/storefront/settings/page.tsx apps/web/app/(shell)/storefront/settings/business/page.tsx
git commit -s -m "feat(storefront): add DPF production instance preset"
```

---

## Chunk 3: Public Product Truth and Customer-Zero Flow

### Task 5: Replace training-example storefront content with DPF product truth

**Files:**
- Modify: `apps/web/components/storefront-admin/ItemsManager.tsx`
- Modify: `apps/web/components/storefront-admin/SetupWizard.tsx`
- Modify: `apps/web/app/(storefront)/s/[slug]/page.tsx`
- Modify: `apps/web/app/(storefront)/s/[slug]/inquire/page.tsx`
- Modify: `apps/web/lib/release/storefront-data.test.ts`

- [ ] **Step 1: Write the failing storefront-data test**

Add or extend a test in `apps/web/lib/release/storefront-data.test.ts` to assert the storefront can carry software-platform copy without breaking public-storefront loading:

```ts
it("returns published software-platform storefront items and sections for the public slug", async () => {
  expect(result?.items[0]?.ctaType).toBe("inquiry");
});
```

- [ ] **Step 2: Run the storefront-data test**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/release/storefront-data.test.ts
```

- [ ] **Step 3: Tighten setup copy**

Update `apps/web/components/storefront-admin/SetupWizard.tsx` so copy around business model / template selection does not imply only a generic SMB/services setup. Keep the template-first structure, but make room for “software platform” and “operator + sold product” language where appropriate.

- [ ] **Step 4: Improve the public storefront experience for DPF**

Update:

- `apps/web/app/(storefront)/s/[slug]/page.tsx`
- `apps/web/app/(storefront)/s/[slug]/inquire/page.tsx`

Goals:

- make the sold product legible as DPF, not a generic training offer
- keep the first CTA focused on inquiry/demo/contact
- ensure the inquiry page asks for the right product-conversation context

Do not introduce a brand-new public IA in this task; stay within the existing storefront shape.

- [ ] **Step 5: Ensure catalog editing is manageable**

Update `apps/web/components/storefront-admin/ItemsManager.tsx` only if needed to make DPF item content easy to maintain after the preset runs. Keep the UI theme-aware and avoid introducing a new one-off editor.

- [ ] **Step 6: Re-run tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/release/storefront-data.test.ts
pnpm --filter web typecheck
pnpm --filter web build
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/storefront-admin/ItemsManager.tsx apps/web/components/storefront-admin/SetupWizard.tsx apps/web/app/(storefront)/s/[slug]/page.tsx apps/web/app/(storefront)/s/[slug]/inquire/page.tsx apps/web/lib/release/storefront-data.test.ts
git commit -s -m "feat(storefront): convert public DPF product content"
```

### Task 6: Close the first customer-zero loop from inquiry to product work

**Files:**
- Modify: `apps/web/components/storefront-admin/StorefrontInbox.tsx`
- Modify: `apps/web/app/(shell)/storefront/inbox/page.tsx`
- Modify: `apps/web/lib/governed-backlog-workflow.ts`
- Modify: `tests/e2e/platform-qa-plan.md`

- [ ] **Step 1: Write the failing governed-backlog test**

Add a focused test in the existing governed backlog test file or create one if needed to assert that a storefront inquiry can be normalized into product-work intake metadata.

Example:

```ts
it("maps a storefront inquiry into a governed backlog intake payload tagged as customer-zero signal");
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/governed-backlog-workflow.test.ts
```

- [ ] **Step 3: Add the product-signal bridge**

Extend `apps/web/lib/governed-backlog-workflow.ts` with a minimal adapter/helper that can accept storefront inquiry metadata and classify it as a customer-zero product signal. Keep this additive; do not redesign the whole governed backlog flow.

- [ ] **Step 4: Make inbox handling legible**

Update inbox surface files:

- `apps/web/components/storefront-admin/StorefrontInbox.tsx`
- `apps/web/app/(shell)/storefront/inbox/page.tsx`

Add a small, explicit affordance for product/sales inquiries related to DPF (for example: tags, filter label, or “send to product backlog” action). Keep changes narrow and internal-facing.

- [ ] **Step 5: Add QA cases**

Add platform QA cases to `tests/e2e/platform-qa-plan.md` for:

- DPF production runtime boundary check
- storefront inquiry flow for DPF product interest
- inbox handling of DPF inquiry
- conversion of one DPF inquiry into governed backlog/product follow-up

- [ ] **Step 6: Re-run tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/governed-backlog-workflow.test.ts
pnpm --filter web typecheck
pnpm --filter web build
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/storefront-admin/StorefrontInbox.tsx apps/web/app/(shell)/storefront/inbox/page.tsx apps/web/lib/governed-backlog-workflow.ts tests/e2e/platform-qa-plan.md
git commit -s -m "feat(storefront): connect DPF inquiries to product work"
```

---

## Chunk 4: Live Conversion and Verification

### Task 7: Apply the reset/preset to the live install and verify production paths

**Files:**
- Modify: none expected unless verification reveals a bug
- Test: live runtime + DB checks

- [ ] **Step 1: Seed the new archetype**

Run:

```bash
pnpm --filter @dpf/db seed
```

Expected: `software-platform` archetype exists in the DB.

- [ ] **Step 2: Rebuild the production runtime**

Run:

```bash
docker compose build --no-cache portal portal-init sandbox
docker compose up -d portal-init sandbox
docker compose up -d portal
```

Expected: `portal` healthy on `http://localhost:3000`, sandbox healthy on `http://localhost:3035`.

- [ ] **Step 3: Apply the admin/support reset + preset**

Use the new internal route/action to:

1. reset the install from `Corporate Training` to `software-platform`
2. apply the DPF production-instance preset

Then verify in DB:

```sql
SELECT name, slug, industry FROM "Organization";
SELECT industry, "ctaType", "revenueModel" FROM "BusinessContext";
SELECT "isPublished", tagline, description FROM "StorefrontConfig";
SELECT name, "ctaType" FROM "StorefrontItem" ORDER BY "createdAt";
```

- [ ] **Step 4: Run focused automated checks**

Run:

```bash
pnpm --filter web typecheck
pnpm --filter web build
```

Expected: both pass before claiming completion.

- [ ] **Step 5: Run UX verification against production**

Verify against `http://localhost:3000`:

1. `/storefront/settings` shows DPF truth
2. `/storefront/settings/business` shows DPF business context
3. `/s/<slug>` presents DPF as the sold product
4. `/s/<slug>/inquire` captures a product inquiry
5. `/storefront/inbox` shows the inquiry

Also verify dev/runtime separation:

1. `http://localhost:3000` remains the Docker production-served runtime
2. `http://localhost:3001` serves dev-portal (if started)
3. `http://localhost:3035` remains sandbox

- [ ] **Step 6: Update backlog live**

Create the epic:

- `DPF on DPF: Production Instance and Customer-Zero Operationalization`

Then create the first-slice backlog items that match this plan and mark completed items done as work lands.

- [ ] **Step 7: Final commit / handoff**

```bash
git status
```

If clean and verified, either:

- open/update PR for the branch, or
- move into execution using `superpowers:subagent-driven-development`

---

## Verification Checklist

- `pnpm --filter web exec vitest run apps/web/lib/storefront/industries.test.ts`
- `pnpm --filter @dpf/storefront-templates exec vitest run src/archetypes/archetypes.test.ts`
- `pnpm --filter @dpf/db exec vitest run src/seed-storefront-archetypes.test.ts`
- `pnpm --filter web exec vitest run apps/web/lib/storefront/archetype-reset.test.ts apps/web/app/api/storefront/admin/archetype-reset/route.test.ts`
- `pnpm --filter web exec vitest run apps/web/lib/actions/dpf-production-instance.test.ts apps/web/app/api/business-context/setup/route.test.ts`
- `pnpm --filter web exec vitest run apps/web/lib/release/storefront-data.test.ts apps/web/lib/governed-backlog-workflow.test.ts`
- `pnpm --filter web typecheck`
- `pnpm --filter web build`
- Manual UX verification on `http://localhost:3000`

Plan complete and saved to `docs/superpowers/plans/2026-04-25-dpf-on-dpf-production-instance.md`. Ready to execute?
