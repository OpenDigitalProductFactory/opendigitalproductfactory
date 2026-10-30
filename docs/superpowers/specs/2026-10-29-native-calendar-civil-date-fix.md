---
status: active
---

# Native calendar civil-date integrity

BI-E815393C; WC-7983D1B3. Base: 07f23d32acb0027a817afe9cc105fd578e0a8589.

## Reproduction and substrate

CalendarEventPopover submits a date-only string. Native create/update actions store that as UTC midnight. Both native calendar-data and private feed adapters currently emit an ISO timestamp even when allDay is true. FullCalendar interprets that instant in the local zone; its all-day startStr is then date-only. CalendarDetailPopover parses that date-only value as UTC and formats locally again. Test the selected29/grid28/detail27 chain in America/Chicago before implementation; do not infer stored corruption from a display shift.

The existing workbooks grid-calendar dateToKey already preserves browser-local day keys. Shared lib/datetime owns formatting. Reuse those homes and existing CalendarEvent/read models; no schema, scheduler, source-row migration or permissions change. Existing opportunity-next-step uses noon anchoring, which cannot cover every offset including UTC+14; do not copy that strategy into an all-day calendar.

## Standards

Pinned FullCalendar v6 documents date-only all-day startStr/endStr and exclusive end boundaries: https://legacy.fullcalendar.io/v6/event-object . Its parsing contract distinguishes date-only strings from offset-bearing instants: https://legacy.fullcalendar.io/v6/date-parsing . Preserve that distinction rather than incrementing selected dates.

## Atomic ordered repair

1. Reproduce with actual FullCalendar v6 local parsing plus the existing native feed adapter and detail renderer. Test negative/positive offsets, UTC+14, DST edges, single/multiday and timed-event controls. Validate create/update storage remains the selected UTC civil day with no guessed migration.
2. Extend the existing datetime home with the calendar wire boundary: all-day Date storage -> YYYY-MM-DD, timed Date storage -> original ISO instant. Apply to native grid and feed read adapters; preserve their authorization predicates. Use the existing local dateToKey for new-event/view defaults.
3. Use shared formatting in detail: all-day civil dates formatted without local-zone shifts; timed dates retain local conversion. Display the last included all-day date from FullCalendar's exclusive end, without changing stored dates or adding a day to input. Clarify the existing end input's exclusive meaning using the message catalog if needed. Do not add edit/detail functionality beyond this date repair.
4. Run related calendar/feed/workbook and component regressions, affected package typecheck, guards and exact-head governed gate. Preserve existing source profile and private-feed authorization. Publish one DCO-signed repair PR through protected review/merge and canonical release.
5. Served owner fixture: select a day, save, reload, inspect grid/detail, edit via supported operation, repeat across zones/DST/multiday; confirm timed events still convert legitimately. Keep the genuine TeamLogic checkpoint unchanged unless a separate reviewed repair establishes its stored semantics. No claim of notification delivery from a correct calendar display.

## Boundaries and evidence

The missing description/edit UI remains a separate scoped observation. Tests, implementation and served proof are pending at this initial design. Preview/review infrastructure failures from the expense phase are not evidence that calendar code fails. Record actual reproduction results before implementation admission and actual gate/served outcomes before completion.
