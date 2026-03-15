# EP-CAL-001: Calendar Infrastructure Design

**Epic:** Calendar Infrastructure — Unified Scheduling & Event System
**Date:** 2026-03-15
**Status:** Approved

## Summary

A calendar event framework that serves as platform scheduling infrastructure. Subsumes the existing `ScheduledJob` model into a unified `CalendarEvent` model supporting one-time and recurring events, automated action execution with backlog-based audit trails, and role-contextual UX surfaces. Exposed to AI coworkers via MCP tool, with future extensibility for customer/partner-facing calendars.

## Motivation

The platform needs a unified time-based event system. Current state:
- `ScheduledJob` handles only AI provider recurring sync (one seeded record)
- No calendar view for users to see upcoming events relevant to their role
- AI coworkers have no mechanism to schedule future actions ("re-enable provider on the 19th")
- No infrastructure for role-contextual scheduling (field service, finance deadlines, admin tasks, vulnerability scans)

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Calendar as infrastructure, not a single view | Multiple consumers: workspace widget, full route, AI coworkers, future customer portals |
| ScheduledJob | Absorb into CalendarEvent | Single source of truth for all time-based things; no parallel systems |
| Event sources | System + Human + Agent + External (all four) | All four needed now; each creates events through a well-defined interface |
| Execution model | Action events create backlog items (in-progress → done) | Fault-tolerant audit trail; human visibility into automated actions |
| HITL authority | Human-scheduled = intent granted at creation time, recorded | AI coworker creates on behalf of logged-in user; `createdById` is the authority record |
| Recurrence | Simple intervals now (daily/weekly/monthly); RRULE string stored for future RFC 5545 | Data model is future-proof; UI exposes simple options initially |
| Timezone | Store creator's timezone (server for system, user's for human-created) alongside UTC datetime | Recurrence stays correct across DST shifts |
| Tenant scoping | Internal-only now; `customerAccountId` FK ready for future | Customer-facing calendar depends on deployer's business model |
| MCP interface | `calendar_manage_event` tool; inherits user session auth | AI coworker operates within user's authority and permission scope |
| Identity management | Not required now; clean `createdById`/`source` tracking is IdM-ready | Backlog item to update when IdM epic lands |

## Data Model

### CalendarEvent (replaces ScheduledJob)

```prisma
model CalendarEvent {
  id                String    @id @default(cuid())
  eventId           String    @unique          // Human-readable: EVT-xxxx
  title             String
  description       String?
  eventType         String                     // action | notification | informational
  source            String                     // system | human | agent | external
  status            String    @default("scheduled") // scheduled | in_progress | completed | failed | cancelled
  startsAt          DateTime                   // When the event fires (UTC)
  endsAt            DateTime?                  // Optional end time
  allDay            Boolean   @default(false)
  timezone          String    @default("UTC")  // IANA timezone of creator
  rrule             String?                    // iCal RRULE string (null = one-time)
  schedule          String?                    // Simple interval: daily | weekly | monthly | null (one-time)
  nextRunAt         DateTime?                  // Pre-computed next occurrence (recurring)
  lastRunAt         DateTime?                  // Last execution time
  actionPayload     Json?                      // { action: string, args: Record<string, unknown> }
  actionResult      String?                    // Last execution result/error
  assignedToRole    String?                    // Platform role visibility filter
  assignedToUserId  String?                    // Specific user assignment
  assignedToAgentId String?                    // Agent responsible for execution
  customerAccountId String?                    // Future: unlinked FK, no @relation until CustomerAccount epic
  createdById       String?                    // User who created (null for system)
  metadata          Json?                      // Extensible key-value data
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  backlogItem       BacklogItem? @relation(fields: [backlogItemId], references: [id])
  backlogItemId     String?
  assignedAgent     Agent?       @relation(fields: [assignedToAgentId], references: [id])
  createdBy         User?        @relation(fields: [createdById], references: [id])
}
```

**Inverse relations required on existing models:**
- `BacklogItem` gains: `calendarEvent CalendarEvent?`
- `Agent` gains: `calendarEvents CalendarEvent[]`
- `User` gains: `calendarEvents CalendarEvent[]`
- `customerAccountId` is intentionally an unlinked FK (no `@relation`) — the `CustomerAccount` model will gain the inverse when the customer-facing calendar epic lands.

**Recurrence field precedence:** `schedule` is the authoritative field for the execution pipeline now. `rrule` is stored for future use; when RFC 5545 parsing is implemented, `rrule` will take precedence over `schedule`. Until then, `rrule` is informational only.

### Migration from ScheduledJob

All existing `ScheduledJob` records are migrated to `CalendarEvent`:

**provider-registry-sync:**
```
eventId: "EVT-provider-registry-sync"
title: "Provider Registry Sync"
eventType: "action"
source: "system"
schedule: "weekly"
actionPayload: { "action": "syncProviderRegistry" }
```

**provider-priority-optimizer** (if present):
```
eventId: "EVT-provider-priority-optimizer"
title: "Provider Priority Optimizer"
eventType: "action"
source: "system"
schedule: "daily"
actionPayload: { "action": "optimizeProviderPriority" }
```

The `ScheduledJob` model is dropped after migration. All references in `ai-provider-types.ts`, `ai-provider-data.ts`, `ai-provider-priority.ts`, `actions/ai-providers.ts`, `ScheduledJobsTable.tsx`, and `platform/ai/page.tsx` are updated to use `CalendarEvent`.

**`disabled` schedule mapping:** The existing `disabled` schedule value maps to `status: "cancelled"` on the CalendarEvent. The `schedule` field retains the original interval (daily/weekly/monthly) so re-enabling restores the previous cadence. The UI shows a disable/enable toggle that sets `status: "cancelled"` / `status: "scheduled"` respectively.

## Event Lifecycle

### State transitions

```
scheduled → in_progress → completed
                       → failed
scheduled → cancelled
```

### Execution pipeline (action events)

1. Scheduler checks `nextRunAt <= now()` for `status: "scheduled"` events with `eventType: "action"`
2. Create `BacklogItem` with `type: "calendar"`, `status: "in-progress"`, linked to the event via `backlogItemId`
3. Execute action payload (server action invocation or agent dispatch)
4. On success: backlog item → `done`, event `lastRunAt` + `actionResult` updated
5. On failure: backlog item stays `in-progress` (visible to human), `actionResult` stores error
6. For recurring events: compute `nextRunAt` from `schedule`, event stays `scheduled`
7. For one-time events: event status → `completed` or `failed`

### Notification events
- Surface in calendar UI; future: email/push notification
- Status → `completed` after time passes; no backlog item

### Informational events
- Purely display (finance deadlines, class schedules, training days)
- No execution, no backlog item

### Execution authority
- `source: "human"` → HITL satisfied at creation time via `createdById`
- `source: "agent"` → created on behalf of user; `createdById` records authorizer
- `source: "system"` → platform-generated, no human approval needed
- `source: "external"` → future, needs its own auth model

## MCP Tool Interface

### `calendar_manage_event`

Operations: `create | update | cancel | list | get`

| Parameter | Type | Required | Purpose |
|-----------|------|----------|---------|
| `operation` | string | yes | CRUD operation |
| `eventId` | string | update/cancel/get | Target event |
| `title` | string | create | Event title |
| `description` | string | no | Details |
| `eventType` | string | create | action / notification / informational |
| `startsAt` | string | create | ISO 8601 datetime |
| `endsAt` | string | no | ISO 8601 datetime |
| `allDay` | boolean | no | Date-only event |
| `schedule` | string | no | once / daily / weekly / monthly |
| `actionPayload` | object | no | Action descriptor for executable events |
| `assignedToRole` | string | no | Role visibility filter |
| `assignedToAgentId` | string | no | Agent to execute |
| `metadata` | object | no | Extensible data |
| `filter` | object | for list | { from?, to?, eventType?, source?, role? } |

Auth: Inherits logged-in user's session. `createdById` set server-side. The `manage_calendar` capability is required for `create`, `update`, and `cancel` operations. Additionally, action-specific permissions are checked for action events (e.g., `manage_provider_connections` for provider actions). The `list` and `get` operations require only `view_calendar`.

### Example: AI coworker scheduling provider re-enable

```json
{
  "operation": "create",
  "title": "Re-enable Anthropic provider",
  "eventType": "action",
  "startsAt": "2026-03-19T08:00:00Z",
  "actionPayload": {
    "action": "configureProvider",
    "args": { "providerId": "anthropic", "status": "active" }
  }
}
```

## UX Surfaces

### Mini-widget (workspace page)

- Horizontal scrollable strip above existing workspace tiles
- Shows next 5-7 events filtered to current user's role
- Each card: time (relative or absolute), title, color-coded type dot, source label
- "View all →" links to `/calendar`
- Empty state: "No upcoming events"

### Full calendar route (`/calendar`)

- New nav item: Calendar (permission: `view_calendar` — all authenticated users)
- Default view: week (day/week/month switcher)
- Left sidebar: filters by event type, source, role
- Events color-coded: action (#7c8cf8), notification (#fbbf24), informational (#8888a0)
- Click event → detail slide panel (reuses BacklogPanel pattern)
- Detail panel: title, description, schedule, execution status, linked backlog item, creator, action payload
- "Create event" button → slide panel in create mode

### Role-contextual filtering

- Auto-filter to events matching user's `platformRole` (via `assignedToRole`) + direct assignments (`assignedToUserId`)
- Admin roles (HR-000) see all events by default with filters to narrow
- Mini-widget uses same filtering logic

### ScheduledJobsTable migration

The existing `ScheduledJobsTable` on `/platform/ai` becomes a filtered calendar view showing `source: "system"` action events. Same inline schedule editing UX, now backed by `CalendarEvent`.

## New Permission

- `view_calendar`: all authenticated users (all 6 HR roles)
- `manage_calendar`: create/update/cancel events — HR-000, HR-500 (admin + ops)
- Action-specific permissions delegate to existing capabilities (e.g., `manage_provider_connections` for provider actions)

## Seed Data

Migrate existing `provider-registry-sync` ScheduledJob to CalendarEvent. Add seed events:
- `EVT-provider-registry-sync`: weekly provider sync (action, system)
- `EVT-vuln-scan-weekly`: weekly vulnerability scan (action, system, `assignedToAgentId: null` — no security agent in registry yet)
- Sample informational event for demonstration (e.g., "Platform Maintenance Window")

## Backlog Items (Future)

- **RFC 5545 RRULE parsing**: Full recurrence rule support (complex patterns, exclusion dates, end dates)
- **Email notifications on event completion**: Optional email to creator when action event completes
- **Identity management integration**: Update auth model when IdM epic lands (delegation chains, service accounts, scoped authorization)
- **Customer-facing calendar**: Business-model-dependent onboarding and configuration patterns
- **External event sources**: API for partner/customer systems to push events

## File Impact

### New files
- `packages/db/prisma/migrations/xxx_calendar_event/migration.sql` — create CalendarEvent, drop ScheduledJob
- `apps/web/lib/calendar-types.ts` — pure helpers: event type colours, status labels, validation, schedule computation
- `apps/web/lib/calendar-data.ts` — React cache fetchers: getCalendarEvents, getUpcomingEvents, getEventById
- `apps/web/lib/actions/calendar.ts` — server actions: createEvent, updateEvent, cancelEvent, executeEventAction
- `apps/web/components/calendar/UpcomingStrip.tsx` — workspace mini-widget
- `apps/web/components/calendar/CalendarGrid.tsx` — week/day/month grid (client component)
- `apps/web/components/calendar/CalendarSidebar.tsx` — filter panel
- `apps/web/components/calendar/EventDetailPanel.tsx` — slide panel for event detail/edit
- `apps/web/app/(shell)/calendar/page.tsx` — full calendar route (server component)
- `apps/web/app/(shell)/calendar/layout.tsx` — auth gate (view_calendar)
- `apps/web/lib/calendar-types.test.ts` — unit tests for pure helpers

### Modified files
- `packages/db/prisma/schema.prisma` — add CalendarEvent, remove ScheduledJob; add inverse relations on BacklogItem, Agent, User
- `packages/db/src/seed.ts` — replace seedScheduledJobs with seedCalendarEvents
- `apps/web/lib/permissions.ts` — add view_calendar, manage_calendar capabilities
- `apps/web/components/shell/Header.tsx` — add Calendar nav item
- `apps/web/app/(shell)/workspace/page.tsx` — add UpcomingStrip component
- `apps/web/app/(shell)/platform/ai/page.tsx` — update to use CalendarEvent instead of ScheduledJob
- `apps/web/components/platform/ScheduledJobsTable.tsx` — refactor to use CalendarEvent (or replace)
- `apps/web/lib/ai-provider-types.ts` — remove ScheduledJob types, update schedule helpers
- `apps/web/lib/ai-provider-data.ts` — remove getScheduledJobs, use calendar-data
- `apps/web/lib/ai-provider-priority.ts` — update `prisma.scheduledJob` references to use CalendarEvent
- `apps/web/lib/ai-provider-internals.ts` — update `prisma.scheduledJob.upsert` (auto-disable quota scheduling) to use CalendarEvent
- `apps/web/lib/actions/agent-coworker.ts` — update `prisma.scheduledJob.deleteMany` (provider re-enable cleanup) to use CalendarEvent
- `apps/web/lib/actions/ai-providers.ts` — remove ScheduledJob actions, delegate to calendar actions
- `apps/web/lib/backlog.ts` — widen `BacklogItemInput.type` union to include `"calendar"`

### Notes on BacklogItem.type

The existing `BacklogItem.type` field accepts `product | portfolio`. Calendar-generated backlog items use a new type value: `calendar`. This is additive — no existing backlog items are affected.

### Workspace mini-widget permissions

The mini-widget on `/workspace` has no separate permission gate — it inherits from the workspace page (all authenticated users). The widget queries only events visible to the current user's role, so permission scoping is enforced at the data layer via `assignedToRole` / `assignedToUserId` filtering.

### Calendar rendering

The calendar grid (day/week/month) is built from scratch using CSS Grid — no third-party calendar library. This keeps the bundle lean and the dark-theme styling consistent with the rest of the platform. The initial implementation focuses on week view; day and month views follow the same grid pattern.
