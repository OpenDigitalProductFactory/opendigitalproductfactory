-- EP-CAL-001: Calendar Infrastructure — Unified Scheduling & Event System
-- Run from repo root with:
--   cd packages/db && npx prisma db execute --file ../../scripts/update-calendar-epic.sql --schema prisma/schema.prisma

DO $$
DECLARE
  cal_epic_id TEXT;
  mfg_portfolio_id TEXT;
  found_portfolio_id TEXT;
  dpf_portal_id TEXT;
  mfg_tax_node_id TEXT;
  inserted_count INTEGER;
BEGIN
  -- Look up required references
  SELECT id INTO mfg_portfolio_id FROM "Portfolio" WHERE slug = 'manufacturing_and_delivery';
  SELECT id INTO found_portfolio_id FROM "Portfolio" WHERE slug = 'foundational';
  SELECT id INTO dpf_portal_id FROM "DigitalProduct" WHERE "productId" = 'dpf-portal';
  SELECT "nodeId" INTO mfg_tax_node_id FROM "TaxonomyNode" WHERE "nodeId" = 'manufacturing_and_delivery';

  IF mfg_portfolio_id IS NULL THEN RAISE EXCEPTION 'manufacturing_and_delivery portfolio not found'; END IF;
  IF found_portfolio_id IS NULL THEN RAISE EXCEPTION 'foundational portfolio not found'; END IF;
  IF dpf_portal_id IS NULL THEN RAISE EXCEPTION 'dpf-portal digital product not found'; END IF;

  -- ── Create or update the epic ──────────────────────────────────────────────
  INSERT INTO "Epic" (id, "epicId", title, description, status, "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    'EP-CAL-001',
    'Calendar Infrastructure — Unified Scheduling & Event System',
    'A calendar event framework serving as platform scheduling infrastructure. Subsumes ScheduledJob into a unified CalendarEvent model supporting one-time and recurring events, automated action execution with backlog-based audit trails, role-contextual UX surfaces, and MCP tool exposure for AI coworkers.',
    'open',
    NOW(),
    NOW()
  )
  ON CONFLICT ("epicId") DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    "updatedAt" = NOW();

  SELECT id INTO cal_epic_id FROM "Epic" WHERE "epicId" = 'EP-CAL-001';

  -- Link epic to both portfolios (foundational infra + manufacturing/delivery for DPF)
  INSERT INTO "EpicPortfolio" ("epicId", "portfolioId")
  VALUES (cal_epic_id, found_portfolio_id)
  ON CONFLICT ("epicId", "portfolioId") DO NOTHING;

  INSERT INTO "EpicPortfolio" ("epicId", "portfolioId")
  VALUES (cal_epic_id, mfg_portfolio_id)
  ON CONFLICT ("epicId", "portfolioId") DO NOTHING;

  -- ── Create backlog items ───────────────────────────────────────────────────
  INSERT INTO "BacklogItem" (id, "itemId", title, body, status, type, priority, "epicId", "digitalProductId", "taxonomyNodeId", "createdAt", "updatedAt")
  SELECT
    gen_random_uuid()::text,
    data.item_id,
    data.title,
    data.body,
    'open',
    'product',
    data.priority,
    cal_epic_id,
    dpf_portal_id,
    mfg_tax_node_id,
    NOW(),
    NOW()
  FROM (
    VALUES
      (1, 'BI-CAL-001', 'CalendarEvent schema + migration (drop ScheduledJob)',
       'Create CalendarEvent model with all fields from spec (eventId, title, eventType, source, status, startsAt/endsAt, allDay, timezone, rrule, schedule, nextRunAt, lastRunAt, actionPayload/Result, assignments, metadata). Add inverse relations on BacklogItem, Agent, User. Widen BacklogItem.type to include "calendar". Migrate existing ScheduledJob records (provider-registry-sync, provider-priority-optimizer) to CalendarEvent. Drop ScheduledJob model.'),
      (2, 'BI-CAL-002', 'Calendar pure helpers and unit tests (calendar-types.ts)',
       'Create apps/web/lib/calendar-types.ts with: EVENT_TYPE_COLOURS, STATUS_LABELS, SCHEDULE_INTERVALS_MS (moved from ai-provider-types), validateCalendarInput, computeNextRunAt, formatEventTime. Port schedule helpers from ai-provider-types.ts. Write Vitest tests in calendar-types.test.ts.'),
      (3, 'BI-CAL-003', 'Calendar data fetchers (calendar-data.ts)',
       'Create apps/web/lib/calendar-data.ts with React cache fetchers: getCalendarEvents(filters), getUpcomingEvents(role, userId, limit), getEventById(eventId). Role-contextual filtering via assignedToRole + assignedToUserId. Admin (HR-000) sees all by default.'),
      (4, 'BI-CAL-004', 'Calendar server actions (actions/calendar.ts)',
       'Create apps/web/lib/actions/calendar.ts with "use server" actions: createCalendarEvent, updateCalendarEvent, cancelCalendarEvent, executeEventAction. Auth gates: manage_calendar for create/update/cancel, plus action-specific permission checks. Execution pipeline: create BacklogItem in-progress, execute action, update to done/failed.'),
      (5, 'BI-CAL-005', 'Migrate ScheduledJob references in AI provider code',
       'Update ai-provider-types.ts (remove ScheduledJob types), ai-provider-data.ts (remove getScheduledJobs), ai-provider-priority.ts (prisma.scheduledJob -> CalendarEvent), ai-provider-internals.ts (prisma.scheduledJob.upsert -> CalendarEvent), actions/agent-coworker.ts (prisma.scheduledJob.deleteMany -> CalendarEvent), actions/ai-providers.ts (remove ScheduledJob actions, delegate to calendar).'),
      (6, 'BI-CAL-006', 'Permissions: view_calendar + manage_calendar',
       'Add view_calendar (all 6 HR roles) and manage_calendar (HR-000, HR-500) to permissions.ts ROLE_CAPABILITIES. Add Calendar nav item to Header.tsx with view_calendar capability gate.'),
      (7, 'BI-CAL-007', 'UpcomingStrip workspace widget',
       'Create apps/web/components/calendar/UpcomingStrip.tsx — horizontal scrollable strip showing next 5-7 events for current user role. Cards: time, title, color-coded type dot, source label. "View all" links to /calendar. Empty state: "No upcoming events". Add to workspace page.tsx above tile grid.'),
      (8, 'BI-CAL-008', 'Full calendar route with week grid (/calendar)',
       'Create apps/web/app/(shell)/calendar/layout.tsx (auth gate: view_calendar) and page.tsx (server component). Build CalendarGrid.tsx (client, CSS Grid week view with day/week/month switcher), CalendarSidebar.tsx (filters by event type, source, role), prev/next/today navigation. Events color-coded by type.'),
      (9, 'BI-CAL-009', 'EventDetailPanel slide panel',
       'Create apps/web/components/calendar/EventDetailPanel.tsx — reuses BacklogPanel slide pattern. Shows title, description, schedule, execution status, linked backlog item, creator, action payload. Create mode for new events with form validation.'),
      (10, 'BI-CAL-010', 'Refactor ScheduledJobsTable to use CalendarEvent',
       'Update apps/web/components/platform/ScheduledJobsTable.tsx and platform/ai/page.tsx to query CalendarEvent (source: "system", eventType: "action") instead of ScheduledJob. Same inline schedule editing UX. "disabled" toggle maps to status: cancelled/scheduled.'),
      (11, 'BI-CAL-011', 'MCP tool: calendar_manage_event',
       'Expose calendar CRUD as MCP tool for AI coworker consumption. Operations: create, update, cancel, list, get. Auth: inherits user session, createdById set server-side, manage_calendar + action-specific permission checks. Filter support for list operation.'),
      (12, 'BI-CAL-012', 'Seed calendar events',
       'Replace seedScheduledJobs() with seedCalendarEvents() in seed.ts. Seed: EVT-provider-registry-sync (weekly action, system), EVT-provider-priority-optimizer (weekly action, system), EVT-vuln-scan-weekly (weekly action, system, no agent), sample informational event (Platform Maintenance Window).'),
      (13, 'BI-CAL-013', 'Backlog: RFC 5545 RRULE parsing (future)',
       'Future epic item: implement full iCal RRULE parsing for complex recurrence patterns (every MWF, first Monday of month, exclusion dates, end dates). When implemented, rrule field takes precedence over schedule field.'),
      (14, 'BI-CAL-014', 'Backlog: Email notifications on event completion (future)',
       'Future epic item: optional email to creator when an action event completes or fails. Configurable per-event. Requires email infrastructure.'),
      (15, 'BI-CAL-015', 'Backlog: Identity management integration (future)',
       'Future epic item: update calendar auth model when IdM epic lands. Delegation chains for AI coworker authority, service accounts for system events, scoped authorization beyond role-based.'),
      (16, 'BI-CAL-016', 'Backlog: Customer-facing calendar (future)',
       'Future epic item: business-model-dependent customer/partner calendar. Onboarding patterns and configuration for property management fleet scheduling, student class schedules, etc. Requires CustomerAccount scoping.')
  ) AS data(priority, item_id, title, body)
  WHERE NOT EXISTS (
    SELECT 1 FROM "BacklogItem" b WHERE b."itemId" = data.item_id
  );

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RAISE NOTICE 'EP-CAL-001: epic created/updated, % backlog items inserted.', inserted_count;
END
$$;
