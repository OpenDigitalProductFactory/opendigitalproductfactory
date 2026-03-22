# Unified Hours of Operation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated "Operating Hours" step to the onboarding flow that captures business hours once and feeds both the change management system (BusinessProfile/DeploymentWindow) and storefront booking system (ProviderAvailability).

**Architecture:** New `saveOperatingHours` server action is the central hub — accepts a `WeeklySchedule`, upserts `BusinessProfile`, derives low-traffic windows, replaces seed deployment windows with hours-derived windows, and optionally seeds `ProviderAvailability`. A reusable `OperatingHoursEditor` React component provides the UI for both onboarding and admin settings.

**Tech Stack:** Prisma (migration + actions), Next.js server actions, Vitest (testing), React + Tailwind (UI)

**Spec:** `docs/superpowers/specs/2026-03-22-unified-hours-of-operation-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/lib/actions/operating-hours.ts` | Server actions: `getOperatingHours`, `saveOperatingHours`, `getDefaultHoursForArchetype` |
| `apps/web/lib/actions/operating-hours.test.ts` | Tests for all operating hours server actions |
| `apps/web/components/admin/OperatingHoursEditor.tsx` | Reusable weekly schedule editor (day toggles + time pickers) |
| `apps/web/app/(shell)/admin/operating-hours/page.tsx` | Setup step page wrapping the editor |
| `apps/web/app/api/v1/admin/operating-hours/route.ts` | GET/PUT API for programmatic access |

### Modified Files

| File | Changes |
|------|---------|
| `packages/db/prisma/schema.prisma` | Add `hoursConfirmedAt DateTime?` to `BusinessProfile` |
| `apps/web/lib/actions/setup-constants.ts` | Add `"operating-hours"` step, route, label |
| `apps/web/app/api/storefront/admin/setup/route.ts:101-115` | Check BusinessProfile hours before falling back to archetype defaults |
| `apps/web/lib/onboarding-prompt.ts` | Add COO guidance text for operating-hours step |

---

## Task 1: Schema — Add hoursConfirmedAt to BusinessProfile

**Files:**
- Modify: `packages/db/prisma/schema.prisma:611-625`

- [ ] **Step 1: Add hoursConfirmedAt field to BusinessProfile**

In `packages/db/prisma/schema.prisma`, add `hoursConfirmedAt` to the `BusinessProfile` model after `lowTrafficWindows`:

```prisma
model BusinessProfile {
  id                String             @id @default(cuid())
  profileKey        String             @unique
  name              String
  description       String?
  isActive          Boolean            @default(true)
  businessHours     Json
  timezone          String             @default("UTC")
  hasStorefront     Boolean            @default(false)
  lowTrafficWindows Json?
  hoursConfirmedAt  DateTime?
  deploymentWindows DeploymentWindow[]
  blackoutPeriods   BlackoutPeriod[]
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt
}
```

- [ ] **Step 2: Create migration**

Run:
```bash
pnpm --filter @dpf/db exec prisma migrate dev --name add-hours-confirmed-at
```

Expected: Migration created, applied, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(schema): add hoursConfirmedAt to BusinessProfile for operating hours tracking"
```

---

## Task 2: Server Actions — Operating Hours Core Logic

**Files:**
- Create: `apps/web/lib/actions/operating-hours.ts`
- Create: `apps/web/lib/actions/operating-hours.test.ts`

- [ ] **Step 1: Write failing tests for getOperatingHours**

Create `apps/web/lib/actions/operating-hours.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    businessProfile: {
      findFirst: vi.fn(),
    },
    storefrontConfig: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// Helper: create fresh transaction mocks for saveOperatingHours tests.
// The saveOperatingHours action uses prisma.$transaction(async (tx) => { ... })
// so we mock $transaction to call through to a local txMocks object.
function makeTxMocks() {
  return {
    businessProfile: { upsert: vi.fn().mockResolvedValue({ id: "bp-1" }) },
    deploymentWindow: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    serviceProvider: { findFirst: vi.fn().mockResolvedValue(null) },
    providerAvailability: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import {
  getOperatingHours,
  saveOperatingHours,
  getDefaultHoursForArchetype,
  GENERIC_DEFAULTS,
  type WeeklySchedule,
} from "./operating-hours";

const mockSession = {
  user: { id: "user-1", email: "admin@test.com", platformRole: "HR-000", isSuperuser: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue(mockSession as never);
  vi.mocked(can).mockReturnValue(true);
});

describe("getOperatingHours", () => {
  it("returns existing confirmed hours from BusinessProfile", async () => {
    vi.mocked(prisma.businessProfile.findFirst).mockResolvedValue({
      businessHours: {
        monday: { open: "09:00", close: "17:00" },
        tuesday: { open: "09:00", close: "17:00" },
        wednesday: { open: "09:00", close: "17:00" },
        thursday: { open: "09:00", close: "17:00" },
        friday: { open: "09:00", close: "17:00" },
        saturday: null,
        sunday: null,
      },
      timezone: "Europe/London",
      hoursConfirmedAt: new Date(),
    } as never);

    const result = await getOperatingHours();
    expect(result.schedule.monday.enabled).toBe(true);
    expect(result.schedule.monday.open).toBe("09:00");
    expect(result.schedule.saturday.enabled).toBe(false);
    expect(result.timezone).toBe("Europe/London");
    expect(result.isConfirmed).toBe(true);
  });

  it("returns generic defaults when no profile exists", async () => {
    vi.mocked(prisma.businessProfile.findFirst).mockResolvedValue(null as never);

    const result = await getOperatingHours();
    expect(result.schedule.monday.enabled).toBe(true);
    expect(result.schedule.monday.open).toBe("09:00");
    expect(result.schedule.monday.close).toBe("17:00");
    expect(result.schedule.saturday.enabled).toBe(false);
    expect(result.isConfirmed).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/lib/actions/operating-hours.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write getOperatingHours implementation**

Create `apps/web/lib/actions/operating-hours.ts`:

```typescript
"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

// ─── Types ───────────────────────────────────────────────────────────────────

export type DaySchedule = {
  enabled: boolean;
  open: string;  // "HH:mm"
  close: string; // "HH:mm"
};

export type WeeklySchedule = {
  monday: DaySchedule;
  tuesday: DaySchedule;
  wednesday: DaySchedule;
  thursday: DaySchedule;
  friday: DaySchedule;
  saturday: DaySchedule;
  sunday: DaySchedule;
};

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
type DayName = (typeof DAY_NAMES)[number];

const CLOSED_DAY: DaySchedule = { enabled: false, open: "09:00", close: "17:00" };

export const GENERIC_DEFAULTS: WeeklySchedule = {
  monday:    { enabled: true, open: "09:00", close: "17:00" },
  tuesday:   { enabled: true, open: "09:00", close: "17:00" },
  wednesday: { enabled: true, open: "09:00", close: "17:00" },
  thursday:  { enabled: true, open: "09:00", close: "17:00" },
  friday:    { enabled: true, open: "09:00", close: "17:00" },
  saturday:  { enabled: false, open: "09:00", close: "17:00" },
  sunday:    { enabled: false, open: "09:00", close: "17:00" },
};

// ─── Auth Guard ──────────────────────────────────────────────────────────────

async function requireAccess(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user) throw new Error("Unauthorized");
  // Any authenticated user can view/set operating hours during setup
  return user.id!;
}

// ─── Helpers: BusinessProfile JSON <-> WeeklySchedule ────────────────────────

function profileHoursToSchedule(
  businessHours: Record<string, { open: string; close: string } | null>
): WeeklySchedule {
  const schedule = { ...GENERIC_DEFAULTS };
  for (const day of DAY_NAMES) {
    const hours = businessHours[day];
    if (hours) {
      schedule[day] = { enabled: true, open: hours.open, close: hours.close };
    } else {
      schedule[day] = { ...CLOSED_DAY };
    }
  }
  return schedule;
}

function scheduleToProfileHours(
  schedule: WeeklySchedule
): Record<string, { open: string; close: string } | null> {
  const hours: Record<string, { open: string; close: string } | null> = {};
  for (const day of DAY_NAMES) {
    const d = schedule[day];
    hours[day] = d.enabled ? { open: d.open, close: d.close } : null;
  }
  return hours;
}

// ─── Helpers: Low-traffic windows derivation ──────────────────────────────

function deriveLowTrafficWindows(
  schedule: WeeklySchedule
): Array<{ dayOfWeek: number; start: string; end: string }> {
  const windows: Array<{ dayOfWeek: number; start: string; end: string }> = [];

  for (let i = 0; i < DAY_NAMES.length; i++) {
    const day = DAY_NAMES[i];
    const d = schedule[day];

    if (!d.enabled) {
      // Closed day — entire day is low traffic
      windows.push({ dayOfWeek: i, start: "00:00", end: "23:59" });
    } else {
      // Before open
      if (d.open !== "00:00") {
        windows.push({ dayOfWeek: i, start: "00:00", end: d.open });
      }
      // After close
      if (d.close !== "23:59") {
        windows.push({ dayOfWeek: i, start: d.close, end: "23:59" });
      }
    }
  }
  return windows;
}

// ─── Helpers: Deployment windows from schedule ───────────────────────────

type DeploymentWindowData = {
  businessProfileId: string;
  windowKey: string;
  name: string;
  description: string;
  dayOfWeek: number[];
  startTime: string;
  endTime: string;
  maxConcurrentChanges: number;
  allowedChangeTypes: string[];
  allowedRiskLevels: string[];
  enforcement: string;
};

function deriveDeploymentWindows(
  schedule: WeeklySchedule,
  profileId: string
): DeploymentWindowData[] {
  const defaults = {
    maxConcurrentChanges: 1,
    allowedChangeTypes: ["standard", "normal"],
    allowedRiskLevels: ["low", "medium"],
    enforcement: "advisory",
  };

  // Group open days by identical close/open times (their off-hours pattern)
  const overnightGroups = new Map<string, number[]>();
  const allDayDays: number[] = [];

  for (let i = 0; i < DAY_NAMES.length; i++) {
    const day = DAY_NAMES[i];
    const d = schedule[day];
    if (!d.enabled) {
      allDayDays.push(i);
    } else {
      const key = `${d.close}-${d.open}`;
      if (!overnightGroups.has(key)) overnightGroups.set(key, []);
      overnightGroups.get(key)!.push(i);
    }
  }

  const windows: DeploymentWindowData[] = [];
  let idx = 0;

  for (const [key, days] of overnightGroups) {
    const [startTime, endTime] = key.split("-");
    const suffix = idx === 0 ? "business-days" : `business-days-${idx}`;
    windows.push({
      businessProfileId: profileId,
      windowKey: `off-hours-${suffix}`,
      name: `Off-Hours (Business Days${idx > 0 ? ` #${idx + 1}` : ""})`,
      description: "Automatically derived from operating hours — outside business hours on open days",
      dayOfWeek: days,
      startTime: startTime ?? "17:00",
      endTime: endTime ?? "09:00",
      ...defaults,
    });
    idx++;
  }

  if (allDayDays.length > 0) {
    windows.push({
      businessProfileId: profileId,
      windowKey: "off-hours-closed-days",
      name: "Off-Hours (Closed Days)",
      description: "Automatically derived from operating hours — all day on closed days",
      dayOfWeek: allDayDays,
      startTime: "00:00",
      endTime: "23:59",
      ...defaults,
      allowedChangeTypes: ["standard", "normal", "emergency"],
      allowedRiskLevels: ["low", "medium", "high", "critical"],
    });
  }

  return windows;
}

// ─── getOperatingHours ───────────────────────────────────────────────────

export async function getOperatingHours(): Promise<{
  schedule: WeeklySchedule;
  timezone: string;
  isConfirmed: boolean;
}> {
  await requireAccess();

  const profile = await prisma.businessProfile.findFirst({
    where: { isActive: true },
    select: { businessHours: true, timezone: true, hoursConfirmedAt: true },
  });

  // Priority 1: Existing confirmed hours
  if (profile?.hoursConfirmedAt) {
    const businessHours = profile.businessHours as Record<string, { open: string; close: string } | null>;
    return {
      schedule: profileHoursToSchedule(businessHours),
      timezone: profile.timezone,
      isConfirmed: true,
    };
  }

  // Priority 2/3: Smart defaults from archetype/industry
  const config = await prisma.storefrontConfig.findFirst({
    select: { archetypeId: true },
  });
  if (config?.archetypeId) {
    const category = config.archetypeId.split("/")[0];
    return {
      schedule: getDefaultHoursForArchetype(category),
      timezone: profile?.timezone ?? "UTC",
      isConfirmed: false,
    };
  }

  // Priority 4: Generic fallback
  return {
    schedule: { ...GENERIC_DEFAULTS },
    timezone: profile?.timezone ?? "UTC",
    isConfirmed: false,
  };
}

// ─── getDefaultHoursForArchetype ──────────────────────────────────────────

const INDUSTRY_DEFAULTS: Record<string, WeeklySchedule> = {
  "healthcare-wellness": {
    monday:    { enabled: true, open: "08:00", close: "17:00" },
    tuesday:   { enabled: true, open: "08:00", close: "17:00" },
    wednesday: { enabled: true, open: "08:00", close: "17:00" },
    thursday:  { enabled: true, open: "08:00", close: "17:00" },
    friday:    { enabled: true, open: "08:00", close: "17:00" },
    saturday:  { enabled: false, open: "09:00", close: "13:00" },
    sunday:    { enabled: false, open: "09:00", close: "17:00" },
  },
  "beauty-personal-care": {
    monday:    { enabled: true, open: "09:00", close: "18:00" },
    tuesday:   { enabled: true, open: "09:00", close: "18:00" },
    wednesday: { enabled: true, open: "09:00", close: "18:00" },
    thursday:  { enabled: true, open: "09:00", close: "18:00" },
    friday:    { enabled: true, open: "09:00", close: "18:00" },
    saturday:  { enabled: true, open: "09:00", close: "17:00" },
    sunday:    { enabled: false, open: "09:00", close: "17:00" },
  },
  "retail-goods": {
    monday:    { enabled: true, open: "09:00", close: "18:00" },
    tuesday:   { enabled: true, open: "09:00", close: "18:00" },
    wednesday: { enabled: true, open: "09:00", close: "18:00" },
    thursday:  { enabled: true, open: "09:00", close: "18:00" },
    friday:    { enabled: true, open: "09:00", close: "18:00" },
    saturday:  { enabled: true, open: "09:00", close: "18:00" },
    sunday:    { enabled: true, open: "10:00", close: "16:00" },
  },
  "food-hospitality": {
    monday:    { enabled: true, open: "09:00", close: "18:00" },
    tuesday:   { enabled: true, open: "09:00", close: "18:00" },
    wednesday: { enabled: true, open: "09:00", close: "18:00" },
    thursday:  { enabled: true, open: "09:00", close: "18:00" },
    friday:    { enabled: true, open: "09:00", close: "18:00" },
    saturday:  { enabled: true, open: "09:00", close: "18:00" },
    sunday:    { enabled: true, open: "10:00", close: "16:00" },
  },
  "professional-services": { ...GENERIC_DEFAULTS },
  "trades-maintenance": {
    monday:    { enabled: true, open: "07:00", close: "16:00" },
    tuesday:   { enabled: true, open: "07:00", close: "16:00" },
    wednesday: { enabled: true, open: "07:00", close: "16:00" },
    thursday:  { enabled: true, open: "07:00", close: "16:00" },
    friday:    { enabled: true, open: "07:00", close: "16:00" },
    saturday:  { enabled: false, open: "07:00", close: "16:00" },
    sunday:    { enabled: false, open: "07:00", close: "16:00" },
  },
  "fitness-recreation": {
    monday:    { enabled: true, open: "06:00", close: "21:00" },
    tuesday:   { enabled: true, open: "06:00", close: "21:00" },
    wednesday: { enabled: true, open: "06:00", close: "21:00" },
    thursday:  { enabled: true, open: "06:00", close: "21:00" },
    friday:    { enabled: true, open: "06:00", close: "21:00" },
    saturday:  { enabled: true, open: "08:00", close: "18:00" },
    sunday:    { enabled: true, open: "08:00", close: "18:00" },
  },
  "education-training": {
    monday:    { enabled: true, open: "08:30", close: "17:00" },
    tuesday:   { enabled: true, open: "08:30", close: "17:00" },
    wednesday: { enabled: true, open: "08:30", close: "17:00" },
    thursday:  { enabled: true, open: "08:30", close: "17:00" },
    friday:    { enabled: true, open: "08:30", close: "17:00" },
    saturday:  { enabled: false, open: "08:30", close: "17:00" },
    sunday:    { enabled: false, open: "08:30", close: "17:00" },
  },
  "pet-services": {
    monday:    { enabled: true, open: "08:00", close: "18:00" },
    tuesday:   { enabled: true, open: "08:00", close: "18:00" },
    wednesday: { enabled: true, open: "08:00", close: "18:00" },
    thursday:  { enabled: true, open: "08:00", close: "18:00" },
    friday:    { enabled: true, open: "08:00", close: "18:00" },
    saturday:  { enabled: true, open: "09:00", close: "14:00" },
    sunday:    { enabled: false, open: "09:00", close: "14:00" },
  },
};

export function getDefaultHoursForArchetype(
  archetypeCategory?: string | null
): WeeklySchedule {
  if (archetypeCategory && INDUSTRY_DEFAULTS[archetypeCategory]) {
    return { ...INDUSTRY_DEFAULTS[archetypeCategory] };
  }
  return { ...GENERIC_DEFAULTS };
}

// ─── saveOperatingHours ──────────────────────────────────────────────────

export async function saveOperatingHours(input: {
  schedule: WeeklySchedule;
  timezone?: string;
  hasStorefront?: boolean;
}): Promise<void> {
  await requireAccess();

  const { schedule, timezone, hasStorefront } = input;

  // Validate: at least one day enabled
  const anyEnabled = DAY_NAMES.some((day) => schedule[day].enabled);
  if (!anyEnabled) throw new Error("At least one day must be enabled");

  // Validate: end after start for enabled days
  for (const day of DAY_NAMES) {
    const d = schedule[day];
    if (d.enabled && d.close <= d.open) {
      throw new Error(`${day}: closing time must be after opening time`);
    }
  }

  const businessHours = scheduleToProfileHours(schedule);
  const lowTrafficWindows = deriveLowTrafficWindows(schedule);

  await prisma.$transaction(async (tx) => {
    // 1. Upsert BusinessProfile
    const profile = await tx.businessProfile.upsert({
      where: { profileKey: "default" },
      create: {
        profileKey: "default",
        name: "Default Business Profile",
        isActive: true,
        businessHours: businessHours as never,
        timezone: timezone ?? "UTC",
        hasStorefront: hasStorefront ?? false,
        lowTrafficWindows: lowTrafficWindows as never,
        hoursConfirmedAt: new Date(),
      },
      update: {
        businessHours: businessHours as never,
        ...(timezone ? { timezone } : {}),
        ...(hasStorefront !== undefined ? { hasStorefront } : {}),
        lowTrafficWindows: lowTrafficWindows as never,
        hoursConfirmedAt: new Date(),
      },
    });

    // 2. Replace seed/derived deployment windows
    // Delete windows with off-hours-* prefix OR the old seed keys
    await tx.deploymentWindow.deleteMany({
      where: {
        businessProfileId: profile.id,
        OR: [
          { windowKey: { startsWith: "off-hours-" } },
          { windowKey: { in: ["weeknight-maintenance", "weekend-maintenance"] } },
        ],
      },
    });

    // Create new windows derived from hours
    const newWindows = deriveDeploymentWindows(schedule, profile.id);
    if (newWindows.length > 0) {
      await tx.deploymentWindow.createMany({ data: newWindows });
    }

    // 3. Optionally seed ProviderAvailability if a ServiceProvider exists
    const provider = await tx.serviceProvider.findFirst({
      where: { isActive: true },
      select: { id: true },
    });

    if (provider) {
      // Delete existing availability for this provider
      await tx.providerAvailability.deleteMany({
        where: { providerId: provider.id },
      });

      // Group days by identical hours
      const grouped = new Map<string, number[]>();
      for (let i = 0; i < DAY_NAMES.length; i++) {
        const d = schedule[DAY_NAMES[i]];
        if (!d.enabled) continue;
        const key = `${d.open}-${d.close}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(i);
      }

      const availabilityRows = Array.from(grouped.entries()).map(([key, days]) => {
        const [startTime, endTime] = key.split("-");
        return {
          providerId: provider.id,
          days,
          startTime: startTime ?? "09:00",
          endTime: endTime ?? "17:00",
        };
      });

      if (availabilityRows.length > 0) {
        await tx.providerAvailability.createMany({ data: availabilityRows });
      }
    }
  });

  revalidatePath("/ops");
  revalidatePath("/admin");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/lib/actions/operating-hours.test.ts`

Expected: 2 tests pass.

- [ ] **Step 5: Write remaining tests**

Add to `apps/web/lib/actions/operating-hours.test.ts`:

```typescript
describe("getDefaultHoursForArchetype", () => {
  it("returns healthcare defaults for healthcare-wellness", () => {
    const result = getDefaultHoursForArchetype("healthcare-wellness");
    expect(result.monday.open).toBe("08:00");
    expect(result.monday.close).toBe("17:00");
    expect(result.saturday.enabled).toBe(false);
  });

  it("returns fitness defaults with extended hours", () => {
    const result = getDefaultHoursForArchetype("fitness-recreation");
    expect(result.monday.open).toBe("06:00");
    expect(result.monday.close).toBe("21:00");
    expect(result.saturday.enabled).toBe(true);
  });

  it("returns generic defaults for unknown category", () => {
    const result = getDefaultHoursForArchetype("unknown-category");
    expect(result.monday.open).toBe("09:00");
    expect(result.saturday.enabled).toBe(false);
  });

  it("returns generic defaults for null", () => {
    const result = getDefaultHoursForArchetype(null);
    expect(result.monday.open).toBe("09:00");
  });
});

describe("saveOperatingHours", () => {
  const MF_SCHEDULE: WeeklySchedule = {
    monday:    { enabled: true, open: "09:00", close: "17:00" },
    tuesday:   { enabled: true, open: "09:00", close: "17:00" },
    wednesday: { enabled: true, open: "09:00", close: "17:00" },
    thursday:  { enabled: true, open: "09:00", close: "17:00" },
    friday:    { enabled: true, open: "09:00", close: "17:00" },
    saturday:  { enabled: false, open: "09:00", close: "17:00" },
    sunday:    { enabled: false, open: "09:00", close: "17:00" },
  };

  it("upserts BusinessProfile with schedule and sets hoursConfirmedAt", async () => {
    const txMocks = makeTxMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      (async (fn: unknown) => (fn as (tx: typeof txMocks) => Promise<unknown>)(txMocks)) as never,
    );

    await saveOperatingHours({ schedule: MF_SCHEDULE, timezone: "Europe/London" });

    expect(txMocks.businessProfile.upsert).toHaveBeenCalledOnce();
    const upsertArg = txMocks.businessProfile.upsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(upsertArg.update.hoursConfirmedAt).toBeInstanceOf(Date);
    expect(upsertArg.update.timezone).toBe("Europe/London");
  });

  it("replaces seed deployment windows with derived windows", async () => {
    const txMocks = makeTxMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      (async (fn: unknown) => (fn as (tx: typeof txMocks) => Promise<unknown>)(txMocks)) as never,
    );

    await saveOperatingHours({ schedule: MF_SCHEDULE });

    // Deletes old seed + derived windows
    expect(txMocks.deploymentWindow.deleteMany).toHaveBeenCalledOnce();
    // Creates new derived windows
    expect(txMocks.deploymentWindow.createMany).toHaveBeenCalledOnce();
  });

  it("seeds ProviderAvailability when ServiceProvider exists", async () => {
    const txMocks = makeTxMocks();
    txMocks.serviceProvider.findFirst.mockResolvedValue({ id: "sp-1" } as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      (async (fn: unknown) => (fn as (tx: typeof txMocks) => Promise<unknown>)(txMocks)) as never,
    );

    await saveOperatingHours({ schedule: MF_SCHEDULE });

    expect(txMocks.providerAvailability.deleteMany).toHaveBeenCalledOnce();
    expect(txMocks.providerAvailability.createMany).toHaveBeenCalledOnce();
  });

  it("skips ProviderAvailability when no ServiceProvider", async () => {
    const txMocks = makeTxMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      (async (fn: unknown) => (fn as (tx: typeof txMocks) => Promise<unknown>)(txMocks)) as never,
    );

    await saveOperatingHours({ schedule: MF_SCHEDULE });

    expect(txMocks.providerAvailability.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects schedule with no enabled days", async () => {
    const allClosed: WeeklySchedule = {
      monday:    { enabled: false, open: "09:00", close: "17:00" },
      tuesday:   { enabled: false, open: "09:00", close: "17:00" },
      wednesday: { enabled: false, open: "09:00", close: "17:00" },
      thursday:  { enabled: false, open: "09:00", close: "17:00" },
      friday:    { enabled: false, open: "09:00", close: "17:00" },
      saturday:  { enabled: false, open: "09:00", close: "17:00" },
      sunday:    { enabled: false, open: "09:00", close: "17:00" },
    };

    await expect(saveOperatingHours({ schedule: allClosed })).rejects.toThrow(
      "At least one day must be enabled"
    );
  });

  it("rejects close before open", async () => {
    const bad: WeeklySchedule = {
      ...GENERIC_DEFAULTS,
      monday: { enabled: true, open: "17:00", close: "09:00" },
    };

    await expect(saveOperatingHours({ schedule: bad })).rejects.toThrow(
      "monday: closing time must be after opening time"
    );
  });
});
```

Note: The `$transaction` mock needs adjustment — the simplest approach is to make `$transaction` call through to the same mock functions. The test file's mock setup at the top handles this by passing the mocked prisma methods into the transaction callback.

- [ ] **Step 6: Run all tests**

Run: `npx vitest run apps/web/lib/actions/operating-hours.test.ts`

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/actions/operating-hours.ts apps/web/lib/actions/operating-hours.test.ts
git commit -m "feat: add operating hours server actions with smart defaults and BusinessProfile sync"
```

---

## Task 3: Setup Constants Integration

**Files:**
- Modify: `apps/web/lib/actions/setup-constants.ts`

- [ ] **Step 1: Add operating-hours to SETUP_STEPS**

In `apps/web/lib/actions/setup-constants.ts`, insert `"operating-hours"` after `"org-settings"` in the `SETUP_STEPS` array:

```typescript
export const SETUP_STEPS = [
  "account-bootstrap",
  "ai-providers",
  "branding",
  "org-settings",
  "operating-hours",  // NEW
  "storefront",
  "build-studio",
  "workspace",
] as const;
```

- [ ] **Step 2: Add route and label**

Add to `STEP_ROUTES`:
```typescript
"operating-hours": "/admin/operating-hours",
```

Add to `STEP_LABELS`:
```typescript
"operating-hours": "Operating Hours",
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/actions/setup-constants.ts
git commit -m "feat: add operating-hours step to onboarding flow"
```

---

## Task 4: UI Component — OperatingHoursEditor

**Files:**
- Create: `apps/web/components/admin/OperatingHoursEditor.tsx`

- [ ] **Step 1: Create the OperatingHoursEditor component**

Create `apps/web/components/admin/OperatingHoursEditor.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import type { WeeklySchedule, DaySchedule } from "@/lib/actions/operating-hours";

const DAY_ORDER = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
] as const;

const DAY_LABELS: Record<string, string> = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday",
  thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};

type Props = {
  defaultSchedule: WeeklySchedule;
  timezone: string;
  onSave: (schedule: WeeklySchedule) => Promise<void>;
  saving?: boolean;
};

export function OperatingHoursEditor({ defaultSchedule, timezone, onSave, saving: externalSaving }: Props) {
  const [schedule, setSchedule] = useState<WeeklySchedule>(defaultSchedule);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const busy = externalSaving || isPending;

  function updateDay(day: string, patch: Partial<DaySchedule>) {
    setSchedule((prev) => ({
      ...prev,
      [day]: { ...prev[day as keyof WeeklySchedule], ...patch },
    }));
    setError(null);
  }

  function handleSave() {
    // Client-side validation
    const anyEnabled = DAY_ORDER.some((d) => schedule[d].enabled);
    if (!anyEnabled) {
      setError("At least one day must be enabled");
      return;
    }
    for (const day of DAY_ORDER) {
      const d = schedule[day];
      if (d.enabled && d.close <= d.open) {
        setError(`${DAY_LABELS[day]}: closing time must be after opening time`);
        return;
      }
    }

    startTransition(async () => {
      try {
        await onSave(schedule);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-[var(--dpf-muted)]">
        Timezone: {timezone}
      </div>

      <div className="space-y-2">
        {DAY_ORDER.map((day) => {
          const d = schedule[day];
          return (
            <div
              key={day}
              className="flex items-center gap-3 p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]"
            >
              {/* Toggle */}
              <button
                type="button"
                onClick={() => updateDay(day, { enabled: !d.enabled })}
                className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${
                  d.enabled
                    ? "bg-[var(--dpf-accent)]"
                    : "bg-[var(--dpf-muted-foreground)]/30"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    d.enabled ? "left-5" : "left-0.5"
                  }`}
                />
              </button>

              {/* Day label */}
              <span
                className={`w-24 text-sm font-medium ${
                  d.enabled ? "text-[var(--dpf-text)]" : "text-[var(--dpf-muted)]"
                }`}
              >
                {DAY_LABELS[day]}
              </span>

              {/* Time pickers */}
              {d.enabled ? (
                <div className="flex items-center gap-2 text-sm">
                  <input
                    type="time"
                    value={d.open}
                    onChange={(e) => updateDay(day, { open: e.target.value })}
                    className="px-2 py-1 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] text-sm"
                  />
                  <span className="text-[var(--dpf-muted)]">to</span>
                  <input
                    type="time"
                    value={d.close}
                    onChange={(e) => updateDay(day, { close: e.target.value })}
                    className="px-2 py-1 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] text-sm"
                  />
                </div>
              ) : (
                <span className="text-sm text-[var(--dpf-muted)]">Closed</span>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="text-xs text-[var(--dpf-destructive)]">{error}</div>
      )}

      <button
        onClick={handleSave}
        disabled={busy}
        className="px-4 py-2 text-sm rounded-lg border transition-colors disabled:opacity-50"
        style={{
          color: "var(--dpf-accent)",
          borderColor: "var(--dpf-accent)",
          backgroundColor: "color-mix(in srgb, var(--dpf-accent) 15%, transparent)",
        }}
      >
        {busy ? "Saving..." : "Save Operating Hours"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/admin/OperatingHoursEditor.tsx
git commit -m "feat: add OperatingHoursEditor component with day toggles and time pickers"
```

---

## Task 5: Setup Page — Operating Hours Route

**Files:**
- Create: `apps/web/app/(shell)/admin/operating-hours/page.tsx`

- [ ] **Step 1: Create the setup page**

Create `apps/web/app/(shell)/admin/operating-hours/page.tsx`:

```tsx
import { getOperatingHours, saveOperatingHours } from "@/lib/actions/operating-hours";
import { OperatingHoursEditor } from "@/components/admin/OperatingHoursEditor";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function OperatingHoursPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Smart defaults handled inside getOperatingHours (archetype > industry > fallback)
  const { schedule, timezone } = await getOperatingHours();

  async function handleSave(newSchedule: Parameters<typeof saveOperatingHours>[0]["schedule"]) {
    "use server";
    await saveOperatingHours({ schedule: newSchedule, timezone });
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Operating Hours</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Set your business operating hours. These determine when platform maintenance is scheduled
          and when your team is available for bookings.
        </p>
      </div>

      <OperatingHoursEditor
        defaultSchedule={schedule}
        timezone={timezone}
        onSave={handleSave}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(shell)/admin/operating-hours/page.tsx
git commit -m "feat: add /admin/operating-hours setup page"
```

---

## Task 6: API Endpoint — Programmatic Access

**Files:**
- Create: `apps/web/app/api/v1/admin/operating-hours/route.ts`

- [ ] **Step 1: Create the API route**

Create `apps/web/app/api/v1/admin/operating-hours/route.ts`:

```typescript
// GET /api/v1/admin/operating-hours — get current hours or defaults
// PUT /api/v1/admin/operating-hours — save operating hours

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { getOperatingHours, saveOperatingHours } from "@/lib/actions/operating-hours";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);
    const result = await getOperatingHours();
    return apiSuccess(result);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    await authenticateRequest(request);
    const body = await request.json();

    if (!body.schedule) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "schedule is required" },
        { status: 422 },
      );
    }

    await saveOperatingHours({
      schedule: body.schedule,
      timezone: body.timezone,
      hasStorefront: body.hasStorefront,
    });

    return apiSuccess({ success: true });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    const message = e instanceof Error ? e.message : "An unexpected error occurred";
    return NextResponse.json(
      { code: "VALIDATION_ERROR", message },
      { status: 422 },
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/api/v1/admin/operating-hours/route.ts
git commit -m "feat: add GET/PUT /api/v1/admin/operating-hours endpoint"
```

---

## Task 7: Storefront Setup Integration

**Files:**
- Modify: `apps/web/app/api/storefront/admin/setup/route.ts:101-115`

- [ ] **Step 1: Modify storefront setup to check BusinessProfile hours**

In `apps/web/app/api/storefront/admin/setup/route.ts`, before the existing availability seeding (around line 101), add a check for confirmed BusinessProfile hours:

Replace the section starting at `// 2. Create availability rows — group days by identical hours` (lines 101-115) with logic that first checks BusinessProfile:

```typescript
    // 2. Create availability rows
    // Prefer confirmed BusinessProfile hours over archetype defaults
    const profile = await prisma.businessProfile.findFirst({
      where: { isActive: true, hoursConfirmedAt: { not: null } },
      select: { businessHours: true },
    });

    let operatingHours: { day: number; start: string; end: string }[];
    if (profile?.businessHours) {
      // Convert BusinessProfile format to archetype format
      const bh = profile.businessHours as Record<string, { open: string; close: string } | null>;
      const dayMap: Record<string, number> = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
        thursday: 4, friday: 5, saturday: 6,
      };
      operatingHours = Object.entries(bh)
        .filter(([, hours]) => hours !== null)
        .map(([day, hours]) => ({
          day: dayMap[day] ?? 0,
          start: hours!.open,
          end: hours!.close,
        }));
    } else {
      operatingHours = defaults.defaultOperatingHours;
    }

    const grouped = new Map<string, number[]>();
    for (const h of operatingHours) {
      const key = `${h.start}-${h.end}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(h.day);
    }
    for (const [key, days] of grouped) {
      const keyParts = key.split("-");
      const startTime = keyParts[0] ?? "09:00";
      const endTime = keyParts[1] ?? "17:00";
      await prisma.providerAvailability.create({
        data: { providerId: provider.id, days, startTime, endTime },
      });
    }
```

Also update the BusinessProfile to set `hasStorefront: true` after storefront setup:

```typescript
    // Update BusinessProfile to reflect storefront existence
    await prisma.businessProfile.updateMany({
      where: { isActive: true },
      data: { hasStorefront: true },
    });
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/api/storefront/admin/setup/route.ts
git commit -m "feat: storefront setup inherits confirmed BusinessProfile hours"
```

---

## Task 8: Run Full Test Suite

- [ ] **Step 1: Run all change-management and operating-hours tests**

```bash
npx vitest run apps/web/lib/actions/change-management.test.ts apps/web/lib/actions/standard-change-catalog.test.ts apps/web/lib/actions/operating-hours.test.ts
```

Expected: All tests pass.

- [ ] **Step 2: Run broader test suite to check for regressions**

```bash
npx vitest run
```

Expected: No regressions. If storefront setup tests exist and fail due to the new BusinessProfile check, update those mocks.

- [ ] **Step 3: Final commit if any test fixes were needed**

```bash
git add -A
git commit -m "test: fix any mocks affected by operating hours integration"
```
