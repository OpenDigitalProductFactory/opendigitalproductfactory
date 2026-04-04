"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DatesSetArg, EventClickArg } from "@fullcalendar/core";
import type { CalendarEventView } from "@/lib/calendar-data";
import { CalendarEventPopover } from "./CalendarEventPopover";
import { CalendarSyncPanel } from "./CalendarSyncPanel";

const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  hr: { label: "HR", color: "#a78bfa" },
  operations: { label: "Operations", color: "#38bdf8" },
  platform: { label: "Platform", color: "#fb923c" },
  personal: { label: "Personal", color: "#4ade80" },
  external: { label: "External", color: "var(--dpf-muted)" },
};

type Props = {
  events: CalendarEventView[];
};

export function WorkspaceCalendar({ events: initialEvents }: Props) {
  const calendarRef = useRef<FullCalendar>(null);
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());
  const [createPopover, setCreatePopover] = useState<{ date: string; endDate?: string } | null>(null);
  const [liveEvents, setLiveEvents] = useState<CalendarEventView[]>(initialEvents);
  const [fetching, setFetching] = useState(false);

  function toggleCategory(cat: string) {
    setHiddenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  // Refetch calendar events at the right density when the view or date range changes
  const handleDatesSet = useCallback(async (arg: DatesSetArg) => {
    setFetching(true);
    try {
      const params = new URLSearchParams({
        start: arg.start.toISOString(),
        end:   arg.end.toISOString(),
      });
      const res = await fetch(`/api/calendar/events?${params}`);
      if (res.ok) {
        const data = (await res.json()) as CalendarEventView[];
        setLiveEvents(data);
      }
    } catch {
      // Silently fall back to current events
    } finally {
      setFetching(false);
    }
  }, []);

  // Drill-down: clicking a digest event navigates to day view for that date
  const handleEventClick = useCallback((info: EventClickArg) => {
    const eventType = info.event.extendedProps.eventType as string;
    if (eventType === "recurring-digest") {
      const api = calendarRef.current?.getApi();
      if (api) {
        api.changeView("timeGridDay", info.event.startStr);
      }
    }
  }, []);

  const filteredEvents = useMemo(() =>
    liveEvents
      .filter((e) => !hiddenCategories.has(e.category))
      .map((e) => ({
        id: e.id,
        title: e.title,
        start: e.start,
        ...(e.end ? { end: e.end } : {}),
        allDay: e.allDay,
        backgroundColor: e.color,
        borderColor: e.color,
        textColor: "var(--dpf-text)",
        editable: e.editable,
        extendedProps: {
          category: e.category,
          eventType: e.eventType,
          sourceType: e.sourceType,
          digestCount: e.digestCount,
          digestSchedule: e.digestSchedule,
          digestLastStatus: e.digestLastStatus,
        },
      })),
    [liveEvents, hiddenCategories],
  );

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      {/* Filter toolbar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-widest mr-2">Filter:</span>
        {Object.entries(CATEGORY_CONFIG).map(([key, { label, color }]) => {
          const hidden = hiddenCategories.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggleCategory(key)}
              className="px-2 py-0.5 text-[10px] rounded-full border transition-colors"
              style={{
                borderColor: hidden ? "var(--dpf-border)" : color,
                background: hidden ? "transparent" : `${color}20`,
                color: hidden ? "var(--dpf-muted)" : color,
                opacity: hidden ? 0.5 : 1,
              }}
            >
              {label}
            </button>
          );
        })}
        {fetching && (
          <span className="text-[10px] text-[var(--dpf-muted)] ml-auto">Loading...</span>
        )}
      </div>

      {/* FullCalendar */}
      <style>{`
        .fc {
          --fc-border-color: var(--dpf-border);
          --fc-page-bg-color: transparent;
          --fc-neutral-bg-color: var(--dpf-surface-2);
          --fc-list-event-hover-bg-color: var(--dpf-surface-2);
          --fc-today-bg-color: color-mix(in srgb, var(--dpf-accent) 5%, transparent);
          --fc-event-border-color: transparent;
          font-size: 11px;
        }
        .fc .fc-col-header-cell { color: var(--dpf-muted); font-size: 10px; text-transform: uppercase; }
        .fc .fc-daygrid-day-number { color: var(--dpf-text); font-size: 11px; }
        .fc .fc-daygrid-day.fc-day-today .fc-daygrid-day-number { color: var(--dpf-accent); font-weight: 700; }
        .fc .fc-button { background: var(--dpf-surface-2); border-color: var(--dpf-border); color: var(--dpf-text); font-size: 11px; padding: 4px 10px; }
        .fc .fc-button:hover { background: color-mix(in srgb, var(--dpf-accent) 15%, transparent); }
        .fc .fc-button-active { background: color-mix(in srgb, var(--dpf-accent) 20%, transparent) !important; border-color: var(--dpf-accent) !important; }
        .fc .fc-toolbar-title { color: var(--dpf-text); font-size: 15px; font-weight: 600; }
        .fc .fc-event { border-radius: 3px; padding: 1px 3px; font-size: 10px; cursor: pointer; }
        .fc .fc-daygrid-event-dot { display: none; }
        .fc .fc-scrollgrid { border-color: var(--dpf-border); }
        .fc td, .fc th { border-color: var(--dpf-border) !important; }
        /* Digest events get a dashed left border to signal drill-down */
        .fc .fc-event[data-digest="true"] { border-left: 2px dashed var(--dpf-accent); cursor: zoom-in; }
      `}</style>
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "dayGridMonth,timeGridWeek,timeGridDay",
        }}
        events={filteredEvents}
        height="auto"
        dayMaxEvents={4}
        editable={false}
        selectable={true}
        nowIndicator={true}
        datesSet={handleDatesSet}
        eventClick={handleEventClick}
        eventDidMount={(info) => {
          if (info.event.extendedProps.eventType === "recurring-digest") {
            info.el.setAttribute("data-digest", "true");
            const count = info.event.extendedProps.digestCount;
            const schedule = info.event.extendedProps.digestSchedule;
            info.el.title = `${info.event.title}\nSchedule: ${schedule}\nClick to drill into day view`;
            if (count) {
              info.el.title += `\n${count} occurrences`;
            }
          }
        }}
        dateClick={(info) => {
          setCreatePopover({ date: info.dateStr });
        }}
        select={(info) => {
          setCreatePopover({ date: info.startStr, endDate: info.endStr });
        }}
      />

      {createPopover && (
        <CalendarEventPopover
          defaultDate={createPopover.date}
          defaultEndDate={createPopover.endDate}
          onClose={() => setCreatePopover(null)}
        />
      )}

      <CalendarSyncPanel />
    </div>
  );
}
