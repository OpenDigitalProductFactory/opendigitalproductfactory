-- Seed Calendaring Core epic
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/seed-calendaring-epic.sql --schema prisma/schema.prisma
--
-- Architecture note (from legacy ADR-0007):
--   PostgreSQL is the canonical scheduling authority.
--   Google Calendar and Microsoft Outlook/Exchange are adapters only — not authoritative.
--   Four subdomains: platform job scheduling, calendar & availability,
--   workforce shift planning, appointment & dispatch.
DO $$
DECLARE
  employees_id TEXT;
  sold_id      TEXT;
  epic_id      TEXT;
BEGIN
  SELECT id INTO employees_id FROM "Portfolio" WHERE slug = 'for_employees';
  SELECT id INTO sold_id      FROM "Portfolio" WHERE slug = 'products_and_services_sold';

  IF employees_id IS NULL OR sold_id IS NULL THEN
    RAISE EXCEPTION 'Expected portfolio slugs not found.';
  END IF;

  INSERT INTO "Epic" (id, "epicId", title, description, status, "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    'EP-' || gen_random_uuid()::text,
    'Calendaring Core',
    'Central scheduling and calendar kernel for the platform. PostgreSQL is the canonical authority — Google Calendar and Microsoft Outlook/Exchange are projection adapters, never the source of truth. Covers four subdomains: (1) platform job scheduling for AI agents and procedural automation; (2) calendar and availability for employees (business calendars, availability windows, holidays); (3) workforce shift planning (shift templates, instances, time-off); (4) appointment and dispatch for customer-facing bookings. ICS/RFC-5545 export enables provider-agnostic customer invites. External calendar push sync is included as an optional per-user opt-in. Shift optimisation (OR-Tools) and field dispatch are follow-on epics.',
    'open', NOW(), NOW()
  ) RETURNING id INTO epic_id;

  INSERT INTO "EpicPortfolio" ("epicId", "portfolioId")
  VALUES (epic_id, employees_id), (epic_id, sold_id);

  INSERT INTO "BacklogItem" (id, "itemId", title, type, status, priority, "epicId", "createdAt", "updatedAt")
  VALUES
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'CalendarEvent model (Prisma): eventType enum (platform_job|shift|time_off|appointment|holiday|meeting), startAt/endAt UTC DateTime, timezone string, allDay bool, status (draft|confirmed|tentative|cancelled), ownerUserId FK (nullable — system events have no owner), recurrenceRule (iCal RRULE string), parentEventId self-ref for recurrence expansion',
     'portfolio', 'open', 1, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'CalendarParticipant model (Prisma): eventId FK, participantType (employee|customer_contact|agent), refId (polymorphic — userId/customerContactId/agentId), responseStatus (pending|accepted|declined|tentative), role (organizer|attendee|optional); composite unique on (eventId, participantType, refId)',
     'portfolio', 'open', 2, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'BusinessCalendar + AvailabilityRule models (Prisma): BusinessCalendar — organisation-wide holiday and exception days keyed by year + timezone + portfolioId; AvailabilityRule — per-user recurring availability windows (dayOfWeek, startTime, endTime, validFrom/validTo) used for appointment slot generation',
     'portfolio', 'open', 3, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Core event server actions: createEvent, updateEvent, cancelEvent, addParticipant, updateParticipantResponse — any authenticated user can manage their own events; HR-000/HR-100 can create and modify shifts and time-off for any employee; all mutations update CalendarEvent.updatedAt for audit',
     'portfolio', 'open', 4, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Platform job scheduling: createAgentJobSchedule(agentId, rrule, timezone) creates a CalendarEvent type=platform_job with an agent CalendarParticipant; scheduleJobRun records execution history (status, startedAt, finishedAt, errorMessage) as a child event; links to existing AgentThread model',
     'portfolio', 'open', 5, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'ICS/RFC-5545 export + outbound invite: generateIcs(eventId) returns a valid .ics string (VEVENT with DTSTART/DTEND/RRULE/ATTENDEE lines); sendCalendarInvite(eventId, emails[]) sends ICS as email attachment — customer-facing, no provider account required on the recipient side',
     'portfolio', 'open', 6, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'CalendarIntegration model (Prisma): per-user external calendar binding — provider (google|microsoft), externalCalendarId, credentialRef FK (points to CredentialEntry), syncEnabled bool, lastSyncAt DateTime?, syncDirection (push_only|bidirectional); pushEventToExternalCalendar(eventId, userId) server action; CalendarSyncLog (eventId, userId, provider, status, errorMessage, syncedAt) for audit',
     'portfolio', 'open', 7, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     '/calendar route (employee view): week and month toggle showing the current user''s confirmed events grouped by type (shifts in one colour, appointments in another, time-off, holidays from BusinessCalendar); click event shows detail drawer; + New button pre-fills event type based on caller role; HR-000/HR-100 see team view with employee filter',
     'product', 'open', 8, epic_id, NOW(), NOW());

  RAISE NOTICE 'Calendaring Core epic created with 8 stories.';
END $$;
