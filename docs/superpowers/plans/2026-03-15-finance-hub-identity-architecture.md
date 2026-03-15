# Finance Hub And Identity Architecture Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up DPF with a separate IdP runtime and ERPNext runtime, make managed runtimes register into inventory and digital products, then build the first DPF-native identity and finance integration slices on top.

**Architecture:** Keep DPF as the employee-facing hub. Run the IdP and ERPNext as separate runtimes beside DPF in Docker. Add a DPF-native principal and principal-alias layer so DPF owns business identity context while the external IdP still issues tokens. Extend discovery/bootstrap flows so managed runtimes appear in inventory and register as digital products in the correct employee-facing portfolio context.

**Tech Stack:** Docker Compose, Next.js App Router, Auth.js/NextAuth, Prisma 5, PostgreSQL, ERPNext/Frappe, external IdP runtime, Stripe, Vitest

---

## Execution Snapshot (2026-03-15)

- Finance epic planning is the active focus after current baseline UX work.
- Next execution slice: Task 6 (managed finance runtime visibility) and Task 7 (first work portal finance slice), while preserving the order of the broader architecture plan.
- Note: live DB-backed backlog checks are still unavailable in this environment; treat these as planning status only until the database-backed verification is run.

## Finance Epic Backlog Snapshot

- Status: **In planning + backlog alignment**
- Backlog alignment artifact updates completed:
  - `scripts/update-finance-epic.sql`
  - `scripts/update-selfdev-epic-runtime-registration.sql`
- Execution target:
  1. Task 6: managed finance runtime read models and platform visibility
  2. Task 7: first employee-facing work portal slice for managed finance tools
- Dependency: runtime registration and principal linkage work remains a prerequisite for final execution claims.

## Scope Guard

This architecture spans multiple independent subsystems. Do **not** implement it as one giant branch. Execute it as three shippable slices in order:

1. Docker topology plus runtime inventory/digital-product registration
2. Principal foundation and IdP boundary
3. Finance hub and employee portal integration

Each slice should be developed and verified independently before moving to the next.

This plan intentionally does **not** implement:

- full payroll compliance
- full external customer federation
- full DPF-native replacement of the IdP runtime
- full employee portal HR/payroll/documents experience

---

## File Structure

### Runtime topology and platform bootstrap

- Modify: `docker-compose.yml` or the repo's primary Compose manifest if named differently
- Modify: `install-dpf.ps1`
- Modify: `scripts/dpf-start.ps1`
- Modify: `scripts/dpf-stop.ps1`
- Modify: `uninstall-dpf.ps1`
- Modify: `README.md`

### Discovery, inventory, and digital product registration

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260315100000_managed_runtime_registration/migration.sql`
- Modify: `packages/db/src/discovery-types.ts`
- Modify: `packages/db/src/discovery-sync.ts`
- Modify: `packages/db/src/discovery-attribution.ts`
- Modify: `packages/db/src/discovery-sync.test.ts`
- Modify: `apps/web/lib/discovery-data.ts`
- Modify: `apps/web/lib/actions/discovery.ts`
- Modify: `apps/web/app/(shell)/inventory/page.tsx`
- Modify: `apps/web/app/(shell)/inventory/page.test.tsx`
- Modify: `apps/web/components/inventory/InventoryEntityPanel.tsx`
- Modify: `apps/web/components/inventory/InventoryEntityPanel.test.tsx`

### Identity foundation and IdP boundary

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260315110000_principal_and_alias_foundation/migration.sql`
- Modify: `apps/web/lib/auth.ts`
- Modify: `apps/web/lib/auth.test.ts`
- Modify: `apps/web/lib/principal-context.ts`
- Modify: `apps/web/lib/governance-types.ts`
- Create: `apps/web/lib/principal-data.ts`
- Create: `apps/web/lib/principal-data.test.ts`
- Create: `apps/web/lib/actions/principals.ts`
- Create: `apps/web/lib/actions/principals.test.ts`
- Modify: `apps/web/app/(shell)/employee/page.tsx`
- Modify: `apps/web/app/(shell)/platform/page.tsx`

### Finance hub and portal surfaces

- Modify: `apps/web/lib/actions/products.ts`
- Create: `apps/web/lib/actions/finance.ts`
- Create: `apps/web/lib/actions/finance.test.ts`
- Create: `apps/web/lib/finance-data.ts`
- Create: `apps/web/lib/finance-data.test.ts`
- Modify: `apps/web/app/(shell)/platform/page.tsx`
- Modify: `apps/web/app/(shell)/employee/page.tsx`
- Create: `apps/web/components/platform/ManagedRuntimePanel.tsx`
- Create: `apps/web/components/platform/FinanceRuntimePanel.tsx`
- Create: `apps/web/components/employee/WorkPortalPanel.tsx`
- Modify: `apps/web/components/platform/TokenSpendPanel.tsx`

### Backlog and documentation

- Modify: `docs/superpowers/specs/2026-03-15-finance-hub-identity-architecture-design.md`
- Modify: `scripts/update-finance-epic.sql`
- Modify: `scripts/update-selfdev-epic-runtime-registration.sql`

---

## Chunk 1: Runtime Topology And Managed Runtime Registration

### Task 1: Add the external runtime topology to the local platform stack

**Files:**
- Modify: `docker-compose.yml` or equivalent Compose manifest
- Modify: `install-dpf.ps1`
- Modify: `scripts/dpf-start.ps1`
- Modify: `scripts/dpf-stop.ps1`
- Modify: `uninstall-dpf.ps1`
- Modify: `README.md`

- [ ] **Step 1: Identify the current primary Compose file**

Run:

```bash
rg --files -g "docker-compose*.yml" -g "docker-compose*.yaml" .
```

Expected: one primary Compose manifest or a small set of environment-specific manifests.

- [ ] **Step 2: Write a failing startup note in the README**

Add a short draft checklist to `README.md` describing the intended services:

```md
Planned managed runtimes:
- dpf-web
- dpf-db
- idp
- erpnext-web
- erpnext-db
- erpnext-redis
- erpnext-workers
```

This intentionally documents the target before wiring the startup scripts.

- [ ] **Step 3: Extend the Compose stack with runtime placeholders**

Add services for:

```yaml
idp:
  image: <selected-idp-image>
  restart: unless-stopped

erpnext-web:
  image: <erpnext-image>

erpnext-db:
  image: mariadb:...

erpnext-redis:
  image: redis:...
```

Do not wire production secrets yet. Use env placeholders and comments only where necessary.

- [ ] **Step 4: Update the PowerShell install/start/stop flows**

Adjust:

- `install-dpf.ps1`
- `scripts/dpf-start.ps1`
- `scripts/dpf-stop.ps1`
- `uninstall-dpf.ps1`

So managed runtimes are included in install/start/stop behavior instead of being out-of-band manual steps.

- [ ] **Step 5: Add startup docs**

Document:

- which services are expected
- which are employee-facing
- which are back-office only
- which should remain internal-only on the Docker network

- [ ] **Step 6: Commit**

```bash
git add README.md install-dpf.ps1 scripts/dpf-start.ps1 scripts/dpf-stop.ps1 uninstall-dpf.ps1 docker-compose*.yml
git commit -m "feat(deploy): add managed runtime topology for idp and erpnext"
```

### Task 2: Model managed runtime registration in the database

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260315100000_managed_runtime_registration/migration.sql`
- Modify: `packages/db/src/discovery-types.ts`
- Modify: `packages/db/src/discovery-sync.ts`
- Modify: `packages/db/src/discovery-sync.test.ts`

- [ ] **Step 1: Write a failing DB test for managed runtime registration**

Extend `packages/db/src/discovery-sync.test.ts` with a focused case:

```ts
it("links a managed runtime to inventory and a digital product when employee operated", async () => {
  const result = await persistBootstrapDiscoveryRun(db, managedRuntimeFixture, {
    runKey: "run-managed-runtime",
    sourceSlug: "bootstrap",
  });
  expect(result.createdEntities).toBeGreaterThan(0);
  expect(linkedDigitalProductId).toBeDefined();
});
```

Use a fixture that represents an installed ERP or IdP runtime.

- [ ] **Step 2: Run the targeted DB test to confirm failure**

Run:

```bash
pnpm --filter @dpf/db test -- discovery-sync.test.ts
```

Expected: FAIL because the managed runtime linkage does not exist yet.

- [ ] **Step 3: Add schema fields or tables for runtime linkage**

Update `schema.prisma` so an inventory entity can carry managed-runtime metadata and, where applicable, link to `DigitalProduct`.

Prefer additive modeling such as:

```prisma
model InventoryEntity {
  ...
  managedByPlatform   Boolean        @default(false)
  runtimeCategory     String?
  digitalProductId    String?
  digitalProduct      DigitalProduct? @relation(fields: [digitalProductId], references: [id], onDelete: SetNull)
}
```

Only add new tables if the linkage cannot be expressed cleanly in the existing model.

- [ ] **Step 4: Create the SQL migration**

Create `packages/db/prisma/migrations/20260315100000_managed_runtime_registration/migration.sql` with explicit `ALTER TABLE` or `CREATE TABLE` statements matching the schema change.

- [ ] **Step 5: Extend discovery types and persistence**

Update:

- `packages/db/src/discovery-types.ts`
- `packages/db/src/discovery-sync.ts`

So a discovered item can declare:

- managed-by-platform
- runtime category
- desired portfolio/taxonomy target
- whether it must create/link a digital product

Then persist those values into inventory and digital product linkage during sync.

- [ ] **Step 6: Re-run DB tests**

Run:

```bash
pnpm --filter @dpf/db test -- discovery-sync.test.ts
pnpm --filter @dpf/db exec prisma validate --schema prisma/schema.prisma
pnpm --filter @dpf/db generate
```

Expected: PASS and valid Prisma schema/client generation.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260315100000_managed_runtime_registration/migration.sql packages/db/src/discovery-types.ts packages/db/src/discovery-sync.ts packages/db/src/discovery-sync.test.ts
git commit -m "feat(db): register managed runtimes in inventory"
```

### Task 3: Surface managed runtime registration in the inventory UI

**Files:**
- Modify: `apps/web/lib/discovery-data.ts`
- Modify: `apps/web/lib/actions/discovery.ts`
- Modify: `apps/web/app/(shell)/inventory/page.tsx`
- Modify: `apps/web/app/(shell)/inventory/page.test.tsx`
- Modify: `apps/web/components/inventory/InventoryEntityPanel.tsx`
- Modify: `apps/web/components/inventory/InventoryEntityPanel.test.tsx`

- [ ] **Step 1: Write a failing inventory UI test**

Extend `apps/web/components/inventory/InventoryEntityPanel.test.tsx` with:

```tsx
it("shows managed runtime and linked digital product badges", () => {
  render(<InventoryEntityPanel entities={[managedRuntimeEntity]} />);
  expect(screen.getByText(/managed runtime/i)).toBeInTheDocument();
  expect(screen.getByText(/digital product/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the targeted web test to confirm failure**

Run:

```bash
pnpm --filter web test -- apps/web/components/inventory/InventoryEntityPanel.test.tsx
```

Expected: FAIL because the panel does not render managed runtime metadata yet.

- [ ] **Step 3: Extend discovery read models**

Update `apps/web/lib/discovery-data.ts` so inventory queries include:

- `managedByPlatform`
- `runtimeCategory`
- linked `digitalProduct`

- [ ] **Step 4: Add managed runtime rendering**

Update `InventoryEntityPanel.tsx` and the inventory page to show:

- managed runtime badge
- runtime category label
- linked digital product label or status

Keep the current inventory layout additive; do not redesign the page.

- [ ] **Step 5: Revalidate inventory after discovery runs**

Update `apps/web/lib/actions/discovery.ts` so any discovery/bootstrap run revalidates the inventory view and keeps runtime registration visible after sync.

- [ ] **Step 6: Re-run web tests**

Run:

```bash
pnpm --filter web test -- apps/web/components/inventory/InventoryEntityPanel.test.tsx apps/web/app/(shell)/inventory/page.test.tsx
pnpm --filter web typecheck
```

Expected: PASS and 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/discovery-data.ts apps/web/lib/actions/discovery.ts apps/web/app/(shell)/inventory/page.tsx apps/web/app/(shell)/inventory/page.test.tsx apps/web/components/inventory/InventoryEntityPanel.tsx apps/web/components/inventory/InventoryEntityPanel.test.tsx
git commit -m "feat(web): surface managed runtime registration in inventory"
```

---

## Chunk 2: Principal Foundation And IdP Boundary

### Task 4: Add principal and alias foundation to DPF

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260315110000_principal_and_alias_foundation/migration.sql`
- Create: `apps/web/lib/principal-data.ts`
- Create: `apps/web/lib/principal-data.test.ts`
- Modify: `apps/web/lib/principal-context.ts`
- Modify: `apps/web/lib/governance-types.ts`

- [ ] **Step 1: Write a failing principal-data test**

Create `apps/web/lib/principal-data.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizePrincipalAlias } from "./principal-data";

describe("normalizePrincipalAlias", () => {
  it("creates stable issuer-scoped OIDC aliases", () => {
    expect(normalizePrincipalAlias("oidc", "https://idp.example.com|abc")).toEqual({
      aliasType: "oidc",
      aliasValue: "https://idp.example.com|abc",
    });
  });
});
```

- [ ] **Step 2: Run the targeted test to confirm failure**

Run:

```bash
pnpm --filter web test -- apps/web/lib/principal-data.test.ts
```

Expected: FAIL because the principal-data module does not exist yet.

- [ ] **Step 3: Add Prisma models for principals and aliases**

Extend `schema.prisma` with additive identity models such as:

```prisma
model Principal {
  id            String   @id @default(cuid())
  principalId    String   @unique
  principalType  String
  displayName    String?
  status         String   @default("active")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  aliases        PrincipalAlias[]
}

model PrincipalAlias {
  id            String   @id @default(cuid())
  principalId    String
  aliasType      String
  aliasValue     String
  createdAt      DateTime @default(now())

  principal      Principal @relation(fields: [principalId], references: [id], onDelete: Cascade)

  @@unique([aliasType, aliasValue])
}
```

Keep this slice additive. Do not replace existing `User`, `Agent`, or `CustomerContact` tables yet.

- [ ] **Step 4: Create the SQL migration**

Create `packages/db/prisma/migrations/20260315110000_principal_and_alias_foundation/migration.sql` matching the Prisma models.

- [ ] **Step 5: Implement principal helpers**

Create `apps/web/lib/principal-data.ts` with helpers for:

- alias normalization
- principal lookup by alias
- bootstrap principal creation for existing users and agents

Keep the module small and typed.

- [ ] **Step 6: Extend runtime principal context**

Update:

- `apps/web/lib/principal-context.ts`
- `apps/web/lib/governance-types.ts`

So `PrincipalContext` can carry:

- `principalId`
- alias references where relevant
- acting subject type beyond just session user

- [ ] **Step 7: Re-run validation**

Run:

```bash
pnpm --filter @dpf/db exec prisma validate --schema prisma/schema.prisma
pnpm --filter @dpf/db generate
pnpm --filter web test -- apps/web/lib/principal-data.test.ts apps/web/lib/principal-context.test.ts
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260315110000_principal_and_alias_foundation/migration.sql apps/web/lib/principal-data.ts apps/web/lib/principal-data.test.ts apps/web/lib/principal-context.ts apps/web/lib/governance-types.ts
git commit -m "feat(identity): add principal and alias foundation"
```

### Task 5: Add IdP synchronization and platform visibility

**Files:**
- Modify: `apps/web/lib/auth.ts`
- Modify: `apps/web/lib/auth.test.ts`
- Create: `apps/web/lib/actions/principals.ts`
- Create: `apps/web/lib/actions/principals.test.ts`
- Modify: `apps/web/app/(shell)/platform/page.tsx`
- Modify: `apps/web/app/(shell)/employee/page.tsx`

- [ ] **Step 1: Write a failing principal sync test**

Create `apps/web/lib/actions/principals.test.ts` with a narrow case:

```ts
it("upserts a principal alias for the authenticated user", async () => {
  const result = await syncAuthenticatedPrincipalAlias({
    principalId: "PRN-001",
    aliasType: "oidc",
    aliasValue: "https://idp.example.com|abc",
  });
  expect(result.ok).toBe(true);
});
```

- [ ] **Step 2: Run the targeted test to confirm failure**

Run:

```bash
pnpm --filter web test -- apps/web/lib/actions/principals.test.ts
```

Expected: FAIL because the principal action module does not exist yet.

- [ ] **Step 3: Extend auth callbacks with alias-aware session data**

Update `apps/web/lib/auth.ts` so the session can carry enough information to resolve or sync the authenticated subject into `Principal` and `PrincipalAlias`.

Keep the session payload small:

```ts
session.user.id
session.user.platformRole
session.user.isSuperuser
session.user.email
```

Do not bloat JWT payloads with business objects.

- [ ] **Step 4: Implement principal sync actions**

Create `apps/web/lib/actions/principals.ts` with:

- `syncAuthenticatedPrincipalAlias`
- `linkAgentPrincipalAlias`
- `linkServiceAccountPrincipalAlias`

These actions should be minimal and explicit. They should not become a generic identity provider client layer yet.

- [ ] **Step 5: Surface principal/alias status in the platform shell**

Update `platform/page.tsx` and `employee/page.tsx` to show whether a user/runtime is:

- only locally known
- mapped to an external IdP alias
- linked to managed runtimes

Add only lightweight visibility in this slice.

- [ ] **Step 6: Re-run web tests and typecheck**

Run:

```bash
pnpm --filter web test -- apps/web/lib/auth.test.ts apps/web/lib/actions/principals.test.ts
pnpm --filter web typecheck
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/auth.ts apps/web/lib/auth.test.ts apps/web/lib/actions/principals.ts apps/web/lib/actions/principals.test.ts apps/web/app/(shell)/platform/page.tsx apps/web/app/(shell)/employee/page.tsx
git commit -m "feat(identity): add idp alias sync and visibility"
```

---

## Chunk 3: Finance Hub And Work Portal Integration

### Task 6: Add managed runtime and finance runtime read models

**Files:**
- Create: `apps/web/lib/finance-data.ts`
- Create: `apps/web/lib/finance-data.test.ts`
- Create: `apps/web/components/platform/ManagedRuntimePanel.tsx`
- Create: `apps/web/components/platform/FinanceRuntimePanel.tsx`
- Modify: `apps/web/app/(shell)/platform/page.tsx`

- [ ] **Step 1: Write a failing finance-data test**

Create `apps/web/lib/finance-data.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { summarizeManagedFinanceRuntime } from "./finance-data";

describe("summarizeManagedFinanceRuntime", () => {
  it("summarizes runtime status and linked product state", () => {
    expect(summarizeManagedFinanceRuntime({
      runtimeName: "ERPNext",
      status: "active",
      linkedProductName: "ERPNext Finance",
    }).statusLabel).toMatch(/active/i);
  });
});
```

- [ ] **Step 2: Run the targeted test to confirm failure**

Run:

```bash
pnpm --filter web test -- apps/web/lib/finance-data.test.ts
```

Expected: FAIL because `finance-data.ts` does not exist yet.

- [ ] **Step 3: Implement finance runtime read helpers**

Create `apps/web/lib/finance-data.ts` with queries/helpers for:

- managed runtime status
- linked digital product state
- basic ERPNext/finance runtime visibility
- AI provider spend summary linkage where already available

- [ ] **Step 4: Add platform panels**

Create:

- `ManagedRuntimePanel.tsx`
- `FinanceRuntimePanel.tsx`

Show:

- runtime health/status
- linked digital product
- inventory linkage state
- whether the runtime is hidden/internal or employee-visible

- [ ] **Step 5: Add the panels to `/platform`**

Update `apps/web/app/(shell)/platform/page.tsx` so platform admins can see the managed finance/identity runtime state in one place.

- [ ] **Step 6: Re-run tests**

Run:

```bash
pnpm --filter web test -- apps/web/lib/finance-data.test.ts apps/web/app/(shell)/platform/page.test.tsx
pnpm --filter web typecheck
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/finance-data.ts apps/web/lib/finance-data.test.ts apps/web/components/platform/ManagedRuntimePanel.tsx apps/web/components/platform/FinanceRuntimePanel.tsx apps/web/app/(shell)/platform/page.tsx
git commit -m "feat(platform): add managed finance runtime visibility"
```

### Task 7: Add the first employee-facing work portal slice

**Files:**
- Create: `apps/web/components/employee/WorkPortalPanel.tsx`
- Modify: `apps/web/app/(shell)/employee/page.tsx`
- Modify: `apps/web/lib/actions/products.ts`
- Create: `apps/web/lib/actions/finance.ts`
- Create: `apps/web/lib/actions/finance.test.ts`

- [ ] **Step 1: Write a failing employee portal test**

Add or extend a test near `apps/web/app/(shell)/employee/page.tsx` to assert:

```tsx
it("shows managed employee-operated tools and finance request entry points", () => {
  render(<WorkPortalPanel tools={[erpRuntimeTool]} requests={[financeRequest]} />);
  expect(screen.getByText(/erpnext/i)).toBeInTheDocument();
  expect(screen.getByText(/finance/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the targeted test to confirm failure**

Run:

```bash
pnpm --filter web test -- apps/web/app/(shell)/employee/page.tsx
```

Expected: FAIL because the panel and actions do not exist yet.

- [ ] **Step 3: Implement minimal finance request actions**

Create `apps/web/lib/actions/finance.ts` with the first thin server actions for:

- listing managed employee-operated finance tools
- creating a finance request shell record or intent
- linking a request to a runtime/product target

Keep this slice minimal. Do not build the full finance workspace yet.

- [ ] **Step 4: Add `WorkPortalPanel`**

Create `apps/web/components/employee/WorkPortalPanel.tsx` to show:

- employee-operated managed tools
- request entry points
- runtime status summaries

- [ ] **Step 5: Wire the panel into `/employee`**

Update `apps/web/app/(shell)/employee/page.tsx` to render the work portal slice using existing employee route structure.

- [ ] **Step 6: Re-run tests**

Run:

```bash
pnpm --filter web test -- apps/web/lib/actions/finance.test.ts apps/web/app/(shell)/employee/page.tsx
pnpm --filter web typecheck
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/employee/WorkPortalPanel.tsx apps/web/app/(shell)/employee/page.tsx apps/web/lib/actions/finance.ts apps/web/lib/actions/finance.test.ts apps/web/lib/actions/products.ts
git commit -m "feat(employee): add first work portal slice for managed tools"
```

### Task 8: Sync docs and backlog helper scripts

**Files:**
- Modify: `docs/superpowers/specs/2026-03-15-finance-hub-identity-architecture-design.md`
- Modify: `scripts/update-finance-epic.sql`
- Modify: `scripts/update-selfdev-epic-runtime-registration.sql`

- [ ] **Step 1: Update the spec with implementation status**

Add a short note near the top of the spec:

```md
Implementation status:
- slice 1: runtime topology and managed runtime registration
- slice 2: principal and alias foundation
- slice 3: finance runtime and work portal visibility
```

- [ ] **Step 2: Align helper SQL/scripts with the delivered slice wording**

Ensure the SQL helper scripts still match the terminology used in the delivered code:

- managed runtime
- digital product linkage
- employee-operated product context

- [ ] **Step 3: Run the verification set**

Run:

```bash
pnpm --filter @dpf/db test
pnpm --filter @dpf/db generate
pnpm --filter web test
pnpm --filter web typecheck
```

Expected:

- DB tests PASS
- Prisma client generation succeeds
- web tests PASS
- web typecheck returns 0 errors

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-03-15-finance-hub-identity-architecture-design.md scripts/update-finance-epic.sql scripts/update-selfdev-epic-runtime-registration.sql
git commit -m "docs: sync finance hub architecture plan and backlog helpers"
```

---

## Notes For The Implementer

- Respect `AGENTS.md`: backlog and runtime state come from the live database, not seed defaults.
- Keep ERPNext and the IdP behind stable API/claims boundaries. Do not shortcut through their internal schemas.
- Do not treat managed runtimes as invisible infrastructure. Inventory and digital product registration is a first-class requirement.
- Keep the employee route additive. The first work portal slice should be light and operational, not a full HR suite.
- Keep identity work additive. `Principal` and `PrincipalAlias` should layer on top of current auth, not replace it in one step.

---

## Review Checklist

- [ ] Managed runtimes are present in Docker topology and startup scripts
- [ ] Managed runtimes register into inventory and link to digital products
- [ ] DPF owns a principal and alias foundation independent of external provider IDs
- [ ] Inventory UI exposes managed runtime and digital product linkage state
- [ ] Platform UI exposes managed finance/identity runtime visibility
- [ ] Employee route shows the first work portal slice
- [ ] Verification commands pass before any completion claim

---

Plan complete and saved to `docs/superpowers/plans/2026-03-15-finance-hub-identity-architecture.md`. Ready to execute?
