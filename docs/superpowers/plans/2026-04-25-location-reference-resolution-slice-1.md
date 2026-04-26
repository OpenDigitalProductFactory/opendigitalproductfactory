# Location Reference Resolution Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the existing employee address cascade into a reusable resolver boundary and use it for HQ/work-location address entry so missing localities can be added through a governed UI path instead of direct data patches.

**Architecture:** This slice is UI/service-boundary only: it preserves the current `Country` -> `Region` -> `City` schema while introducing locality-language helpers and a shared `LocationCascadePicker`. Existing server actions stay compatible, but their duplicate/add behavior moves behind a focused `location-resolution` module that later slices can extend with metadata, audit, cache, and provider support.

**Tech Stack:** Next.js server actions, React client components, Prisma via `@dpf/db`, Vitest component/unit tests, existing `ReferenceTypeahead`, platform CSS variables.

---

## Scope Guard

This plan implements Slice 1 from `docs/superpowers/specs/2026-04-25-location-reference-resolution-design.md`.

It intentionally does not add schema fields, provider adapters, admin stewardship queue, prompt/skill updates, or `Address.postalCode` nullability. Those are separate implementation plans so each PR stays reviewable and independently revertible.

## File Structure

- Create `apps/web/lib/location-resolution/locality-enums.ts`
  - Canonical string values for locality UI/service code in Slice 1. Schema adoption comes in Slice 2.
- Create `apps/web/lib/location-resolution/normalize.ts`
  - Shared normalization used by duplicate checks and component tests.
- Create `apps/web/lib/location-resolution/service.ts`
  - Thin service boundary wrapping current reference-data Prisma queries and create flows.
- Create `apps/web/lib/location-resolution/service.test.ts`
  - Unit tests for scoped search, duplicate suggestions, normalized city creation, and force-create path.
- Create `apps/web/components/location/LocationCascadePicker.tsx`
  - Shared country/region/locality picker with add-new and duplicate suggestion UX.
- Create `apps/web/components/location/LocationCascadePicker.test.tsx`
  - Component tests for progressive reveal, parent clearing, add-new, duplicate suggestions, and theme-safe classes.
- Modify `apps/web/lib/actions/reference-data.ts`
  - Delegate current public server actions to `location-resolution/service.ts` while preserving exports used by existing components.
- Modify `apps/web/components/employee/AddressSection.tsx`
  - Replace duplicated country/region/city typeahead state with `LocationCascadePicker`.
- Modify `apps/web/components/admin/WorkLocationPanel.tsx`
  - Replace its bespoke country/region/city picker with `LocationCascadePicker`, including add-new locality behavior.
- Modify `apps/web/lib/actions/reference-data.test.ts`
  - Update tests to assert delegation-compatible behavior and `revalidatePath` coverage for both `/employee` and `/admin/reference-data`.

---

### Task 1: Add Normalization and Locality Enums

**Files:**
- Create: `apps/web/lib/location-resolution/locality-enums.ts`
- Create: `apps/web/lib/location-resolution/normalize.ts`
- Create: `apps/web/lib/location-resolution/service.test.ts`

- [ ] **Step 1: Create failing tests for normalization**

Add these tests at the top of `apps/web/lib/location-resolution/service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeLocalityName } from "./normalize";

describe("normalizeLocalityName", () => {
  it("normalizes case, diacritics, Unicode composition, and whitespace", () => {
    expect(normalizeLocalityName("  São   Tomé  ")).toBe("sao tome");
    expect(normalizeLocalityName("S\u0061\u0303o Tom\u00e9")).toBe("sao tome");
  });

  it("keeps meaningful punctuation inside names", () => {
    expect(normalizeLocalityName("Winston-Salem")).toBe("winston-salem");
    expect(normalizeLocalityName("St. John's")).toBe("st. john's");
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```powershell
pnpm --filter web vitest run apps/web/lib/location-resolution/service.test.ts
```

Expected: FAIL because `apps/web/lib/location-resolution/normalize.ts` does not exist.

- [ ] **Step 3: Implement canonical enums**

Create `apps/web/lib/location-resolution/locality-enums.ts`:

```ts
export const LOCALITY_STATUSES = ["active", "inactive", "needs-review"] as const;
export type LocalityStatus = (typeof LOCALITY_STATUSES)[number];

export const LOCALITY_SOURCES = ["seed", "user", "provider", "import"] as const;
export type LocalitySource = (typeof LOCALITY_SOURCES)[number];

export const LOCALITY_TYPES = [
  "city",
  "town",
  "village",
  "municipality",
  "suburb",
  "district",
  "hamlet",
  "postal-city",
  "unknown",
] as const;
export type LocalityType = (typeof LOCALITY_TYPES)[number];

export const PROVIDER_IDS = ["none", "nominatim", "google-places", "opencage", "census-tiger"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const DEFAULT_LOCALITY_STATUS: LocalityStatus = "active";
export const DEFAULT_LOCALITY_SOURCE: LocalitySource = "user";
export const DEFAULT_LOCALITY_TYPE: LocalityType = "town";
```

- [ ] **Step 4: Implement normalization**

Create `apps/web/lib/location-resolution/normalize.ts`:

```ts
export function normalizeLocalityName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function namesAreExactNormalizedMatch(left: string, right: string): boolean {
  return normalizeLocalityName(left) === normalizeLocalityName(right);
}
```

- [ ] **Step 5: Run the normalization tests**

Run:

```powershell
pnpm --filter web vitest run apps/web/lib/location-resolution/service.test.ts
```

Expected: PASS for `normalizeLocalityName` tests.

- [ ] **Step 6: Commit**

Run:

```powershell
git add apps/web/lib/location-resolution/locality-enums.ts apps/web/lib/location-resolution/normalize.ts apps/web/lib/location-resolution/service.test.ts
$branch = git branch --show-current
if ($branch -eq "main") { Write-Error "ERROR: on main - abort"; exit 1 }
git commit -s -m "feat(reference-data): add locality normalization helpers"
```

---

### Task 2: Introduce the Location Resolution Service Boundary

**Files:**
- Modify: `apps/web/lib/location-resolution/service.test.ts`
- Create: `apps/web/lib/location-resolution/service.ts`
- Modify: `apps/web/lib/actions/reference-data.ts`

- [ ] **Step 1: Replace the service test file with service-boundary tests**

Replace `apps/web/lib/location-resolution/service.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    country: { findMany: vi.fn() },
    region: { findMany: vi.fn(), create: vi.fn() },
    city: { findMany: vi.fn(), create: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { normalizeLocalityName } from "./normalize";
import {
  createLocality,
  forceCreateLocality,
  searchCountriesForLocation,
  searchLocalities,
  searchRegionsForLocation,
  suggestDuplicateLocalities,
} from "./service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("normalizeLocalityName", () => {
  it("normalizes case, diacritics, Unicode composition, and whitespace", () => {
    expect(normalizeLocalityName("  São   Tomé  ")).toBe("sao tome");
    expect(normalizeLocalityName("S\u0061\u0303o Tom\u00e9")).toBe("sao tome");
  });

  it("keeps meaningful punctuation inside names", () => {
    expect(normalizeLocalityName("Winston-Salem")).toBe("winston-salem");
    expect(normalizeLocalityName("St. John's")).toBe("st. john's");
  });
});

describe("searchCountriesForLocation", () => {
  it("searches active countries by name and ISO codes", async () => {
    const countries = [{ id: "country-us", name: "United States", iso2: "US", iso3: "USA", phoneCode: "+1" }];
    vi.mocked(prisma.country.findMany).mockResolvedValue(countries as never);

    await expect(searchCountriesForLocation("us")).resolves.toEqual(countries);
    expect(prisma.country.findMany).toHaveBeenCalledWith({
      where: {
        status: "active",
        OR: [
          { name: { contains: "us", mode: "insensitive" } },
          { iso2: { contains: "us", mode: "insensitive" } },
          { iso3: { contains: "us", mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, iso2: true, iso3: true, phoneCode: true },
      orderBy: { name: "asc" },
      take: 20,
    });
  });
});

describe("searchRegionsForLocation", () => {
  it("searches active regions scoped to country", async () => {
    const regions = [{ id: "region-tx", name: "Texas", code: "TX" }];
    vi.mocked(prisma.region.findMany).mockResolvedValue(regions as never);

    await expect(searchRegionsForLocation("country-us", "tex")).resolves.toEqual(regions);
    expect(prisma.region.findMany).toHaveBeenCalledWith({
      where: {
        countryId: "country-us",
        status: "active",
        OR: [
          { name: { contains: "tex", mode: "insensitive" } },
          { code: { contains: "tex", mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
      take: 20,
    });
  });
});

describe("searchLocalities", () => {
  it("searches active localities scoped to region", async () => {
    const localities = [{ id: "city-thorndale", name: "Thorndale" }];
    vi.mocked(prisma.city.findMany).mockResolvedValue(localities as never);

    await expect(searchLocalities("region-tx", "thor")).resolves.toEqual(localities);
    expect(prisma.city.findMany).toHaveBeenCalledWith({
      where: {
        regionId: "region-tx",
        status: "active",
        name: { contains: "thor", mode: "insensitive" },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 20,
    });
  });
});

describe("suggestDuplicateLocalities", () => {
  it("returns exact normalized matches before create", async () => {
    vi.mocked(prisma.city.findMany).mockResolvedValue([
      { id: "city-1", name: "Sao Tome" },
      { id: "city-2", name: "Thorndale" },
    ] as never);

    await expect(suggestDuplicateLocalities("region-1", "São Tomé")).resolves.toEqual([
      { id: "city-1", name: "Sao Tome" },
    ]);
  });
});

describe("createLocality", () => {
  it("returns suggestions when an exact normalized duplicate exists", async () => {
    vi.mocked(prisma.city.findMany).mockResolvedValue([{ id: "city-1", name: "Sao Tome" }] as never);

    const result = await createLocality({ regionId: "region-1", name: "São Tomé" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Similar localities");
    expect(result.suggestions).toEqual([{ id: "city-1", name: "Sao Tome" }]);
    expect(prisma.city.create).not.toHaveBeenCalled();
  });

  it("creates locality with current City table shape when no duplicate exists", async () => {
    vi.mocked(prisma.city.findMany).mockResolvedValue([]);
    vi.mocked(prisma.city.create).mockResolvedValue({ id: "city-new", name: "Thorndale" } as never);

    const result = await createLocality({ regionId: "region-tx", name: " Thorndale " });

    expect(result).toEqual({
      ok: true,
      message: 'Locality "Thorndale" created.',
      created: { id: "city-new", name: "Thorndale" },
    });
    expect(prisma.city.create).toHaveBeenCalledWith({
      data: {
        name: "Thorndale",
        regionId: "region-tx",
        status: "active",
      },
      select: { id: true, name: true },
    });
  });
});

describe("forceCreateLocality", () => {
  it("bypasses duplicate suggestions for steward-confirmed distinct localities", async () => {
    vi.mocked(prisma.city.create).mockResolvedValue({ id: "city-force", name: "Springfield" } as never);

    const result = await forceCreateLocality({ regionId: "region-1", name: "Springfield" });

    expect(result.ok).toBe(true);
    expect(prisma.city.findMany).not.toHaveBeenCalled();
    expect(prisma.city.create).toHaveBeenCalledWith({
      data: {
        name: "Springfield",
        regionId: "region-1",
        status: "active",
      },
      select: { id: true, name: true },
    });
  });
});
```

- [ ] **Step 2: Run the service tests and verify they fail**

Run:

```powershell
pnpm --filter web vitest run apps/web/lib/location-resolution/service.test.ts
```

Expected: FAIL because `service.ts` does not exist.

- [ ] **Step 3: Implement the service module**

Create `apps/web/lib/location-resolution/service.ts`:

```ts
import { prisma } from "@dpf/db";
import { normalizeLocalityName } from "./normalize";

export type LocationRefResult = {
  ok: boolean;
  message: string;
  created?: { id: string; name: string; code?: string | null };
  suggestions?: { id: string; name: string; code?: string | null }[];
};

export type CreateLocalityInput = {
  regionId: string;
  name: string;
};

export async function searchCountriesForLocation(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  return prisma.country.findMany({
    where: {
      status: "active",
      OR: [
        { name: { contains: trimmed, mode: "insensitive" } },
        { iso2: { contains: trimmed, mode: "insensitive" } },
        { iso3: { contains: trimmed, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, iso2: true, iso3: true, phoneCode: true },
    orderBy: { name: "asc" },
    take: 20,
  });
}

export async function searchRegionsForLocation(countryId: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  return prisma.region.findMany({
    where: {
      countryId,
      status: "active",
      OR: [
        { name: { contains: trimmed, mode: "insensitive" } },
        { code: { contains: trimmed, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
    take: 20,
  });
}

export async function searchLocalities(regionId: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  return prisma.city.findMany({
    where: {
      regionId,
      status: "active",
      name: { contains: trimmed, mode: "insensitive" },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 20,
  });
}

export async function suggestDuplicateLocalities(regionId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const normalized = normalizeLocalityName(trimmed);

  const candidates = await prisma.city.findMany({
    where: {
      regionId,
      status: "active",
      name: { contains: trimmed.slice(0, Math.min(trimmed.length, 6)), mode: "insensitive" },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 50,
  });

  return candidates.filter((candidate) => normalizeLocalityName(candidate.name) === normalized);
}

export async function createLocality(input: CreateLocalityInput): Promise<LocationRefResult> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    return { ok: false, message: "Locality name is required." };
  }

  const suggestions = await suggestDuplicateLocalities(input.regionId, trimmedName);
  if (suggestions.length > 0) {
    return {
      ok: false,
      message: "Similar localities already exist. Did you mean one of these?",
      suggestions,
    };
  }

  const created = await prisma.city.create({
    data: {
      name: trimmedName,
      regionId: input.regionId,
      status: "active",
    },
    select: { id: true, name: true },
  });

  return { ok: true, message: `Locality "${created.name}" created.`, created };
}

export async function forceCreateLocality(input: CreateLocalityInput): Promise<LocationRefResult> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    return { ok: false, message: "Locality name is required." };
  }

  const created = await prisma.city.create({
    data: {
      name: trimmedName,
      regionId: input.regionId,
      status: "active",
    },
    select: { id: true, name: true },
  });

  return { ok: true, message: `Locality "${created.name}" created.`, created };
}
```

- [ ] **Step 4: Update server actions to delegate to the service**

Modify `apps/web/lib/actions/reference-data.ts`:

```ts
import {
  createLocality,
  forceCreateLocality,
  searchCountriesForLocation,
  searchLocalities,
  searchRegionsForLocation,
} from "@/lib/location-resolution/service";
```

Replace the body of `searchCountries` with:

```ts
export async function searchCountries(query: string) {
  await requireAuth();
  return searchCountriesForLocation(query);
}
```

Replace the body of `searchRegions` with:

```ts
export async function searchRegions(countryId: string, query: string) {
  await requireAuth();
  return searchRegionsForLocation(countryId, query);
}
```

Replace the body of `searchCities` with:

```ts
export async function searchCities(regionId: string, query: string) {
  await requireAuth();
  return searchLocalities(regionId, query);
}
```

Replace only the implementation body of `createCity` with:

```ts
export async function createCity(
  regionId: string,
  name: string,
): Promise<CreateRefResult> {
  await requireAuth();
  const result = await createLocality({ regionId, name });
  revalidatePath("/employee");
  revalidatePath("/admin/reference-data");
  return result;
}
```

Replace only the implementation body of `forceCreateCity` with:

```ts
export async function forceCreateCity(
  regionId: string,
  name: string,
): Promise<CreateRefResult> {
  await requireAuth();
  const result = await forceCreateLocality({ regionId, name });
  revalidatePath("/employee");
  revalidatePath("/admin/reference-data");
  return result;
}
```

Keep `createRegion` and `forceCreateRegion` unchanged in this slice.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
pnpm --filter web vitest run apps/web/lib/location-resolution/service.test.ts apps/web/lib/actions/reference-data.test.ts
```

Expected: PASS. If `reference-data.test.ts` still expects only `/employee`, update those expectations to also require `/admin/reference-data` after city/locality creation.

- [ ] **Step 6: Commit**

Run:

```powershell
git add apps/web/lib/location-resolution/service.ts apps/web/lib/location-resolution/service.test.ts apps/web/lib/actions/reference-data.ts apps/web/lib/actions/reference-data.test.ts
$branch = git branch --show-current
if ($branch -eq "main") { Write-Error "ERROR: on main - abort"; exit 1 }
git commit -s -m "feat(reference-data): route locality actions through resolver service"
```

---

### Task 3: Build the Reusable LocationCascadePicker

**Files:**
- Create: `apps/web/components/location/LocationCascadePicker.tsx`
- Create: `apps/web/components/location/LocationCascadePicker.test.tsx`

- [ ] **Step 1: Write component tests**

Create `apps/web/components/location/LocationCascadePicker.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { LocationCascadePicker } from "./LocationCascadePicker";

function setup(overrides: Partial<ComponentProps<typeof LocationCascadePicker>> = {}) {
  const onChange = vi.fn();
  const onCreateRegion = vi.fn().mockResolvedValue({
    ok: true,
    created: { id: "region-new", name: "New Region", code: null },
  });
  const onCreateLocality = vi.fn().mockResolvedValue({
    ok: true,
    created: { id: "city-thorndale", name: "Thorndale" },
  });

  render(
    <LocationCascadePicker
      value={{ country: null, region: null, locality: null }}
      onChange={onChange}
      searchCountries={vi.fn().mockResolvedValue([{ id: "country-us", label: "United States (US)" }])}
      searchRegions={vi.fn().mockResolvedValue([{ id: "region-tx", label: "Texas (TX)" }])}
      searchLocalities={vi.fn().mockResolvedValue([])}
      onCreateRegion={onCreateRegion}
      onCreateLocality={onCreateLocality}
      {...overrides}
    />,
  );

  return { onChange, onCreateRegion, onCreateLocality };
}

describe("LocationCascadePicker", () => {
  it("disables region and locality until their parents are selected", () => {
    setup();

    expect(screen.getByLabelText("Country")).toBeEnabled();
    expect(screen.getByLabelText("Region")).toBeDisabled();
    expect(screen.getByLabelText("Locality")).toBeDisabled();
    expect(screen.getByText("Select a country first.")).toBeInTheDocument();
    expect(screen.getByText("Select a region first.")).toBeInTheDocument();
  });

  it("clears child selections when a parent changes", async () => {
    const onChange = vi.fn();
    render(
      <LocationCascadePicker
        value={{
          country: { id: "country-us", label: "United States (US)" },
          region: { id: "region-tx", label: "Texas (TX)" },
          locality: { id: "city-austin", label: "Austin" },
        }}
        onChange={onChange}
        searchCountries={vi.fn().mockResolvedValue([{ id: "country-ca", label: "Canada (CA)" }])}
        searchRegions={vi.fn().mockResolvedValue([])}
        searchLocalities={vi.fn().mockResolvedValue([])}
      />,
    );

    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "Canada" } });
    fireEvent.click(await screen.findByText("Canada (CA)"));

    expect(onChange).toHaveBeenCalledWith({
      country: { id: "country-ca", label: "Canada (CA)" },
      region: null,
      locality: null,
    });
  });

  it("offers add locality when a scoped search has no exact match", async () => {
    const { onCreateLocality } = setup({
      value: {
        country: { id: "country-us", label: "United States (US)" },
        region: { id: "region-tx", label: "Texas (TX)" },
        locality: null,
      },
    });

    fireEvent.change(screen.getByLabelText("Locality"), { target: { value: "Thorndale" } });

    const option = await screen.findByText('+ Add new locality: "Thorndale"');
    fireEvent.click(option);

    await waitFor(() => {
      expect(onCreateLocality).toHaveBeenCalledWith("Thorndale", "region-tx");
    });
  });

  it("shows duplicate suggestions before force creation", async () => {
    const onCreateLocality = vi.fn().mockResolvedValue({
      ok: false,
      message: "Similar localities already exist.",
      suggestions: [{ id: "city-sao", name: "Sao Tome" }],
    });
    setup({
      value: {
        country: { id: "country-st", label: "Sao Tome and Principe (ST)" },
        region: { id: "region-01", label: "Água Grande" },
        locality: null,
      },
      onCreateLocality,
    });

    fireEvent.change(screen.getByLabelText("Locality"), { target: { value: "São Tomé" } });
    fireEvent.click(await screen.findByText('+ Add new locality: "São Tomé"'));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Similar localities already exist.")).toBeInTheDocument();
    expect(within(alert).getByText("Sao Tome")).toBeInTheDocument();
  });

  it("uses platform theme classes", () => {
    const { container } = setup();
    expect(container.innerHTML).toContain("text-[var(--dpf-text)]");
    expect(container.innerHTML).toContain("bg-[var(--dpf-surface-2)]");
    expect(container.innerHTML).not.toContain("text-gray-");
    expect(container.innerHTML).not.toContain("bg-white");
  });
});
```

- [ ] **Step 2: Run component tests and verify failure**

Run:

```powershell
pnpm --filter web vitest run apps/web/components/location/LocationCascadePicker.test.tsx
```

Expected: FAIL because `LocationCascadePicker.tsx` does not exist.

- [ ] **Step 3: Implement LocationCascadePicker**

Create `apps/web/components/location/LocationCascadePicker.tsx`:

```tsx
"use client";

import { useCallback, useState, useTransition } from "react";
import { ReferenceTypeahead } from "@/components/ui/ReferenceTypeahead";
import type { CreateRefResult } from "@/lib/actions/reference-data";

export type RefItem = { id: string; label: string };

export type LocationSelection = {
  country: RefItem | null;
  region: RefItem | null;
  locality: RefItem | null;
};

type Suggestion = { id: string; name: string; code?: string | null };

type Props = {
  value: LocationSelection;
  onChange: (value: LocationSelection) => void;
  searchCountries: (query: string) => Promise<RefItem[]>;
  searchRegions: (countryId: string, query: string) => Promise<RefItem[]>;
  searchLocalities: (regionId: string, query: string) => Promise<RefItem[]>;
  onCreateRegion?: (name: string, countryId: string) => Promise<CreateRefResult>;
  onCreateLocality?: (name: string, regionId: string) => Promise<CreateRefResult>;
};

const labelCls = "block text-xs font-medium text-[var(--dpf-muted)] mb-1";
const helpCls = "mt-1 text-xs text-[var(--dpf-muted)]";

function suggestionLabel(item: Suggestion): string {
  return item.code ? `${item.name} (${item.code})` : item.name;
}

export function LocationCascadePicker({
  value,
  onChange,
  searchCountries,
  searchRegions,
  searchLocalities,
  onCreateRegion,
  onCreateLocality,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const setCountry = useCallback(
    (country: RefItem | null) => {
      setMessage(null);
      setSuggestions([]);
      onChange({ country, region: null, locality: null });
    },
    [onChange],
  );

  const setRegion = useCallback(
    (region: RefItem | null) => {
      setMessage(null);
      setSuggestions([]);
      onChange({ country: value.country, region, locality: null });
    },
    [onChange, value.country],
  );

  const setLocality = useCallback(
    (locality: RefItem | null) => {
      setMessage(null);
      setSuggestions([]);
      onChange({ country: value.country, region: value.region, locality });
    },
    [onChange, value.country, value.region],
  );

  const createRegion = useCallback(
    (name: string) => {
      if (!value.country || !onCreateRegion) return;
      startTransition(async () => {
        const result = await onCreateRegion(name, value.country!.id);
        if (result.ok && result.created) {
          setRegion({ id: result.created.id, label: suggestionLabel(result.created) });
        } else {
          setMessage(result.message);
          setSuggestions(result.suggestions ?? []);
        }
      });
    },
    [onCreateRegion, setRegion, value.country],
  );

  const createLocality = useCallback(
    (name: string) => {
      if (!value.region || !onCreateLocality) return;
      startTransition(async () => {
        const result = await onCreateLocality(name, value.region!.id);
        if (result.ok && result.created) {
          setLocality({ id: result.created.id, label: result.created.name });
        } else {
          setMessage(result.message);
          setSuggestions(result.suggestions ?? []);
        }
      });
    },
    [onCreateLocality, setLocality, value.region],
  );

  return (
    <div className="space-y-3 text-[var(--dpf-text)]">
      {message && (
        <div role="alert" className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs text-[var(--dpf-text)]">
          <p>{message}</p>
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {suggestions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setLocality({ id: item.id, label: suggestionLabel(item) })}
                  className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-xs text-[var(--dpf-text)] hover:text-[var(--dpf-accent)]"
                >
                  {suggestionLabel(item)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <label htmlFor="location-country" className={labelCls}>Country</label>
        <ReferenceTypeahead
          inputId="location-country"
          placeholder="Search countries..."
          onSearch={searchCountries}
          onSelect={setCountry}
          value={value.country}
        />
      </div>

      <div>
        <label htmlFor="location-region" className={labelCls}>Region</label>
        <ReferenceTypeahead
          inputId="location-region"
          placeholder="Search regions..."
          onSearch={(query) => (value.country ? searchRegions(value.country.id, query) : Promise.resolve([]))}
          onSelect={setRegion}
          onAddNew={value.country && onCreateRegion ? createRegion : undefined}
          addNewLabel="Add new region"
          value={value.region}
          disabled={!value.country || isPending}
        />
        {!value.country && <p className={helpCls}>Select a country first.</p>}
      </div>

      <div>
        <label htmlFor="location-locality" className={labelCls}>Locality</label>
        <ReferenceTypeahead
          inputId="location-locality"
          placeholder="Search towns, cities, or localities..."
          onSearch={(query) => (value.region ? searchLocalities(value.region.id, query) : Promise.resolve([]))}
          onSelect={setLocality}
          onAddNew={value.region && onCreateLocality ? createLocality : undefined}
          addNewLabel="Add new locality"
          value={value.locality}
          disabled={!value.region || isPending}
        />
        {!value.region && <p className={helpCls}>Select a region first.</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add inputId support to ReferenceTypeahead**

Modify `apps/web/components/ui/ReferenceTypeahead.tsx`:

Add the prop:

```ts
  inputId?: string;
```

Destructure it:

```ts
  inputId,
```

Add it to the `<input>`:

```tsx
        id={inputId}
```

- [ ] **Step 5: Run component tests**

Run:

```powershell
pnpm --filter web vitest run apps/web/components/location/LocationCascadePicker.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add apps/web/components/location/LocationCascadePicker.tsx apps/web/components/location/LocationCascadePicker.test.tsx apps/web/components/ui/ReferenceTypeahead.tsx
$branch = git branch --show-current
if ($branch -eq "main") { Write-Error "ERROR: on main - abort"; exit 1 }
git commit -s -m "feat(reference-data): add shared location cascade picker"
```

---

### Task 4: Refactor Employee AddressSection to Use the Shared Picker

**Files:**
- Modify: `apps/web/components/employee/AddressSection.tsx`
- Test: existing focused component tests if present; otherwise run typecheck plus action tests.

- [ ] **Step 1: Update imports**

In `apps/web/components/employee/AddressSection.tsx`, replace the `ReferenceTypeahead` import with:

```ts
import { LocationCascadePicker, type LocationSelection } from "@/components/location/LocationCascadePicker";
```

Keep existing server-action imports for `searchCountries`, `searchRegions`, `searchCities`, `createRegion`, `createCity`, `forceCreateRegion`, and `forceCreateCity`.

- [ ] **Step 2: Replace separate location state with a single selection**

Replace:

```ts
  const [country, setCountry] = useState<RefItem | null>(null);
  const [region, setRegion] = useState<RefItem | null>(null);
  const [city, setCity] = useState<RefItem | null>(null);
```

with:

```ts
  const [locationSelection, setLocationSelection] = useState<LocationSelection>({
    country: null,
    region: null,
    locality: null,
  });
  const country = locationSelection.country;
  const region = locationSelection.region;
  const city = locationSelection.locality;
```

- [ ] **Step 3: Replace country/region/city JSX with LocationCascadePicker**

Replace the three `<ReferenceTypeahead>` blocks under Country, Region, and City with:

```tsx
          <LocationCascadePicker
            value={locationSelection}
            onChange={setLocationSelection}
            searchCountries={searchCountryAdapter}
            searchRegions={async (countryId, query) => {
              const results = await searchRegions(countryId, query);
              return results.map((r) => ({
                id: r.id,
                label: r.code ? `${r.name} (${r.code})` : r.name,
              }));
            }}
            searchLocalities={async (regionId, query) => {
              const results = await searchCities(regionId, query);
              return results.map((c) => ({ id: c.id, label: c.name }));
            }}
            onCreateRegion={async (name, countryId) => createRegion(countryId, name, undefined)}
            onCreateLocality={async (name, regionId) => createCity(regionId, name)}
          />
```

If the old `handleAddNewRegion`, `handleAddNewCity`, `handlePickSuggestion`, and `handleForceCreate` blocks are no longer referenced, delete them and the duplicate-specific state they served. Do not delete server-side `forceCreate*` exports in this slice because existing tests and admin tools still use them.

- [ ] **Step 4: Update reset logic**

Where the component currently sets `setCountry(null)`, `setRegion(null)`, or `setCity(null)` during reset, replace with:

```ts
    setLocationSelection({ country: null, region: null, locality: null });
```

- [ ] **Step 5: Run focused checks**

Run:

```powershell
pnpm --filter web vitest run apps/web/lib/actions/address.test.ts apps/web/lib/actions/reference-data.test.ts
pnpm --filter web typecheck
```

Expected: PASS. If typecheck reports stale `setCountry`, `setRegion`, or `setCity` references, remove those references rather than reintroducing duplicate picker state.

- [ ] **Step 6: Commit**

Run:

```powershell
git add apps/web/components/employee/AddressSection.tsx
$branch = git branch --show-current
if ($branch -eq "main") { Write-Error "ERROR: on main - abort"; exit 1 }
git commit -s -m "refactor(employee): reuse location cascade picker"
```

---

### Task 5: Refactor WorkLocationPanel to Use the Shared Picker and Add Missing Localities

**Files:**
- Modify: `apps/web/components/admin/WorkLocationPanel.tsx`
- Modify: `apps/web/lib/actions/reference-data-admin.test.ts` if postal/locality labels affect expected messages.

- [ ] **Step 1: Update imports**

In `apps/web/components/admin/WorkLocationPanel.tsx`, replace the `ReferenceTypeahead` import with:

```ts
import { LocationCascadePicker, type LocationSelection } from "@/components/location/LocationCascadePicker";
```

Extend the reference-data imports:

```ts
  createRegion,
  createCity,
```

- [ ] **Step 2: Replace separate location state**

Replace:

```ts
  const [country, setCountry] = useState<RefItem | null>(null);
  const [region, setRegion] = useState<RefItem | null>(null);
  const [city, setCity] = useState<RefItem | null>(null);
```

with:

```ts
  const [locationSelection, setLocationSelection] = useState<LocationSelection>({
    country: null,
    region: null,
    locality: null,
  });
  const country = locationSelection.country;
  const region = locationSelection.region;
  const city = locationSelection.locality;
```

- [ ] **Step 3: Replace the Country/Region/City JSX**

Replace the three `<ReferenceTypeahead>` blocks with:

```tsx
                  <LocationCascadePicker
                    value={locationSelection}
                    onChange={setLocationSelection}
                    searchCountries={searchCountryAdapter}
                    searchRegions={async (countryId, query) => {
                      const results = await searchRegions(countryId, query);
                      return results.map((r) => ({
                        id: r.id,
                        label: r.code ? `${r.name} (${r.code})` : r.name,
                      }));
                    }}
                    searchLocalities={async (regionId, query) => {
                      const results = await searchCities(regionId, query);
                      return results.map((c) => ({ id: c.id, label: c.name }));
                    }}
                    onCreateRegion={async (name, countryId) => createRegion(countryId, name, undefined)}
                    onCreateLocality={async (name, regionId) => createCity(regionId, name)}
                  />
```

- [ ] **Step 4: Update reset logic**

Replace reset calls to `setCountry(null)`, `setRegion(null)`, and `setCity(null)` with:

```ts
    setLocationSelection({ country: null, region: null, locality: null });
```

- [ ] **Step 5: Update validation copy**

In `handleLink`, replace:

```ts
      setError("Please select a city.");
```

with:

```ts
      setError("Please select a locality.");
```

Keep the server action payload field as `cityId: city.id` until Slice 2 renames the schema boundary.

- [ ] **Step 6: Run focused checks**

Run:

```powershell
pnpm --filter web vitest run apps/web/lib/actions/reference-data.test.ts apps/web/lib/actions/reference-data-admin.test.ts
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git add apps/web/components/admin/WorkLocationPanel.tsx apps/web/lib/actions/reference-data-admin.test.ts
$branch = git branch --show-current
if ($branch -eq "main") { Write-Error "ERROR: on main - abort"; exit 1 }
git commit -s -m "feat(admin): reuse locality resolver for work locations"
```

---

### Task 6: Add Platform QA Coverage Notes

**Files:**
- Modify: `tests/e2e/platform-qa-plan.md`

- [ ] **Step 1: Find the Admin/Reference Data phase**

Run:

```powershell
Select-String -Path tests\e2e\platform-qa-plan.md -Pattern "Reference Data","Admin","Work Location","Employee" -Context 2,4
```

Expected: identify the closest existing phase for admin reference-data and employee/work-location address coverage.

- [ ] **Step 2: Add the QA case**

Add this case to the closest matching phase:

```md
#### REF-LOCALITY-01 — Missing locality can be added through governed cascade

**UI path:** Admin → Configuration → Reference Data → Work Locations → Headquarters.

**Steps:**
1. Select `United States (US)` in Country.
2. Select `Texas (TX)` in Region.
3. Search for `Thorndale` in Locality.
4. When no exact result exists, choose `Add new locality: "Thorndale"`.
5. Complete the HQ address form and save.

**Expected:** The locality is created through the cascade picker, the HQ address links to that locality, and no direct database insert or seed edit is required.

**Incomplete information test:** Try saving with Country selected but no Region/Locality. The form must ask for the missing lower-level location instead of guessing or creating a freeform value.
```

- [ ] **Step 3: Commit**

Run:

```powershell
git add tests/e2e/platform-qa-plan.md
$branch = git branch --show-current
if ($branch -eq "main") { Write-Error "ERROR: on main - abort"; exit 1 }
git commit -s -m "test(qa): cover governed locality creation"
```

---

### Task 7: Final Verification for Slice 1

**Files:**
- No new files unless verification reveals a defect.

- [ ] **Step 1: Run focused unit/component tests**

Run:

```powershell
pnpm --filter web vitest run apps/web/lib/location-resolution/service.test.ts apps/web/components/location/LocationCascadePicker.test.tsx apps/web/lib/actions/reference-data.test.ts apps/web/lib/actions/reference-data-admin.test.ts apps/web/lib/actions/address.test.ts
```

Expected: all listed test files PASS.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```powershell
cd apps/web
npx next build
```

Expected: PASS. If Windows/Turbopack reports stale `.next/static/*.tmp` `ENOENT`, verify no real type or import error is present, clear stale `.next` artifacts if needed, and rerun once before classifying it as an environment blocker.

- [ ] **Step 4: Run UX verification against Docker runtime**

Use the repo-preferred production runtime:

```powershell
docker compose build --no-cache portal portal-init sandbox
docker compose up -d portal-init sandbox
docker compose up -d portal
```

Then in the browser at `http://localhost:3000`:

1. Log in as `admin@dpf.local` using `ADMIN_PASSWORD` from root `.env`.
2. Open Admin → Configuration → Reference Data.
3. Expand Work Locations → Headquarters.
4. Select United States, Texas, search Thorndale, and add it through the locality flow.
5. Save the HQ address.
6. Refresh and verify the address remains linked.

Expected: user can add the missing locality through the UI and complete HQ address entry without direct DB insertion.

- [ ] **Step 5: Final status**

Run:

```powershell
git status --short --branch
```

Expected: only pre-existing unrelated untracked `.githooks/*` files remain, or no changes remain after committing verification fixes.

---

## Follow-On Plans

After Slice 1 is merged, create separate plans for:

1. Slice 2: Locality metadata migration, `Country.usesPostalCode`, nullable `Address.postalCode`, canonical enum parity, `pg_trgm`, and provider cache stub.
2. Slice 3: Admin scoped locality management and stewardship queue with `ComplianceAuditLog`.
3. Slice 4: Provider-assisted resolution, starting with no-provider plus Nominatim adapter if accepted.
4. Slice 5: Customer-site adoption and duplicate-site prevention.
5. Slice 6: Build Studio reference-data stewardship skill and prompt guardrail.
