# HR Workforce Core Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working slice of the HR workforce domain by adding employee profiles, org structure, and lifecycle scaffolding on top of the identity-governance foundation, then surface it in the existing employee portal.

**Architecture:** Keep `User`, `PlatformRole`, `Team`, and `TeamMembership` as the auth/governance layer. Add a separate workforce overlay in Prisma for `EmployeeProfile`, `Department`, `Position`, `EmploymentType`, `WorkLocation`, `EmploymentEvent`, and `TerminationRecord`. Prove the slice by extending `/employee` to manage employee records and organization assignment without introducing payroll or a full external HRMS.

**Tech Stack:** Prisma 5, PostgreSQL, Next.js App Router, NextAuth v5 beta, React 18, TypeScript, Vitest

---

## Scope Guard

This plan intentionally implements only the first workforce slice from the spec:

- employee master/profile records
- normalized org reference data
- manager and department relationships
- lifecycle status and event scaffolding
- governed HR server actions
- additive `/employee` UI for directory and profile operations

This plan does **not** implement:

- payroll
- benefits
- attendance
- leave workflow execution
- recruiting ATS
- performance reviews
- customer-contact workforce semantics
- full AI coworker runtime integration

Those remain follow-on plans.

---

## File Structure

### Database and model layer

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260313170000_hr_workforce_core/migration.sql`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/seed.ts`
- Create: `packages/db/src/workforce-seed.ts`
- Create: `packages/db/src/workforce-seed.test.ts`

### Workforce data/runtime library

- Create: `apps/web/lib/workforce-types.ts`
- Create: `apps/web/lib/workforce-data.ts`
- Create: `apps/web/lib/workforce-context.ts`
- Create: `apps/web/lib/workforce-data.test.ts`
- Create: `apps/web/lib/workforce-context.test.ts`

### Workforce server actions

- Create: `apps/web/lib/actions/workforce.ts`
- Create: `apps/web/lib/actions/workforce.test.ts`
- Modify: `apps/web/lib/actions/users.ts`

### Employee route UI

- Modify: `apps/web/app/(shell)/employee/page.tsx`
- Create: `apps/web/app/(shell)/employee/page.test.tsx`
- Create: `apps/web/components/employee/EmployeeDirectoryPanel.tsx`
- Create: `apps/web/components/employee/EmployeeProfilePanel.tsx`
- Create: `apps/web/components/employee/OrgAssignmentPanel.tsx`
- Create: `apps/web/components/employee/LifecycleEventPanel.tsx`
- Modify: `apps/web/components/employee/HrUserLifecyclePanel.tsx`

### Documentation

- Modify: `docs/superpowers/specs/2026-03-13-hr-workforce-core-design.md`

---

## Chunk 1: Workforce Data Foundation

### Task 1: Add workforce Prisma models

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260313170000_hr_workforce_core/migration.sql`
- Modify: `docs/superpowers/specs/2026-03-13-hr-workforce-core-design.md`

- [ ] **Step 1: Add an implementation note to the spec**

Append this note near the top of the spec:

```md
Implementation slice 1 models:
- EmployeeProfile
- Department
- Position
- EmploymentType
- WorkLocation
- EmploymentEvent
- TerminationRecord
```

- [ ] **Step 2: Add the workforce models to `schema.prisma`**

Add these models following the style used by the existing governance models:

```prisma
model EmployeeProfile { ... }
model Department { ... }
model Position { ... }
model EmploymentType { ... }
model WorkLocation { ... }
model EmploymentEvent { ... }
model TerminationRecord { ... }
```

Use the spec's field shapes. Keep nullable room where the slice needs it, especially for:

- `userId`
- `managerEmployeeId`
- `dottedLineManagerId`
- `departmentId`
- `positionId`
- `workLocationId`
- `terminationRecordId`
- optional dates

- [ ] **Step 3: Add relations to existing models**

Update existing models only where needed:

```prisma
model User {
  ...
  employeeProfile EmployeeProfile?
}
```

Add back-relations on workforce tables for manager/report structures, department heads, lifecycle events, and termination records. Do not refactor `TeamMembership` or the governance models in this slice.

- [ ] **Step 4: Add validation-focused indexes and constraints**

Ensure the Prisma schema includes:

- unique `employeeId`
- unique optional `userId`
- indexes on `status`, `departmentId`, `managerEmployeeId`, `effectiveAt`
- foreign keys that use `SetNull` for manager/head links where deletion should not cascade the workforce tree

- [ ] **Step 5: Create the SQL migration**

Create `packages/db/prisma/migrations/20260313170000_hr_workforce_core/migration.sql` with explicit `CREATE TABLE`, `CREATE INDEX`, and FK statements matching the schema.

Add indexes for:

- `EmployeeProfile.status`
- `EmployeeProfile.departmentId`
- `EmployeeProfile.managerEmployeeId`
- `EmploymentEvent.employeeProfileId`
- `EmploymentEvent.effectiveAt`
- `Department.parentDepartmentId`

- [ ] **Step 6: Run Prisma validation**

Run:

```bash
$env:DATABASE_URL='postgresql://dpf:dpf_dev@localhost:5432/dpf'; pnpm --filter @dpf/db exec prisma validate --schema prisma/schema.prisma
```

Expected: `The schema at prisma/schema.prisma is valid`

- [ ] **Step 7: Generate the Prisma client**

Run:

```bash
pnpm --filter @dpf/db generate
```

Expected: Prisma client regenerates successfully.

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260313170000_hr_workforce_core/migration.sql docs/superpowers/specs/2026-03-13-hr-workforce-core-design.md
git commit -m "feat(db): add workforce core schema"
```

### Task 2: Seed only workforce reference defaults

**Files:**
- Modify: `packages/db/src/seed.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/src/workforce-seed.ts`
- Create: `packages/db/src/workforce-seed.test.ts`

- [ ] **Step 1: Write failing tests for workforce seed helpers**

Create `packages/db/src/workforce-seed.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getDefaultEmploymentTypes, getDefaultWorkLocations } from "./workforce-seed";

describe("workforce seed defaults", () => {
  it("returns stable employment types", () => {
    expect(getDefaultEmploymentTypes().map((item) => item.employmentTypeId)).toEqual([
      "emp-full-time",
      "emp-part-time",
      "emp-contractor",
      "emp-intern",
      "emp-advisor",
    ]);
  });

  it("returns a default remote work location", () => {
    expect(getDefaultWorkLocations().map((item) => item.locationId)).toContain("loc-remote");
  });
});
```

- [ ] **Step 2: Run the DB tests to confirm failure**

Run:

```bash
pnpm --filter @dpf/db test
```

Expected: FAIL because `workforce-seed.ts` does not exist yet.

- [ ] **Step 3: Implement minimal workforce seed helpers**

Create `packages/db/src/workforce-seed.ts` with:

```ts
export function getDefaultEmploymentTypes() {
  return [
    { employmentTypeId: "emp-full-time", name: "Full-time" },
    { employmentTypeId: "emp-part-time", name: "Part-time" },
    { employmentTypeId: "emp-contractor", name: "Contractor" },
    { employmentTypeId: "emp-intern", name: "Intern" },
    { employmentTypeId: "emp-advisor", name: "Advisor" },
  ];
}
```

Also export:

- `getDefaultWorkLocations()`
- `seedWorkforceReferenceData(prisma)`

Do not seed live employees, managers, or departments.

- [ ] **Step 4: Wire workforce reference seeding into `seed.ts`**

Call `seedWorkforceReferenceData(prisma)` from `packages/db/src/seed.ts` after governance reference data seeding.

Seed only:

- `EmploymentType`
- `WorkLocation`

Do not seed `EmployeeProfile`, `Department`, `EmploymentEvent`, or `TerminationRecord`.

- [ ] **Step 5: Export helper types or functions only if needed**

If plan execution needs seed helpers reachable from other packages, update `packages/db/src/index.ts` minimally. Otherwise leave exports unchanged.

- [ ] **Step 6: Re-run DB tests**

Run:

```bash
pnpm --filter @dpf/db test
```

Expected: PASS for the new seed-helper tests and existing DB tests.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/seed.ts packages/db/src/index.ts packages/db/src/workforce-seed.ts packages/db/src/workforce-seed.test.ts
git commit -m "feat(db): seed workforce reference defaults"
```

---

## Chunk 2: Workforce Runtime and Actions

### Task 3: Add workforce runtime types and read models

**Files:**
- Create: `apps/web/lib/workforce-types.ts`
- Create: `apps/web/lib/workforce-data.ts`
- Create: `apps/web/lib/workforce-context.ts`
- Create: `apps/web/lib/workforce-data.test.ts`
- Create: `apps/web/lib/workforce-context.test.ts`

- [ ] **Step 1: Write failing tests for workforce summary mapping**

Create `apps/web/lib/workforce-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildWorkforceContext } from "./workforce-context";

describe("buildWorkforceContext", () => {
  it("maps an employee profile into a stable runtime shape", () => {
    const ctx = buildWorkforceContext({
      employeeId: "EMP-001",
      departmentId: "dept-people",
      managerEmployeeId: "EMP-002",
      status: "active",
      workLocationId: "loc-remote",
      timezone: "America/Chicago",
    });

    expect(ctx.employeeId).toBe("EMP-001");
    expect(ctx.departmentId).toBe("dept-people");
    expect(ctx.employmentStatus).toBe("active");
  });
});
```

Create `apps/web/lib/workforce-data.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { summarizeEmployeeDisplayName } from "./workforce-data";

describe("summarizeEmployeeDisplayName", () => {
  it("prefers displayName when present", () => {
    expect(summarizeEmployeeDisplayName({
      firstName: "Ada",
      lastName: "Lovelace",
      displayName: "Ada Lovelace",
    })).toBe("Ada Lovelace");
  });
});
```

- [ ] **Step 2: Run the targeted web tests to confirm failure**

Run:

```bash
pnpm --filter web test -- apps/web/lib/workforce-context.test.ts apps/web/lib/workforce-data.test.ts
```

Expected: FAIL because the modules do not exist yet.

- [ ] **Step 3: Implement shared workforce types**

Create `apps/web/lib/workforce-types.ts` with:

```ts
export type WorkforceStatus =
  | "onboarding"
  | "active"
  | "leave"
  | "suspended"
  | "offboarding"
  | "inactive";

export type EmploymentEventType =
  | "hired"
  | "onboarding_started"
  | "activated"
  | "manager_changed"
  | "department_changed"
  | "position_changed"
  | "leave_started"
  | "leave_ended"
  | "offboarding_started"
  | "terminated"
  | "reactivated";

export type WorkforceContext = { ... };
export type EmployeeDirectoryRow = { ... };
export type EmployeeProfileRecord = { ... };
```

Keep these typed and aligned with the spec. Do not use loose `Record<string, unknown>` for domain objects.

- [ ] **Step 4: Implement pure runtime helpers**

Create:

- `summarizeEmployeeDisplayName()` in `apps/web/lib/workforce-data.ts`
- `buildWorkforceContext()` in `apps/web/lib/workforce-context.ts`

Keep them pure and small.

- [ ] **Step 5: Add DB-backed read helpers**

In `apps/web/lib/workforce-data.ts`, add focused Prisma readers:

- `getEmployeeDirectoryRows()`
- `getEmployeeProfileByUserId(userId: string)`
- `getWorkforceReferenceData()`
- `getEmployeeLifecycleEvents(employeeProfileId: string)`

Use narrow `select` projections only for fields needed by `/employee`.

- [ ] **Step 6: Re-run targeted tests**

Run:

```bash
pnpm --filter web test -- apps/web/lib/workforce-context.test.ts apps/web/lib/workforce-data.test.ts
pnpm --filter web typecheck
```

Expected: PASS and 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/workforce-types.ts apps/web/lib/workforce-data.ts apps/web/lib/workforce-context.ts apps/web/lib/workforce-data.test.ts apps/web/lib/workforce-context.test.ts
git commit -m "feat(web): add workforce data and context helpers"
```

### Task 4: Add governed workforce server actions

**Files:**
- Create: `apps/web/lib/actions/workforce.ts`
- Create: `apps/web/lib/actions/workforce.test.ts`
- Modify: `apps/web/lib/actions/users.ts`

- [ ] **Step 1: Write failing tests for workforce action validation**

Create `apps/web/lib/actions/workforce.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateEmployeeProfileInput, validateLifecycleTransition } from "./workforce";

describe("validateEmployeeProfileInput", () => {
  it("rejects an end date before the start date", () => {
    expect(validateEmployeeProfileInput({
      firstName: "Ada",
      lastName: "Lovelace",
      status: "active",
      startDate: new Date("2026-03-13"),
      endDate: new Date("2026-03-12"),
    })).toMatch(/start date/i);
  });
});

describe("validateLifecycleTransition", () => {
  it("requires a termination date when setting inactive through termination", () => {
    expect(validateLifecycleTransition({
      currentStatus: "active",
      nextStatus: "inactive",
      eventType: "terminated",
      terminationDate: null,
    })).toMatch(/termination date/i);
  });
});
```

- [ ] **Step 2: Run the targeted test to confirm failure**

Run:

```bash
pnpm --filter web test -- apps/web/lib/actions/workforce.test.ts
```

Expected: FAIL because `workforce.ts` does not exist yet.

- [ ] **Step 3: Implement pure validation helpers**

Create `apps/web/lib/actions/workforce.ts` with:

- `validateEmployeeProfileInput(input)`
- `validateLifecycleTransition(input)`

Cover at minimum:

- required first/last name
- start/end date order
- confirmation date not before start date
- no self-manager relationship
- termination requires date

- [ ] **Step 4: Add governed server actions**

In the same file, implement:

- `createEmployeeProfile(input)`
- `updateEmployeeProfile(input)`
- `assignEmployeeOrg(input)`
- `recordEmploymentLifecycleEvent(input)`

Each action should:

- require authenticated user
- gate via existing HR/admin capabilities using `can()`
- use the governance/audit helpers already present on the branch
- write `EmploymentEvent` entries where appropriate
- revalidate `/employee` and `/admin`

- [ ] **Step 5: Keep `users.ts` focused on account management**

Modify `apps/web/lib/actions/users.ts` only if needed to:

- expose a stable helper for account-to-employee linkage
- avoid duplicating workforce validation in the user-account actions

Do not merge employee-domain logic into `users.ts`.

- [ ] **Step 6: Re-run tests**

Run:

```bash
pnpm --filter web test -- apps/web/lib/actions/workforce.test.ts apps/web/lib/actions/users.test.ts
pnpm --filter web typecheck
```

Expected: PASS and 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/actions/workforce.ts apps/web/lib/actions/workforce.test.ts apps/web/lib/actions/users.ts
git commit -m "feat(web): add governed workforce actions"
```

---

## Chunk 3: Employee Portal UX

### Task 5: Add workforce panels for `/employee`

**Files:**
- Create: `apps/web/components/employee/EmployeeDirectoryPanel.tsx`
- Create: `apps/web/components/employee/EmployeeProfilePanel.tsx`
- Create: `apps/web/components/employee/OrgAssignmentPanel.tsx`
- Create: `apps/web/components/employee/LifecycleEventPanel.tsx`
- Modify: `apps/web/components/employee/HrUserLifecyclePanel.tsx`

- [ ] **Step 1: Write a failing component test for workforce visibility**

Create `apps/web/app/(shell)/employee/page.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EmployeeDirectoryPanel } from "@/components/employee/EmployeeDirectoryPanel";

describe("EmployeeDirectoryPanel", () => {
  it("renders employee profile and org details", () => {
    const html = renderToStaticMarkup(
      <EmployeeDirectoryPanel
        employees={[
          {
            employeeId: "EMP-001",
            displayName: "Ada Lovelace",
            status: "active",
            departmentName: "People Operations",
            positionTitle: "HR Manager",
            managerName: "Grace Hopper",
          },
        ]}
      />,
    );

    expect(html).toContain("EMP-001");
    expect(html).toContain("People Operations");
    expect(html).toContain("Grace Hopper");
  });
});
```

- [ ] **Step 2: Run the targeted test to confirm failure**

Run:

```bash
pnpm --filter web test -- "app/(shell)/employee/page.test.tsx"
```

Expected: FAIL because the new panel does not exist yet.

- [ ] **Step 3: Implement focused presentation components**

Create:

- `EmployeeDirectoryPanel.tsx`
- `EmployeeProfilePanel.tsx`
- `OrgAssignmentPanel.tsx`
- `LifecycleEventPanel.tsx`

Keep the components small and data-driven.

Display at minimum:

- employee identifier and name
- employment status
- department
- position
- manager
- important lifecycle dates or recent events

- [ ] **Step 4: Keep `HrUserLifecyclePanel` additive**

Update `apps/web/components/employee/HrUserLifecyclePanel.tsx` only so it coexists with the new workforce panels. Do not remove the existing role/account lifecycle controls; they still matter.

- [ ] **Step 5: Re-run the targeted test**

Run:

```bash
pnpm --filter web test -- "app/(shell)/employee/page.test.tsx"
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/employee/EmployeeDirectoryPanel.tsx apps/web/components/employee/EmployeeProfilePanel.tsx apps/web/components/employee/OrgAssignmentPanel.tsx apps/web/components/employee/LifecycleEventPanel.tsx apps/web/components/employee/HrUserLifecyclePanel.tsx apps/web/app/(shell)/employee/page.test.tsx
git commit -m "feat(web): add workforce employee panels"
```

### Task 6: Extend the `/employee` page with workforce data

**Files:**
- Modify: `apps/web/app/(shell)/employee/page.tsx`
- Modify: `apps/web/app/(shell)/admin/page.tsx`

- [ ] **Step 1: Add a failing route-level expectation**

Extend `apps/web/app/(shell)/employee/page.test.tsx` with an additional expectation that the employee page renders both role/admin context and workforce context by checking for labels like `Employee directory` and `HR user lifecycle`.

- [ ] **Step 2: Run the targeted test to confirm failure**

Run:

```bash
pnpm --filter web test -- "app/(shell)/employee/page.test.tsx"
```

Expected: FAIL because the route has not been updated yet.

- [ ] **Step 3: Update `/employee/page.tsx`**

Modify the page to load, in parallel:

- platform roles
- user accounts
- employee directory rows
- workforce reference data

Render:

- existing role summary cards
- `EmployeeDirectoryPanel`
- `EmployeeProfilePanel`
- `OrgAssignmentPanel`
- `LifecycleEventPanel`
- existing `HrUserLifecyclePanel`

Keep the route additive and do not redesign the whole page.

- [ ] **Step 4: Update `/admin/page.tsx` only if needed**

If account-to-employee linkage needs visibility for admins, add a minimal employee linkage hint to the existing user cards. If not needed for slice 1, leave `admin/page.tsx` unchanged.

- [ ] **Step 5: Re-run tests and typecheck**

Run:

```bash
pnpm --filter web test -- "app/(shell)/employee/page.test.tsx" apps/web/lib/actions/workforce.test.ts apps/web/lib/workforce-data.test.ts
pnpm --filter web typecheck
```

Expected: PASS and 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/(shell)/employee/page.tsx apps/web/app/(shell)/admin/page.tsx apps/web/app/(shell)/employee/page.test.tsx
git commit -m "feat(web): extend employee route with workforce core"
```

---

## Chunk 4: Lifecycle Verification and Docs Sync

### Task 7: Sync the spec and verify the slice

**Files:**
- Modify: `docs/superpowers/specs/2026-03-13-hr-workforce-core-design.md`

- [ ] **Step 1: Update the spec status note**

Add a brief note near the top of the spec:

```md
Implementation status:
- slice 1 delivered: employee profile core, org references, manager links, lifecycle events, employee route visibility
- deferred: payroll, benefits, attendance, leave execution, performance workflows
```

- [ ] **Step 2: Run the full verification set**

Run:

```bash
pnpm --filter @dpf/db test
pnpm --filter @dpf/db generate
$env:DATABASE_URL='postgresql://dpf:dpf_dev@localhost:5432/dpf'; pnpm --filter @dpf/db exec prisma validate --schema prisma/schema.prisma
pnpm --filter web test
pnpm --filter web typecheck
```

Expected:

- DB tests PASS
- Prisma client generates cleanly
- Prisma validate succeeds
- web tests PASS
- web typecheck returns 0 errors

- [ ] **Step 3: Manually verify the main employee paths**

Run:

```bash
pnpm --filter web dev
```

Check:

- `/employee` shows employee directory and workforce information
- manager and department fields render correctly
- lifecycle actions produce human-readable messages
- existing account lifecycle controls still work
- no regression on `/admin`

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-03-13-hr-workforce-core-design.md
git commit -m "docs: sync HR workforce spec with slice 1 delivery"
```

---

## Notes For The Implementer

- Respect `AGENTS.md`: current state comes from the live DB, not seed defaults. Only seed lookup/reference data in `seed.ts`.
- Keep workforce data separate from `User`. Do not stuff HR profile fields into the auth table.
- Do not collapse `Department` into governance `Team`. They have different meanings.
- Reuse the existing `/employee` route rather than inventing a new HR console.
- Keep lifecycle history append-only via `EmploymentEvent` where possible.
- Follow TDD strictly. Every new helper, action, and component should start with a failing test.

---

## Review Checklist

- [ ] `EmployeeProfile` stays separate from `User`
- [ ] Department/org structure remains separate from governance teams
- [ ] Reference seeding is limited to lookup data only
- [ ] Manager relationships and lifecycle validations are covered by tests
- [ ] `/employee` gains workforce functionality without losing current account lifecycle controls
- [ ] Full verification commands pass before any completion claim
