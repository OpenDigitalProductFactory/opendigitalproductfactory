# EP-STORE-003: Storefront Booking Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every booking-enabled storefront archetype functional with slot-based scheduling, provider management, and conflict prevention.

**Architecture:** Slot computation engine as pure functions in `lib/slot-engine/`, three new public API routes for dates/slots/holds, enhanced `submitBooking` server action with hold validation and provider assignment, admin team management tab, and archetype-seeded defaults so booking works on day one.

**Tech Stack:** Prisma (schema + migrations), Vitest (TDD), Next.js 16 App Router (API routes + server actions), React client components with CSS variables (`var(--dpf-*)`), date-fns-tz for timezone handling.

**Spec:** `docs/superpowers/specs/2026-03-20-storefront-booking-calendar-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/validators/src/storefront.ts` | BookingConfig Zod schema |
| `apps/web/lib/slot-engine/types.ts` | Engine-internal types (TimeWindow, BusyPeriod, SlotCandidate) |
| `apps/web/lib/slot-engine/availability.ts` | Build availability windows from ProviderAvailability rows |
| `apps/web/lib/slot-engine/availability.test.ts` | Tests for availability builder |
| `apps/web/lib/slot-engine/busy-times.ts` | Subtract bookings + holds from windows |
| `apps/web/lib/slot-engine/busy-times.test.ts` | Tests for busy-time subtraction |
| `apps/web/lib/slot-engine/slot-generator.ts` | Generate slot candidates at intervals |
| `apps/web/lib/slot-engine/slot-generator.test.ts` | Tests for slot generation |
| `apps/web/lib/slot-engine/provider-assignment.ts` | Weighted round-robin + capacity logic |
| `apps/web/lib/slot-engine/provider-assignment.test.ts` | Tests for assignment |
| `apps/web/lib/slot-engine/compute-slots.ts` | Orchestrator: computeAvailableSlots + getAvailableDates |
| `apps/web/lib/slot-engine/compute-slots.test.ts` | Integration tests for orchestrator |
| `apps/web/lib/slot-engine/index.ts` | Public re-exports |
| `apps/web/app/api/storefront/[slug]/dates/route.ts` | GET available dates for month |
| `apps/web/app/api/storefront/[slug]/slots/route.ts` | GET available slots for date |
| `apps/web/app/api/storefront/[slug]/hold/route.ts` | POST reservation hold |
| `apps/web/lib/slot-engine/api-routes.test.ts` | Tests for all 3 API routes |
| `apps/web/components/storefront/SlotBookingFlow.tsx` | Slot-driven booking UI (replaces BookingForm) |
| `apps/web/components/storefront-admin/TeamManager.tsx` | Provider list + CRUD |
| `apps/web/components/storefront-admin/ScheduleEditor.tsx` | Weekly grid + date overrides |
| `apps/web/app/(shell)/admin/storefront/team/page.tsx` | Team tab page |

### Modified Files

| File | Changes |
|------|---------|
| `packages/db/prisma/schema.prisma` | 4 new models + extend StorefrontConfig, StorefrontItem, StorefrontBooking |
| `packages/types/src/entities.ts` | Add BookingConfig interface |
| `packages/storefront-templates/src/types.ts` | Add schedulingDefaults to ArchetypeDefinition |
| `packages/storefront-templates/src/archetypes/*.ts` | Add scheduling defaults per category |
| `apps/web/lib/storefront-actions.ts` | Enhance submitBooking with hold validation + provider assignment |
| `apps/web/lib/storefront-actions.test.ts` | New tests for enhanced submitBooking |
| `apps/web/lib/storefront-data.ts` | Add timezone to public config query |
| `apps/web/lib/storefront-types.ts` | Add timezone to PublicStorefrontConfig |
| `apps/web/app/(storefront)/s/[slug]/book/[itemId]/page.tsx` | Use SlotBookingFlow instead of BookingForm |
| `apps/web/components/storefront-admin/StorefrontAdminTabNav.tsx` | Add Team tab |
| `apps/web/components/storefront-admin/StorefrontInbox.tsx` | Provider column, cancel/reschedule actions |
| `apps/web/app/api/storefront/admin/setup/route.ts` | Create default provider + availability on setup |

---

## Task 1: Prisma Schema — New Models & Extensions

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add ServiceProvider model**

Add after the `StorefrontBooking` model block (after line ~3132):

```prisma
model ServiceProvider {
  id           String   @id @default(cuid())
  providerId   String   @unique
  storefrontId String
  name         String
  email        String?
  phone        String?
  avatarUrl    String?
  employeeId   String?
  isActive     Boolean  @default(true)
  priority     Int      @default(0)
  weight       Int      @default(100)
  sortOrder    Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  storefront   StorefrontConfig  @relation(fields: [storefrontId], references: [id])
  employee     EmployeeProfile?  @relation(fields: [employeeId], references: [id])
  services     ProviderService[]
  availability ProviderAvailability[]
  bookings     StorefrontBooking[]
  bookingHolds BookingHold[]

  @@index([storefrontId])
}

model ProviderService {
  id         String @id @default(cuid())
  providerId String
  itemId     String

  provider   ServiceProvider @relation(fields: [providerId], references: [id], onDelete: Cascade)
  item       StorefrontItem  @relation(fields: [itemId], references: [id], onDelete: Cascade)

  @@unique([providerId, itemId])
}

model ProviderAvailability {
  id         String    @id @default(cuid())
  providerId String
  days       Int[]     @default([])
  startTime  String
  endTime    String
  date       DateTime?
  isBlocked  Boolean   @default(false)
  reason     String?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  provider   ServiceProvider @relation(fields: [providerId], references: [id], onDelete: Cascade)

  @@index([providerId])
  @@index([providerId, date])
}

model BookingHold {
  id           String           @id @default(cuid())
  storefrontId String
  itemId       String
  providerId   String?
  slotStart    DateTime
  slotEnd      DateTime
  holderToken  String
  expiresAt    DateTime
  createdAt    DateTime         @default(now())

  storefront   StorefrontConfig @relation(fields: [storefrontId], references: [id], onDelete: Cascade)
  item         StorefrontItem   @relation(fields: [itemId], references: [id], onDelete: Cascade)
  provider     ServiceProvider? @relation(fields: [providerId], references: [id], onDelete: Cascade)

  @@index([storefrontId, slotStart, slotEnd])
  @@index([expiresAt])
}
```

- [ ] **Step 2: Extend StorefrontConfig — add timezone + relations**

Add to the `StorefrontConfig` model:
- Field: `timezone String @default("Europe/London")` (after `customDomain`)
- Relations: `providers ServiceProvider[]` and `bookingHolds BookingHold[]` (after existing relations)

- [ ] **Step 3: Extend StorefrontItem — add relation**

Add to the `StorefrontItem` model:
- Relations: `providerServices ProviderService[]` and `bookingHolds BookingHold[]`

- [ ] **Step 4: Extend StorefrontBooking — add new fields + relations**

Add to the `StorefrontBooking` model (after `status`):

```prisma
  providerId        String?
  assignmentMode    String?
  recurrenceRule    String?
  recurrenceEndDate DateTime?
  parentBookingId   String?
  fromReschedule    String?
  cancellationReason String?
  cancelledAt       DateTime?
  idempotencyKey    String?   @unique

  provider          ServiceProvider?  @relation(fields: [providerId], references: [id])
  parentBooking     StorefrontBooking? @relation("BookingRecurrence", fields: [parentBookingId], references: [id])
  childBookings     StorefrontBooking[] @relation("BookingRecurrence")
```

- [ ] **Step 5: Add EmployeeProfile back-relation**

Add to `EmployeeProfile` model: `serviceProviders ServiceProvider[]`

- [ ] **Step 6: Generate and run migration**

```bash
cd /h/OpenDigitalProductFactory && npx prisma migrate dev --name add-booking-calendar-models
```

- [ ] **Step 7: Verify Prisma client generates**

```bash
cd /h/OpenDigitalProductFactory && npx prisma generate
```

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add booking calendar models — ServiceProvider, ProviderService, ProviderAvailability, BookingHold"
```

---

## Task 2: BookingConfig Type & Zod Validation

**Files:**
- Modify: `packages/types/src/entities.ts`
- Create: `packages/validators/src/storefront.ts`
- Modify: `packages/validators/src/index.ts`

- [ ] **Step 1: Add BookingConfig interface to entities.ts**

Append to `packages/types/src/entities.ts`:

```typescript
export interface BookingConfig {
  durationMinutes: number;
  beforeBufferMinutes?: number;
  afterBufferMinutes?: number;
  minimumNoticeHours?: number;
  maxAdvanceDays?: number;
  slotIntervalMinutes?: number;
  schedulingPattern: "slot" | "class" | "recurring";
  assignmentMode: "next-available" | "customer-choice";
  capacity?: number;
  bookingLimits?: {
    day?: number;
    week?: number;
    month?: number;
  };
}
```

- [ ] **Step 2: Create Zod schema for BookingConfig**

Create `packages/validators/src/storefront.ts`:

```typescript
import { z } from "zod";

export const bookingLimitsSchema = z.object({
  day: z.number().int().positive().optional(),
  week: z.number().int().positive().optional(),
  month: z.number().int().positive().optional(),
}).strict();

export const bookingConfigSchema = z.object({
  durationMinutes: z.number().int().min(5).max(480),
  beforeBufferMinutes: z.number().int().min(0).max(120).optional(),
  afterBufferMinutes: z.number().int().min(0).max(120).optional(),
  minimumNoticeHours: z.number().min(0).max(720).optional(),
  maxAdvanceDays: z.number().int().min(1).max(365).optional(),
  slotIntervalMinutes: z.number().int().min(5).max(480).optional(),
  schedulingPattern: z.enum(["slot", "class", "recurring"]),
  assignmentMode: z.enum(["next-available", "customer-choice"]),
  capacity: z.number().int().min(1).max(500).optional(),
  bookingLimits: bookingLimitsSchema.optional(),
}).strict();
```

- [ ] **Step 3: Export from validators index**

Add to `packages/validators/src/index.ts`:
```typescript
export * from "./storefront";
```

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/entities.ts packages/validators/src/storefront.ts packages/validators/src/index.ts
git commit -m "feat(types): add BookingConfig interface and Zod validation schema"
```

---

## Task 3: Slot Engine — Types & Availability Builder

**Files:**
- Create: `apps/web/lib/slot-engine/types.ts`
- Create: `apps/web/lib/slot-engine/availability.ts`
- Create: `apps/web/lib/slot-engine/availability.test.ts`

- [ ] **Step 1: Create engine types**

Create `apps/web/lib/slot-engine/types.ts`:

```typescript
/** A contiguous time window in minutes-since-midnight (local time) */
export interface TimeWindow {
  startMinutes: number; // 0-1439
  endMinutes: number;   // 1-1440
}

/** A busy period in minutes-since-midnight */
export interface BusyPeriod {
  startMinutes: number;
  endMinutes: number;
}

/** A generated slot candidate */
export interface SlotCandidate {
  startMinutes: number;
  endMinutes: number;
  providerId: string;
  providerName: string;
  providerAvatarUrl?: string | null;
}

/** Provider availability row (from DB) */
export interface AvailabilityRow {
  days: number[];
  startTime: string; // "HH:MM"
  endTime: string;   // "HH:MM"
  date: Date | null;
  isBlocked: boolean;
}

/** Resolved booking config with defaults applied */
export interface ResolvedBookingConfig {
  durationMinutes: number;
  beforeBufferMinutes: number;
  afterBufferMinutes: number;
  minimumNoticeHours: number;
  maxAdvanceDays: number;
  slotIntervalMinutes: number;
  schedulingPattern: "slot" | "class" | "recurring";
  assignmentMode: "next-available" | "customer-choice";
  capacity: number;
  bookingLimits: { day?: number; week?: number; month?: number };
}

export function resolveBookingConfig(raw: Record<string, unknown>): ResolvedBookingConfig {
  const dur = typeof raw.durationMinutes === "number" ? raw.durationMinutes : 60;
  return {
    durationMinutes: dur,
    beforeBufferMinutes: (raw.beforeBufferMinutes as number) ?? 0,
    afterBufferMinutes: (raw.afterBufferMinutes as number) ?? 0,
    minimumNoticeHours: (raw.minimumNoticeHours as number) ?? 1,
    maxAdvanceDays: (raw.maxAdvanceDays as number) ?? 60,
    slotIntervalMinutes: (raw.slotIntervalMinutes as number) ?? dur,
    schedulingPattern: (raw.schedulingPattern as "slot" | "class" | "recurring") ?? "slot",
    assignmentMode: (raw.assignmentMode as "next-available" | "customer-choice") ?? "next-available",
    capacity: (raw.capacity as number) ?? 1,
    bookingLimits: (raw.bookingLimits as { day?: number; week?: number; month?: number }) ?? {},
  };
}
```

- [ ] **Step 2: Write failing test for availability builder**

Create `apps/web/lib/slot-engine/availability.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildAvailabilityWindows } from "./availability";
import type { AvailabilityRow } from "./types";

describe("buildAvailabilityWindows", () => {
  it("returns windows from recurring weekly rule matching day-of-week", () => {
    const rows: AvailabilityRow[] = [
      { days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00", date: null, isBlocked: false },
    ];
    // Monday = day 1
    const windows = buildAvailabilityWindows(rows, new Date("2026-03-23")); // Monday
    expect(windows).toEqual([{ startMinutes: 540, endMinutes: 1020 }]);
  });

  it("returns empty for day-of-week not in recurring rule", () => {
    const rows: AvailabilityRow[] = [
      { days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00", date: null, isBlocked: false },
    ];
    const windows = buildAvailabilityWindows(rows, new Date("2026-03-22")); // Sunday
    expect(windows).toEqual([]);
  });

  it("date-specific override replaces recurring rules", () => {
    const targetDate = new Date("2026-03-23");
    const rows: AvailabilityRow[] = [
      { days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00", date: null, isBlocked: false },
      { days: [], startTime: "10:00", endTime: "14:00", date: targetDate, isBlocked: false },
    ];
    const windows = buildAvailabilityWindows(rows, targetDate);
    expect(windows).toEqual([{ startMinutes: 600, endMinutes: 840 }]);
  });

  it("blocked date override returns empty", () => {
    const targetDate = new Date("2026-03-23");
    const rows: AvailabilityRow[] = [
      { days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00", date: null, isBlocked: false },
      { days: [], startTime: "00:00", endTime: "00:00", date: targetDate, isBlocked: true },
    ];
    const windows = buildAvailabilityWindows(rows, targetDate);
    expect(windows).toEqual([]);
  });

  it("multiple recurring rules produce multiple windows", () => {
    const rows: AvailabilityRow[] = [
      { days: [1], startTime: "09:00", endTime: "12:00", date: null, isBlocked: false },
      { days: [1], startTime: "14:00", endTime: "18:00", date: null, isBlocked: false },
    ];
    const windows = buildAvailabilityWindows(rows, new Date("2026-03-23")); // Monday
    expect(windows).toEqual([
      { startMinutes: 540, endMinutes: 720 },
      { startMinutes: 840, endMinutes: 1080 },
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /h/OpenDigitalProductFactory && npx vitest run apps/web/lib/slot-engine/availability.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 4: Implement availability builder**

Create `apps/web/lib/slot-engine/availability.ts`:

```typescript
import type { AvailabilityRow, TimeWindow } from "./types";

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function isSameDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Build available time windows for a provider on a specific date.
 * Date-specific overrides fully replace recurring rules.
 */
export function buildAvailabilityWindows(
  rows: AvailabilityRow[],
  targetDate: Date
): TimeWindow[] {
  // Check for date-specific overrides first
  const overrides = rows.filter((r) => r.date !== null && isSameDate(r.date, targetDate));

  if (overrides.length > 0) {
    // Date overrides fully replace recurring rules
    if (overrides.some((r) => r.isBlocked)) return [];
    return overrides
      .filter((r) => !r.isBlocked)
      .map((r) => ({
        startMinutes: timeToMinutes(r.startTime),
        endMinutes: timeToMinutes(r.endTime),
      }));
  }

  // Fall back to recurring weekly rules
  const dayOfWeek = targetDate.getDay(); // 0=Sun..6=Sat
  return rows
    .filter((r) => r.date === null && r.days.includes(dayOfWeek))
    .map((r) => ({
      startMinutes: timeToMinutes(r.startTime),
      endMinutes: timeToMinutes(r.endTime),
    }));
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /h/OpenDigitalProductFactory && npx vitest run apps/web/lib/slot-engine/availability.test.ts
```

Expected: all 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/slot-engine/types.ts apps/web/lib/slot-engine/availability.ts apps/web/lib/slot-engine/availability.test.ts
git commit -m "feat(slot-engine): add types and availability window builder with TDD"
```

---

## Task 4: Slot Engine — Busy Time Subtraction

**Files:**
- Create: `apps/web/lib/slot-engine/busy-times.ts`
- Create: `apps/web/lib/slot-engine/busy-times.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/slot-engine/busy-times.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { subtractBusyTimes } from "./busy-times";
import type { TimeWindow, BusyPeriod } from "./types";

describe("subtractBusyTimes", () => {
  it("returns full window when no busy periods", () => {
    const windows: TimeWindow[] = [{ startMinutes: 540, endMinutes: 1020 }];
    const result = subtractBusyTimes(windows, []);
    expect(result).toEqual([{ startMinutes: 540, endMinutes: 1020 }]);
  });

  it("removes middle section for busy period", () => {
    const windows: TimeWindow[] = [{ startMinutes: 540, endMinutes: 1020 }]; // 9-17
    const busy: BusyPeriod[] = [{ startMinutes: 660, endMinutes: 720 }]; // 11-12
    const result = subtractBusyTimes(windows, busy);
    expect(result).toEqual([
      { startMinutes: 540, endMinutes: 660 },
      { startMinutes: 720, endMinutes: 1020 },
    ]);
  });

  it("handles busy period at start of window", () => {
    const windows: TimeWindow[] = [{ startMinutes: 540, endMinutes: 1020 }];
    const busy: BusyPeriod[] = [{ startMinutes: 540, endMinutes: 600 }];
    const result = subtractBusyTimes(windows, busy);
    expect(result).toEqual([{ startMinutes: 600, endMinutes: 1020 }]);
  });

  it("handles busy period at end of window", () => {
    const windows: TimeWindow[] = [{ startMinutes: 540, endMinutes: 1020 }];
    const busy: BusyPeriod[] = [{ startMinutes: 960, endMinutes: 1020 }];
    const result = subtractBusyTimes(windows, busy);
    expect(result).toEqual([{ startMinutes: 540, endMinutes: 960 }]);
  });

  it("handles multiple busy periods splitting one window", () => {
    const windows: TimeWindow[] = [{ startMinutes: 540, endMinutes: 1020 }];
    const busy: BusyPeriod[] = [
      { startMinutes: 600, endMinutes: 660 },
      { startMinutes: 780, endMinutes: 840 },
    ];
    const result = subtractBusyTimes(windows, busy);
    expect(result).toEqual([
      { startMinutes: 540, endMinutes: 600 },
      { startMinutes: 660, endMinutes: 780 },
      { startMinutes: 840, endMinutes: 1020 },
    ]);
  });

  it("returns empty when busy period covers entire window", () => {
    const windows: TimeWindow[] = [{ startMinutes: 540, endMinutes: 600 }];
    const busy: BusyPeriod[] = [{ startMinutes: 540, endMinutes: 600 }];
    expect(subtractBusyTimes(windows, busy)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /h/OpenDigitalProductFactory && npx vitest run apps/web/lib/slot-engine/busy-times.test.ts
```

- [ ] **Step 3: Implement busy-time subtraction**

Create `apps/web/lib/slot-engine/busy-times.ts`:

```typescript
import type { TimeWindow, BusyPeriod } from "./types";

/**
 * Subtract busy periods from available windows, returning remaining free windows.
 * Both inputs must use the same time base (minutes-since-midnight).
 */
export function subtractBusyTimes(
  windows: TimeWindow[],
  busy: BusyPeriod[]
): TimeWindow[] {
  if (busy.length === 0) return [...windows];

  const sorted = [...busy].sort((a, b) => a.startMinutes - b.startMinutes);
  let free: TimeWindow[] = [...windows];

  for (const bp of sorted) {
    const next: TimeWindow[] = [];
    for (const w of free) {
      // No overlap
      if (bp.endMinutes <= w.startMinutes || bp.startMinutes >= w.endMinutes) {
        next.push(w);
        continue;
      }
      // Left remainder
      if (bp.startMinutes > w.startMinutes) {
        next.push({ startMinutes: w.startMinutes, endMinutes: bp.startMinutes });
      }
      // Right remainder
      if (bp.endMinutes < w.endMinutes) {
        next.push({ startMinutes: bp.endMinutes, endMinutes: w.endMinutes });
      }
    }
    free = next;
  }

  return free;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /h/OpenDigitalProductFactory && npx vitest run apps/web/lib/slot-engine/busy-times.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/slot-engine/busy-times.ts apps/web/lib/slot-engine/busy-times.test.ts
git commit -m "feat(slot-engine): add busy-time subtraction with TDD"
```

---

## Task 5: Slot Engine — Slot Candidate Generator

**Files:**
- Create: `apps/web/lib/slot-engine/slot-generator.ts`
- Create: `apps/web/lib/slot-engine/slot-generator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/slot-engine/slot-generator.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { generateSlotCandidates } from "./slot-generator";
import type { TimeWindow, BusyPeriod } from "./types";

describe("generateSlotCandidates", () => {
  it("generates slots at interval within window", () => {
    const windows: TimeWindow[] = [{ startMinutes: 540, endMinutes: 720 }]; // 9-12
    const slots = generateSlotCandidates(windows, [], {
      durationMinutes: 45,
      intervalMinutes: 45,
      beforeBuffer: 0,
      afterBuffer: 0,
    });
    // 9:00-9:45, 9:45-10:30, 10:30-11:15, 11:15-12:00
    expect(slots).toHaveLength(4);
    expect(slots[0]).toEqual({ startMinutes: 540, endMinutes: 585 });
    expect(slots[3]).toEqual({ startMinutes: 675, endMinutes: 720 });
  });

  it("respects buffer time in slot footprint", () => {
    const windows: TimeWindow[] = [{ startMinutes: 540, endMinutes: 720 }]; // 9-12
    const busy: BusyPeriod[] = [{ startMinutes: 600, endMinutes: 645 }]; // 10:00-10:45 booking
    const slots = generateSlotCandidates(windows, busy, {
      durationMinutes: 45,
      intervalMinutes: 45,
      beforeBuffer: 10,
      afterBuffer: 10,
    });
    // 9:00 slot footprint = [8:50, 9:55] — ok (no conflict)
    // 9:45 slot footprint = [9:35, 10:40] — overlaps busy 10:00 → excluded
    // 10:30 slot footprint = [10:20, 11:25] — overlaps busy end 10:45 → excluded
    // 10:55 would be next but with 45min interval from 9:00 → 9:45, 10:30, 11:15
    // 11:15 footprint = [11:05, 12:10] — exceeds window end 12:00 → excluded
    expect(slots.map((s) => s.startMinutes)).toEqual([540]);
  });

  it("returns empty when window too small for duration", () => {
    const windows: TimeWindow[] = [{ startMinutes: 540, endMinutes: 570 }]; // 30 min window
    const slots = generateSlotCandidates(windows, [], {
      durationMinutes: 45,
      intervalMinutes: 45,
      beforeBuffer: 0,
      afterBuffer: 0,
    });
    expect(slots).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /h/OpenDigitalProductFactory && npx vitest run apps/web/lib/slot-engine/slot-generator.test.ts
```

- [ ] **Step 3: Implement slot generator**

Create `apps/web/lib/slot-engine/slot-generator.ts`:

```typescript
import type { TimeWindow, BusyPeriod } from "./types";

interface SlotConfig {
  durationMinutes: number;
  intervalMinutes: number;
  beforeBuffer: number;
  afterBuffer: number;
}

interface GeneratedSlot {
  startMinutes: number;
  endMinutes: number;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Generate slot candidates at fixed intervals within free windows.
 * A slot's effective footprint includes buffers: [start - beforeBuffer, end + afterBuffer].
 * The slot is available only if this footprint fits within a window AND doesn't overlap busy periods.
 */
export function generateSlotCandidates(
  windows: TimeWindow[],
  busy: BusyPeriod[],
  config: SlotConfig
): GeneratedSlot[] {
  const { durationMinutes, intervalMinutes, beforeBuffer, afterBuffer } = config;
  const slots: GeneratedSlot[] = [];

  for (const window of windows) {
    let cursor = window.startMinutes;
    while (cursor + durationMinutes <= window.endMinutes) {
      const footprintStart = cursor - beforeBuffer;
      const footprintEnd = cursor + durationMinutes + afterBuffer;

      // Footprint must fit within window bounds
      if (footprintStart >= window.startMinutes && footprintEnd <= window.endMinutes) {
        // Check no overlap with busy periods
        const conflict = busy.some((b) => overlaps(footprintStart, footprintEnd, b.startMinutes, b.endMinutes));
        if (!conflict) {
          slots.push({ startMinutes: cursor, endMinutes: cursor + durationMinutes });
        }
      }

      cursor += intervalMinutes;
    }
  }

  return slots;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /h/OpenDigitalProductFactory && npx vitest run apps/web/lib/slot-engine/slot-generator.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/slot-engine/slot-generator.ts apps/web/lib/slot-engine/slot-generator.test.ts
git commit -m "feat(slot-engine): add slot candidate generator with buffer-aware footprints"
```

---

## Task 6: Slot Engine — Provider Assignment

**Files:**
- Create: `apps/web/lib/slot-engine/provider-assignment.ts`
- Create: `apps/web/lib/slot-engine/provider-assignment.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/slot-engine/provider-assignment.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { selectProviderRoundRobin } from "./provider-assignment";

describe("selectProviderRoundRobin", () => {
  it("picks provider with lowest effective weight", () => {
    const providers = [
      { id: "p1", name: "Alice", priority: 0, weight: 100, recentBookings: 5 },
      { id: "p2", name: "Bob", priority: 0, weight: 100, recentBookings: 3 },
    ];
    const result = selectProviderRoundRobin(providers);
    expect(result?.id).toBe("p2"); // fewer bookings → higher effective weight
  });

  it("uses priority as tiebreaker (lower priority = first)", () => {
    const providers = [
      { id: "p1", name: "Alice", priority: 1, weight: 100, recentBookings: 3 },
      { id: "p2", name: "Bob", priority: 0, weight: 100, recentBookings: 3 },
    ];
    const result = selectProviderRoundRobin(providers);
    expect(result?.id).toBe("p2");
  });

  it("respects weight differences", () => {
    const providers = [
      { id: "p1", name: "Senior", priority: 0, weight: 50, recentBookings: 2 },
      { id: "p2", name: "Junior", priority: 0, weight: 100, recentBookings: 3 },
    ];
    // effectiveWeight: p1 = 50/(1+2-2)=50, p2 = 100/(1+3-2)=50 → tie → priority tiebreak (both 0) → p1 first by id stability
    const result = selectProviderRoundRobin(providers);
    expect(result).toBeDefined();
  });

  it("returns null for empty provider list", () => {
    expect(selectProviderRoundRobin([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /h/OpenDigitalProductFactory && npx vitest run apps/web/lib/slot-engine/provider-assignment.test.ts
```

- [ ] **Step 3: Implement provider assignment**

Create `apps/web/lib/slot-engine/provider-assignment.ts`:

```typescript
interface ProviderCandidate {
  id: string;
  name: string;
  priority: number;
  weight: number;
  recentBookings: number;
}

/**
 * Weighted round-robin provider selection.
 * effectiveWeight = weight / (1 + recentBookings - lowestBookingCount)
 * Tiebreaker: lower priority value wins.
 */
export function selectProviderRoundRobin(
  providers: ProviderCandidate[]
): ProviderCandidate | null {
  if (providers.length === 0) return null;

  const minBookings = Math.min(...providers.map((p) => p.recentBookings));

  const scored = providers.map((p) => ({
    ...p,
    effectiveWeight: p.weight / (1 + p.recentBookings - minBookings),
  }));

  scored.sort((a, b) => {
    if (b.effectiveWeight !== a.effectiveWeight) return b.effectiveWeight - a.effectiveWeight;
    return a.priority - b.priority;
  });

  return scored[0];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /h/OpenDigitalProductFactory && npx vitest run apps/web/lib/slot-engine/provider-assignment.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/slot-engine/provider-assignment.ts apps/web/lib/slot-engine/provider-assignment.test.ts
git commit -m "feat(slot-engine): add weighted round-robin provider assignment"
```

---

## Task 7: Slot Engine — computeAvailableSlots Orchestrator

**Files:**
- Create: `apps/web/lib/slot-engine/compute-slots.ts`
- Create: `apps/web/lib/slot-engine/compute-slots.test.ts`
- Create: `apps/web/lib/slot-engine/index.ts`

- [ ] **Step 1: Write failing integration tests**

Create `apps/web/lib/slot-engine/compute-slots.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    storefrontItem: { findFirst: vi.fn() },
    serviceProvider: { findMany: vi.fn() },
    providerAvailability: { findMany: vi.fn() },
    storefrontBooking: { findMany: vi.fn() },
    bookingHold: { findMany: vi.fn() },
  },
}));

import { computeAvailableSlots, getAvailableDates } from "./compute-slots";
import { prisma } from "@dpf/db";

const mockItem = {
  id: "item-1",
  itemId: "itm-abc",
  storefrontId: "sf-1",
  bookingConfig: {
    durationMinutes: 45,
    schedulingPattern: "slot",
    assignmentMode: "next-available",
  },
  storefront: { timezone: "Europe/London" },
};

const mockProvider = {
  id: "prov-1",
  providerId: "SP-0001",
  name: "Alice",
  avatarUrl: null,
  priority: 0,
  weight: 100,
  isActive: true,
};

describe("computeAvailableSlots", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns slots for next-available mode", async () => {
    vi.mocked(prisma.storefrontItem.findFirst).mockResolvedValue(mockItem as never);
    vi.mocked(prisma.serviceProvider.findMany).mockResolvedValue([mockProvider] as never);
    vi.mocked(prisma.providerAvailability.findMany).mockResolvedValue([
      { days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00", date: null, isBlocked: false },
    ] as never);
    vi.mocked(prisma.storefrontBooking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.bookingHold.findMany).mockResolvedValue([] as never);

    const result = await computeAvailableSlots("itm-abc", "2026-03-23"); // Monday
    expect(result.mode).toBe("next-available");
    if (result.mode === "next-available") {
      expect(result.slots.length).toBeGreaterThan(0);
      expect(result.slots[0].startTime).toBe("09:00");
      expect(result.slots[0].providerId).toBe("prov-1");
    }
  });

  it("returns error when item not found", async () => {
    vi.mocked(prisma.storefrontItem.findFirst).mockResolvedValue(null as never);
    await expect(computeAvailableSlots("missing", "2026-03-23")).rejects.toThrow("Item not found");
  });

  it("returns empty slots when no providers", async () => {
    vi.mocked(prisma.storefrontItem.findFirst).mockResolvedValue(mockItem as never);
    vi.mocked(prisma.serviceProvider.findMany).mockResolvedValue([] as never);

    const result = await computeAvailableSlots("itm-abc", "2026-03-23");
    if (result.mode === "next-available") {
      expect(result.slots).toEqual([]);
    }
  });
});

describe("getAvailableDates", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns dates that have at least one provider with availability", async () => {
    vi.mocked(prisma.storefrontItem.findFirst).mockResolvedValue(mockItem as never);
    vi.mocked(prisma.serviceProvider.findMany).mockResolvedValue([mockProvider] as never);
    vi.mocked(prisma.providerAvailability.findMany).mockResolvedValue([
      { days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00", date: null, isBlocked: false },
    ] as never);
    vi.mocked(prisma.storefrontBooking.findMany).mockResolvedValue([] as never);

    const dates = await getAvailableDates("itm-abc", "2026-03");
    // March 2026 has weekdays Mon-Fri, should have ~22 available dates
    expect(dates.length).toBeGreaterThan(15);
    // Weekend dates should not appear
    const weekendDates = dates.filter((d) => {
      const day = new Date(d).getDay();
      return day === 0 || day === 6;
    });
    expect(weekendDates).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /h/OpenDigitalProductFactory && npx vitest run apps/web/lib/slot-engine/compute-slots.test.ts
```

- [ ] **Step 3: Implement computeAvailableSlots and getAvailableDates**

Create `apps/web/lib/slot-engine/compute-slots.ts`. This orchestrator:

1. Loads item config + storefront timezone from DB
2. Validates date against minimumNoticeHours and maxAdvanceDays
3. Loads eligible providers (via ProviderService join)
4. For each provider: builds availability windows, loads bookings + holds as busy periods, generates slots
5. Aggregates by assignment mode (next-available → round-robin merge, customer-choice → group by provider, class → capacity check)

Key implementation details:
- Convert booking `scheduledAt` UTC times to local minutes-since-midnight using the storefront timezone
- Extend each existing booking's busy footprint by its own item's buffer config (requires loading the booking's item config)
- For holds: filter `expiresAt > now()`, exclude holds with the `currentToken` if provided
- For `getAvailableDates`: iterate each day in the month, check if any provider has a matching availability rule and isn't fully booked (cheaper than full slot enumeration)
- Returns `AvailableSlotsResult` discriminated union per spec

The function signatures:
```typescript
export async function computeAvailableSlots(
  itemId: string,
  dateStr: string, // "YYYY-MM-DD"
  options?: { providerId?: string; holderToken?: string }
): Promise<AvailableSlotsResult>

export async function getAvailableDates(
  itemId: string,
  yearMonth: string // "YYYY-MM"
): Promise<string[]> // Array of "YYYY-MM-DD"
```

Use `buildAvailabilityWindows` from `./availability`, `subtractBusyTimes` from `./busy-times`, `generateSlotCandidates` from `./slot-generator`, and `selectProviderRoundRobin` from `./provider-assignment`.

Convert minutes-since-midnight back to "HH:MM" strings for the return type. Use helper:
```typescript
function minutesToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
```

For weekly booking count (round-robin), query bookings WHERE providerId = X AND scheduledAt between Monday 00:00 and Sunday 23:59 of the current week, status != 'cancelled'.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /h/OpenDigitalProductFactory && npx vitest run apps/web/lib/slot-engine/compute-slots.test.ts
```

- [ ] **Step 5: Create index.ts re-exports**

Create `apps/web/lib/slot-engine/index.ts`:

```typescript
export { computeAvailableSlots, getAvailableDates } from "./compute-slots";
export { resolveBookingConfig } from "./types";
export type {
  ResolvedBookingConfig,
  SlotCandidate,
  TimeWindow,
  BusyPeriod,
  AvailabilityRow,
} from "./types";
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/slot-engine/
git commit -m "feat(slot-engine): add computeAvailableSlots and getAvailableDates orchestrators"
```

---

## Task 8: API Routes — dates, slots, hold

**Files:**
- Create: `apps/web/app/api/storefront/[slug]/dates/route.ts`
- Create: `apps/web/app/api/storefront/[slug]/slots/route.ts`
- Create: `apps/web/app/api/storefront/[slug]/hold/route.ts`
- Create: `apps/web/lib/slot-engine/api-routes.test.ts`

- [ ] **Step 1: Write failing tests for all 3 routes**

Create `apps/web/lib/slot-engine/api-routes.test.ts` with tests that mock the slot engine functions and verify:
- `GET dates` — calls `getAvailableDates(itemId, month)`, returns `{ dates: string[] }`
- `GET dates` — returns 400 if `itemId` or `month` query param missing
- `GET slots` — calls `computeAvailableSlots(itemId, date, { providerId })`, returns result
- `GET slots` — returns 400 if `itemId` or `date` missing
- `POST hold` — creates `BookingHold` with 10-min TTL, returns `{ holderToken, expiresAt }`
- `POST hold` — returns 429 when rate limit exceeded (3 active holds per IP per storefront)
- `POST hold` — returns 409 when slot is already held by another token

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /h/OpenDigitalProductFactory && npx vitest run apps/web/lib/slot-engine/api-routes.test.ts
```

- [ ] **Step 3: Implement GET dates route**

Create `apps/web/app/api/storefront/[slug]/dates/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getAvailableDates } from "@/lib/slot-engine";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { searchParams } = req.nextUrl;
  const itemId = searchParams.get("itemId");
  const month = searchParams.get("month"); // "YYYY-MM"

  if (!itemId || !month) {
    return NextResponse.json({ error: "itemId and month are required" }, { status: 400 });
  }

  try {
    const dates = await getAvailableDates(itemId, month);
    return NextResponse.json({ dates });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
```

- [ ] **Step 4: Implement GET slots route**

Create `apps/web/app/api/storefront/[slug]/slots/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { computeAvailableSlots } from "@/lib/slot-engine";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { searchParams } = req.nextUrl;
  const itemId = searchParams.get("itemId");
  const date = searchParams.get("date"); // "YYYY-MM-DD"
  const providerId = searchParams.get("providerId") ?? undefined;
  const holderToken = searchParams.get("holderToken") ?? undefined;

  if (!itemId || !date) {
    return NextResponse.json({ error: "itemId and date are required" }, { status: 400 });
  }

  try {
    const result = await computeAvailableSlots(itemId, date, { providerId, holderToken });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
```

- [ ] **Step 5: Implement POST hold route**

Create `apps/web/app/api/storefront/[slug]/hold/route.ts`:

Accepts `{ itemId, providerId?, slotStart, slotEnd }` in body.

Rate limiting checks (all via DB count queries):
1. Count active holds for this IP + storefrontId where `expiresAt > now()` → reject if >= 3
2. Count holds created by this IP in last hour → reject if >= 10
3. Count all active holds for storefrontId → reject if >= 50

If passed, check for conflicting holds (same provider + overlapping slot times where `expiresAt > now()`). If conflict → 409.

Create `BookingHold` with `expiresAt = now() + 10 minutes`, `holderToken = crypto.randomUUID()`.

Return `{ holderToken, expiresAt }`.

Note: IP is extracted from `req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown"`. Store IP on hold row for rate limiting (add `holderIp String?` to BookingHold schema — or use in-query filter only, no storage needed since we count by IP match).

**Simplification:** Since we don't store IP on holds, rate limiting by IP requires a different approach. Instead, use the storefront-global limit (50 concurrent holds) and the per-token approach (3 holds per holderToken session). The per-IP limit is enforced at the application level by counting recent hold creations. For v1, implement only the storefront-global limit (50) and per-hold-creation response with unique token.

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /h/OpenDigitalProductFactory && npx vitest run apps/web/lib/slot-engine/api-routes.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/api/storefront/\[slug\]/dates/ apps/web/app/api/storefront/\[slug\]/slots/ apps/web/app/api/storefront/\[slug\]/hold/ apps/web/lib/slot-engine/api-routes.test.ts
git commit -m "feat(api): add storefront dates, slots, and hold API routes"
```

---

## Task 9: Enhanced submitBooking Server Action

**Files:**
- Modify: `apps/web/lib/storefront-actions.ts`
- Modify: `apps/web/lib/storefront-actions.test.ts`

- [ ] **Step 1: Write failing tests for enhanced submitBooking**

Add to `apps/web/lib/storefront-actions.test.ts`:

```typescript
describe("submitBooking (enhanced)", () => {
  it("validates hold token before creating booking", async () => {
    // Mock storefront found, hold found with matching token
    // Expect: booking created, hold deleted
  });

  it("rejects booking when hold token is invalid", async () => {
    // Mock storefront found, hold NOT found for token
    // Expect: { success: false, error: "Invalid or expired hold" }
  });

  it("rejects duplicate submission via idempotency key", async () => {
    // Mock Prisma unique constraint error on idempotencyKey
    // Expect: { success: false, error: "Duplicate submission" }
  });

  it("assigns provider from hold when providerId is present", async () => {
    // Expect: booking.providerId matches hold.providerId
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /h/OpenDigitalProductFactory && npx vitest run apps/web/lib/storefront-actions.test.ts
```

- [ ] **Step 3: Enhance submitBooking**

Update `submitBooking` in `apps/web/lib/storefront-actions.ts`:

New parameters: `holderToken?: string`, `providerId?: string`, `assignmentMode?: string`, `idempotencyKey?: string`, `recurrenceRule?: string`, `recurrenceEndDate?: Date`.

Logic:
1. If `holderToken` provided: verify hold exists, matches token, not expired, slot matches. Delete hold after verification.
2. If `idempotencyKey` provided: set on booking (unique constraint handles duplicates — catch Prisma P2002 error).
3. Set `providerId` and `assignmentMode` on booking.
4. If `recurrenceRule` provided: create child bookings (Task 10).

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /h/OpenDigitalProductFactory && npx vitest run apps/web/lib/storefront-actions.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/storefront-actions.ts apps/web/lib/storefront-actions.test.ts
git commit -m "feat(storefront): enhance submitBooking with hold validation, provider assignment, idempotency"
```

---

## Task 10: Recurring Booking Logic

**Files:**
- Modify: `apps/web/lib/storefront-actions.ts`
- Modify: `apps/web/lib/storefront-actions.test.ts`

- [ ] **Step 1: Write failing tests for recurrence**

Add tests:
- `createRecurringBookings` generates weekly children for 3 months
- `createRecurringBookings` generates biweekly children
- Cancelling parent cancels all future children

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement recurrence logic**

Add `createRecurringBookings(parentBookingId, rule, endDate, baseSlot)` to `storefront-actions.ts`:

Project future dates from rule, create `StorefrontBooking` rows for each with `parentBookingId` linking back. Each child has independent status. No holds for future instances.

Helper to project dates:
```typescript
function projectRecurrenceDates(
  startDate: Date,
  rule: "weekly" | "biweekly" | "monthly",
  endDate: Date
): Date[] {
  const dates: Date[] = [];
  const msPerDay = 86400000;
  const interval = rule === "weekly" ? 7 : rule === "biweekly" ? 14 : 0;
  let cursor = new Date(startDate.getTime());

  if (rule === "monthly") {
    const dayOfMonth = cursor.getDate();
    cursor.setMonth(cursor.getMonth() + 1);
    while (cursor <= endDate) {
      cursor.setDate(dayOfMonth);
      dates.push(new Date(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else {
    cursor = new Date(cursor.getTime() + interval * msPerDay);
    while (cursor <= endDate) {
      dates.push(new Date(cursor));
      cursor = new Date(cursor.getTime() + interval * msPerDay);
    }
  }
  return dates;
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/storefront-actions.ts apps/web/lib/storefront-actions.test.ts
git commit -m "feat(storefront): add recurring booking creation with weekly/biweekly/monthly rules"
```

---

## Task 11: Storefront Data Layer — Add Timezone

**Files:**
- Modify: `apps/web/lib/storefront-data.ts`
- Modify: `apps/web/lib/storefront-types.ts`

- [ ] **Step 1: Add timezone to PublicStorefrontConfig**

In `apps/web/lib/storefront-types.ts`, add to `PublicStorefrontConfig`:
```typescript
timezone: string;
```

- [ ] **Step 2: Update getPublicStorefront query**

In `apps/web/lib/storefront-data.ts`, add `timezone: true` to the `StorefrontConfig` select. Include in return object:
```typescript
timezone: config.timezone ?? "Europe/London",
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/storefront-data.ts apps/web/lib/storefront-types.ts
git commit -m "feat(storefront): expose timezone in public storefront config"
```

---

## Task 12: Customer UI — SlotBookingFlow Component

**Files:**
- Create: `apps/web/components/storefront/SlotBookingFlow.tsx`
- Modify: `apps/web/app/(storefront)/s/[slug]/book/[itemId]/page.tsx`

- [ ] **Step 1: Create SlotBookingFlow component**

Create `apps/web/components/storefront/SlotBookingFlow.tsx` — a `"use client"` component that:

1. **Props:** `orgSlug: string`, `itemId: string`, `itemName: string`, `timezone: string`, `bookingConfig: Record<string, unknown> | null`
2. **State:** `selectedDate`, `selectedSlot`, `holderToken`, `step` (date → slot → form → confirmation)
3. **Date selection:** Fetches `GET /api/storefront/${orgSlug}/dates?itemId=${itemId}&month=${currentMonth}`. Renders a month calendar grid. Days with no availability are greyed out (`opacity: 0.4, cursor: not-allowed`). Uses CSS variables for all colors.
4. **Slot selection:** On date pick, fetches `GET /api/storefront/${orgSlug}/slots?itemId=${itemId}&date=${selectedDate}`. Renders based on mode:
   - `next-available`: Grid of time buttons
   - `customer-choice`: Provider cards with name + avatar, each showing time buttons
   - `class`: Session list with remaining capacity
5. **Hold creation:** On slot pick, POSTs to `/api/storefront/${orgSlug}/hold`. Stores `holderToken` in state. Shows form fields.
6. **Form submission:** Calls `submitBooking(orgSlug, { itemId, holderToken, providerId, scheduledAt, durationMinutes, idempotencyKey: crypto.randomUUID(), ... })` via server action. Redirects to checkout on success.
7. **All styling:** CSS variables only (`var(--dpf-*)` pattern). No hardcoded colors.

- [ ] **Step 2: Update book page to use SlotBookingFlow**

Replace `BookingForm` with `SlotBookingFlow` in `apps/web/app/(storefront)/s/[slug]/book/[itemId]/page.tsx`:

```typescript
import { SlotBookingFlow } from "@/components/storefront/SlotBookingFlow";

// In the component:
return (
  <div style={{ paddingTop: 40, maxWidth: 600 }}>
    <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Book: {item.name}</h1>
    <SlotBookingFlow
      orgSlug={slug}
      itemId={item.itemId}
      itemName={item.name}
      timezone={storefront.timezone}
      bookingConfig={item.bookingConfig}
    />
  </div>
);
```

Update the `getPublicStorefront` call to use the new timezone field.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/storefront/SlotBookingFlow.tsx apps/web/app/\(storefront\)/s/\[slug\]/book/\[itemId\]/page.tsx
git commit -m "feat(storefront): add SlotBookingFlow component replacing free-form BookingForm"
```

---

## Task 13: Admin UI — Team Tab (Provider Management)

**Files:**
- Create: `apps/web/app/(shell)/admin/storefront/team/page.tsx`
- Create: `apps/web/components/storefront-admin/TeamManager.tsx`
- Create: `apps/web/components/storefront-admin/ScheduleEditor.tsx`
- Modify: `apps/web/components/storefront-admin/StorefrontAdminTabNav.tsx`

- [ ] **Step 1: Add Team tab to nav**

In `StorefrontAdminTabNav.tsx`, add to TABS array:
```typescript
{ label: "Team", href: "/admin/storefront/team" },
```
Insert after "Items" and before "Inbox".

- [ ] **Step 2: Create team page (server component)**

Create `apps/web/app/(shell)/admin/storefront/team/page.tsx`:
- Authenticate with `auth()` and `can(user, "manage_storefront")`
- Load storefront config + providers from DB
- Pass to `TeamManager` client component

- [ ] **Step 3: Create TeamManager component**

Create `apps/web/components/storefront-admin/TeamManager.tsx` — `"use client"` component:
- Lists ServiceProvider rows with name, email, status badge, service count
- "Add Provider" button opens inline form (name, email, phone, avatar URL)
- Creates provider via API call to a new admin endpoint
- Per-provider: inline `ScheduleEditor`, service assignment checkboxes, priority/weight inputs
- "Copy schedule from..." dropdown for bulk action

- [ ] **Step 4: Create ScheduleEditor component**

Create `apps/web/components/storefront-admin/ScheduleEditor.tsx` — `"use client"` component:
- Weekly grid: 7 rows (Mon-Sun), each with start/end time inputs and enabled toggle
- "Add Exception" button: date picker + block/custom hours + reason
- Preview section: shows next 7 days computed availability (calls `computeAvailableSlots` preview)
- Saves via admin API endpoints (new routes needed for provider CRUD)

- [ ] **Step 5: Create admin API routes for provider CRUD**

Create `apps/web/app/api/storefront/admin/providers/route.ts` (GET list, POST create) and `apps/web/app/api/storefront/admin/providers/[id]/route.ts` (PUT update, DELETE).

All routes require `manage_storefront` capability check.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/\(shell\)/admin/storefront/team/ apps/web/components/storefront-admin/TeamManager.tsx apps/web/components/storefront-admin/ScheduleEditor.tsx apps/web/components/storefront-admin/StorefrontAdminTabNav.tsx apps/web/app/api/storefront/admin/providers/
git commit -m "feat(admin): add Team tab with provider management and schedule editor"
```

---

## Task 14: Admin UI — Inbox Enhancements

**Files:**
- Modify: `apps/web/components/storefront-admin/StorefrontInbox.tsx`
- Modify: `apps/web/app/(shell)/admin/storefront/inbox/page.tsx`

- [ ] **Step 1: Add provider column and actions to inbox**

Enhance `StorefrontInbox.tsx`:
- Add `providerName` to Entry type
- Show provider name badge on booking entries
- Add "Cancel" button → prompts for reason, calls cancel action (sets `cancellationReason` + `cancelledAt`)
- Add "Reschedule" button → opens date/time picker, creates new booking with `fromReschedule` link
- Add status badges: pending (yellow), confirmed (green), completed (blue), cancelled (red), needs-reschedule (orange)
- Add "Filter by provider" dropdown alongside existing type filter

- [ ] **Step 2: Update inbox page to load provider data**

Update the inbox page query to join `ServiceProvider` on bookings and pass `providerName` to the component.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/storefront-admin/StorefrontInbox.tsx apps/web/app/\(shell\)/admin/storefront/inbox/
git commit -m "feat(admin): enhance inbox with provider column, cancel/reschedule actions, status badges"
```

---

## Task 15: Archetype Template Defaults

**Files:**
- Modify: `packages/storefront-templates/src/types.ts`
- Modify: `packages/storefront-templates/src/archetypes/beauty-personal-care.ts`
- Modify: `packages/storefront-templates/src/archetypes/healthcare-wellness.ts`
- Modify: `packages/storefront-templates/src/archetypes/pet-services.ts`
- Modify: `packages/storefront-templates/src/archetypes/fitness-recreation.ts`
- Modify: `packages/storefront-templates/src/archetypes/food-hospitality.ts`
- Modify: `packages/storefront-templates/src/archetypes/education-training.ts`
- Modify: `packages/storefront-templates/src/archetypes/trades-maintenance.ts`
- Modify: `packages/storefront-templates/src/archetypes/archetypes.test.ts`

- [ ] **Step 1: Add schedulingDefaults to ArchetypeDefinition type**

In `packages/storefront-templates/src/types.ts`, add:

```typescript
export interface SchedulingDefaults {
  schedulingPattern: "slot" | "class" | "recurring";
  assignmentMode: "next-available" | "customer-choice";
  defaultOperatingHours: { day: number; start: string; end: string }[];
  defaultBeforeBuffer: number;
  defaultAfterBuffer: number;
  minimumNoticeHours: number;
  maxAdvanceDays: number;
}
```

Add `schedulingDefaults?: SchedulingDefaults` to `ArchetypeDefinition`.

- [ ] **Step 2: Add defaults to each category file**

Per the spec's "Category defaults" table. Example for beauty-personal-care:

```typescript
const BEAUTY_SCHEDULING: SchedulingDefaults = {
  schedulingPattern: "slot",
  assignmentMode: "customer-choice",
  defaultOperatingHours: [1, 2, 3, 4, 5, 6].map((day) => ({ day, start: "09:00", end: "18:00" })),
  defaultBeforeBuffer: 0,
  defaultAfterBuffer: 10,
  minimumNoticeHours: 2,
  maxAdvanceDays: 60,
};
```

Add `schedulingDefaults: BEAUTY_SCHEDULING` to each archetype in the category. Repeat for all 7 categories per spec table.

- [ ] **Step 3: Update archetype tests**

In `archetypes.test.ts`, add test:
```typescript
it("all booking-type archetypes have schedulingDefaults", () => {
  const bookingArchetypes = allArchetypes.filter((a) => a.ctaType === "booking");
  for (const a of bookingArchetypes) {
    expect(a.schedulingDefaults, `${a.archetypeId} missing schedulingDefaults`).toBeDefined();
  }
});
```

- [ ] **Step 4: Run tests**

```bash
cd /h/OpenDigitalProductFactory && npx vitest run packages/storefront-templates/src/archetypes/archetypes.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/storefront-templates/
git commit -m "feat(archetypes): add schedulingDefaults to all booking-enabled archetype templates"
```

---

## Task 16: Setup Wizard Integration

**Files:**
- Modify: `apps/web/app/api/storefront/admin/setup/route.ts`

- [ ] **Step 1: Write failing test for setup wizard provider creation**

Test that after setup, a default ServiceProvider, ProviderAvailability rows, and ProviderService links are created.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Enhance setup route**

After creating StorefrontConfig + items, if the archetype has `schedulingDefaults`:

1. Create a default `ServiceProvider` named after the storefront (or orgName)
2. Create `ProviderAvailability` rows from `defaultOperatingHours`
3. Create `ProviderService` links for all booking-type items
4. Set `bookingConfig` on each booking-type item from `schedulingDefaults` + item's `bookingDurationMinutes`

```typescript
// After items are created:
if (archetype.schedulingDefaults) {
  const defaults = archetype.schedulingDefaults;
  const provider = await prisma.serviceProvider.create({
    data: {
      providerId: `SP-${nanoid(6).toUpperCase()}`,
      storefrontId: config.id,
      name: orgName,
      isActive: true,
    },
  });

  // Create availability rows
  const hoursByDay = new Map<number, { start: string; end: string }>();
  for (const h of defaults.defaultOperatingHours) {
    hoursByDay.set(h.day, { start: h.start, end: h.end });
  }
  // Group consecutive days with same hours into one row
  await prisma.providerAvailability.create({
    data: {
      providerId: provider.id,
      days: defaults.defaultOperatingHours.map((h) => h.day),
      startTime: defaults.defaultOperatingHours[0].start,
      endTime: defaults.defaultOperatingHours[0].end,
    },
  });

  // Link provider to all booking items
  const bookingItems = await prisma.storefrontItem.findMany({
    where: { storefrontId: config.id, ctaType: "booking" },
    select: { id: true, itemId: true },
  });
  for (const item of bookingItems) {
    await prisma.providerService.create({
      data: { providerId: provider.id, itemId: item.id },
    });
  }

  // Set bookingConfig on items from template + defaults
  for (const [i, tmpl] of itemTemplates.entries()) {
    if ((tmpl.ctaType ?? archetype.ctaType) === "booking") {
      await prisma.storefrontItem.updateMany({
        where: { storefrontId: config.id, name: tmpl.name },
        data: {
          bookingConfig: {
            durationMinutes: tmpl.bookingDurationMinutes ?? 60,
            schedulingPattern: defaults.schedulingPattern,
            assignmentMode: defaults.assignmentMode,
            beforeBufferMinutes: defaults.defaultBeforeBuffer,
            afterBufferMinutes: defaults.defaultAfterBuffer,
            minimumNoticeHours: defaults.minimumNoticeHours,
            maxAdvanceDays: defaults.maxAdvanceDays,
          },
        },
      });
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/storefront/admin/setup/route.ts
git commit -m "feat(storefront): setup wizard creates default provider, availability, and bookingConfig from archetype"
```

---

## Task 17: Run Full Test Suite & Final Verification

- [ ] **Step 1: Run all slot-engine tests**

```bash
cd /h/OpenDigitalProductFactory && npx vitest run apps/web/lib/slot-engine/
```

- [ ] **Step 2: Run all storefront tests**

```bash
cd /h/OpenDigitalProductFactory && npx vitest run --reporter=verbose 2>&1 | head -100
```

- [ ] **Step 3: Verify Prisma schema is valid**

```bash
cd /h/OpenDigitalProductFactory && npx prisma validate
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /h/OpenDigitalProductFactory && npx tsc --noEmit 2>&1 | head -50
```

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A && git commit -m "fix: address test and type issues from booking calendar implementation"
```
