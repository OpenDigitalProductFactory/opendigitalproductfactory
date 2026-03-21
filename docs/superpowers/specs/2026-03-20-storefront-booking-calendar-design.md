# EP-STORE-003: Storefront Booking Calendar

**Status:** Draft
**Date:** 2026-03-20
**Epic:** Storefront Booking Calendar — Availability, Slot Computation & Scheduling Patterns
**Depends on:** Storefront Foundation (EP-STORE-001 — complete)
**Parallel with:** EP-CAL-001 (internal calendar infrastructure — separate concern)

---

## Problem

The storefront has booking-enabled archetypes across multiple categories (hair salons, vet clinics, yoga studios, restaurants, etc.), but the booking flow is broken:

1. **No availability model** — customers pick any date/time via a free-form datetime picker with zero conflict detection
2. **No staff/provider concept** — bookings are not assigned to anyone who can deliver the service
3. **Setup gap** — archetype templates define `bookingDurationMinutes` but the setup wizard doesn't transfer it to `StorefrontItem.bookingConfig`
4. **Single scheduling pattern** — all archetypes use the same free-form picker, despite needing slot-based (salon), class-based (yoga), or recurring (maintenance) patterns

## Goal

Make every booking-enabled archetype functional out of the box:

1. **Slot-based 1:1 appointments** — customer picks from computed available slots, provider assigned via next-available queue or customer choice (14 archetypes: salon, vet, dentist, therapist, tutoring, grooming)
2. **Class/session enrollment** — fixed schedule with capacity limits, customer enrolls in a session (3-4 archetypes: yoga drop-in, dance drop-in, restaurant tables)
3. **Recurring service schedules** — customer opts into repeating visits on a cadence (maintenance contracts, dog walking packages)

All three patterns share a common foundation: provider availability, conflict detection, buffer time, and reservation holds.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Slot storage | Computed on demand, never stored | Universal pattern across Cal.com, Calendly, Acuity, Easy!Appointments. Stored slots go stale when calendars change. |
| Availability model | Single table with nullable `date` (Cal.com pattern) | `date = NULL` → recurring weekly rule. `date = non-null` → date-specific override. Eliminates separate schedule + exception tables. |
| Race condition prevention | Optimistic reservation hold with TTL (Cal.com `SelectedSlots` pattern) | Creates `BookingHold` when customer selects slot, expires after 10 minutes. No DB locks needed at SMB scale. |
| Buffer time | Separate before/after buffers | Therapist needs 10 min prep before AND 15 min cleanup after. Single buffer is insufficient. (Cal.com, Calendly pattern) |
| Provider assignment | Weighted round-robin with priority levels | Cal.com `Host.weight`/`priority` pattern. Handles "senior stylist gets fewer bookings" and "new hire ramp-up." |
| Provider-service mapping | Explicit join table | "Stylist A does cuts but not colour" is universal. Cal.com `Host`, Easy!Appointments `services_providers`. |
| Archetype defaults | Scheduling pattern + config seeded per category | No other system does this. Our differentiator — booking works on day one after setup. |
| Timezone | IANA identifiers, store UTC, display in storefront timezone | Universal best practice. Named timezones handle DST automatically. |
| Cancellation | Simple `cancellationReason` + `cancelledAt` on booking | Full policy model (Booking.com) is overbuilt for SMB v1. |
| Chained services | Deferred | Cut + colour = two resources booked together. SuperSaaS does this. Significant complexity for a v1 edge case. |

---

## Data Model

### New Models

#### ServiceProvider

A person or resource that delivers bookable services on a storefront.

```prisma
model ServiceProvider {
  id           String   @id @default(cuid())
  providerId   String   @unique              // Human-readable: SP-xxxx
  storefrontId String                        // FK to StorefrontConfig
  name         String
  email        String?
  phone        String?
  avatarUrl    String?
  employeeId   String?                       // FK to EmployeeProfile (nullable for contractors)
  isActive     Boolean  @default(true)
  priority     Int      @default(0)          // Lower = higher priority in round-robin
  weight       Int      @default(100)        // Relative booking distribution weight
  sortOrder    Int      @default(0)          // Display order in customer-choice UI
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  storefront   StorefrontConfig @relation(fields: [storefrontId], references: [id])
  employee     EmployeeProfile? @relation(fields: [employeeId], references: [id])
  services     ProviderService[]
  availability ProviderAvailability[]
  bookings     StorefrontBooking[]

  @@index([storefrontId])
}
```

#### ProviderService

Which providers can deliver which services (many-to-many).

```prisma
model ProviderService {
  id         String @id @default(cuid())
  providerId String // FK to ServiceProvider
  itemId     String // FK to StorefrontItem

  provider   ServiceProvider @relation(fields: [providerId], references: [id], onDelete: Cascade)
  item       StorefrontItem  @relation(fields: [itemId], references: [id], onDelete: Cascade)

  @@unique([providerId, itemId])
}
```

#### ProviderAvailability

Unified schedule rules — weekly recurring AND date-specific overrides in one table (Cal.com pattern).

```prisma
model ProviderAvailability {
  id         String    @id @default(cuid())
  providerId String                        // FK to ServiceProvider
  days       Int[]     @default([])        // Day-of-week array [1,2,3,4,5] (0=Sun..6=Sat)
  startTime  String                        // Local time "09:00"
  endTime    String                        // Local time "17:00"
  date       DateTime?                     // NULL = recurring weekly rule, NON-NULL = date-specific override
  isBlocked  Boolean   @default(false)     // true = unavailable on this date (override only)
  reason     String?                       // "Bank Holiday", "Training Day"
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  provider   ServiceProvider @relation(fields: [providerId], references: [id], onDelete: Cascade)

  @@index([providerId])
  @@index([providerId, date])
}
```

**How it works:**
- Row with `date = NULL`, `days = [1,2,3,4,5]`, `startTime = "09:00"`, `endTime = "17:00"` → "Mon-Fri 9am-5pm every week"
- Row with `date = 2026-04-18`, `isBlocked = true`, `reason = "Good Friday"` → "Closed on April 18"
- Row with `date = 2026-04-19`, `startTime = "10:00"`, `endTime = "14:00"` → "Custom hours on April 19"
- Date-specific overrides fully replace recurring rules for that date. No merging.

#### BookingHold

Temporary slot reservation to prevent double-booking during form completion (Cal.com `SelectedSlots` pattern).

```prisma
model BookingHold {
  id           String           @id @default(cuid())
  storefrontId String
  itemId       String
  providerId   String?                      // NULL for class bookings
  slotStart    DateTime                     // UTC
  slotEnd      DateTime                     // UTC
  holderToken  String                       // Cryptographically random token (crypto.randomUUID)
  expiresAt    DateTime                     // TTL: now() + 10 minutes
  createdAt    DateTime         @default(now())

  storefront   StorefrontConfig @relation(fields: [storefrontId], references: [id], onDelete: Cascade)
  item         StorefrontItem   @relation(fields: [itemId], references: [id], onDelete: Cascade)
  provider     ServiceProvider? @relation(fields: [providerId], references: [id], onDelete: Cascade)

  @@index([storefrontId, slotStart, slotEnd])
  @@index([expiresAt])
}
```

> Add back-relations: `StorefrontConfig` gains `bookingHolds BookingHold[]`, `StorefrontItem` gains `bookingHolds BookingHold[]`, `ServiceProvider` gains `bookingHolds BookingHold[]`.

Passive cleanup: expired holds are filtered out during slot queries, not deleted by a background job. Stateless, Vercel-friendly. No `updatedAt` — holds are immutable until deleted (intentional deviation from convention).

### Extended Models

#### StorefrontConfig — new field

```prisma
  timezone  String  @default("Europe/London")  // IANA timezone for slot display and availability interpretation
```

All slot computation uses this timezone to interpret `ProviderAvailability` local times and convert to UTC.

#### StorefrontItem — new relation

```prisma
  providerServices  ProviderService[]
```

> **Note on `StorefrontBooking.itemId`:** Currently a bare `String` with no FK relation. This epic adds `providerId` with a proper relation but does not refactor `itemId` to a FK — that's a separate migration concern affecting existing booking data. The slot computation engine joins through `ProviderService` (which has proper FKs to both sides), so queries are still correct.

#### StorefrontItem.bookingConfig (JSON)

Expanded from `{ durationMinutes }` to:

```typescript
interface BookingConfig {
  durationMinutes: number;                  // Service duration
  beforeBufferMinutes?: number;             // Prep time before (default 0)
  afterBufferMinutes?: number;              // Cleanup time after (default 0)
  minimumNoticeHours?: number;              // Minimum advance booking (default 1)
  maxAdvanceDays?: number;                  // How far ahead to book (default 60)
  slotIntervalMinutes?: number;             // Slot spacing; defaults to durationMinutes
  schedulingPattern: "slot" | "class" | "recurring";
  assignmentMode: "next-available" | "customer-choice";
  capacity?: number;                        // For class pattern: max concurrent (default 1)
  bookingLimits?: {                         // Max bookings per period per provider
    day?: number;
    week?: number;
    month?: number;
  };
}
```

#### StorefrontBooking — new fields

```prisma
// Add to existing StorefrontBooking model:
  providerId        String?                 // FK to ServiceProvider
  assignmentMode    String?                 // "next-available" | "customer-choice"
  recurrenceRule    String?                 // "weekly" | "biweekly" | "monthly"
  recurrenceEndDate DateTime?
  parentBookingId   String?                 // Self-ref FK for recurring instances
  fromReschedule    String?                 // bookingRef of original if rescheduled
  cancellationReason String?
  cancelledAt       DateTime?
  idempotencyKey    String?   @unique       // Prevents duplicate form submissions

  provider          ServiceProvider? @relation(fields: [providerId], references: [id])
  parentBooking     StorefrontBooking? @relation("BookingRecurrence", fields: [parentBookingId], references: [id])
  childBookings     StorefrontBooking[] @relation("BookingRecurrence")
```

---

## Slot Computation Engine

All slots are computed on demand. No slot table. No background generation.

### Function: `computeAvailableSlots(itemId, date, providerId?)`

**Pipeline:**

1. **Load config** — item's `bookingConfig` (duration, buffers, notice, advance, interval, pattern, assignment mode)
2. **Validate date** — reject if before `minimumNoticeHours` from now or after `maxAdvanceDays` from today
3. **Load eligible providers** — specific provider if requested, or all active providers linked via `ProviderService`
4. **For each provider, build available windows:**
   - Query `ProviderAvailability` where `date` matches exactly (date-specific override). If found, use those rules exclusively — they fully replace recurring rules for that date
   - If no date override, query where `date IS NULL` and provider's `days` array contains the target day-of-week
   - If `isBlocked = true` on a date override, provider has zero availability
5. **Subtract busy times:**
   - Existing `StorefrontBooking` rows for this provider on this date (status not `cancelled`)
   - Each booking's item config determines its own buffer needs. Extend each booking's effective busy window by its `beforeBufferMinutes` before start and `afterBufferMinutes` after end.
   - Active `BookingHold` rows where `expiresAt > now()` and `holderToken != currentToken` — treated as busy periods (slotStart to slotEnd)
6. **Generate slots** — within each available window, generate candidates at `slotIntervalMinutes` intervals. A candidate slot's effective footprint is `[slotStart - beforeBuffer, slotStart + duration + afterBuffer]`. The slot is available if this footprint does not overlap any busy period from step 5. This ensures both the existing booking's buffers AND the new slot's buffers are respected.
7. **Apply booking limits** — if `bookingLimits.day` is set, count existing bookings for this provider on this date. Skip provider if at limit. Same for week/month.
8. **Aggregate by mode:**
   - `"next-available"`: merge all providers' slots. For each unique start time, pick provider using weighted round-robin: `effectiveWeight = weight / (1 + recentBookingCount - lowestBookingCount)`, then by `priority` (lower = first). `recentBookingCount` is derived from the database — count of non-cancelled bookings per provider in the current calendar week (Mon-Sun). This is a DB query, not in-memory state, so it survives restarts. Return deduplicated slots with assigned provider.
   - `"customer-choice"`: return slots grouped by provider
   - `"class"`: slots are the schedule windows. Each shows `capacity - currentEnrollment` remaining. Slot exists while remaining > 0.

### Function: `getAvailableDates(itemId, yearMonth)`

Returns an array of dates in the month that have at least one available slot. Algorithm per date:

1. Check at least one provider has an availability window for that day (recurring rule with matching day-of-week, or a non-blocked date override)
2. Count existing bookings for that provider on that date
3. Compute maximum possible slots from the availability window (window duration / slotInterval)
4. If bookings < max possible slots for at least one provider, the date is available

This is cheaper than full slot enumeration (no buffer math or hold checking) but correctly greys out fully-booked days. False positives are acceptable (a date may show as available but have no slots after buffer/hold subtraction) — the full `computeAvailableSlots` call on date selection handles the precise check.

### Return types

```typescript
type AvailableSlot = {
  startTime: string;             // "09:00" (local to storefront timezone)
  endTime: string;               // "09:45"
  providerId?: string;           // Pre-assigned for next-available; null for customer-choice
  providerName?: string;         // Display name
  remainingCapacity?: number;    // For class pattern
};

type SlotsByProvider = {
  provider: { id: string; name: string; avatarUrl?: string };
  slots: AvailableSlot[];
};

type AvailableSlotsResult =
  | { mode: "next-available"; slots: AvailableSlot[] }
  | { mode: "customer-choice"; providers: SlotsByProvider[] }
  | { mode: "class"; slots: AvailableSlot[] };
```

### Timezone handling

- All `StorefrontBooking.scheduledAt` and `BookingHold` times stored in UTC
- `ProviderAvailability.startTime`/`endTime` are in the storefront's local timezone (IANA, stored on `StorefrontConfig`)
- Slot computation converts provider local times to UTC for comparison with bookings
- API returns slots in the storefront's local timezone for customer display
- DST transitions handled by IANA timezone library — no offset-based math

### Reservation hold flow

1. Customer selects a slot → POST to `/api/storefront/[slug]/hold` creates `BookingHold` with 10-minute TTL, returns `holderToken`
2. Customer fills booking form (name, email, phone, notes)
3. Customer submits → `submitBooking()` validates `holderToken` matches an active hold for that slot, creates `StorefrontBooking`, deletes the hold
4. If form is abandoned, hold expires passively. Next slot query filters out expired holds.
5. If two customers select the same slot within the hold window, the second attempt sees the slot as unavailable (first hold blocks it)

---

## Booking Form UX

The current free-form `BookingForm` is replaced with a slot-driven `SlotBookingFlow`.

### Customer flow

1. Customer lands on `/s/[slug]/book/[itemId]`
2. Page loads item config, determines `schedulingPattern` and `assignmentMode`
3. **Date picker** — month calendar. Days with zero availability greyed out (uses `getAvailableDates`)
4. Customer picks a date → fetch `computeAvailableSlots(itemId, date)`
5. **Slot display** varies by mode:
   - `next-available`: grid of time buttons ("9:00", "9:45", "10:30"...). Customer picks a time.
   - `customer-choice`: provider cards with name + avatar, each showing available times. Customer picks provider then time.
   - `class`: session list with remaining capacity ("9:00 AM Yoga — 3 spots left"). Customer picks a session.
6. Customer selects slot → `BookingHold` created → form fields appear (from archetype `formSchema`)
7. Submit → `submitBooking()` with hold validation → confirmation page

### Recurring booking flow

For services that support recurring scheduling:

1. After selecting the first slot, customer sees "Make this recurring?" toggle
2. Options: weekly, biweekly, monthly. End date picker (default: 3 months out).
3. System projects future dates from the recurrence rule and checks availability for each:
   - Green = slot available at the same time with an eligible provider
   - Yellow = slot available but at a different time or with a different provider
   - Red = no availability on that date
4. Customer reviews projected dates and confirms

**Creation strategy:** All child bookings are created at confirmation time (not lazily). Each child is an independent `StorefrontBooking` row with `parentBookingId` linking to the parent. No `BookingHold` is created for future instances — the risk of a future conflict is accepted. The parent booking holds the first slot normally.

**Conflict handling:** If a provider blocks a future date after the recurring booking is created, the affected child booking's status is set to `needs-reschedule` (new status value). The admin inbox surfaces these for manual resolution.

**Individual instance management:**
- Each child booking can be cancelled or rescheduled independently without affecting siblings
- Cancelling the parent booking cancels all future child bookings (past/completed children are unaffected)
- Rescheduling a child creates a new booking with `fromReschedule` linking to the original child

**Provider assignment for recurring:** In `next-available` mode, each child instance may get a different provider based on availability at that future date. In `customer-choice` mode, the same provider is preferred for all instances but falls back if unavailable.

### API routes and server actions

**API routes** (called from client components, return JSON):
- `GET /api/storefront/[slug]/dates?itemId=&month=` → available dates for month
- `GET /api/storefront/[slug]/slots?itemId=&date=&providerId?=` → available slots for date
- `POST /api/storefront/[slug]/hold` → create reservation hold, returns `{ holderToken, expiresAt }`

**Server actions** (called via `useTransition`, match existing storefront pattern):
- `submitBooking()` in `storefront-actions.ts` — enhanced with hold validation, provider assignment, recurrence creation. Existing booking submission stays as a server action for consistency with `submitOrder`, `submitInquiry`, `submitDonation`.

The split is intentional: slot queries and holds are stateless REST endpoints (cacheable, no form state). Booking submission is a server action (matches existing CTA pattern, handles form data natively).

---

## Admin Configuration Surface

### Provider Management (`/storefront/team`)

- List `ServiceProvider` rows for this storefront
- Add provider: name, email, avatar, link to employee (optional)
- Per-provider inline: schedule editor, service assignments, priority/weight
- Copy schedule from another provider (bulk action)

### Schedule Editor (inline on provider card)

- Weekly grid: per-day start/end time inputs
- Date-specific overrides: "Add exception" → pick date, block or set custom hours, reason
- Preview: next 7 days computed availability

### Booking Settings (extend `/storefront/settings`)

- Default operating hours (template for new providers)
- Default buffers, lead time, max advance days
- Per-item config editable on items manager (expanded `bookingConfig` fields)

### Inbox Enhancement

- Provider assignment column on booking rows
- Reschedule action → creates new booking with `fromReschedule` link
- Cancel with reason → sets `cancellationReason` + `cancelledAt`
- Filter by provider
- Status workflow: pending → confirmed → completed / no-show / cancelled

---

## Archetype Integration — Out-of-Box Defaults

Each archetype category seeds scheduling defaults so booking works on day one.

### Archetype template extension

```typescript
// Added to archetype template type
schedulingDefaults: {
  schedulingPattern: "slot" | "class" | "recurring";
  assignmentMode: "next-available" | "customer-choice";
  defaultOperatingHours: { day: number; start: string; end: string }[];
  defaultBeforeBuffer: number;
  defaultAfterBuffer: number;
  minimumNoticeHours: number;
  maxAdvanceDays: number;
}
```

### Category defaults

| Category | Pattern | Assignment | Hours | Before/After Buffer | Notice | Max Advance |
|----------|---------|------------|-------|---------------------|--------|-------------|
| beauty-personal-care | slot | customer-choice | Mon-Sat 9-18 | 0 / 10 min | 2h | 60 days |
| healthcare-wellness | slot | customer-choice | Mon-Fri 8-17 | 5 / 10 min | 24h | 90 days |
| pet-services | slot | next-available | Mon-Sat 8-18 | 5 / 15 min | 4h | 60 days |
| fitness-recreation | class | next-available | Mon-Sun 6-21 | 0 / 5 min | 1h | 30 days |
| food-hospitality | slot | next-available | daily 11-22 | 0 / 15 min | 1h | 30 days |
| education-training | slot | customer-choice | Mon-Fri 9-18 | 5 / 5 min | 24h | 60 days |
| trades-maintenance* | slot | next-available | Mon-Fri 8-17 | 15 / 15 min | 48h | 90 days |

> *Trades archetypes currently use `ctaType: "inquiry"`. These defaults apply only when individual items within a trades storefront are configured with `ctaType: "booking"` (e.g., "Boiler Service" on a plumber's storefront). The archetype-level CTA remains inquiry; scheduling defaults are item-level overrides.

### Setup wizard changes

When the wizard creates a storefront from an archetype, it now also:

1. Maps `bookingDurationMinutes` from item templates → `StorefrontItem.bookingConfig.durationMinutes` (fixing current gap)
2. Maps archetype `schedulingDefaults` → `bookingConfig` fields on each booking-type item
3. Creates a default `ServiceProvider` named after the storefront (single-provider starting point)
4. Creates `ProviderAvailability` rows from `defaultOperatingHours`
5. Creates `ProviderService` links for all booking-type items

**Result:** A new hair salon storefront is immediately bookable after setup. Admin adds stylists and adjusts hours later.

---

## Research & Benchmarking

### Systems Compared

| System | Type | Key Learnings |
|--------|------|---------------|
| **Cal.com** | Open source (Prisma/Next.js) | Gold standard. Unified `Availability` table, `SelectedSlots` for race prevention, weighted round-robin `Host` model, booking limits, separate before/after buffers. |
| **Easy!Appointments** | Open source (PHP) | Explicit `services_providers` join table. Treats breaks as "unavailable appointments." Simple but lacks overrides, buffers, and group booking. |
| **Calendly** | Commercial | Round-robin with booking-count balancing (max 3 ahead). Collective availability (intersection). Rolling window for max advance. |
| **Acuity Scheduling** | Commercial (Squarespace) | Class bookings as distinct concept. Capacity limits per session. Package/credit bundles. |
| **SuperSaaS** | Commercial | Two-tier resource scheduling (resource → service aggregation). AND/OR logic for multi-resource services. Chained bookings. |
| **Booking.com** | Commercial | Full cancellation policy model (flexible/partial/non-refundable). Three penalty types. |

### Patterns Adopted

| Pattern | Source | Rationale |
|---------|--------|-----------|
| Unified availability (nullable `date`) | Cal.com | Single table handles recurring + overrides. No separate exception table. |
| Computed slots (never stored) | All 6 systems | Stored slots go stale. Every major system computes on demand. |
| Optimistic reservation hold | Cal.com `SelectedSlots` | Prevents double-booking without DB locks. Right scale for SMB. |
| Separate before/after buffers | Cal.com, Calendly | Different prep and cleanup needs per service. |
| Weighted round-robin + priority | Cal.com `Host` | Fair distribution with configurable weighting. |
| Provider-service join table | Easy!Appointments, Cal.com | "Provider A does X but not Y" is universal in service businesses. |
| Idempotency key on bookings | Cal.com | Prevents duplicate submissions from network retries. |
| Reschedule audit trail | Cal.com | `fromReschedule` preserves change history for regulated industries. |
| Booking limits per period | Cal.com | Prevents overbooking and provider burnout. |

### Patterns Rejected

| Pattern | Source | Why Rejected |
|---------|--------|-------------|
| Stored slot table | Hotel/airline systems | Stale data, storage explosion, sync overhead. |
| Pessimistic DB locking | Enterprise booking | Overkill for SMB. Deadlock risk, reduced throughput. |
| Separate schedule + exception tables | Easy!Appointments | Cal.com's nullable `date` is cleaner. |
| Chained service bookings (AND/OR) | SuperSaaS | Cut + colour = two resources. Significant complexity for v1 edge case. Deferred. |
| Full cancellation policy model | Booking.com | Overbuilt for SMB. Simple reason + timestamp sufficient for v1. |

### Our Differentiators

- **Archetype-driven defaults** — no other system pre-configures scheduling per business type
- **Four CTA types** on one storefront — booking/purchase/inquiry/donation. Other systems are booking-only.
- **AI coworker MCP integration** — scheduled as follow-on via `calendar_manage_event` tool

### Anti-Patterns Avoided

- No stored slots (stale data risk)
- Split before/after buffers (not single)
- IANA timezones (not UTC offsets)
- Reservation holds (not unprotected)
- Passive hold cleanup (not background jobs)
- Idempotency keys (not unprotected form submission)

---

## Security

- **Slot queries** are public (no auth required — customer browsing storefront)
- **Booking submission** requires no auth (matches existing storefront pattern — customer provides email)
- **Admin actions** (provider management, schedule editing, booking confirmation) require `manage_storefront` capability
- **Provider schedule data** is not exposed to customers — they see computed slots only

### Hold rate limiting

Hold creation requires no auth but is rate-limited to prevent slot exhaustion attacks:

- **Per IP per storefront:** max 3 active (non-expired) holds at any time, max 10 hold creations per hour
- **Per storefront global:** max 50 concurrent active holds (prevents coordinated attacks)
- **Enforcement:** in-handler check against `BookingHold` table counts. No middleware needed — the DB query is the rate check.
- **Exceeded:** returns HTTP 429 with `Retry-After` header

### Holder token

- Generated server-side via `crypto.randomUUID()` (cryptographically random, 128-bit)
- Returned in the hold response body as `{ holderToken, expiresAt }`
- Stored in React component state (NOT localStorage — avoids XSS exposure)
- Passed back in the booking submission request body for validation
- Server verifies: hold exists, matches token, not expired, slot matches booking request

### Slot enumeration privacy

Public slot queries reveal which times are booked by omission (missing slots imply existing bookings). For some businesses (therapists, counsellors), this leaks client activity patterns. This is an inherent trade-off of public slot display and matches industry standard (Cal.com, Calendly, Acuity all expose this). A follow-on could offer a "hide availability" mode that only shows date-level availability, not time-level.

---

## Type Location

`BookingConfig` interface lives in `packages/types/src/entities.ts` with a corresponding Zod schema in `packages/validators/src/storefront.ts`. This matches the existing pattern for shared types with runtime validation.

## Migration & Backwards Compatibility

All new fields on `StorefrontBooking` are nullable or have defaults — the migration is purely additive. Existing bookings continue to work:

- `providerId = null` → displayed as "Unassigned" in the inbox
- `assignmentMode = null` → treated as legacy booking (no provider assignment)
- `idempotencyKey = null` → existing bookings predate the key; only new bookings enforce uniqueness
- `schedulingPattern` on `bookingConfig` → existing items without it treated as `"slot"` (backwards-compatible default)

**Existing storefronts (created before this epic):** Have zero `ServiceProvider` rows. The slot computation engine requires at least one provider. Two options:
1. Admin is prompted to add a provider before booking is enabled ("Add your first team member to start accepting bookings")
2. The admin team page shows a setup prompt when no providers exist

Option 1 is implemented. No data migration creates phantom providers.

**New status value:** `StorefrontBooking.status` gains `"needs-reschedule"` for recurring instances affected by schedule changes. Existing status values (`pending`, `confirmed`, `cancelled`, `completed`, `no-show`) are unchanged.

---

## Testing Strategy

- **Unit tests:** Slot computation with various provider/booking/hold combinations. Buffer math. Weighted round-robin assignment. Date validation. Timezone conversion.
- **Integration tests:** Full flow: create provider → set schedule → compute slots → hold → book → verify slot disappears
- **Edge case tests:** DST transition, midnight-spanning availability, provider with zero services, overlapping holds from two sessions, booking limit enforcement, idempotency key duplicate rejection

---

## What We Explicitly Defer

| Item | Why |
|------|-----|
| Chained services (cut + colour = two resources) | SuperSaaS pattern. Significant complexity. v1 handles individual service bookings. |
| External calendar sync (Google/Outlook) for providers | CalendarSync infrastructure exists but wiring to provider availability is follow-on |
| SMS/email booking reminders | Notification infrastructure needed first |
| Payment capture on booking | EP-STORE-005 (payment processing epic) |
| Customer self-service reschedule/cancel portal | v1: admin handles via inbox. Customer portal is follow-on. |
| Waitlist for full class sessions | v1: full = unavailable. Waitlist adds notification complexity. |
| Walk-in queue management | Real-time queue display is a different UX pattern from scheduled booking. |
| Full cancellation policy model | Simple reason + timestamp sufficient for SMB v1. |
| MCP tool for AI coworker scheduling | Builds on `calendar_manage_event` from EP-CAL-001. Follow-on. |
