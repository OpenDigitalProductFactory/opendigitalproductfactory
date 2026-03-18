"use client";

import { useState, useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { CalendarEventView } from "@/lib/calendar-data";
import { CalendarEventPopover } from "./CalendarEventPopover";
import { CalendarSyncPanel } from "./CalendarSyncPanel";

const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  hr: { label: "HR", color: "#a78bfa" },
  operations: { label: "Operations", color: "#38bdf8" },
  platform: { label: "Platform", color: "#fb923c" },
  personal: { label: "Personal", color: "#4ade80" },
  external: { label: "External", color: "#8888a0" },
};

type Props = {
  events: CalendarEventView[];
};

export function WorkspaceCalendar({ events }: Props) {
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());
  const [createPopover, setCreatePopover] = useState<{ date: string; endDate?: string } | null>(null);

  function toggleCategory(cat: string) {
    setHiddenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  const filteredEvents = useMemo(() =>
    events
      .filter((e) => !hiddenCategories.has(e.category))
      .map((e) => ({
        id: e.id,
        title: e.title,
        start: e.start,
        ...(e.end ? { end: e.end } : {}),
        allDay: e.allDay,
        backgroundColor: e.color,
        borderColor: e.color,
        textColor: "#fff",
        editable: e.editable,
        extendedProps: {
          category: e.category,
          eventType: e.eventType,
          sourceType: e.sourceType,
        },
      })),
    [events, hiddenCategories],
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
      </div>

      {/* FullCalendar */}
      <style>{`
        .fc {
          --fc-border-color: var(--dpf-border);
          --fc-page-bg-color: transparent;
          --fc-neutral-bg-color: var(--dpf-surface-2);
          --fc-list-event-hover-bg-color: var(--dpf-surface-2);
          --fc-today-bg-color: rgba(124, 140, 248, 0.05);
          --fc-event-border-color: transparent;
          font-size: 11px;
        }
        .fc .fc-col-header-cell { color: var(--dpf-muted); font-size: 10px; text-transform: uppercase; }
        .fc .fc-daygrid-day-number { color: #e0e0ff; font-size: 11px; }
        .fc .fc-daygrid-day.fc-day-today .fc-daygrid-day-number { color: #7c8cf8; font-weight: 700; }
        .fc .fc-button { background: var(--dpf-surface-2); border-color: var(--dpf-border); color: #e0e0ff; font-size: 11px; padding: 4px 10px; }
        .fc .fc-button:hover { background: rgba(124,140,248,0.15); }
        .fc .fc-button-active { background: rgba(124,140,248,0.2) !important; border-color: #7c8cf8 !important; }
        .fc .fc-toolbar-title { color: #fff; font-size: 15px; font-weight: 600; }
        .fc .fc-event { border-radius: 3px; padding: 1px 3px; font-size: 10px; cursor: pointer; }
        .fc .fc-daygrid-event-dot { display: none; }
        .fc .fc-scrollgrid { border-color: var(--dpf-border); }
        .fc td, .fc th { border-color: var(--dpf-border) !important; }
      `}</style>
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "dayGridMonth,timeGridWeek,timeGridDay",
        }}
        events={filteredEvents}
        height="auto"
        dayMaxEvents={3}
        editable={false}
        selectable={true}
        nowIndicator={true}
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
