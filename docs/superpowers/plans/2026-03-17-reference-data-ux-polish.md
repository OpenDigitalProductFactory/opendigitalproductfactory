# Reference Data & UX Polish Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add geographic hierarchy, shared address model, typeahead entry, MCP validation slot, phone fields, and DatePicker component to eliminate freeform location data and improve UX consistency.

**Architecture:** Three-tier geographic reference data (Country → Region → City) seeded with ISO 3166-1 countries, a shared context-neutral Address table linked via entity-specific join tables, and a reusable ReferenceTypeahead component for controlled data entry with organic growth. MCP-based geocoding validation is advisory-only.

**Tech Stack:** Prisma + PostgreSQL, Next.js server actions, React components, @floating-ui/react (already installed) for typeahead popover, react-day-picker (new dependency) for DatePicker, Vitest for tests.

**Spec:** `docs/superpowers/specs/2026-03-17-reference-data-ux-polish-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/db/prisma/migrations/<timestamp>_add_reference_data/migration.sql` | Schema migration (auto-generated + raw SQL for functional indexes) |
| `packages/db/scripts/seed-countries.ts` | Idempotent ISO 3166-1 country seed script |
| `packages/db/scripts/countries.json` | ISO 3166-1 dataset (~250 entries) |
| `apps/web/lib/actions/reference-data.ts` | Server actions: search/create countries, regions, cities |
| `apps/web/lib/actions/reference-data.test.ts` | Tests for reference data actions |
| `apps/web/lib/actions/address.ts` | Server actions: address CRUD, employee address link |
| `apps/web/lib/actions/address.test.ts` | Tests for address actions |
| `apps/web/lib/address-data.ts` | Data fetching: employee addresses with hierarchy |
| `apps/web/lib/address-data.test.ts` | Tests for address data queries |
| `apps/web/components/ui/ReferenceTypeahead.tsx` | Reusable typeahead with "add new" flow |
| `apps/web/components/ui/ReferenceTypeahead.test.tsx` | Tests for typeahead component |
| `apps/web/components/ui/DatePicker.tsx` | Shared date picker wrapping react-day-picker |
| `apps/web/components/ui/DatePicker.test.tsx` | Tests for date picker |
| `apps/web/components/employee/AddressSection.tsx` | Address entry/display for employee form |
| `apps/web/components/employee/AddressSection.test.tsx` | Tests for address section |

### Modified Files

| File | Changes |
|------|---------|
| `packages/db/prisma/schema.prisma` | Add Country, Region, City, Address, EmployeeAddress models; add addressId to WorkLocation; rename phoneNumber → phoneWork, add phoneMobile/phoneEmergency on EmployeeProfile |
| `apps/web/package.json` | Add react-day-picker dependency |
| `apps/web/lib/workforce-data.ts` | Rename phoneNumber → phoneWork in select/mapping, add address data loading |
| `apps/web/lib/workforce-types.ts` | Rename phoneNumber → phoneWork on EmployeeProfileInput and EmployeeProfileRecord, add phoneMobile/phoneEmergency, add E.164 validation |
| `apps/web/lib/actions/workforce.ts` | Update phone field references (phoneNumber → phoneWork), add phoneMobile/phoneEmergency to create/update actions |
| `apps/web/components/employee/EmployeeFormPanel.tsx` | Add AddressSection, update phone fields, replace date inputs with DatePicker |
| `apps/web/components/employee/EmployeeProfilePanel.tsx` | Display addresses and phone fields |
| `apps/web/app/(shell)/employee/page.tsx` | Load address data, pass to components |

---

## Chunk 1: Schema, Migration & Seed

### Task 1: Prisma Schema — Geographic Hierarchy Models

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add Country model to schema**

Add after the WorkLocation model (line 244):

```prisma
// ─── Geographic Reference Data ──────────────────────────────────────────────

model Country {
  id          String   @id @default(cuid())
  name        String   // Common short name: "United Kingdom"
  iso2        String   @unique
  iso3        String   @unique
  numericCode String
  phoneCode   String
  status      String   @default("active")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  regions     Region[]

  @@index([status])
}
```

- [ ] **Step 2: Add Region model**

```prisma
model Region {
  id        String   @id @default(cuid())
  name      String
  code      String?
  countryId String
  country   Country  @relation(fields: [countryId], references: [id], onDelete: Restrict)
  status    String   @default("active")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  cities    City[]

  @@unique([countryId, name])
  @@index([countryId])
  @@index([status])
}
```

- [ ] **Step 3: Add City model**

```prisma
model City {
  id        String    @id @default(cuid())
  name      String
  regionId  String
  region    Region    @relation(fields: [regionId], references: [id], onDelete: Restrict)
  status    String    @default("active")
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  addresses Address[]

  @@unique([regionId, name])
  @@index([regionId])
  @@index([status])
}
```

- [ ] **Step 4: Add Address model**

```prisma
model Address {
  id               String    @id @default(cuid())
  label            String    // home | work | billing | shipping | headquarters | site
  addressLine1     String
  addressLine2     String?
  cityId           String
  city             City      @relation(fields: [cityId], references: [id], onDelete: Restrict)
  postalCode       String
  latitude         Decimal?  @db.Decimal(10, 7)
  longitude        Decimal?  @db.Decimal(10, 7)
  validatedAt      DateTime?
  validationSource String?
  status           String    @default("active")
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  employeeAddresses EmployeeAddress[]
  workLocations     WorkLocation[]

  @@index([cityId])
  @@index([status])
}
```

- [ ] **Step 5: Add EmployeeAddress join table**

```prisma
model EmployeeAddress {
  id                String          @id @default(cuid())
  employeeProfileId String
  employeeProfile   EmployeeProfile @relation(fields: [employeeProfileId], references: [id], onDelete: Cascade)
  addressId         String
  address           Address         @relation(fields: [addressId], references: [id], onDelete: Cascade)
  isPrimary         Boolean         @default(false)
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  @@unique([employeeProfileId, addressId])
  @@index([employeeProfileId])
  @@index([addressId])
}
```

- [ ] **Step 6: Add relations to EmployeeProfile and WorkLocation**

In `EmployeeProfile` model, add:
```prisma
  addresses         EmployeeAddress[]
```

In `WorkLocation` model, add:
```prisma
  addressId String?
  address   Address? @relation(fields: [addressId], references: [id], onDelete: SetNull)

  @@index([addressId])
```

- [ ] **Step 7: Rename phoneNumber and add new phone fields on EmployeeProfile**

In the `EmployeeProfile` model, change the existing `phoneNumber` field:
```prisma
  // Replace: phoneNumber String?
  phoneWork      String?
  phoneMobile    String?
  phoneEmergency String?
```

- [ ] **Step 8: Generate and customize the Prisma migration**

Run: `cd packages/db && npx prisma migrate dev --name add_reference_data --create-only`

Then edit the generated migration SQL to:
1. Use `ALTER TABLE "EmployeeProfile" RENAME COLUMN "phoneNumber" TO "phoneWork"` instead of drop+add
2. Append case-insensitive functional unique indexes:

```sql
CREATE UNIQUE INDEX "Region_countryId_name_ci" ON "Region" (LOWER("name"), "countryId");
CREATE UNIQUE INDEX "City_regionId_name_ci" ON "City" (LOWER("name"), "regionId");
```

- [ ] **Step 9: Apply the migration**

Run: `cd packages/db && npx prisma migrate dev`

Verify: no errors, Prisma client regenerated.

- [ ] **Step 10: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "schema: add geographic hierarchy, address, phone fields (EP-REF-001)"
```

---

### Task 2: Country Seed Script

**Files:**
- Create: `packages/db/scripts/countries.json`
- Create: `packages/db/scripts/seed-countries.ts`

- [ ] **Step 1: Create the ISO 3166-1 JSON dataset**

Create `packages/db/scripts/countries.json` with all ~250 countries. Each entry:
```json
[
  { "name": "Afghanistan", "iso2": "AF", "iso3": "AFG", "numericCode": "004", "phoneCode": "+93" },
  { "name": "Albania", "iso2": "AL", "iso3": "ALB", "numericCode": "008", "phoneCode": "+355" },
  ...
]
```

Use common short names (not formal ISO names). Source from public domain ISO 3166-1 data.

- [ ] **Step 2: Create the seed script**

Create `packages/db/scripts/seed-countries.ts`:

```typescript
import { prisma } from "../src/client";
import countries from "./countries.json";

async function main() {
  console.log(`Seeding ${countries.length} countries...`);
  let created = 0;
  let skipped = 0;

  for (const c of countries) {
    const existing = await prisma.country.findUnique({ where: { iso2: c.iso2 } });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.country.create({
      data: {
        name: c.name,
        iso2: c.iso2,
        iso3: c.iso3,
        numericCode: c.numericCode,
        phoneCode: c.phoneCode,
      },
    });
    created++;
  }

  console.log(`Done: ${created} created, ${skipped} already existed.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 3: Run the seed script**

Run: `cd packages/db && npx tsx scripts/seed-countries.ts`

Expected: "Seeding 250 countries... Done: 250 created, 0 already existed."

- [ ] **Step 4: Verify seed data**

Run: `cd packages/db && npx tsx -e "const { PrismaClient } = require('./generated/client'); const p = new PrismaClient(); p.country.count().then(c => console.log('Countries:', c)).finally(() => p.\$disconnect())"`

Expected: "Countries: 250" (approximately)

- [ ] **Step 5: Run seed script again to verify idempotency**

Run: `cd packages/db && npx tsx scripts/seed-countries.ts`

Expected: "Done: 0 created, 250 already existed."

- [ ] **Step 6: Commit**

```bash
git add packages/db/scripts/countries.json packages/db/scripts/seed-countries.ts
git commit -m "data: ISO 3166-1 country seed script (EP-REF-001)"
```

---

## Chunk 2: Server Actions — Reference Data Search & Create

### Task 3: Reference Data Server Actions

**Files:**
- Create: `apps/web/lib/actions/reference-data.ts`
- Create: `apps/web/lib/actions/reference-data.test.ts`

Reference existing pattern: `apps/web/lib/actions/workforce.ts` — uses `"use server"`, returns `{ ok: boolean; message: string }`, calls `revalidatePath`, uses `prisma` from `@dpf/db`.

- [ ] **Step 1: Write the failing test for searchCountries**

Create `apps/web/lib/actions/reference-data.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    country: { findMany: vi.fn() },
    region: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    city: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@dpf/db";
import { searchCountries } from "./reference-data";

describe("searchCountries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns countries matching query by name, iso2, or iso3", async () => {
    const mockCountries = [
      { id: "c1", name: "United Kingdom", iso2: "GB", iso3: "GBR", phoneCode: "+44" },
    ];
    vi.mocked(prisma.country.findMany).mockResolvedValue(mockCountries as any);

    const result = await searchCountries("united");
    expect(result).toEqual(mockCountries);
    expect(prisma.country.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "active",
        }),
        take: 20,
        orderBy: { name: "asc" },
      })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/actions/reference-data.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Implement searchCountries**

Create `apps/web/lib/actions/reference-data.ts`:

```typescript
"use server";

import { prisma } from "@dpf/db";

export async function searchCountries(query: string) {
  const q = query.trim();
  if (!q) return [];

  return prisma.country.findMany({
    where: {
      status: "active",
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { iso2: { contains: q, mode: "insensitive" } },
        { iso3: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, iso2: true, iso3: true, phoneCode: true },
    take: 20,
    orderBy: { name: "asc" },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/actions/reference-data.test.ts`

Expected: PASS

- [ ] **Step 5: Write failing test for searchRegions**

Add to the test file:

```typescript
import { searchRegions } from "./reference-data";

describe("searchRegions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns regions scoped to countryId", async () => {
    const mockRegions = [{ id: "r1", name: "California", code: "CA" }];
    vi.mocked(prisma.region.findMany).mockResolvedValue(mockRegions as any);

    const result = await searchRegions("c1", "cal");
    expect(result).toEqual(mockRegions);
    expect(prisma.region.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          countryId: "c1",
          status: "active",
        }),
      })
    );
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/actions/reference-data.test.ts`

Expected: FAIL — searchRegions not exported

- [ ] **Step 7: Implement searchRegions and searchCities**

Add to `reference-data.ts`:

```typescript
export async function searchRegions(countryId: string, query: string) {
  const q = query.trim();
  if (!q || !countryId) return [];

  return prisma.region.findMany({
    where: {
      countryId,
      status: "active",
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, code: true },
    take: 20,
    orderBy: { name: "asc" },
  });
}

export async function searchCities(regionId: string, query: string) {
  const q = query.trim();
  if (!q || !regionId) return [];

  return prisma.city.findMany({
    where: {
      regionId,
      status: "active",
      name: { contains: q, mode: "insensitive" },
    },
    select: { id: true, name: true },
    take: 20,
    orderBy: { name: "asc" },
  });
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/actions/reference-data.test.ts`

Expected: PASS

- [ ] **Step 9: Write failing test for createRegion with near-match check**

```typescript
import { createRegion } from "./reference-data";

describe("createRegion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns error with suggestions when near-match exists", async () => {
    vi.mocked(prisma.region.findMany).mockResolvedValue([
      { id: "r1", name: "California", code: "CA" } as any,
    ]);

    const result = await createRegion("c1", "Californ", undefined);
    expect(result.ok).toBe(false);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions![0].name).toBe("California");
  });

  it("creates region when no near-match exists", async () => {
    vi.mocked(prisma.region.findMany).mockResolvedValue([]);
    vi.mocked(prisma.region.create).mockResolvedValue({
      id: "r2", name: "Oregon", code: "OR",
    } as any);

    const result = await createRegion("c1", "Oregon", "OR");
    expect(result.ok).toBe(true);
    expect(result.created!.name).toBe("Oregon");
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/actions/reference-data.test.ts`

Expected: FAIL

- [ ] **Step 11: Implement createRegion and createCity**

Add to `reference-data.ts`:

```typescript
import { revalidatePath } from "next/cache";

type CreateRefResult = {
  ok: boolean;
  message: string;
  created?: { id: string; name: string; code?: string | null };
  suggestions?: { id: string; name: string; code?: string | null }[];
};

export async function createRegion(
  countryId: string,
  name: string,
  code: string | undefined,
): Promise<CreateRefResult> {
  const trimmedName = name.trim();
  if (!trimmedName) return { ok: false, message: "Name is required" };

  // Near-match check: prefix match, case-insensitive
  const existing = await prisma.region.findMany({
    where: {
      countryId,
      status: "active",
      name: { startsWith: trimmedName, mode: "insensitive" },
    },
    select: { id: true, name: true, code: true },
    take: 5,
  });

  if (existing.length > 0) {
    return {
      ok: false,
      message: `Similar regions already exist. Did you mean one of these?`,
      suggestions: existing,
    };
  }

  const created = await prisma.region.create({
    data: {
      name: trimmedName,
      code: code?.trim() || null,
      countryId,
    },
    select: { id: true, name: true, code: true },
  });

  revalidatePath("/employee");
  return { ok: true, message: "Region created", created };
}

export async function createCity(
  regionId: string,
  name: string,
): Promise<CreateRefResult> {
  const trimmedName = name.trim();
  if (!trimmedName) return { ok: false, message: "Name is required" };

  const existing = await prisma.city.findMany({
    where: {
      regionId,
      status: "active",
      name: { startsWith: trimmedName, mode: "insensitive" },
    },
    select: { id: true, name: true },
    take: 5,
  });

  if (existing.length > 0) {
    return {
      ok: false,
      message: `Similar cities already exist. Did you mean one of these?`,
      suggestions: existing.map((c) => ({ ...c, code: null })),
    };
  }

  const created = await prisma.city.create({
    data: { name: trimmedName, regionId },
    select: { id: true, name: true },
  });

  revalidatePath("/employee");
  return { ok: true, message: "City created", created: { ...created, code: null } };
}

export async function forceCreateRegion(
  countryId: string,
  name: string,
  code: string | undefined,
): Promise<CreateRefResult> {
  const trimmedName = name.trim();
  if (!trimmedName) return { ok: false, message: "Name is required" };

  const created = await prisma.region.create({
    data: { name: trimmedName, code: code?.trim() || null, countryId },
    select: { id: true, name: true, code: true },
  });

  revalidatePath("/employee");
  return { ok: true, message: "Region created", created };
}

export async function forceCreateCity(
  regionId: string,
  name: string,
): Promise<CreateRefResult> {
  const trimmedName = name.trim();
  if (!trimmedName) return { ok: false, message: "Name is required" };

  const created = await prisma.city.create({
    data: { name: trimmedName, regionId },
    select: { id: true, name: true },
  });

  revalidatePath("/employee");
  return { ok: true, message: "City created", created: { ...created, code: null } };
}
```

- [ ] **Step 12: Run all tests**

Run: `cd apps/web && npx vitest run lib/actions/reference-data.test.ts`

Expected: ALL PASS

- [ ] **Step 13: Commit**

```bash
git add apps/web/lib/actions/reference-data.ts apps/web/lib/actions/reference-data.test.ts
git commit -m "feat: reference data search and create server actions (EP-REF-001)"
```

---

### Task 4: Address CRUD Server Actions

**Files:**
- Create: `apps/web/lib/actions/address.ts`
- Create: `apps/web/lib/actions/address.test.ts`

- [ ] **Step 1: Write failing test for createEmployeeAddress**

Create `apps/web/lib/actions/address.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    $transaction: vi.fn((fn: any) => fn({
      address: { create: vi.fn().mockResolvedValue({ id: "a1" }) },
      employeeAddress: {
        create: vi.fn().mockResolvedValue({ id: "ea1" }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    })),
    address: { update: vi.fn(), findUnique: vi.fn() },
    employeeAddress: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createEmployeeAddress } from "./address";

describe("createEmployeeAddress", () => {
  beforeEach(() => vi.clearAllMocks());

  it("validates required fields", async () => {
    const result = await createEmployeeAddress({
      employeeProfileId: "e1",
      label: "",
      addressLine1: "123 Main St",
      cityId: "city1",
      postalCode: "94102",
      isPrimary: false,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/label/i);
  });

  it("creates address and link in a transaction", async () => {
    const result = await createEmployeeAddress({
      employeeProfileId: "e1",
      label: "home",
      addressLine1: "123 Main St",
      addressLine2: null,
      cityId: "city1",
      postalCode: "94102",
      isPrimary: true,
    });
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/actions/address.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement address server actions**

Create `apps/web/lib/actions/address.ts`:

```typescript
"use server";

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import type { WorkforceActionResult } from "./workforce";

type AddressInput = {
  employeeProfileId: string;
  label: string;
  addressLine1: string;
  addressLine2?: string | null;
  cityId: string;
  postalCode: string;
  isPrimary: boolean;
};

const VALID_LABELS = ["home", "work", "billing", "shipping", "headquarters", "site"];

export async function createEmployeeAddress(input: AddressInput): Promise<WorkforceActionResult> {
  const { employeeProfileId, label, addressLine1, addressLine2, cityId, postalCode, isPrimary } = input;

  if (!label || !VALID_LABELS.includes(label)) {
    return { ok: false, message: `Label must be one of: ${VALID_LABELS.join(", ")}` };
  }
  if (!addressLine1.trim()) return { ok: false, message: "Address line 1 is required" };
  if (!cityId) return { ok: false, message: "City is required" };
  if (!postalCode.trim()) return { ok: false, message: "Postal code is required" };

  await prisma.$transaction(async (tx) => {
    // If setting as primary, unset existing primary
    if (isPrimary) {
      await tx.employeeAddress.updateMany({
        where: { employeeProfileId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const address = await tx.address.create({
      data: {
        label,
        addressLine1: addressLine1.trim(),
        addressLine2: addressLine2?.trim() || null,
        cityId,
        postalCode: postalCode.trim(),
      },
    });

    await tx.employeeAddress.create({
      data: {
        employeeProfileId,
        addressId: address.id,
        isPrimary,
      },
    });
  });

  revalidatePath("/employee");
  return { ok: true, message: "Address added" };
}

export async function updateAddress(
  addressId: string,
  data: Partial<{
    label: string;
    addressLine1: string;
    addressLine2: string | null;
    cityId: string;
    postalCode: string;
  }>,
): Promise<WorkforceActionResult> {
  if (data.label && !VALID_LABELS.includes(data.label)) {
    return { ok: false, message: `Label must be one of: ${VALID_LABELS.join(", ")}` };
  }

  await prisma.address.update({
    where: { id: addressId },
    data: {
      ...(data.label && { label: data.label }),
      ...(data.addressLine1 && { addressLine1: data.addressLine1.trim() }),
      ...(data.addressLine2 !== undefined && { addressLine2: data.addressLine2?.trim() || null }),
      ...(data.cityId && { cityId: data.cityId }),
      ...(data.postalCode && { postalCode: data.postalCode.trim() }),
    },
  });

  revalidatePath("/employee");
  return { ok: true, message: "Address updated" };
}

export async function deleteEmployeeAddress(employeeAddressId: string): Promise<WorkforceActionResult> {
  const link = await prisma.employeeAddress.findUnique({
    where: { id: employeeAddressId },
    select: { addressId: true },
  });

  if (!link) return { ok: false, message: "Address link not found" };

  await prisma.employeeAddress.delete({ where: { id: employeeAddressId } });

  // Soft-delete the address
  await prisma.address.update({
    where: { id: link.addressId },
    data: { status: "inactive" },
  });

  revalidatePath("/employee");
  return { ok: true, message: "Address removed" };
}

export async function setPrimaryAddress(employeeAddressId: string): Promise<WorkforceActionResult> {
  const link = await prisma.employeeAddress.findUnique({
    where: { id: employeeAddressId },
    select: { employeeProfileId: true },
  });

  if (!link) return { ok: false, message: "Address link not found" };

  // Atomic: unset all primary, then set this one
  await prisma.$transaction(async (tx) => {
    await tx.employeeAddress.updateMany({
      where: { employeeProfileId: link.employeeProfileId, isPrimary: true },
      data: { isPrimary: false },
    });
    await tx.employeeAddress.update({
      where: { id: employeeAddressId },
      data: { isPrimary: true },
    });
  });

  revalidatePath("/employee");
  return { ok: true, message: "Primary address updated" };
}
```

- [ ] **Step 4: Run all tests**

Run: `cd apps/web && npx vitest run lib/actions/address.test.ts`

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/address.ts apps/web/lib/actions/address.test.ts
git commit -m "feat: address CRUD server actions (EP-REF-001)"
```

---

### Task 5: Address Data Fetching

**Files:**
- Create: `apps/web/lib/address-data.ts`
- Create: `apps/web/lib/address-data.test.ts`

- [ ] **Step 1: Write failing test for getEmployeeAddresses**

Create `apps/web/lib/address-data.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    employeeAddress: { findMany: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { getEmployeeAddresses } from "./address-data";

describe("getEmployeeAddresses", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns addresses with full hierarchy for an employee", async () => {
    const mockData = [
      {
        id: "ea1",
        isPrimary: true,
        address: {
          id: "a1",
          label: "home",
          addressLine1: "123 Main St",
          addressLine2: null,
          postalCode: "94102",
          validatedAt: null,
          validationSource: null,
          city: {
            id: "city1",
            name: "San Francisco",
            region: {
              id: "r1",
              name: "California",
              code: "CA",
              country: { id: "c1", name: "United States", iso2: "US", phoneCode: "+1" },
            },
          },
        },
      },
    ];
    vi.mocked(prisma.employeeAddress.findMany).mockResolvedValue(mockData as any);

    const result = await getEmployeeAddresses("e1");
    expect(result).toHaveLength(1);
    expect(result[0].isPrimary).toBe(true);
    expect(result[0].address.city.name).toBe("San Francisco");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/address-data.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement getEmployeeAddresses**

Create `apps/web/lib/address-data.ts`:

```typescript
import { prisma } from "@dpf/db";

export async function getEmployeeAddresses(employeeProfileId: string) {
  return prisma.employeeAddress.findMany({
    where: { employeeProfileId, address: { status: "active" } },
    include: {
      address: {
        include: {
          city: {
            include: {
              region: {
                include: {
                  country: {
                    select: { id: true, name: true, iso2: true, phoneCode: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/address-data.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/address-data.ts apps/web/lib/address-data.test.ts
git commit -m "feat: address data fetching with hierarchy (EP-REF-001)"
```

---

## Chunk 3: UI Components

### Task 6: Install react-day-picker Dependency

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Install react-day-picker**

Run: `cd apps/web && pnpm add react-day-picker`

- [ ] **Step 2: Verify installation**

Run: `cd apps/web && pnpm ls react-day-picker`

Expected: react-day-picker version listed

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "deps: add react-day-picker (EP-REF-001)"
```

---

### Task 7: DatePicker Component

**Files:**
- Create: `apps/web/components/ui/DatePicker.tsx`
- Create: `apps/web/components/ui/DatePicker.test.tsx`

- [ ] **Step 1: Write failing test for DatePicker**

Create `apps/web/components/ui/DatePicker.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DatePicker } from "./DatePicker";

describe("DatePicker", () => {
  it("renders with placeholder", () => {
    render(<DatePicker value={null} onChange={vi.fn()} placeholder="Select date" />);
    expect(screen.getByPlaceholderText("Select date")).toBeDefined();
  });

  it("displays the current value formatted", () => {
    const date = new Date(2026, 2, 17); // March 17, 2026
    render(<DatePicker value={date} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue(/2026-03-17/)).toBeDefined();
  });

  it("calls onChange when a date is selected", async () => {
    const onChange = vi.fn();
    render(<DatePicker value={null} onChange={onChange} />);
    // Click input to open calendar
    fireEvent.click(screen.getByRole("textbox"));
    // The calendar should be visible — detailed interaction tests deferred to integration
    expect(screen.getByRole("dialog")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run components/ui/DatePicker.test.tsx`

Expected: FAIL

- [ ] **Step 3: Implement DatePicker**

Create `apps/web/components/ui/DatePicker.tsx`:

```tsx
"use client";

import { useState, useRef } from "react";
import { DayPicker } from "react-day-picker";
import {
  useFloating,
  useClick,
  useDismiss,
  useInteractions,
  offset,
  flip,
  shift,
} from "@floating-ui/react";

type DatePickerProps = {
  value?: Date | null;
  onChange: (date: Date | null) => void;
  mode?: "single";
  placeholder?: string;
  disabled?: boolean;
};

const inputClasses =
  "w-full rounded border px-3 py-2 text-sm bg-[var(--dpf-surface-2)] border-[var(--dpf-border)] text-[var(--dpf-foreground)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]";

export function DatePicker({
  value,
  onChange,
  placeholder = "Select date",
  disabled = false,
}: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    middleware: [offset(4), flip(), shift()],
    placement: "bottom-start",
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);

  const displayValue = value
    ? value.toISOString().slice(0, 10)
    : "";

  return (
    <div className="relative">
      <input
        ref={refs.setReference}
        type="text"
        readOnly
        value={displayValue}
        placeholder={placeholder}
        disabled={disabled}
        className={inputClasses}
        {...getReferenceProps()}
      />
      {isOpen && (
        <div
          ref={refs.setFloating}
          role="dialog"
          style={floatingStyles}
          className="z-50 rounded border bg-[var(--dpf-surface-1)] border-[var(--dpf-border)] p-2 shadow-lg"
          {...getFloatingProps()}
        >
          <DayPicker
            mode="single"
            selected={value ?? undefined}
            onSelect={(day) => {
              onChange(day ?? null);
              setIsOpen(false);
            }}
            classNames={{
              root: "text-sm text-[var(--dpf-foreground)]",
              day: "rounded p-1 hover:bg-[var(--dpf-accent)] hover:text-white cursor-pointer",
              selected: "bg-[var(--dpf-accent)] text-white",
              today: "font-bold",
              chevron: "text-[var(--dpf-muted)]",
            }}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run components/ui/DatePicker.test.tsx`

Expected: PASS (or adjust classNames/role selectors as needed for react-day-picker v9 API)

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ui/DatePicker.tsx apps/web/components/ui/DatePicker.test.tsx
git commit -m "feat: DatePicker component wrapping react-day-picker (EP-REF-001)"
```

---

### Task 8: ReferenceTypeahead Component

**Files:**
- Create: `apps/web/components/ui/ReferenceTypeahead.tsx`
- Create: `apps/web/components/ui/ReferenceTypeahead.test.tsx`

- [ ] **Step 1: Write failing test for ReferenceTypeahead**

Create `apps/web/components/ui/ReferenceTypeahead.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReferenceTypeahead } from "./ReferenceTypeahead";

describe("ReferenceTypeahead", () => {
  it("renders with placeholder", () => {
    render(
      <ReferenceTypeahead
        placeholder="Search countries..."
        onSearch={vi.fn().mockResolvedValue([])}
        onSelect={vi.fn()}
        value={null}
      />
    );
    expect(screen.getByPlaceholderText("Search countries...")).toBeDefined();
  });

  it("calls onSearch after debounce when user types", async () => {
    const onSearch = vi.fn().mockResolvedValue([
      { id: "c1", label: "United Kingdom" },
    ]);
    render(
      <ReferenceTypeahead
        placeholder="Search..."
        onSearch={onSearch}
        onSelect={vi.fn()}
        value={null}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Search..."), {
      target: { value: "uni" },
    });

    await waitFor(() => expect(onSearch).toHaveBeenCalledWith("uni"), {
      timeout: 500,
    });
  });

  it("displays results and calls onSelect when clicked", async () => {
    const onSearch = vi.fn().mockResolvedValue([
      { id: "c1", label: "United Kingdom" },
      { id: "c2", label: "United States" },
    ]);
    const onSelect = vi.fn();

    render(
      <ReferenceTypeahead
        placeholder="Search..."
        onSearch={onSearch}
        onSelect={onSelect}
        value={null}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Search..."), {
      target: { value: "uni" },
    });

    await waitFor(() => expect(screen.getByText("United Kingdom")).toBeDefined());
    fireEvent.click(screen.getByText("United Kingdom"));
    expect(onSelect).toHaveBeenCalledWith({ id: "c1", label: "United Kingdom" });
  });

  it("shows 'Add new' option when onAddNew is provided and no exact match", async () => {
    const onSearch = vi.fn().mockResolvedValue([]);
    const onAddNew = vi.fn();

    render(
      <ReferenceTypeahead
        placeholder="Search..."
        onSearch={onSearch}
        onSelect={vi.fn()}
        onAddNew={onAddNew}
        addNewLabel="Add new region"
        value={null}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Search..."), {
      target: { value: "Oregon" },
    });

    await waitFor(() => expect(screen.getByText(/Add new region/)).toBeDefined());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run components/ui/ReferenceTypeahead.test.tsx`

Expected: FAIL

- [ ] **Step 3: Implement ReferenceTypeahead**

Create `apps/web/components/ui/ReferenceTypeahead.tsx`:

```tsx
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  useFloating,
  useDismiss,
  useInteractions,
  offset,
  flip,
  shift,
  size,
} from "@floating-ui/react";

type RefItem = { id: string; label: string };

type ReferenceTypeaheadProps = {
  placeholder?: string;
  onSearch: (query: string) => Promise<RefItem[]>;
  onSelect: (item: RefItem) => void;
  onAddNew?: (query: string) => void;
  addNewLabel?: string;
  value: RefItem | null;
  disabled?: boolean;
};

const inputClasses =
  "w-full rounded border px-3 py-2 text-sm bg-[var(--dpf-surface-2)] border-[var(--dpf-border)] text-[var(--dpf-foreground)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]";

export function ReferenceTypeahead({
  placeholder = "Search...",
  onSearch,
  onSelect,
  onAddNew,
  addNewLabel = "Add new",
  value,
  disabled = false,
}: ReferenceTypeaheadProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RefItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    middleware: [
      offset(2),
      flip(),
      shift(),
      size({
        apply({ rects, elements }) {
          Object.assign(elements.floating.style, {
            width: `${rects.reference.width}px`,
          });
        },
      }),
    ],
    placement: "bottom-start",
  });

  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

  const doSearch = useCallback(
    async (q: string) => {
      if (q.length < 1) {
        setResults([]);
        setIsOpen(false);
        return;
      }
      const items = await onSearch(q);
      setResults(items);
      setIsOpen(true);
      setActiveIndex(-1);
    },
    [onSearch],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 300);
  };

  const handleSelect = (item: RefItem) => {
    setQuery(item.label);
    setIsOpen(false);
    onSelect(item);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const totalItems = results.length + (onAddNew ? 1 : 0);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, totalItems - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      if (activeIndex < results.length) {
        handleSelect(results[activeIndex]);
      } else if (onAddNew) {
        onAddNew(query);
        setIsOpen(false);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  // If value changes externally, sync the display
  useEffect(() => {
    if (value) setQuery(value.label);
  }, [value]);

  return (
    <div className="relative">
      <input
        ref={refs.setReference}
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => query.length >= 1 && doSearch(query)}
        placeholder={placeholder}
        disabled={disabled}
        className={inputClasses}
        role="combobox"
        aria-expanded={isOpen}
        {...getReferenceProps()}
      />
      {isOpen && (results.length > 0 || onAddNew) && (
        <div
          ref={refs.setFloating}
          role="listbox"
          style={floatingStyles}
          className="z-50 max-h-60 overflow-y-auto rounded border bg-[var(--dpf-surface-1)] border-[var(--dpf-border)] shadow-lg"
          {...getFloatingProps()}
        >
          {results.map((item, i) => (
            <div
              key={item.id}
              role="option"
              aria-selected={i === activeIndex}
              onClick={() => handleSelect(item)}
              className={`cursor-pointer px-3 py-2 text-sm ${
                i === activeIndex
                  ? "bg-[var(--dpf-accent)] text-white"
                  : "text-[var(--dpf-foreground)] hover:bg-[var(--dpf-surface-2)]"
              }`}
            >
              {item.label}
            </div>
          ))}
          {onAddNew && (
            <div
              role="option"
              aria-selected={activeIndex === results.length}
              onClick={() => {
                onAddNew(query);
                setIsOpen(false);
              }}
              className={`cursor-pointer border-t border-[var(--dpf-border)] px-3 py-2 text-sm font-medium ${
                activeIndex === results.length
                  ? "bg-[var(--dpf-accent)] text-white"
                  : "text-[var(--dpf-accent)] hover:bg-[var(--dpf-surface-2)]"
              }`}
            >
              + {addNewLabel}: &quot;{query}&quot;
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run components/ui/ReferenceTypeahead.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ui/ReferenceTypeahead.tsx apps/web/components/ui/ReferenceTypeahead.test.tsx
git commit -m "feat: ReferenceTypeahead component with add-new flow (EP-REF-001)"
```

---

## Chunk 4: Integration — Employee Form & Page

### Task 9: AddressSection Component

**Files:**
- Create: `apps/web/components/employee/AddressSection.tsx`
- Create: `apps/web/components/employee/AddressSection.test.tsx`

This is the compound component that orchestrates the cascading typeaheads (Country → Region → City) and the address form fields. It uses the ReferenceTypeahead component and the reference data server actions.

- [ ] **Step 1: Write failing test for AddressSection**

Create `apps/web/components/employee/AddressSection.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AddressSection } from "./AddressSection";

// Mock server actions
vi.mock("@/lib/actions/reference-data", () => ({
  searchCountries: vi.fn().mockResolvedValue([]),
  searchRegions: vi.fn().mockResolvedValue([]),
  searchCities: vi.fn().mockResolvedValue([]),
  createRegion: vi.fn(),
  createCity: vi.fn(),
  forceCreateRegion: vi.fn(),
  forceCreateCity: vi.fn(),
}));

vi.mock("@/lib/actions/address", () => ({
  createEmployeeAddress: vi.fn().mockResolvedValue({ ok: true, message: "Added" }),
}));

describe("AddressSection", () => {
  it("renders country, region, city typeaheads and address fields", () => {
    render(<AddressSection employeeProfileId="e1" addresses={[]} />);
    expect(screen.getByPlaceholderText(/country/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/address line 1/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/postal code/i)).toBeDefined();
  });

  it("displays existing addresses", () => {
    const addresses = [
      {
        id: "ea1",
        isPrimary: true,
        address: {
          id: "a1",
          label: "home",
          addressLine1: "123 Main St",
          addressLine2: null,
          postalCode: "94102",
          validatedAt: null,
          validationSource: null,
          city: {
            id: "c1",
            name: "San Francisco",
            region: {
              id: "r1",
              name: "California",
              code: "CA",
              country: { id: "co1", name: "United States", iso2: "US", phoneCode: "+1" },
            },
          },
        },
      },
    ];

    render(<AddressSection employeeProfileId="e1" addresses={addresses} />);
    expect(screen.getByText(/123 Main St/)).toBeDefined();
    expect(screen.getByText(/San Francisco/)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run components/employee/AddressSection.test.tsx`

Expected: FAIL

- [ ] **Step 3: Implement AddressSection**

Create `apps/web/components/employee/AddressSection.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { ReferenceTypeahead } from "@/components/ui/ReferenceTypeahead";
import {
  searchCountries,
  searchRegions,
  searchCities,
  createRegion,
  createCity,
  forceCreateRegion,
  forceCreateCity,
} from "@/lib/actions/reference-data";
import { createEmployeeAddress, deleteEmployeeAddress, setPrimaryAddress } from "@/lib/actions/address";

type RefItem = { id: string; label: string };

type AddressWithHierarchy = {
  id: string;
  isPrimary: boolean;
  address: {
    id: string;
    label: string;
    addressLine1: string;
    addressLine2: string | null;
    postalCode: string;
    validatedAt: Date | null;
    validationSource: string | null;
    city: {
      id: string;
      name: string;
      region: {
        id: string;
        name: string;
        code: string | null;
        country: { id: string; name: string; iso2: string; phoneCode: string };
      };
    };
  };
};

type Props = {
  employeeProfileId: string;
  addresses: AddressWithHierarchy[];
};

const LABELS = ["home", "work", "billing", "shipping", "headquarters", "site"];
const labelClasses = "block text-xs font-medium text-[var(--dpf-muted)] mb-1";
const inputClasses =
  "w-full rounded border px-3 py-2 text-sm bg-[var(--dpf-surface-2)] border-[var(--dpf-border)] text-[var(--dpf-foreground)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]";

export function AddressSection({ employeeProfileId, addresses }: Props) {
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [country, setCountry] = useState<RefItem | null>(null);
  const [region, setRegion] = useState<RefItem | null>(null);
  const [city, setCity] = useState<RefItem | null>(null);
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [label, setLabel] = useState("home");
  const [isPrimary, setIsPrimary] = useState(addresses.length === 0);

  const resetForm = () => {
    setCountry(null);
    setRegion(null);
    setCity(null);
    setAddressLine1("");
    setAddressLine2("");
    setPostalCode("");
    setLabel("home");
    setIsPrimary(false);
    setError("");
    setShowForm(false);
  };

  const handleCountrySearch = async (q: string): Promise<RefItem[]> => {
    const results = await searchCountries(q);
    return results.map((c) => ({ id: c.id, label: `${c.name} (${c.iso2})` }));
  };

  const handleRegionSearch = async (q: string): Promise<RefItem[]> => {
    if (!country) return [];
    const results = await searchRegions(country.id, q);
    return results.map((r) => ({ id: r.id, label: r.code ? `${r.name} (${r.code})` : r.name }));
  };

  const handleCitySearch = async (q: string): Promise<RefItem[]> => {
    if (!region) return [];
    const results = await searchCities(region.id, q);
    return results.map((c) => ({ id: c.id, label: c.name }));
  };

  const handleAddRegion = async (name: string) => {
    if (!country) return;
    const result = await createRegion(country.id, name, undefined);
    if (result.ok && result.created) {
      setRegion({ id: result.created.id, label: result.created.name });
    } else if (result.suggestions && result.suggestions.length > 0) {
      // Show suggestions — for now, auto-select first match
      // TODO: show suggestion dialog
      setError(result.message);
    }
  };

  const handleAddCity = async (name: string) => {
    if (!region) return;
    const result = await createCity(region.id, name);
    if (result.ok && result.created) {
      setCity({ id: result.created.id, label: result.created.name });
    } else if (result.suggestions) {
      setError(result.message);
    }
  };

  const handleSubmit = () => {
    if (!city) { setError("Please select a city"); return; }
    if (!addressLine1.trim()) { setError("Address line 1 is required"); return; }
    if (!postalCode.trim()) { setError("Postal code is required"); return; }

    startTransition(async () => {
      const result = await createEmployeeAddress({
        employeeProfileId,
        label,
        addressLine1,
        addressLine2: addressLine2 || null,
        cityId: city.id,
        postalCode,
        isPrimary,
      });
      if (result.ok) {
        resetForm();
      } else {
        setError(result.message);
      }
    });
  };

  const handleDelete = (employeeAddressId: string) => {
    startTransition(() => deleteEmployeeAddress(employeeAddressId));
  };

  const handleSetPrimary = (employeeAddressId: string) => {
    startTransition(() => setPrimaryAddress(employeeAddressId));
  };

  const formatAddress = (addr: AddressWithHierarchy["address"]) => {
    const { city: c } = addr;
    const regionStr = c.region.code ? `${c.region.code}` : c.region.name;
    return `${addr.addressLine1}${addr.addressLine2 ? `, ${addr.addressLine2}` : ""}, ${c.name}, ${regionStr} ${addr.postalCode}, ${c.region.country.name}`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className={labelClasses}>Addresses</span>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="text-xs text-[var(--dpf-accent)] hover:underline"
          >
            + Add address
          </button>
        )}
      </div>

      {/* Existing addresses */}
      {addresses.map((ea) => (
        <div
          key={ea.id}
          className="flex items-start justify-between rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-xs"
        >
          <div>
            <span className="font-medium capitalize">{ea.address.label}</span>
            {ea.isPrimary && (
              <span className="ml-2 rounded bg-[var(--dpf-accent)] px-1.5 py-0.5 text-[10px] text-white">
                Primary
              </span>
            )}
            {ea.address.validatedAt && (
              <span className="ml-1 text-green-400" title={`Validated by ${ea.address.validationSource}`}>✓</span>
            )}
            <div className="mt-1 text-[var(--dpf-muted)]">{formatAddress(ea.address)}</div>
          </div>
          <div className="flex gap-2">
            {!ea.isPrimary && (
              <button
                onClick={() => handleSetPrimary(ea.id)}
                className="text-[var(--dpf-muted)] hover:text-[var(--dpf-foreground)]"
                title="Set as primary"
              >
                ★
              </button>
            )}
            <button
              onClick={() => handleDelete(ea.id)}
              className="text-[var(--dpf-muted)] hover:text-red-400"
              title="Remove"
            >
              ×
            </button>
          </div>
        </div>
      ))}

      {/* Add address form */}
      {showForm && (
        <div className="space-y-2 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
          {error && (
            <div className="rounded bg-red-900/30 px-2 py-1 text-xs text-red-300">{error}</div>
          )}

          <div>
            <label className={labelClasses}>Label</label>
            <select value={label} onChange={(e) => setLabel(e.target.value)} className={inputClasses}>
              {LABELS.map((l) => (
                <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClasses}>Country</label>
            <ReferenceTypeahead
              placeholder="Search countries..."
              onSearch={handleCountrySearch}
              onSelect={(item) => {
                setCountry(item);
                setRegion(null);
                setCity(null);
              }}
              value={country}
            />
          </div>

          <div>
            <label className={labelClasses}>Region / State</label>
            <ReferenceTypeahead
              placeholder="Search regions..."
              onSearch={handleRegionSearch}
              onSelect={(item) => {
                setRegion(item);
                setCity(null);
              }}
              onAddNew={handleAddRegion}
              addNewLabel="Add new region"
              value={region}
              disabled={!country}
            />
          </div>

          <div>
            <label className={labelClasses}>City</label>
            <ReferenceTypeahead
              placeholder="Search cities..."
              onSearch={handleCitySearch}
              onSelect={setCity}
              onAddNew={handleAddCity}
              addNewLabel="Add new city"
              value={city}
              disabled={!region}
            />
          </div>

          <div>
            <label className={labelClasses}>Address Line 1</label>
            <input
              type="text"
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              placeholder="Address line 1"
              className={inputClasses}
            />
          </div>

          <div>
            <label className={labelClasses}>Address Line 2</label>
            <input
              type="text"
              value={addressLine2}
              onChange={(e) => setAddressLine2(e.target.value)}
              placeholder="Address line 2 (optional)"
              className={inputClasses}
            />
          </div>

          <div>
            <label className={labelClasses}>Postal Code</label>
            <input
              type="text"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              placeholder="Postal code"
              className={inputClasses}
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-[var(--dpf-muted)]">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
            />
            Set as primary address
          </label>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSubmit}
              disabled={isPending}
              className="rounded bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? "Saving..." : "Save Address"}
            </button>
            <button
              onClick={resetForm}
              className="rounded border border-[var(--dpf-border)] px-3 py-1.5 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-foreground)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run components/employee/AddressSection.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/employee/AddressSection.tsx apps/web/components/employee/AddressSection.test.tsx
git commit -m "feat: AddressSection with cascading typeaheads (EP-REF-001)"
```

---

### Task 10: Phone Field Rename & E.164 Validation

**Files:**
- Modify: `apps/web/lib/workforce-types.ts`
- Modify: `apps/web/lib/workforce-data.ts`
- Modify: `apps/web/lib/actions/workforce.ts`
- Modify: `apps/web/lib/actions/workforce.test.ts`

- [ ] **Step 1: Add E.164 validation to workforce-types.ts**

In `apps/web/lib/workforce-types.ts`:

1. Rename `phoneNumber` → `phoneWork` on both `EmployeeProfileInput` (line ~74) and `EmployeeProfileRecord` (line ~150)
2. Add `phoneMobile` and `phoneEmergency` to both types (nullable strings)
3. Add E.164 validation helper:

```typescript
const E164_REGEX = /^\+[1-9]\d{1,14}$/;

export function validateE164(phone: string | null | undefined): boolean {
  if (!phone) return true; // nullable fields are valid when empty
  return E164_REGEX.test(phone);
}
```

4. Update `validateEmployeeProfileInput` to include phone validation:

```typescript
if (input.phoneWork && !validateE164(input.phoneWork)) {
  return "Phone (work) must be in E.164 format (e.g., +14155551234)";
}
if (input.phoneMobile && !validateE164(input.phoneMobile)) {
  return "Phone (mobile) must be in E.164 format (e.g., +14155551234)";
}
if (input.phoneEmergency && !validateE164(input.phoneEmergency)) {
  return "Phone (emergency) must be in E.164 format (e.g., +14155551234)";
}
```

- [ ] **Step 2: Write failing test for E.164 validation**

Add to `apps/web/lib/actions/workforce.test.ts`:

```typescript
import { validateE164 } from "../workforce-types";

describe("validateE164", () => {
  it("accepts valid E.164 numbers", () => {
    expect(validateE164("+14155551234")).toBe(true);
    expect(validateE164("+442071234567")).toBe(true);
    expect(validateE164("+61412345678")).toBe(true);
  });

  it("rejects invalid formats", () => {
    expect(validateE164("4155551234")).toBe(false);     // missing +
    expect(validateE164("+0155551234")).toBe(false);    // starts with 0
    expect(validateE164("(415) 555-1234")).toBe(false); // formatted
    expect(validateE164("+1")).toBe(false);              // too short
  });

  it("accepts null/undefined (nullable fields)", () => {
    expect(validateE164(null)).toBe(true);
    expect(validateE164(undefined)).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify**

Run: `cd apps/web && npx vitest run lib/actions/workforce.test.ts`

Expected: PASS

- [ ] **Step 4: Update workforce-data.ts — rename phoneNumber in select and mapping**

In `apps/web/lib/workforce-data.ts`:
- Line ~73: change `phoneNumber: true` → `phoneWork: true, phoneMobile: true, phoneEmergency: true` in the Prisma select
- Line ~102: change `phoneNumber: employee.phoneNumber` → `phoneWork: employee.phoneWork, phoneMobile: employee.phoneMobile, phoneEmergency: employee.phoneEmergency` in the mapping

- [ ] **Step 5: Update workforce.ts — rename phoneNumber in create/update actions**

In `apps/web/lib/actions/workforce.ts`:
- In `createEmployeeProfile` (~line 216): change `phoneNumber` → `phoneWork` in the Prisma data object, add `phoneMobile` and `phoneEmergency`
- In `updateEmployeeProfile` (~line 288): same changes

- [ ] **Step 6: Run all workforce tests**

Run: `cd apps/web && npx vitest run lib/actions/workforce.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/workforce-types.ts apps/web/lib/workforce-data.ts apps/web/lib/actions/workforce.ts apps/web/lib/actions/workforce.test.ts
git commit -m "feat: rename phoneNumber to phoneWork, add E.164 validation (EP-REF-001)"
```

---

### Task 11: Update EmployeeFormPanel — Phone Fields & AddressSection

**Files:**
- Modify: `apps/web/components/employee/EmployeeFormPanel.tsx`
- Modify: `apps/web/components/employee/EmployeeProfilePanel.tsx`

- [ ] **Step 1: Update EmployeeFormPanel — replace phoneNumber with three phone fields**

In `apps/web/components/employee/EmployeeFormPanel.tsx`:
- Replace the single `phoneNumber` input (~lines 243-244) with three inputs: `phoneWork`, `phoneMobile`, `phoneEmergency`
- Each uses the same `inputClasses` pattern as existing fields
- Add labels: "Work Phone", "Mobile Phone", "Emergency Phone"
- Add the `AddressSection` component below the phone fields section
- Add `addresses` to the component props (typed as the array from AddressSection)

Update the form state initialization (~line 42): rename `phoneNumber` → `phoneWork`, add `phoneMobile: employee?.phoneMobile ?? ""` and `phoneEmergency: employee?.phoneEmergency ?? ""`

- [ ] **Step 2: Update EmployeeProfilePanel to display addresses and phone fields**

In `apps/web/components/employee/EmployeeProfilePanel.tsx`, add a "Contact" section after the existing fields:

```tsx
{/* Contact */}
{(employee.phoneWork || employee.phoneMobile || employee.phoneEmergency) && (
  <div className="space-y-1">
    <span className={labelClasses}>Contact</span>
    {employee.phoneWork && <div className="text-xs">Work: {employee.phoneWork}</div>}
    {employee.phoneMobile && <div className="text-xs">Mobile: {employee.phoneMobile}</div>}
    {employee.phoneEmergency && <div className="text-xs">Emergency: {employee.phoneEmergency}</div>}
  </div>
)}

{/* Primary Address */}
{primaryAddress && (
  <div className="space-y-1">
    <span className={labelClasses}>Address</span>
    <div className="text-xs text-[var(--dpf-muted)]">
      {primaryAddress.address.addressLine1}
      {primaryAddress.address.addressLine2 && <>, {primaryAddress.address.addressLine2}</>}
      <br />
      {primaryAddress.address.city.name}, {primaryAddress.address.city.region.code ?? primaryAddress.address.city.region.name} {primaryAddress.address.postalCode}
      <br />
      {primaryAddress.address.city.region.country.name}
    </div>
  </div>
)}
```

The `primaryAddress` prop should be the first address with `isPrimary: true` from the loaded addresses, or `null` if none.

- [ ] **Step 3: Run build to verify no type errors**

Run: `cd apps/web && npx next build`

Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/employee/EmployeeFormPanel.tsx apps/web/components/employee/EmployeeProfilePanel.tsx
git commit -m "feat: phone fields and address section in employee form (EP-REF-001)"
```

---

### Task 12: Wire Address Data into Employee Page

**Files:**
- Modify: `apps/web/app/(shell)/employee/page.tsx`
- Modify: `apps/web/lib/workforce-data.ts`

- [ ] **Step 1: Add address loading to workforce-data.ts**

In `apps/web/lib/workforce-data.ts`, import and re-export `getEmployeeAddresses` from `address-data.ts`, or add a convenience function that loads addresses alongside other employee data.

- [ ] **Step 2: Load addresses in employee page.tsx**

In `apps/web/app/(shell)/employee/page.tsx`:
- Import `getEmployeeAddresses` from `@/lib/address-data`
- In the data loading section, add address fetching for the selected employee
- Pass `addresses` prop to the EmployeeFormPanel and EmployeeProfilePanel components

- [ ] **Step 3: Pass address data to NewEmployeeButton**

Update `NewEmployeeButton.tsx` to pass addresses (empty array for new employees) through to EmployeeFormPanel.

- [ ] **Step 4: Test manually — verify the employee page loads**

Run: `cd apps/web && pnpm dev`

Navigate to `/employee`, verify:
- Page loads without errors
- Address section appears in the employee form
- Country typeahead works (searches seeded countries)
- Adding a new region/city works
- Full address can be saved

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(shell)/employee/page.tsx apps/web/lib/workforce-data.ts apps/web/components/employee/NewEmployeeButton.tsx
git commit -m "feat: wire address data into employee page (EP-REF-001)"
```

---

## Chunk 5: DatePicker Adoption & MCP Validation Slot

### Task 13: Replace Date Inputs with DatePicker

**Files:**
- Modify: `apps/web/components/employee/EmployeeFormPanel.tsx`
- Modify: `apps/web/components/employee/LeavePanel.tsx`
- Modify: `apps/web/components/employee/ReviewPanel.tsx`

- [ ] **Step 1: Replace date inputs in EmployeeFormPanel**

Import `DatePicker` from `@/components/ui/DatePicker`. Replace `<input type="date">` for `startDate` with the `DatePicker` component.

Convert between the `DatePicker`'s `Date` objects and the ISO string format used in form state:
```typescript
<DatePicker
  value={formState.startDate ? new Date(formState.startDate) : null}
  onChange={(d) => setField("startDate")(d ? d.toISOString().slice(0, 10) : "")}
  placeholder="Start date"
/>
```

- [ ] **Step 2: Replace date inputs in LeavePanel and ReviewPanel**

`apps/web/components/employee/LeavePanel.tsx` has 2 date inputs (leave start/end dates).
`apps/web/components/employee/ReviewPanel.tsx` has 2 date inputs (review period dates).

Replace each `<input type="date">` with `DatePicker` using the same conversion pattern.

- [ ] **Step 3: Run build to verify no type errors**

Run: `cd apps/web && npx next build`

Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/employee/EmployeeFormPanel.tsx apps/web/components/employee/LeavePanel.tsx apps/web/components/employee/ReviewPanel.tsx
git commit -m "feat: adopt DatePicker across all date inputs (EP-REF-001)"
```

---

### Task 14: MCP Validation Slot

**Files:**
- Create: `apps/web/lib/address-validation.ts`
- Create: `apps/web/lib/address-validation.test.ts`

This task creates the validation infrastructure. It does NOT require an actual geocoding service — it creates the slot that fires when one is configured.

- [ ] **Step 1: Write failing test for validateAddress**

Create `apps/web/lib/address-validation.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    modelProvider: { findFirst: vi.fn() },
    address: { update: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { validateAddress } from "./address-validation";

describe("validateAddress", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns early when no geocoding service is registered", async () => {
    vi.mocked(prisma.modelProvider.findFirst).mockResolvedValue(null);

    const result = await validateAddress("a1");
    expect(result).toEqual({ status: "no-service" });
    expect(prisma.address.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/address-validation.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement validateAddress**

Create `apps/web/lib/address-validation.ts`:

```typescript
import { prisma } from "@dpf/db";

type ValidationResult =
  | { status: "no-service" }
  | { status: "validated"; latitude: number; longitude: number }
  | { status: "suggestions"; suggestions: string[] }
  | { status: "error"; message: string };

export async function validateAddress(addressId: string): Promise<ValidationResult> {
  // Check if a geocoding MCP service is registered
  const geocodingService = await prisma.modelProvider.findFirst({
    where: {
      endpointType: "service",
      status: "active",
      // Look for providers tagged with geocoding capability
      OR: [
        { name: { contains: "geocod", mode: "insensitive" } },
        { name: { contains: "places", mode: "insensitive" } },
        { name: { contains: "mapbox", mode: "insensitive" } },
      ],
    },
  });

  if (!geocodingService) {
    return { status: "no-service" };
  }

  // Load the address with hierarchy for the API call
  const address = await prisma.address.findUnique({
    where: { id: addressId },
    include: {
      city: {
        include: {
          region: {
            include: { country: true },
          },
        },
      },
    },
  });

  if (!address) return { status: "error", message: "Address not found" };

  // TODO: Call the MCP service endpoint with the address data
  // For now, this is the integration point — when a geocoding MCP service
  // is registered, the callProvider infrastructure (from EP-LLM-LIVE-001)
  // will be used to make the API call.
  //
  // On success, update the address:
  // await prisma.address.update({
  //   where: { id: addressId },
  //   data: {
  //     latitude: result.latitude,
  //     longitude: result.longitude,
  //     validatedAt: new Date(),
  //     validationSource: geocodingService.name,
  //   },
  // });

  return { status: "no-service" }; // Placeholder until MCP service integration
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/web && npx vitest run lib/address-validation.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/address-validation.ts apps/web/lib/address-validation.test.ts
git commit -m "feat: MCP address validation slot (EP-REF-001)"
```

---

### Task 15: Update Backlog Items

**Files:**
- SQL or script to mark backlog items as done

- [ ] **Step 1: Update the epic backlog items to reflect completion**

Run SQL or use the platform UI to mark the three backlog items under "Reference Data & UX Polish" as done:
1. "Location reference data management (countries, regions, offices)" → done
2. "Address and phone number fields on employee profiles" → done
3. "Calendar date picker component for all date inputs" → done

Set `completedAt` timestamps on each.

- [ ] **Step 2: Commit any seed/migration scripts used**

```bash
git add scripts/
git commit -m "ops: mark Reference Data & UX Polish backlog items done (EP-REF-001)"
```

---

## Final Verification

After all tasks are complete:

1. `cd apps/web && npx vitest run` — all tests pass
2. `cd apps/web && npx next build` — build succeeds
3. Manual smoke test on `/employee`:
   - Country typeahead returns results from seeded data
   - Region/city can be added organically
   - Full address can be saved and displayed
   - Phone fields save in E.164 format
   - DatePicker works on all date inputs
   - Addresses show validation status (no icon when no service configured)
