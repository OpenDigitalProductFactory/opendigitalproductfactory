# EP-CALENDAR-001: Workspace Calendar & Activity Feed — Design Spec

**Date:** 2026-03-17
**Status:** Merged into EP-CAL-001 (calendar infrastructure, 2026-03-15)
**Goal:** Full-month corporate calendar on the workspace landing page with role-filtered activity feed, event creation, and architecture for external calendar sync. Uses FullCalendar (MIT) as the rendering engine.

---

## 1. Architecture

Three event sources merged into a unified calendar view:

1. **Projected events** — auto-generated at query time from existing platform data (leave requests, review cycles, onboarding tasks, timesheets, lifecycle events, delegation grants). No duplication — source tables are authoritative.

2. **Native events** — user-created entries (meetings, reminders, deadlines) stored in the `CalendarEvent` table.

3. **Synced events** — imported from external calendars (Google, Outlook, iCal) via the `CalendarSync` configuration. Stored as native events with `syncSource` + `externalId` for dedup.

**Data flow:**
```
Platform data (leaves, reviews, timesheets, etc.) ──┐
Native CalendarEvent records ────────────────────────┼──→ Unified event list ──→ FullCalendar UI
External synced events ──────────────────────────────┘
```

The query layer (`calendar-data.ts`) merges all sources into a common `CalendarEventView` type, filtered by the user's role and reporting relationships.

---

## 2. Schema

### CalendarEvent (native + synced entries)

```prisma
model CalendarEvent {
  id                String    @id @default(cuid())
  eventId           String    @unique
  title             String
  description       String?   @db.Text
  startAt           DateTime
  endAt             DateTime?
  allDay            Boolean   @default(false)
  eventType         String    // meeting | reminder | deadline | personal | synced
  category          String    @default("personal") // hr | operations | platform | personal | external
  ownerEmployeeId   String
  visibility        String    @default("team")     // private | team | public
  recurrence        String?                        // null | daily | weekly | monthly | yearly
  recurrenceEnd     DateTime?
  color             String?                        // optional hex override
  syncSource        String?                        // null | google | outlook | ical
  externalId        String?                        // external calendar event ID for dedup
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  ownerEmployee     EmployeeProfile @relation(fields: [ownerEmployeeId], references: [id])

  @@index([ownerEmployeeId])
  @@index([startAt, endAt])
  @@index([category])
  @@index([syncSource, externalId])
}
```

### CalendarSync (external calendar connections)

```prisma
model CalendarSync {
  id                String    @id @default(cuid())
  syncId            String    @unique
  employeeProfileId String
  provider          String    // google | outlook | ical
  connectionData    Json      // tokens, feed URL, etc. (encrypted at rest)
  syncDirection     String    @default("inbound") // inbound | outbound | bidirectional
  filterPattern     String?   // optional keyword filter for imports
  lastSyncAt        DateTime?
  status            String    @default("active")  // active | paused | error
  errorMessage      String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  employeeProfile   EmployeeProfile @relation(fields: [employeeProfileId], references: [id])

  @@unique([employeeProfileId, provider])
  @@index([employeeProfileId])
  @@index([status])
}
```

### EmployeeProfile back-relations

Add to EmployeeProfile:
```prisma
  calendarEvents    CalendarEvent[]
  calendarSyncs     CalendarSync[]
```

---

## 3. Projected Platform Events

These are NOT stored in CalendarEvent — they're assembled at query time from source tables:

| Source | Calendar Title Pattern | Category | Date Fields |
|--------|----------------------|----------|-------------|
| LeaveRequest (approved) | "{name} — {leaveType} leave" | hr | startDate → endDate |
| LeaveRequest (pending) | "{name} — leave request (pending)" | hr | startDate → endDate |
| ReviewCycle (active) | "Review cycle: {name}" | hr | periodStart → periodEnd |
| ReviewCycle (draft, start within 30d) | "Upcoming review: {name}" | hr | periodStart |
| OnboardingTask (pending, has dueDate) | "Onboarding: {title}" | hr | dueDate |
| TimesheetPeriod (draft, not submitted) | "Timesheet due" | operations | weekStarting + 6 days |
| TimesheetPeriod (submitted, pending approval) | "{name} timesheet to approve" | operations | submittedAt |
| EmployeeProfile (startDate in range) | "{name} starts" | hr | startDate |
| EmployeeProfile (confirmationDate in range) | "{name} probation ends" | hr | confirmationDate |
| DelegationGrant (expiring within 14d) | "Grant expiring: {actionKey}" | platform | expiresAt |

The `calendar-data.ts` query function runs all these projections in parallel and merges with native events, sorted by startAt.

---

## 4. Activity Feed

Three-section feed below the calendar, showing everything across the user's responsibilities.

### Action Items (highlighted, top)
Things requiring the user's direct action:
- Timesheets to approve (manager) or submit (self)
- Leave requests to approve (manager)
- Onboarding tasks assigned to their role (hr/manager/it/employee)
- Performance reviews awaiting their input
- Expiring delegation grants (admin)

### Awareness Items (middle)
Things happening they should know about:
- Team members starting/ending leave
- New hires starting this week
- Review cycles opening/closing
- Employee lifecycle changes (promotions, departures)
- Backlog items changing status in their area
- Improvement proposals needing review

### History (scrollable, bottom)
Completed/past items:
- Approved timesheets and leave requests
- Completed onboarding tasks
- Finalized reviews
- Past lifecycle events

Each item: icon, title, person, date, status badge, link to relevant page.

### Role Filtering (server-side)
- **Managers**: see their direct reports' items
- **HR (manage_user_lifecycle)**: see all employee items
- **Ops (manage_backlog)**: see backlog/epic changes
- **Admin (view_admin)**: see delegation grants, platform config
- **Everyone**: sees their own items + team awareness

---

## 5. Calendar UI

**Library:** FullCalendar v6 (MIT)
- Packages: `@fullcalendar/react`, `@fullcalendar/core`, `@fullcalendar/daygrid`, `@fullcalendar/timegrid`, `@fullcalendar/interaction`

### Views
- **Month** (default on workspace landing page)
- **Week** (time-grid with hour slots)
- **Day** (detailed time-grid)

### Filter Toolbar
- Category toggles: HR | Operations | Platform | Personal | External — color-coded pills, click to show/hide
- People filter: "My events" | "My team" | "All" (scoped by permissions)
- View switcher: Month | Week | Day (FullCalendar built-in)

### Event Rendering
- Color-coded by category (hr=#a78bfa, operations=#38bdf8, platform=#fb923c, personal=#4ade80, external=#8888a0)
- All-day events in top bar, timed events in grid
- Projected platform events show with a subtle indicator (e.g., lock icon) to distinguish from editable native events
- Overtime timesheets flagged with warning color

### Event Creation
- Click a day → quick-create popover (title, type, start/end, all-day)
- Drag a range → pre-fills start/end
- Type selection determines form:
  - "Leave request" → opens leave request form
  - "Meeting" / "Reminder" / "Deadline" / "Personal" → creates CalendarEvent
- Save calls server action `createCalendarEvent` or routes to platform action

### Event Editing
- Click existing native event → edit popover (same fields)
- Projected events are read-only — click shows detail with link to source page
- Drag-to-move for native events → updates CalendarEvent dates

### Theming
- FullCalendar CSS variables overridden to match dark theme (--dpf-bg, --dpf-surface-1, --dpf-border, etc.)
- Custom event renderer for consistent card style

---

## 6. External Calendar Integration (Architected, Stubs)

### iCal Feed (read-only outbound)
- Route: `/api/calendar/feed/[userId]/route.ts`
- Generates iCalendar (.ics) format from user's calendar events
- URL can be subscribed to from Google Calendar, Outlook, Apple Calendar
- Includes both native and projected platform events
- Auth: token-based URL (includes API token in query param)

### Sync Webhook (inbound, stub)
- Route: `/api/calendar/sync/route.ts`
- Stub endpoint for receiving push notifications from Google/Outlook
- CalendarSync model stores connection config
- When built: receives webhook → fetches updated events → upserts CalendarEvent with syncSource + externalId

### Not Built in v1
- Google Calendar OAuth flow
- Outlook/Microsoft Graph integration
- Bidirectional sync logic
- Conflict resolution for synced events

---

## 7. Files Affected

### New Dependency
`@fullcalendar/react`, `@fullcalendar/core`, `@fullcalendar/daygrid`, `@fullcalendar/timegrid`, `@fullcalendar/interaction`

### New Files (8)
| File | Responsibility |
|------|---------------|
| `apps/web/lib/calendar-data.ts` | Native events + projected platform events, merged and role-filtered |
| `apps/web/lib/activity-feed-data.ts` | Action items, awareness items, history — role-filtered |
| `apps/web/lib/actions/calendar.ts` | Create/update/delete CalendarEvent |
| `apps/web/components/workspace/WorkspaceCalendar.tsx` | FullCalendar wrapper with dark theme, filters, event creation |
| `apps/web/components/workspace/ActivityFeed.tsx` | Three-section feed (actions, awareness, history) |
| `apps/web/components/workspace/CalendarEventPopover.tsx` | Quick-create/edit popover |
| `apps/web/app/api/calendar/feed/[userId]/route.ts` | iCal feed endpoint |
| `apps/web/app/api/calendar/sync/route.ts` | Webhook receiver stub |

### Modified Files (2)
| File | Change |
|------|--------|
| `apps/web/app/(shell)/workspace/page.tsx` | Add calendar + activity feed sections below tiles |
| `packages/db/prisma/schema.prisma` | CalendarEvent + CalendarSync models, EmployeeProfile back-relations |

---

## 8. Implementation Order (4 Chunks)

1. **Schema + FullCalendar install + basic calendar** — Migration with CalendarEvent + CalendarSync models. Install FullCalendar packages. WorkspaceCalendar component rendering projected platform events (leaves, reviews, timesheets, onboarding, lifecycle). Dark theme CSS override. Category color coding.

2. **Activity feed** — activity-feed-data.ts with role-filtered queries for action items, awareness, and history. ActivityFeed component with three collapsible sections. Wire into workspace page below calendar.

3. **Event creation + editing** — CalendarEventPopover for quick-create/edit. Server actions for CRUD. Click-to-create and drag-to-create. Platform event routing (leave request type → leave form). Native event drag-to-move.

4. **iCal feed + sync stubs** — iCal generation endpoint. CalendarSync model wired. Webhook stub route. Token-based feed URL generation.

---

## 9. Not In Scope (v1)

- Google Calendar OAuth flow
- Outlook/Microsoft Graph integration
- Bidirectional sync implementation
- Conflict resolution for synced events
- Recurring event expansion (simple recurrence field stored, but recurrence instances not exploded)
- Calendar sharing between users
- Meeting room / resource booking
