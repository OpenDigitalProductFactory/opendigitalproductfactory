# Admin Reference Data Management Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin page for managing geographic reference data (countries, regions, cities) and linking addresses to work locations.

**Architecture:** New `/admin/reference-data` route with four collapsible client panels (CountryPanel, RegionPanel, CityPanel, WorkLocationPanel) backed by a single admin server action file with `can("view_admin")` capability checks. Follows existing admin page patterns exactly.

**Tech Stack:** Next.js App Router (server component page + client panels), Prisma queries, existing ReferenceTypeahead component for work location address linking, Vitest for tests.

**Spec:** `docs/superpowers/specs/2026-03-17-admin-reference-data-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/app/(shell)/admin/reference-data/page.tsx` | Server component: loads all reference data, renders heading + AdminTabNav + panels |
| `apps/web/lib/actions/reference-data-admin.ts` | Server actions: toggle status, update, link/unlink address — all with `can("view_admin")` |
| `apps/web/lib/actions/reference-data-admin.test.ts` | Tests for admin actions |
| `apps/web/components/admin/CountryPanel.tsx` | Client panel: searchable country list with status toggle |
| `apps/web/components/admin/RegionPanel.tsx` | Client panel: filterable region list with inline edit, status toggle, add |
| `apps/web/components/admin/CityPanel.tsx` | Client panel: filterable city list with inline edit, status toggle, add |
| `apps/web/components/admin/WorkLocationPanel.tsx` | Client panel: work location cards with address link/unlink |

### Modified Files

| File | Changes |
|------|---------|
| `apps/web/components/admin/AdminTabNav.tsx` | Add 4th tab: "Reference Data" → `/admin/reference-data` |
| `apps/web/components/admin/AdminTabNav.test.tsx` | Assert 4th tab renders |

---

## Chunk 1: Server Actions & Tab Navigation

### Task 1: Admin Reference Data Server Actions

**Files:**
- Create: `apps/web/lib/actions/reference-data-admin.ts`
- Create: `apps/web/lib/actions/reference-data-admin.test.ts`

- [ ] **Step 1: Write failing test for requireAdminCapability and toggleCountryStatus**

Create `apps/web/lib/actions/reference-data-admin.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    country: { findUnique: vi.fn(), update: vi.fn() },
    region: { update: vi.fn() },
    city: { update: vi.fn() },
    workLocation: { update: vi.fn(), findUnique: vi.fn() },
    address: { create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn((fn: any) => fn({
      address: { create: vi.fn().mockResolvedValue({ id: "a1" }) },
      workLocation: { update: vi.fn() },
    })),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { toggleCountryStatus } from "./reference-data-admin";

describe("requireAdminCapability", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated users", async () => {
    vi.mocked(auth).mockResolvedValue(null as any);
    const result = await toggleCountryStatus("c1");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/unauthorized/i);
  });

  it("rejects users without view_admin capability", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", platformRole: "employee", isSuperuser: false } } as any);
    vi.mocked(can).mockReturnValue(false);
    const result = await toggleCountryStatus("c1");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/unauthorized/i);
  });
});

describe("toggleCountryStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", platformRole: "HR-000", isSuperuser: true } } as any);
    vi.mocked(can).mockReturnValue(true);
  });

  it("flips active to inactive", async () => {
    vi.mocked(prisma.country.findUnique).mockResolvedValue({ id: "c1", status: "active" } as any);
    vi.mocked(prisma.country.update).mockResolvedValue({ id: "c1", status: "inactive" } as any);

    const result = await toggleCountryStatus("c1");
    expect(result.ok).toBe(true);
    expect(prisma.country.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { status: "inactive" },
    });
  });

  it("flips inactive to active", async () => {
    vi.mocked(prisma.country.findUnique).mockResolvedValue({ id: "c1", status: "inactive" } as any);
    vi.mocked(prisma.country.update).mockResolvedValue({ id: "c1", status: "active" } as any);

    const result = await toggleCountryStatus("c1");
    expect(result.ok).toBe(true);
    expect(prisma.country.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { status: "active" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/actions/reference-data-admin.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Implement all admin server actions**

Create `apps/web/lib/actions/reference-data-admin.ts`:

```typescript
"use server";

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import type { WorkforceActionResult } from "./workforce";

const VALID_LABELS = ["home", "work", "billing", "shipping", "headquarters", "site"];

async function requireAdminCapability(): Promise<WorkforceActionResult | null> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_admin")) {
    return { ok: false, message: "Unauthorized" };
  }
  return null; // authorized
}

function revalidate() {
  revalidatePath("/admin/reference-data");
  revalidatePath("/employee");
}

// ── Country ──────────────────────────────────────────────────────────────

export async function toggleCountryStatus(id: string): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  const country = await prisma.country.findUnique({ where: { id }, select: { status: true } });
  if (!country) return { ok: false, message: "Country not found" };

  const newStatus = country.status === "active" ? "inactive" : "active";
  await prisma.country.update({ where: { id }, data: { status: newStatus } });

  revalidate();
  return { ok: true, message: `Country ${newStatus}` };
}

// ── Region ───────────────────────────────────────────────────────────────

export async function updateRegion(
  id: string,
  data: { name?: string; code?: string },
): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  const update: Record<string, string> = {};
  if (data.name !== undefined) {
    const trimmed = data.name.trim();
    if (!trimmed) return { ok: false, message: "Name is required" };
    update.name = trimmed;
  }
  if (data.code !== undefined) {
    update.code = data.code.trim() || "";
  }

  if (Object.keys(update).length === 0) return { ok: false, message: "Nothing to update" };

  await prisma.region.update({ where: { id }, data: update });
  revalidate();
  return { ok: true, message: "Region updated" };
}

export async function toggleRegionStatus(id: string): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  const region = await prisma.region.findUnique({ where: { id }, select: { status: true } });
  if (!region) return { ok: false, message: "Region not found" };

  const newStatus = region.status === "active" ? "inactive" : "active";
  await prisma.region.update({ where: { id }, data: { status: newStatus } });

  revalidate();
  return { ok: true, message: `Region ${newStatus}` };
}

// ── City ─────────────────────────────────────────────────────────────────

export async function updateCity(
  id: string,
  data: { name?: string },
): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  if (data.name === undefined) return { ok: false, message: "Nothing to update" };
  const trimmed = data.name.trim();
  if (!trimmed) return { ok: false, message: "Name is required" };

  await prisma.city.update({ where: { id }, data: { name: trimmed } });
  revalidate();
  return { ok: true, message: "City updated" };
}

export async function toggleCityStatus(id: string): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  const city = await prisma.city.findUnique({ where: { id }, select: { status: true } });
  if (!city) return { ok: false, message: "City not found" };

  const newStatus = city.status === "active" ? "inactive" : "active";
  await prisma.city.update({ where: { id }, data: { status: newStatus } });

  revalidate();
  return { ok: true, message: `City ${newStatus}` };
}

// ── Work Location Address ────────────────────────────────────────────────

type WorkLocationAddressInput = {
  label: string;
  addressLine1: string;
  addressLine2?: string | null;
  cityId: string;
  postalCode: string;
};

export async function linkWorkLocationAddress(
  locationId: string,
  addressData: WorkLocationAddressInput,
): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  if (!addressData.label || !VALID_LABELS.includes(addressData.label)) {
    return { ok: false, message: `Label must be one of: ${VALID_LABELS.join(", ")}` };
  }
  if (!addressData.addressLine1.trim()) return { ok: false, message: "Address line 1 is required" };
  if (!addressData.cityId) return { ok: false, message: "City is required" };
  if (!addressData.postalCode.trim()) return { ok: false, message: "Postal code is required" };

  await prisma.$transaction(async (tx) => {
    const address = await tx.address.create({
      data: {
        label: addressData.label,
        addressLine1: addressData.addressLine1.trim(),
        addressLine2: addressData.addressLine2?.trim() || null,
        cityId: addressData.cityId,
        postalCode: addressData.postalCode.trim(),
      },
    });
    await tx.workLocation.update({
      where: { id: locationId },
      data: { addressId: address.id },
    });
  });

  revalidate();
  return { ok: true, message: "Address linked" };
}

export async function unlinkWorkLocationAddress(locationId: string): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  const location = await prisma.workLocation.findUnique({
    where: { id: locationId },
    select: { addressId: true },
  });

  if (!location) return { ok: false, message: "Work location not found" };
  if (!location.addressId) return { ok: false, message: "No address linked" };

  await prisma.workLocation.update({ where: { id: locationId }, data: { addressId: null } });
  await prisma.address.update({ where: { id: location.addressId }, data: { status: "inactive" } });

  revalidate();
  return { ok: true, message: "Address unlinked" };
}
```

- [ ] **Step 4: Add tests for remaining actions**

Add to the test file:

```typescript
import {
  toggleCountryStatus,
  updateRegion,
  toggleRegionStatus,
  updateCity,
  toggleCityStatus,
  linkWorkLocationAddress,
  unlinkWorkLocationAddress,
} from "./reference-data-admin";

describe("updateRegion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", platformRole: "HR-000", isSuperuser: true } } as any);
    vi.mocked(can).mockReturnValue(true);
  });

  it("validates non-empty name", async () => {
    const result = await updateRegion("r1", { name: "  " });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/name is required/i);
  });

  it("trims and updates name", async () => {
    vi.mocked(prisma.region.update).mockResolvedValue({} as any);
    const result = await updateRegion("r1", { name: " Oregon " });
    expect(result.ok).toBe(true);
    expect(prisma.region.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { name: "Oregon" },
    });
  });
});

describe("unlinkWorkLocationAddress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", platformRole: "HR-000", isSuperuser: true } } as any);
    vi.mocked(can).mockReturnValue(true);
  });

  it("sets addressId to null and soft-deletes address", async () => {
    vi.mocked(prisma.workLocation.findUnique).mockResolvedValue({ addressId: "a1" } as any);
    vi.mocked(prisma.workLocation.update).mockResolvedValue({} as any);
    vi.mocked(prisma.address.update).mockResolvedValue({} as any);

    const result = await unlinkWorkLocationAddress("loc1");
    expect(result.ok).toBe(true);
    expect(prisma.workLocation.update).toHaveBeenCalledWith({
      where: { id: "loc1" },
      data: { addressId: null },
    });
    expect(prisma.address.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { status: "inactive" },
    });
  });
});
```

- [ ] **Step 5: Run all tests**

Run: `cd apps/web && npx vitest run lib/actions/reference-data-admin.test.ts`

Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/actions/reference-data-admin.ts apps/web/lib/actions/reference-data-admin.test.ts
git commit -m "feat: admin reference data server actions with capability check (EP-REF-002)"
```

---

### Task 2: Update AdminTabNav

**Files:**
- Modify: `apps/web/components/admin/AdminTabNav.tsx`
- Modify: `apps/web/components/admin/AdminTabNav.test.tsx`

- [ ] **Step 1: Add Reference Data tab to AdminTabNav**

In `apps/web/components/admin/AdminTabNav.tsx`, add to the `TABS` array:

```typescript
{ label: "Reference Data", href: "/admin/reference-data" },
```

- [ ] **Step 2: Update AdminTabNav test**

In `apps/web/components/admin/AdminTabNav.test.tsx`, add assertion for the new tab:

```typescript
expect(container.textContent).toContain("Reference Data");
```

And verify the href:

```typescript
const refDataLink = screen.getByText("Reference Data");
expect(refDataLink.closest("a")?.getAttribute("href")).toBe("/admin/reference-data");
```

- [ ] **Step 3: Run tests**

Run: `cd apps/web && npx vitest run components/admin/AdminTabNav.test.tsx`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/admin/AdminTabNav.tsx apps/web/components/admin/AdminTabNav.test.tsx
git commit -m "feat: add Reference Data tab to admin navigation (EP-REF-002)"
```

---

## Chunk 2: Admin Panels & Page

### Task 3: CountryPanel Component

**Files:**
- Create: `apps/web/components/admin/CountryPanel.tsx`

Client component with:
- Collapsible section header: "Countries (X active)" with chevron toggle
- Search input filtering on name/iso2/iso3 (client-side)
- Each row: name, iso2, iso3, phoneCode, status dot (green=active, muted=inactive)
- Toggle button to flip active/inactive — calls `toggleCountryStatus`
- Uses `useTransition` for pending state on toggles

Props: `{ countries: Array<{ id: string; name: string; iso2: string; iso3: string; phoneCode: string; status: string }> }`

Styling: follows existing admin card pattern — `bg-[var(--dpf-surface-1)]`, `border-[var(--dpf-border)]`, `text-[var(--dpf-foreground)]`, muted text for metadata.

- [ ] **Step 1: Create CountryPanel**

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/admin/CountryPanel.tsx
git commit -m "feat: CountryPanel with search and status toggle (EP-REF-002)"
```

---

### Task 4: RegionPanel Component

**Files:**
- Create: `apps/web/components/admin/RegionPanel.tsx`

Client component with:
- Collapsible section header: "Regions (X active)"
- Country filter dropdown (shows all when unselected)
- Each row: name, code, country name, status badge, created date
- Edit icon → inline edit mode (name + code inputs, Enter to save, Escape to cancel) — calls `updateRegion`
- Status toggle — calls `toggleRegionStatus`
- "+ Add region" button → inline form (name, code, country dropdown) — calls `forceCreateRegion`
- Uses `useTransition` for async actions

Props: `{ regions: RegionWithCountry[]; countries: CountryRef[] }`

- [ ] **Step 1: Create RegionPanel**

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/admin/RegionPanel.tsx
git commit -m "feat: RegionPanel with inline edit and add (EP-REF-002)"
```

---

### Task 5: CityPanel Component

**Files:**
- Create: `apps/web/components/admin/CityPanel.tsx`

Client component with:
- Collapsible section header: "Cities (X active)"
- Country → Region cascading filter dropdowns
- Each row: name, region name, country name, status badge
- Inline edit (name only) — calls `updateCity`
- Status toggle — calls `toggleCityStatus`
- "+ Add city" button → inline form (name, region dropdown scoped to country) — calls `forceCreateCity`

Props: `{ cities: CityWithRegion[]; countries: CountryRef[]; regions: RegionRef[] }`

- [ ] **Step 1: Create CityPanel**

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/admin/CityPanel.tsx
git commit -m "feat: CityPanel with inline edit and add (EP-REF-002)"
```

---

### Task 6: WorkLocationPanel Component

**Files:**
- Create: `apps/web/components/admin/WorkLocationPanel.tsx`

Client component with:
- Collapsible section header: "Work Locations (X)"
- Each card: name, type badge (office/remote/hybrid/customer_site), timezone
- If address linked: formatted address + "Unlink address" button — calls `unlinkWorkLocationAddress`
- If no address: "No address" + "Link address" button → expands address form below card
- Address form reuses ReferenceTypeahead pattern (Country → Region → City + street + postal) — calls `linkWorkLocationAddress`

Props: `{ workLocations: WorkLocationWithAddress[] }`

Imports ReferenceTypeahead from `@/components/ui/ReferenceTypeahead` and search actions from `@/lib/actions/reference-data`.

- [ ] **Step 1: Create WorkLocationPanel**

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/admin/WorkLocationPanel.tsx
git commit -m "feat: WorkLocationPanel with address link/unlink (EP-REF-002)"
```

---

### Task 7: Admin Reference Data Page

**Files:**
- Create: `apps/web/app/(shell)/admin/reference-data/page.tsx`

Server component following the standard admin page pattern:

```typescript
import { prisma } from "@dpf/db";
import AdminTabNav from "@/components/admin/AdminTabNav";
import { CountryPanel } from "@/components/admin/CountryPanel";
import { RegionPanel } from "@/components/admin/RegionPanel";
import { CityPanel } from "@/components/admin/CityPanel";
import { WorkLocationPanel } from "@/components/admin/WorkLocationPanel";

export default async function AdminReferenceDataPage() {
  const [countries, regions, cities, workLocations] = await Promise.all([
    prisma.country.findMany({ orderBy: { name: "asc" } }),
    prisma.region.findMany({
      include: { country: { select: { id: true, name: true, iso2: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.city.findMany({
      include: {
        region: {
          include: { country: { select: { id: true, name: true, iso2: true } } },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.workLocation.findMany({
      include: {
        address: {
          include: {
            city: {
              include: {
                region: {
                  include: { country: { select: { id: true, name: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Geographic reference data management
        </p>
      </div>

      <AdminTabNav />

      <div className="mt-6 space-y-6">
        <CountryPanel countries={countries} />
        <RegionPanel
          regions={regions}
          countries={countries.map((c) => ({ id: c.id, name: c.name, iso2: c.iso2 }))}
        />
        <CityPanel
          cities={cities}
          countries={countries.map((c) => ({ id: c.id, name: c.name, iso2: c.iso2 }))}
          regions={regions.map((r) => ({ id: r.id, name: r.name, countryId: r.countryId }))}
        />
        <WorkLocationPanel workLocations={workLocations} />
      </div>
    </div>
  );
}
```

- [ ] **Step 1: Create the page**

- [ ] **Step 2: Manually test — navigate to /admin/reference-data**

Verify:
- Page loads with all 4 sections
- Country search works
- Region/city filter dropdowns work
- Inline edit on regions/cities saves
- Status toggles work
- Work location address linking works

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(shell)/admin/reference-data/page.tsx
git commit -m "feat: admin reference data page (EP-REF-002)"
```

---

### Task 8: Update Backlog

- [ ] **Step 1: Create backlog entry for EP-REF-002**

Add a backlog item under the "Reference Data & UX Polish" epic (or create a new mini-epic) for the admin reference data management page. Mark as done once verified.

- [ ] **Step 2: Commit**

```bash
git commit -m "ops: add EP-REF-002 backlog entry (EP-REF-002)"
```

---

## Final Verification

After all tasks:

1. `cd apps/web && npx vitest run` — all tests pass
2. Navigate to `/admin/reference-data` — page loads correctly
3. Verify all 4 panels display data
4. Test status toggles on country/region/city
5. Test inline edit on region (name + code) and city (name)
6. Test add region and add city via admin panel
7. Test link/unlink address on a work location
8. Verify non-admin user cannot access the page (gets 404)
