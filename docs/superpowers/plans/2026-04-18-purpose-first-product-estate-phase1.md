# Purpose-First Product Estate Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Demote top-level Inventory into Platform discovery operations, reframe product inventory as dependencies and estate, and repurpose the coworker into a cohesive estate specialist backed by the shared product-estate model.

**Architecture:** Keep the existing `InventoryEntity` / `InventoryRelationship` / taxonomy backbone, but change the first user-facing slice so humans navigate through `Portfolio` and product context while discovery mechanics move under `Platform > Tools & Services`. Add a lightweight estate presentation layer over existing evidence, plus a small schema extension for cross-type identity fields, without introducing a full CMDB subtype hierarchy or a second inventory truth.

**Tech Stack:** Next.js App Router, React server/client components, TypeScript, Prisma/PostgreSQL migrations, Tailwind utility classes with DPF CSS variables, Vitest, Docker Compose, Playwright CLI for live smoke checks.

---

## Scope

This plan intentionally covers only the **first shippable absorption slice** from `docs/superpowers/specs/2026-04-18-purpose-first-product-estate-design.md`:

- remove `Inventory` as a durable top-level destination
- add `Discovery Operations` under `Platform > Tools & Services`
- keep `/inventory` only as a legacy alias/redirect
- relabel product `Inventory` to `Dependencies & Estate`
- add the first high-signal estate identity card using shared evidence
- repurpose the current `inventory-specialist` into a purpose/dependency/posture-oriented estate specialist

Do **not** include these in this plan:

- full portfolio-node sub-route restructuring (`Overview / Products / Dependencies / Posture`)
- a large dedicated posture findings subsystem beyond `PortfolioQualityIssue`
- multiple new specialist agents with their own runtime orchestration
- a broad polymorphic CMDB schema

Those belong in follow-on plans once this foundation is shipping cleanly.

## File Structure

### Existing files to modify

- `apps/web/lib/govern/permissions.ts`
  - remove `Inventory` from durable shell/workspace surfaces
- `apps/web/lib/govern/permissions.test.ts`
  - update shell/workspace expectations after the navigation demotion
- `apps/web/app/(shell)/workspace/page.tsx`
  - remove obsolete inventory tile metrics and align workspace copy if needed
- `apps/web/components/platform/platform-nav.ts`
  - add `Discovery Operations` as a `Tools & Services` sub-item
- `apps/web/components/platform/platform-nav.test.ts`
  - cover the new discovery route family mapping
- `apps/web/components/platform/PlatformTabNav.test.tsx`
  - verify discovery sub-navigation is shown in the tools family
- `apps/web/app/(shell)/platform/tools/page.tsx`
  - add discovery operations to the tools hub
- `apps/web/app/(shell)/inventory/page.tsx`
  - convert from primary destination to legacy alias/redirect or thin wrapper
- `apps/web/app/(shell)/inventory/layout.tsx`
  - preserve gating while aligning the route to its legacy role
- `apps/web/app/(shell)/portfolio/product/[id]/page.tsx`
  - update overview copy/stat labels to `Dependencies & Estate`
- `apps/web/app/(shell)/portfolio/product/[id]/inventory/page.tsx`
  - turn the page into the first estate/dependency surface
- `apps/web/app/(shell)/portfolio/product/[id]/layout.tsx`
  - keep the product header/tab framing aligned
- `apps/web/components/product/ProductTabNav.tsx`
  - relabel the `Operate > Inventory` experience to `Dependencies & Estate`
- `apps/web/components/inventory/InventoryEntityPanel.tsx`
  - either retire or narrow to discovery-operations use only
- `apps/web/app/(shell)/inventory/page.test.tsx`
  - update tests for the new role of discovery operations / alias behavior
- `apps/web/lib/actions/discovery.ts`
  - revalidate the new discovery route in addition to or instead of `/inventory`
- `apps/web/lib/actions/inventory.ts`
  - revalidate the new discovery route in addition to or instead of `/inventory`
- `apps/web/lib/tak/agent-routing.ts`
  - update route mapping, prompt, description, and skills for the estate specialist
- `apps/web/lib/tak/agent-routing.test.ts`
  - verify routing and prompt text for `/platform/tools/discovery` and the new specialist framing
- `tests/e2e/platform-qa-plan.md`
  - add/replace Phase 8 and AI coworker test cases for estate/discovery behavior
- `packages/db/prisma/schema.prisma`
  - add a small set of normalized cross-type estate detail fields

### New files to create

- `apps/web/app/(shell)/platform/tools/discovery/page.tsx`
  - canonical `Discovery Operations` route
- `apps/web/components/inventory/DiscoveryOperationsPage.tsx`
  - reusable server-friendly composition for sweep status, connections, attribution, topology, and quality panels
- `apps/web/app/(shell)/platform/tools/discovery/page.test.tsx`
  - narrow regression coverage for the new route shell and key headings
- `apps/web/components/inventory/EstateItemCard.tsx`
  - shared identity/posture card for product estate items
- `apps/web/components/inventory/EstateItemCard.test.tsx`
  - render-level regression coverage for icons, manufacturer, version, support, and confidence states
- `apps/web/lib/estate/estate-item.ts`
  - helper functions for icon key resolution, support-state derivation, and version display decisions
- `apps/web/lib/estate/estate-item.test.ts`
  - unit tests for derivation logic
- `apps/web/lib/actions/inventory.test.ts`
  - server-action coverage for revalidation and authorization on inventory reassignment/dismissal flows
- `packages/db/prisma/migrations/<timestamp>_purpose_first_estate_foundation/migration.sql`
  - schema migration with inline backfill SQL for new normalized estate fields

### Existing files likely to need limited follow-up in the same slice

- `apps/web/components/inventory/DiscoveryRunSummary.tsx`
- `apps/web/components/inventory/AddDiscoveryConnection.tsx`
- `apps/web/components/inventory/InventoryExceptionQueue.tsx`
- `apps/web/components/inventory/PortfolioQualityIssuesPanel.tsx`
- `apps/web/components/inventory/TopologyGraph.tsx`

Keep these changes additive and focused on reframing. Do not redesign every panel in this slice.

---

## Chunk 1: Discovery Operations Reframe

### Task 1: Add failing tests for nav demotion and discovery route membership

**Files:**
- Modify: `apps/web/lib/govern/permissions.test.ts`
- Modify: `apps/web/components/platform/platform-nav.test.ts`
- Modify: `apps/web/components/platform/PlatformTabNav.test.tsx`
- Modify: `apps/web/lib/tak/agent-routing.test.ts`

- [ ] **Step 1: Add failing permissions assertions**

Update `permissions.test.ts` to assert:

- `Inventory` is no longer present in the `products` shell section
- `Inventory` is no longer present in the `product-oversight` workspace section
- `Portfolio` remains present

- [ ] **Step 2: Add failing platform-nav assertions**

Update `platform-nav.test.ts` so it expects:

- `/platform/tools/discovery` maps to the `tools` family
- the tools family includes a `Discovery Operations` sub-item

- [ ] **Step 3: Add failing PlatformTabNav render assertions**

Update `PlatformTabNav.test.tsx` so it expects:

- when the pathname is `/platform/tools/discovery`, the rendered sub-nav contains:
  - `href="/platform/tools"`
  - `href="/platform/tools/catalog"`
  - `href="/platform/tools/services"`
  - `href="/platform/tools/discovery"`

- [ ] **Step 4: Add failing route-agent assertions**

Update `agent-routing.test.ts` so it expects:

- `/platform/tools/discovery` resolves to `inventory-specialist`
- the system prompt mentions purpose, dependencies, and posture rather than generic stage-gate language

- [ ] **Step 5: Run the tests and verify failure**

Run:

```bash
pnpm --filter web exec vitest run lib/govern/permissions.test.ts components/platform/platform-nav.test.ts components/platform/PlatformTabNav.test.tsx lib/tak/agent-routing.test.ts
```

Expected:
- FAIL with assertions that still reflect the current top-level inventory model

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/govern/permissions.test.ts apps/web/components/platform/platform-nav.test.ts apps/web/components/platform/PlatformTabNav.test.tsx apps/web/lib/tak/agent-routing.test.ts
git commit -m "test(estate): add failing coverage for discovery operations refactor"
```

### Task 2: Move discovery into Platform Tools and demote Inventory

**Files:**
- Modify: `apps/web/lib/govern/permissions.ts`
- Modify: `apps/web/app/(shell)/workspace/page.tsx`
- Modify: `apps/web/components/platform/platform-nav.ts`
- Modify: `apps/web/app/(shell)/platform/tools/page.tsx`
- Create: `apps/web/app/(shell)/platform/tools/discovery/page.tsx`
- Create: `apps/web/components/inventory/DiscoveryOperationsPage.tsx`
- Modify: `apps/web/app/(shell)/inventory/page.tsx`
- Modify: `apps/web/app/(shell)/inventory/layout.tsx`
- Test: `apps/web/lib/govern/permissions.test.ts`
- Test: `apps/web/components/platform/platform-nav.test.ts`
- Test: `apps/web/components/platform/PlatformTabNav.test.tsx`

- [ ] **Step 1: Remove Inventory from durable nav structures**

In `permissions.ts`:

- remove `inventory` from `ALL_TILES`
- remove `inventory` from `SHELL_ITEMS`
- remove `inventory` from `WORKSPACE_SECTION_BLUEPRINTS.product-oversight`

Do not remove the underlying `view_inventory` capability yet. The route still needs auth gating and the legacy alias still exists.

- [ ] **Step 2: Clean up workspace status wiring**

In `workspace/page.tsx`:

- remove the `tileStatus.inventory` block
- keep the other tile metrics intact

- [ ] **Step 3: Add discovery to the platform tools family**

In `platform-nav.ts`, extend the tools family sub-items:

```ts
{ label: "Discovery Operations", href: "/platform/tools/discovery" }
```

Keep `Capability Inventory` separate; it remains agent-tool inventory, not product estate discovery.

- [ ] **Step 4: Add discovery entry to the tools hub**

In `platform/tools/page.tsx`:

- replace the current three-card framing with four cards or revise the layout so `Discovery Operations` sits alongside `Catalog`, `Services`, and `Capability Inventory`
- make the copy clearly distinguish:
  - discovery/product estate plumbing
  - agent tool inventory

- [ ] **Step 5: Extract a reusable discovery operations composition**

Create `DiscoveryOperationsPage.tsx` that renders the existing discovery-focused panels now living on `/inventory`:

- `DiscoveryRunSummary`
- `AddDiscoveryConnection`
- `InventoryExceptionQueue`
- `SubnetGroupedInventoryPanel`
- `PortfolioQualityIssuesPanel`
- `TopologyGraph`

Its props should accept the already-fetched data so the route stays server-component-friendly.

- [ ] **Step 6: Create the canonical route**

Create `app/(shell)/platform/tools/discovery/page.tsx` and move the current discovery query logic there.

Reuse the query structure already in `/inventory`, but update headings and copy to:

- `Discovery Operations`
- emphasize scans, attribution, topology, and promotion quality
- avoid presenting it as the main human-facing estate destination

- [ ] **Step 7: Convert `/inventory` into a legacy alias**

Choose the lighter option:

- server-side `redirect("/platform/tools/discovery")`

If the route needs to stay visible temporarily, use a thin wrapper page that:

- explains the route has moved
- immediately links/redirects to the canonical route

Do not keep the full discovery operations implementation duplicated in both routes.

- [ ] **Step 8: Keep auth gating intact**

Update `inventory/layout.tsx` only as needed so the legacy route keeps its auth boundary while the canonical route inherits the correct platform/tools layout and permissions.

- [ ] **Step 9: Run the updated tests**

Run:

```bash
pnpm --filter web exec vitest run lib/govern/permissions.test.ts components/platform/platform-nav.test.ts components/platform/PlatformTabNav.test.tsx
```

Expected:
- PASS

- [ ] **Step 10: Commit**

```bash
git add apps/web/lib/govern/permissions.ts apps/web/app/(shell)/workspace/page.tsx apps/web/components/platform/platform-nav.ts apps/web/app/(shell)/platform/tools/page.tsx apps/web/app/(shell)/platform/tools/discovery/page.tsx apps/web/components/inventory/DiscoveryOperationsPage.tsx apps/web/app/(shell)/inventory/page.tsx apps/web/app/(shell)/inventory/layout.tsx apps/web/lib/govern/permissions.test.ts apps/web/components/platform/platform-nav.test.ts apps/web/components/platform/PlatformTabNav.test.tsx
git commit -m "feat(estate): demote inventory into discovery operations"
```

### Task 3: Update discovery and inventory actions to revalidate the canonical route

**Files:**
- Modify: `apps/web/lib/actions/discovery.ts`
- Modify: `apps/web/lib/actions/inventory.ts`
- Create: `apps/web/lib/actions/inventory.test.ts`
- Modify: `apps/web/lib/actions/discovery.test.ts`

- [ ] **Step 1: Add failing action tests**

In `discovery.test.ts` and the new `inventory.test.ts`, assert that successful mutations revalidate:

- `/platform/tools/discovery`

If you keep `/inventory` as a legacy redirect, it is acceptable to revalidate both routes in this phase.

- [ ] **Step 2: Run tests to confirm failure**

Run:

```bash
pnpm --filter web exec vitest run lib/actions/discovery.test.ts lib/actions/inventory.test.ts
```

Expected:
- FAIL because the actions still only revalidate `/inventory`

- [ ] **Step 3: Update the actions**

In `discovery.ts` and `inventory.ts`:

- revalidate `/platform/tools/discovery`
- optionally keep `/inventory` revalidation during the migration window

- [ ] **Step 4: Re-run the tests**

Run:

```bash
pnpm --filter web exec vitest run lib/actions/discovery.test.ts lib/actions/inventory.test.ts
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/discovery.ts apps/web/lib/actions/inventory.ts apps/web/lib/actions/discovery.test.ts apps/web/lib/actions/inventory.test.ts
git commit -m "feat(estate): revalidate canonical discovery operations route"
```

---

## Chunk 2: Estate Detail Foundation

### Task 4: Add minimal normalized estate identity fields to the schema

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_purpose_first_estate_foundation/migration.sql`

- [ ] **Step 1: Add the failing schema expectations**

Update the Prisma schema to add only the normalized cross-type fields needed in this phase:

```prisma
technicalClass   String?
iconKey          String?
manufacturer     String?
productModel     String?
observedVersion  String?
normalizedVersion String?
supportStatus    String? @default("unknown")
```

Do **not** add a broad subtype tree or a dedicated vulnerability model in this phase.

- [ ] **Step 2: Validate the schema before migration**

Run:

```bash
pnpm --filter @dpf/db exec prisma validate
```

Expected:
- PASS

- [ ] **Step 3: Generate the migration skeleton**

Run:

```bash
pnpm --filter @dpf/db exec prisma migrate dev --name purpose_first_estate_foundation
```

Expected:
- a new migration directory is created

- [ ] **Step 4: Add inline backfill SQL to the migration**

Backfill the new columns from existing evidence where possible:

- `manufacturer` from the newest `DiscoveredSoftwareEvidence.rawVendor`
- `observedVersion` from the newest `DiscoveredSoftwareEvidence.rawVersion`
- `normalizedVersion` from existing software normalization output if already stored in evidence metadata or properties
- `iconKey` / `technicalClass` from existing `entityType` mapping
- `supportStatus` default to `unknown`

Keep the SQL in the migration file itself. Do not create a separate one-off script.

- [ ] **Step 5: Re-run the migration cleanly**

Run:

```bash
pnpm --filter @dpf/db exec prisma migrate dev
pnpm --filter @dpf/db exec prisma generate
```

Expected:
- PASS with no drift

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(estate): add normalized estate identity fields"
```

### Task 5: Add derivation helpers and failing UI tests for estate item presentation

**Files:**
- Create: `apps/web/lib/estate/estate-item.ts`
- Create: `apps/web/lib/estate/estate-item.test.ts`
- Create: `apps/web/components/inventory/EstateItemCard.tsx`
- Create: `apps/web/components/inventory/EstateItemCard.test.tsx`

- [ ] **Step 1: Write failing derivation tests**

Cover:

- `entityType` to `iconKey` mapping
- support-state label normalization
- observed vs normalized version precedence
- confidence labeling for weak evidence

Representative expectations:

- `router` → `connectivity`
- `camera` → `security-control` or `facility-device` only if explicitly chosen by the mapping rules
- missing support state → `unknown`

- [ ] **Step 2: Write the failing card render test**

Assert the new card can render:

- icon placeholder/class hook
- manufacturer
- observed version
- support status
- confidence text
- taxonomy/purpose context

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm --filter web exec vitest run lib/estate/estate-item.test.ts components/inventory/EstateItemCard.test.tsx
```

Expected:
- FAIL because the helper and component do not exist yet

- [ ] **Step 4: Implement the derivation helper**

Create a focused helper module with functions like:

```ts
export function resolveEstateIconKey(entityType: string, technicalClass?: string | null): string
export function resolveEstateVersion(input: { observedVersion?: string | null; normalizedVersion?: string | null }): { primary: string | null; secondary: string | null }
export function resolveSupportStatusLabel(status?: string | null): string
```

- [ ] **Step 5: Implement the card**

Create a compact presentation component that shows:

- icon
- display name
- taxonomy / purpose
- dependency role label if present
- manufacturer
- version
- support status
- confidence / last-seen metadata

Use only DPF theme variables. No hardcoded colors.

- [ ] **Step 6: Re-run the tests**

Run:

```bash
pnpm --filter web exec vitest run lib/estate/estate-item.test.ts components/inventory/EstateItemCard.test.tsx
```

Expected:
- PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/estate/estate-item.ts apps/web/lib/estate/estate-item.test.ts apps/web/components/inventory/EstateItemCard.tsx apps/web/components/inventory/EstateItemCard.test.tsx
git commit -m "feat(estate): add shared estate item presentation layer"
```

### Task 6: Reframe the product inventory surface into Dependencies & Estate

**Files:**
- Modify: `apps/web/components/product/ProductTabNav.tsx`
- Modify: `apps/web/app/(shell)/portfolio/product/[id]/page.tsx`
- Modify: `apps/web/app/(shell)/portfolio/product/[id]/inventory/page.tsx`
- Modify: `apps/web/app/(shell)/portfolio/product/[id]/layout.tsx`
- Test: `apps/web/components/inventory/EstateItemCard.test.tsx`

- [ ] **Step 1: Relabel the product tab**

In `ProductTabNav.tsx`:

- keep the existing route path `/portfolio/product/[id]/inventory`
- change the visible label from `Inventory` to `Dependencies & Estate`
- keep it under the `Operate` family in this phase

- [ ] **Step 2: Update product overview stats/copy**

In `product/[id]/page.tsx`:

- rename the stat label `Inventory Entities` to `Dependencies & Estate`
- update any nearby copy so the product is framed around runtime role, dependencies, and posture

- [ ] **Step 3: Expand the product inventory query**

In `product/[id]/inventory/page.tsx`:

- fetch the new normalized identity fields
- fetch the newest `softwareEvidence` needed for version/manufacturer fallback if the normalized columns are empty
- fetch `fromRelationships` / `toRelationships` counts or the minimal dependency summary needed to show upstream/downstream context

- [ ] **Step 4: Replace flat cards with `EstateItemCard`**

Keep the page grouped if that still helps scanability, but lead each item with:

- purpose context
- role/dependency clues
- manufacturer/version/support posture

Do not rebuild the full topology page here. This is a first-pass estate surface.

- [ ] **Step 5: Run the estate-related tests**

Run:

```bash
pnpm --filter web exec vitest run components/inventory/EstateItemCard.test.tsx
```

Expected:
- PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/product/ProductTabNav.tsx apps/web/app/(shell)/portfolio/product/[id]/page.tsx apps/web/app/(shell)/portfolio/product/[id]/inventory/page.tsx apps/web/app/(shell)/portfolio/product/[id]/layout.tsx apps/web/components/inventory/EstateItemCard.tsx
git commit -m "feat(estate): reframe product inventory as dependencies and estate"
```

---

## Chunk 3: Specialist Absorption

### Task 7: Update the route agent into a Digital Product Estate Specialist

**Files:**
- Modify: `apps/web/lib/tak/agent-routing.ts`
- Modify: `apps/web/lib/tak/agent-routing.test.ts`

- [ ] **Step 1: Replace the old generic product-manager framing**

For the route entry currently used by inventory/discovery:

- keep `agentId: "inventory-specialist"`
- change the displayed role to something like `Digital Product Estate Specialist`
- update the description from generic lifecycle analysis to purpose/dependency/posture stewardship

- [ ] **Step 2: Add the canonical route**

Ensure `/platform/tools/discovery` resolves to the estate specialist.

If `/inventory` remains reachable during migration, it should resolve to the same agent so behavior stays consistent.

- [ ] **Step 3: Rewrite the system prompt**

The prompt must instruct the agent to reason in this order:

1. taxonomy/purpose
2. owning portfolio/product
3. dependency role
4. blast radius
5. posture
6. confidence/freshness
7. technical classification

Avoid lifecycle stage-gate language unless the user is explicitly asking about product lifecycle.

- [ ] **Step 4: Rewrite the skills menu**

Replace the current lifecycle-oriented skills with:

- `What breaks if this fails?`
- `Show upstream dependencies`
- `Show downstream impact`
- `Review taxonomy placement`
- `Check support posture`
- `Check version confidence`
- `Review discovery quality`
- `Run discovery sweep`

- [ ] **Step 5: Run the route-agent tests**

Run:

```bash
pnpm --filter web exec vitest run lib/tak/agent-routing.test.ts
```

Expected:
- PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/tak/agent-routing.ts apps/web/lib/tak/agent-routing.test.ts
git commit -m "feat(ai): repurpose inventory specialist into estate specialist"
```

### Task 8: Add focused page tests for the new discovery route and update QA coverage

**Files:**
- Create: `apps/web/app/(shell)/platform/tools/discovery/page.test.tsx`
- Modify: `apps/web/app/(shell)/inventory/page.test.tsx`
- Modify: `tests/e2e/platform-qa-plan.md`

- [ ] **Step 1: Add a narrow discovery route page test**

Test only for stable headings/copy such as:

- `Discovery Operations`
- `Open Discovery Issues`
- `Product Inventory` should no longer read like the main page title

Keep mocking light and avoid a giant data fixture.

- [ ] **Step 2: Update the legacy inventory page tests**

If `/inventory` becomes a redirect or alias, replace the old assumptions accordingly. Do not keep tests asserting that `/inventory` is the primary product inventory destination.

- [ ] **Step 3: Update the Playwright QA plan**

In `tests/e2e/platform-qa-plan.md`, update Phase 8 and Phase 12:

- replace `INV-01` with a test that verifies `/inventory` redirects or hands off to discovery operations cleanly
- add:
  - `INV-02` canonical discovery route load at `/platform/tools/discovery`
  - `INV-03` product page shows `Dependencies & Estate`
  - `INV-04` product estate cards show manufacturer/version/support data when available
  - `AI-11` coworker on `/platform/tools/discovery` presents the estate specialist
  - `AI-12` incomplete-info test for the estate specialist asking for scope before summarizing posture

- [ ] **Step 4: Run the page and route tests**

Run:

```bash
pnpm --filter web exec vitest run "app/(shell)/platform/tools/discovery/page.test.tsx" "app/(shell)/inventory/page.test.tsx" lib/tak/agent-routing.test.ts
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(shell)/platform/tools/discovery/page.test.tsx apps/web/app/(shell)/inventory/page.test.tsx tests/e2e/platform-qa-plan.md
git commit -m "test(estate): cover discovery operations and estate specialist flows"
```

---

## Chunk 4: Verification Gate

### Task 9: Run focused tests, build, migration verification, Docker rebuild, and live smoke

**Files:**
- No code changes

- [ ] **Step 1: Run the focused Vitest suite**

Run:

```bash
pnpm --filter web exec vitest run lib/govern/permissions.test.ts components/platform/platform-nav.test.ts components/platform/PlatformTabNav.test.tsx lib/actions/discovery.test.ts lib/actions/inventory.test.ts lib/estate/estate-item.test.ts components/inventory/EstateItemCard.test.tsx lib/tak/agent-routing.test.ts "app/(shell)/platform/tools/discovery/page.test.tsx" "app/(shell)/inventory/page.test.tsx"
```

Expected:
- PASS

- [ ] **Step 2: Verify Prisma schema and migration state**

Run:

```bash
pnpm --filter @dpf/db exec prisma validate
pnpm --filter @dpf/db exec prisma migrate status
```

Expected:
- PASS
- no unexpected drift

- [ ] **Step 3: Run the production build**

Run:

```bash
pnpm --filter web build
```

Expected:
- PASS with exit code `0`

- [ ] **Step 4: Rebuild the live portal image**

Run:

```bash
docker compose up -d --build portal
```

Expected:
- portal rebuilt and healthy

- [ ] **Step 5: Perform live browser smoke checks**

Use Playwright CLI and verify:

- `/workspace`
  - no `Inventory` tile in the durable launcher set
- `/platform/tools`
  - `Discovery Operations` appears in the hub and sub-nav
- `/platform/tools/discovery`
  - discovery panels load under Platform Tools
  - coworker shows the estate specialist
- `/inventory`
  - clean redirect or alias handoff to the canonical route
- `/portfolio/product/<known-id>/inventory`
  - tab label reads `Dependencies & Estate`
  - estate cards show manufacturer/version/support when evidence exists

- [ ] **Step 6: Commit the final implementation batch if everything passes**

Stage only the files from this slice plus the migration and tests. Do not stage:

- `.admin-credentials`
- `.host-profile.json`
- `.codex`
- `.playwright-cli/`
- unrelated coworker panel files
- monitoring files

Suggested commit:

```bash
git add apps/web/lib/govern/permissions.ts apps/web/lib/govern/permissions.test.ts apps/web/app/(shell)/workspace/page.tsx apps/web/components/platform/platform-nav.ts apps/web/components/platform/platform-nav.test.ts apps/web/components/platform/PlatformTabNav.test.tsx apps/web/app/(shell)/platform/tools/page.tsx apps/web/app/(shell)/platform/tools/discovery/page.tsx apps/web/components/inventory/DiscoveryOperationsPage.tsx apps/web/app/(shell)/inventory/page.tsx apps/web/app/(shell)/inventory/layout.tsx apps/web/lib/actions/discovery.ts apps/web/lib/actions/inventory.ts apps/web/lib/actions/discovery.test.ts apps/web/lib/actions/inventory.test.ts packages/db/prisma/schema.prisma packages/db/prisma/migrations apps/web/lib/estate/estate-item.ts apps/web/lib/estate/estate-item.test.ts apps/web/components/inventory/EstateItemCard.tsx apps/web/components/inventory/EstateItemCard.test.tsx apps/web/components/product/ProductTabNav.tsx apps/web/app/(shell)/portfolio/product/[id]/page.tsx apps/web/app/(shell)/portfolio/product/[id]/inventory/page.tsx apps/web/app/(shell)/portfolio/product/[id]/layout.tsx apps/web/lib/tak/agent-routing.ts apps/web/lib/tak/agent-routing.test.ts apps/web/app/(shell)/platform/tools/discovery/page.test.tsx apps/web/app/(shell)/inventory/page.test.tsx tests/e2e/platform-qa-plan.md
git commit -m "feat(estate): introduce discovery operations and purpose-first estate surfaces"
```

---

## Notes For The Implementer

- Use the PR workflow in this repository. Create one short-lived intent-named branch (`feat/*`, `fix/*`, `chore/*`, `doc/*`, or `clean/*`) for this slice, and do not push directly to `main`.
- The workspace is already dirty with unrelated local changes. Leave them untouched.
- Follow the absorption rule from the approved spec:
  - discovery, vulnerability, version, and posture capabilities feed one shared estate model
  - do not introduce a second user-facing inventory truth
  - do not design scanner-specific silo views as the primary UX
- Keep type-specific data in `properties` or evidence. Only normalize fields users truly need to filter, sort, and summarize across entity types.
- Keep all UI theme-aware. No hardcoded colors beyond the allowed white-on-accent button exception.
- Prefer alias/redirect migration over duplicate route implementations.

## Completion Criteria

Phase 1 is complete when:

- `Inventory` is no longer a durable top-level destination
- `Discovery Operations` exists under `Platform > Tools & Services`
- `/inventory` no longer acts like the primary estate home
- product pages present `Dependencies & Estate`
- the estate specialist explains purpose, dependencies, posture, and confidence instead of generic lifecycle language
- a minimal normalized estate identity layer exists in the schema and is backfilled from current evidence
- focused tests pass
- Prisma migration applies cleanly
- `pnpm --filter web build` passes
- the rebuilt live portal passes the smoke checks above

---

Plan complete and saved to `docs/superpowers/plans/2026-04-18-purpose-first-product-estate-phase1.md`. Ready to execute?
