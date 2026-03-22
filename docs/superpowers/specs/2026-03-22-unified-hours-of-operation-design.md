# Unified Hours of Operation Setup

**Date:** 2026-03-22
**Status:** Draft
**Epic:** EP-STORE-OPS
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Depends on:**
- `docs/superpowers/specs/2026-03-21-change-deployment-management-design.md` (BusinessProfile, DeploymentWindow models)
- `docs/superpowers/specs/2026-03-15-calendar-infrastructure-design.md` (CalendarEvent scheduling)
**Unblocks:**
- EP-STORE-SCHED (Recurring Class/Session Scheduling) — timetable builder for training/class-based businesses
- EP-CHG-MGMT-012 (Booking blocks during maintenance windows)

## Problem Statement

Three disconnected systems handle "when is this business operating":

1. **Storefront booking hours** — derived from archetype templates during storefront setup, stored in `ProviderAvailability`. Only exists if the business has a storefront.
2. **Deployment window hours** — hardcoded Monday-Friday 08:00-18:00 UTC in seed script, stored in `BusinessProfile`. Never reflects the actual business's operating pattern.
3. **Non-storefront businesses** — have no setup step for operating hours at all. The platform assumes generic defaults that may be completely wrong for their situation.

Consequences:
- Deployment windows don't align with actual business operations. A Saturday-open salon gets maintenance windows calculated against a Monday-Friday schedule.
- Businesses without a storefront (consultancies, back-office operations) have no way to tell the platform when they operate.
- The storefront setup derives hours from archetype templates independently, so even businesses that set up a storefront end up with two potentially conflicting definitions of "when are we open."
- Low-traffic windows for change scheduling are meaningless because the underlying BusinessProfile doesn't reflect reality.

## Design Summary

A dedicated "Hours of Operation" step in the onboarding flow that captures the business's operating schedule once and feeds it to both the change management system (BusinessProfile/DeploymentWindow) and the storefront booking system (ProviderAvailability).

### Key Principles

- **Single source of truth during setup** — operating hours are captured once and flow to both systems. After setup, each system's hours can diverge independently (a business may extend booking hours beyond core operating hours, or restrict deployments to a narrower window).
- **Smart defaults from business type** — the archetype (if selected) or industry (from org-settings) pre-fills typical operating hours. Users confirm or adjust.
- **Every business gets this step** — storefront or not. Operating hours are a business-level concern, not a storefront feature.
- **Reusable component** — the hours editor built for setup is reused in admin settings for post-setup changes.

---

## Section 1: Setup Flow Integration

### 1.1 New Step Position

The onboarding flow becomes:

```
account-bootstrap → ai-providers → branding → org-settings → operating-hours → storefront → build-studio → workspace
```

The step is inserted between `org-settings` (which captures timezone and location) and `storefront` (which may use the hours for booking setup).

### 1.2 COO Introduction

When the COO guides the user to this step:

> "Now let's set your operating hours. These determine when we schedule platform maintenance outside your business hours, and when your team is available for bookings if you set up a storefront."

For businesses that have already selected an archetype (if storefront setup was visited first in a non-linear flow):

> "Based on your business type, I've pre-filled typical operating hours. Adjust anything that doesn't match your schedule."

### 1.3 Setup Constants Update

In `apps/web/lib/actions/setup-constants.ts`:

- Add `"operating-hours"` to the `SETUP_STEPS` array, positioned after `"org-settings"`
- Add to `STEP_ROUTES`: `"operating-hours"` → `"/admin/operating-hours"`
- Add to `STEP_LABELS`: `"operating-hours"` → `"Operating Hours"`

---

## Section 2: Hours Editor Component

### 2.1 UI Design

A weekly schedule grid:

- **7 rows** — Monday through Sunday (following ISO week order, localized display)
- **Each row contains:**
  - Day label (e.g., "Monday")
  - On/off toggle (is the business open this day?)
  - Start time picker (e.g., "09:00")
  - End time picker (e.g., "17:00")
- **Pre-filled from defaults** (see Section 3)
- **Validation:** end time must be after start time; at least one day must be enabled

### 2.2 Scope for v1

- **Single contiguous block per day** — no split shifts (e.g., no "9-12 and 14-17"). Split shifts are a future enhancement.
- **Same hours apply to the whole business** — no per-department or per-provider hour overrides in this step. Provider-specific availability is managed separately in storefront admin.
- **Weekly recurrence only** — no seasonal variation. Seasonal profiles (holiday hours, summer hours) are a future enhancement via additional BusinessProfile records.

### 2.3 Reuse

The `OperatingHoursEditor` component is used in two places:

1. **Onboarding step** — `/admin/operating-hours` (setup context, COO-guided)
2. **Admin settings** — `/admin/settings` or `/ops/changes` Windows tab (post-setup editing)

The component accepts `defaultHours` (pre-filled schedule) and `onSave` (callback with the validated schedule). It does not handle persistence — the parent page decides what to do with the data.

---

## Section 3: Smart Defaults

### 3.1 Default Derivation Priority

When the operating hours step loads, defaults are derived in this order:

1. **Existing operating hours** — if `BusinessProfile` already has non-default hours (user previously completed this step), use those
2. **Archetype scheduling defaults** — if a storefront archetype has been selected and has `schedulingDefaults.defaultOperatingHours`, use those
3. **Industry heuristics** — if org-settings captured an industry but no archetype (or the archetype has no `schedulingDefaults`, as is the case for professional-services, trades-maintenance, and fitness-recreation archetypes), apply industry-level defaults:
   - Healthcare/wellness: M-F 08:00-17:00 (matches healthcare archetype)
   - Beauty/personal care: M-F 09:00-18:00, Sat 09:00-17:00 (matches beauty archetype)
   - Retail/hospitality: M-Sat 09:00-18:00, Sun 10:00-16:00
   - Professional services: M-F 09:00-17:00
   - Trades/maintenance: M-F 07:00-16:00
   - Fitness/recreation: M-F 06:00-21:00, Sat-Sun 08:00-18:00
   - Education/training: M-F 08:30-17:00
   - Pet services: M-F 08:00-18:00, Sat 09:00-14:00 (matches veterinary archetype)
4. **Generic fallback** — M-F 09:00-17:00 in the organization's configured timezone

### 3.2 Timezone

**Note:** The `Organization` model does not have a `timezone` field. Timezone is stored on:
- `StorefrontConfig.timezone` (default `"Europe/London"`) — only exists if storefront is set up
- `BusinessProfile.timezone` (default `"UTC"`) — always exists after seed
- `EmployeeProfile.timezone` — per-employee, not relevant here

For the operating hours step, timezone is read from `BusinessProfile.timezone`. The org-settings step should write the user's chosen timezone to `BusinessProfile.timezone` (in addition to `StorefrontConfig.timezone` if applicable). If neither has been set, the hours editor shows UTC and prompts the user to confirm.

All stored times are timezone-naive strings (e.g., "09:00") interpreted against the BusinessProfile timezone.

---

## Section 4: Data Flow on Save

### Data Format Transformations

Three systems store operating hours in different formats. The `saveOperatingHours` action is the transformation hub:

| System | Format | Example |
|--------|--------|---------|
| **UI Component** (`WeeklySchedule`) | `{ dayName: { enabled, open, close } }` | `{ monday: { enabled: true, open: "09:00", close: "17:00" } }` |
| **BusinessProfile** (`businessHours` JSON) | `{ dayName: { open, close } \| null }` | `{ monday: { open: "09:00", close: "17:00" }, saturday: null }` |
| **Archetype templates** (`defaultOperatingHours`) | `{ day: number, start: string, end: string }[]` | `[{ day: 1, start: "08:00", end: "17:00" }]` |
| **ProviderAvailability** (Prisma model) | `{ days: Int[], startTime, endTime }` | `{ days: [1,2,3,4,5], startTime: "09:00", endTime: "17:00" }` |
| **DeploymentWindow** (Prisma model) | `{ dayOfWeek: Int[], startTime, endTime }` | `{ dayOfWeek: [1,2,3,4,5], startTime: "17:00", endTime: "09:00" }` |

**Day numbering:** All systems use 0=Sunday, 1=Monday...6=Saturday (ISO `Date.getDay()` convention). Day names in BusinessProfile JSON use lowercase English (`monday`, `tuesday`, etc.).

**Mapping from `WeeklySchedule` → `BusinessProfile.businessHours`:** `{ enabled: false }` → `null`. `{ enabled: true, open, close }` → `{ open, close }`.

**Mapping from archetype `defaultOperatingHours` → `WeeklySchedule`:** `day` integer → day name lookup. `start` → `open`, `end` → `close`. Days not in the array → `{ enabled: false }`.

**Mapping from `BusinessProfile.businessHours` → `ProviderAvailability`:** Group days with identical `open`/`close` values. Map `open` → `startTime`, `close` → `endTime`. Skip `null` (closed) days.

When the user saves their operating hours, the system performs these actions in a single Prisma transaction:

### 4.1 BusinessProfile Update

**Scoping:** The `BusinessProfile` model has no `organizationId` field — it is identified by `profileKey` (unique string). The platform is single-org. All code (seed script, deployment-windows actions) targets the single active profile via `findFirst({ where: { isActive: true } })` or `findUnique({ where: { profileKey: "default" } })`. This spec follows the same convention. Multi-org scoping is a future concern.

**Detection of user-set hours:** The seed script creates the default profile with M-F 08:00-18:00 UTC. To distinguish "user has explicitly set hours" from "seed defaults still in place", we add a `hoursConfirmedAt: DateTime?` field to `BusinessProfile` (null = seed defaults, set = user confirmed). This avoids fragile comparison against magic values. The operating hours step sets this timestamp on save.

```
BusinessProfile {
  profileKey: "default"
  businessHours: {
    monday:    { open: "09:00", close: "17:00" },
    tuesday:   { open: "09:00", close: "17:00" },
    ...
    saturday:  null,   // closed
    sunday:    null,   // closed
  }
  timezone: <from org-settings or existing value>
  hasStorefront: <true if storefront archetype selected>
  lowTrafficWindows: <auto-derived — see 4.2>
  hoursConfirmedAt: <timestamp of user confirmation>
}
```

This is an upsert — creates if no BusinessProfile exists, updates if one does.

### 4.2 Low-Traffic Windows Auto-Derivation

For each day the business is open, the hours outside operating hours are low-traffic windows. For closed days, the entire day is low-traffic.

Example for a business open M-F 09:00-17:00:
```json
[
  { "dayOfWeek": 1, "start": "00:00", "end": "09:00" },
  { "dayOfWeek": 1, "start": "17:00", "end": "23:59" },
  { "dayOfWeek": 2, "start": "00:00", "end": "09:00" },
  { "dayOfWeek": 2, "start": "17:00", "end": "23:59" },
  ...
  { "dayOfWeek": 6, "start": "00:00", "end": "23:59" },
  { "dayOfWeek": 0, "start": "00:00", "end": "23:59" }
]
```

### 4.3 Default Deployment Windows

The seed script creates two windows: `weeknight-maintenance` (M-F 22:00-06:00) and `weekend-maintenance` (Sat-Sun all day). When the user confirms operating hours, these seed windows are **replaced** — delete existing `weeknight-maintenance` and `weekend-maintenance`, then create new windows derived from the actual schedule.

For each distinct off-hours pattern, create a separate DeploymentWindow:

**Example for M-F 09:00-17:00, Sat-Sun closed:**
- Window 1: `off-hours-weeknight` — days [1,2,3,4,5], startTime "17:00", endTime "09:00" (overnight)
- Window 2: `off-hours-weekend` — days [0,6], startTime "00:00", endTime "23:59" (all day)

**Example for M-Sat 09:00-18:00, Sun closed:**
- Window 1: `off-hours-weeknight` — days [1,2,3,4,5,6], startTime "18:00", endTime "09:00"
- Window 2: `off-hours-sunday` — days [0], startTime "00:00", endTime "23:59"

All created windows use:
```
maxConcurrentChanges: 1
allowedChangeTypes: ["standard", "normal"]
allowedRiskLevels: ["low", "medium"]
enforcement: "advisory"
```

Windows are keyed with the `off-hours-` prefix. On subsequent saves (user edits hours later), all `off-hours-*` windows are deleted and recreated from the new schedule. Manually created windows are never touched.

### 4.4 ProviderAvailability Seeding

If a storefront archetype has been selected (or will be selected later):

- The storefront setup step checks whether `ProviderAvailability` records already exist for the default provider
- If they do (created by this step), storefront setup skips re-deriving from archetype
- If they don't (setup was non-linear), storefront setup creates them from archetype as today

When operating hours are saved and a ServiceProvider exists:
- Upsert `ProviderAvailability` records grouped by identical time windows
- Example: M-F 09:00-17:00 → one record with `days: [1,2,3,4,5]`, `startTime: "09:00"`, `endTime: "17:00"`

If no ServiceProvider exists yet (storefront not configured), skip this step. The storefront setup will inherit hours from BusinessProfile when it runs.

### 4.5 Storefront Setup Integration

Modify the storefront setup (`POST /api/storefront/admin/setup`, specifically the `schedulingDefaults.defaultOperatingHours` usage around line 103) to:

1. Check if `BusinessProfile.hoursConfirmedAt` is set (user has explicitly confirmed hours)
2. If yes, read `BusinessProfile.businessHours` and convert to the archetype format (`{ day, start, end }[]`) for `ProviderAvailability` seeding
3. If no (`hoursConfirmedAt` is null), fall back to archetype `schedulingDefaults.defaultOperatingHours` as today

This means the flow works regardless of step order:
- **Normal flow:** org-settings → operating-hours → storefront — storefront inherits confirmed hours
- **Skipped hours:** org-settings → storefront — storefront uses archetype defaults as today
- **No storefront:** org-settings → operating-hours → workspace — only BusinessProfile is populated

### 4.6 Transaction Safety

The `saveOperatingHours` action wraps all database operations (BusinessProfile upsert, deployment window deletion/creation, ProviderAvailability seeding) in a single `prisma.$transaction()`. If any step fails, the entire save rolls back to maintain consistency.

---

## Section 5: Schema Changes

### 5.0 BusinessProfile — New Field

Add `hoursConfirmedAt DateTime?` to the `BusinessProfile` model. This nullable timestamp distinguishes "user explicitly set hours" from "seed defaults still in place." Set on save in the operating hours step. Migration required.

No other schema changes. All other data is stored in existing JSON fields or existing models.

---

## Section 6: Server Actions

### 6.1 New Actions

File: `apps/web/lib/actions/operating-hours.ts`

| Function | Purpose |
|----------|---------|
| `getOperatingHours()` | Returns current operating hours from BusinessProfile, or smart defaults if none set |
| `saveOperatingHours(hours)` | Upserts BusinessProfile, derives low-traffic windows, creates/updates deployment window, optionally seeds ProviderAvailability |
| `getDefaultHoursForArchetype(archetypeId?)` | Returns pre-filled hours based on archetype or industry |

### 6.2 Modified Actions

| File | Change |
|------|--------|
| `apps/web/lib/actions/setup-constants.ts` | Add `"operating-hours"` step |
| `apps/web/app/api/storefront/admin/setup/route.ts` | Check BusinessProfile hours before falling back to archetype defaults |

---

## Section 7: Routes

### 7.1 New Route

`/admin/operating-hours` — setup page with `OperatingHoursEditor` component.

Server page loads current hours (or defaults), renders the editor, handles save via server action.

### 7.2 API Endpoint

`GET/PUT /api/v1/admin/operating-hours` — for programmatic access (COO agent, external integrations).

- `GET` returns current hours or smart defaults
- `PUT` saves hours (same logic as `saveOperatingHours` action)

---

## Section 8: UI Components

### 8.1 New Components

| Component | File | Purpose |
|-----------|------|---------|
| `OperatingHoursEditor` | `apps/web/components/admin/OperatingHoursEditor.tsx` | Reusable weekly schedule editor with day toggles and time pickers |
| `OperatingHoursSetupPage` | `apps/web/app/(shell)/admin/operating-hours/page.tsx` | Setup step page wrapping the editor |

### 8.2 OperatingHoursEditor Props

```typescript
type DaySchedule = {
  enabled: boolean;
  open: string;  // "HH:mm"
  close: string; // "HH:mm"
};

type WeeklySchedule = {
  monday: DaySchedule;
  tuesday: DaySchedule;
  wednesday: DaySchedule;
  thursday: DaySchedule;
  friday: DaySchedule;
  saturday: DaySchedule;
  sunday: DaySchedule;
};

type Props = {
  defaultSchedule: WeeklySchedule;
  timezone: string;
  onSave: (schedule: WeeklySchedule) => Promise<void>;
  saving?: boolean;
};
```

---

## Section 9: Testing

| Test Area | Scope | Count (est.) |
|-----------|-------|--------------|
| `saveOperatingHours` | Upserts BusinessProfile, derives low-traffic windows, creates deployment window | 5 |
| `getDefaultHoursForArchetype` | Returns correct defaults per archetype/industry/fallback | 4 |
| Smart defaults priority | Existing hours > archetype > industry > fallback | 3 |
| ProviderAvailability sync | Creates/updates availability when ServiceProvider exists, skips when absent | 3 |
| Storefront setup integration | Inherits from BusinessProfile when available, falls back to archetype | 2 |
| Validation | At least one day enabled, end after start | 2 |
| **Total** | | **~19** |

---

## Section 10: Companion Epic

### EP-STORE-SCHED — Recurring Class/Session Scheduling

**Status:** Placeholder (not yet specced)
**Depends on:** EP-STORE-OPS (this epic — delivers operating hours foundation)

For businesses that operate on a timetable model (training academies, yoga studios, fitness classes, cooking schools):

- **Timetable builder** — create recurring sessions within operating hours (e.g., "Beginner Yoga, Tuesday 10:00-11:00, weekly")
- **Capacity per session** — maximum attendees, waitlist support
- **Enrollment** — customers book into specific class instances
- **Instructor assignment** — link sessions to service providers
- **Auto-generation** — system creates future session instances from the recurring template

This is architecturally distinct from appointment-based booking (which is 1:1 provider-to-customer). Class scheduling is 1:many with capacity constraints. Both consume operating hours as a foundation.

---

## Implementation Sequence

| Phase | Scope | Deliverables |
|-------|-------|-------------|
| 1 | Server actions | `getOperatingHours`, `saveOperatingHours`, `getDefaultHoursForArchetype`. Smart defaults from archetype/industry. BusinessProfile upsert, low-traffic derivation, deployment window creation. |
| 2 | UI component | `OperatingHoursEditor` — day toggles, time pickers, validation. Platform theme. |
| 3 | Setup integration | New step in onboarding flow. Route, page, setup-constants update. COO prompt update. |
| 4 | Storefront sync | ProviderAvailability seeding from saved hours. Storefront setup inherits BusinessProfile hours. |
| 5 | API endpoint | `GET/PUT /api/v1/admin/operating-hours` for programmatic access. |
| 6 | Admin reuse | Hours editor accessible in admin settings for post-setup changes. |
| 7 | Tests | ~19 unit tests covering all data flows. |
