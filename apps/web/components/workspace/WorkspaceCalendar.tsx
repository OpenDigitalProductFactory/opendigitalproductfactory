"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DatesSetArg, EventClickArg } from "@fullcalendar/core";
import type { CalendarEventView } from "@/lib/calendar-data";
import { CalendarEventPopover } from "./CalendarEventPopover";
import { CalendarDetailPopover } from "./CalendarDetailPopover";
import { CalendarAgentScheduler } from "./CalendarAgentScheduler";
import { CalendarSyncPanel } from "./CalendarSyncPanel";

// Must match CATEGORY_COLORS in calendar-data.ts — use concrete hex, not CSS vars
const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  hr: { label: "HR", color: "#a78bfa" },
  operations: { label: "Operations", color: "#38bdf8" },
  platform: { label: "Platform", color: "#fb923c" },
  compliance: { label: "Compliance", color: "#e879f9" },
  finance: { label: "Finance", color: "#facc15" },
  business: { label: "Business", color: "#14b8a6" },
  personal: { label: "Personal", color: "#4ade80" },
  external: { label: "External", color: "#8888a0" },
};

const SOURCE_FILTER_CONFIG: Record<string, { label: string; matchFn: (e: { sourceType: string; eventType: string }) => boolean }> = {
  native:          { label: "User events",     matchFn: (e) => e.sourceType === "native" },
  "scheduled-jobs": { label: "Scheduled jobs", matchFn: (e) => e.eventType === "recurring-digest" || e.eventType === "maintenance" },
  compliance:      { label: "Compliance",      matchFn: (e) => e.eventType === "compliance-deadline" || e.eventType === "audit" || e.eventType === "regulatory" },
  finance:         { label: "Finance",         matchFn: (e) => e.eventType === "invoice" || e.eventType === "bill" || e.eventType === "recurring-invoice" },
  "change-mgmt":   { label: "Change mgmt",    matchFn: (e) => e.eventType === "change-request" || e.eventType === "blackout" || e.eventType === "deployment-window" },
  bookings:        { label: "Bookings",       matchFn: (e) => e.eventType === "booking" },
  crm:             { label: "CRM",            matchFn: (e) => e.eventType === "crm-activity" || e.eventType === "pipeline-deadline" },
  "op-hours":      { label: "Hours",          matchFn: (e) => e.eventType === "operating-hours" },
  providers:       { label: "Providers",      matchFn: (e) => e.eventType === "provider-schedule" },
  "agent-tasks":   { label: "AI tasks",       matchFn: (e) => e.eventType === "agent-task" },
};

/** Archetype categories where certain source filters are hidden by default. */
const ARCHETYPE_DEFAULT_HIDDEN: Record<string, string[]> = {
  "retail-goods":            ["providers"],
  "hoa-property-management": ["bookings", "providers"],
  "professional-services":   ["providers"],
  "nonprofit-community":     ["bookings", "providers"],
  "trades-maintenance":      ["providers"],
};

type Props = {
  events: CalendarEventView[];
  archetypeCategory?: string | null;
};

export function WorkspaceCalendar({ events: initialEvents, archetypeCategory }: Props) {
  const calendarRef = useRef<FullCalendar>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Restore hidden categories from URL on mount
  const hiddenCategories = useMemo(() => {
    const param = searchParams.get("hidden");
    return param ? new Set(param.split(",")) : new Set<string>();
  }, [searchParams]);

  // Restore hidden source filters from URL — fall back to archetype defaults on first load
  const hiddenSources = useMemo(() => {
    const param = searchParams.get("sourceHidden");
    if (param) return new Set(param.split(","));
    const defaults = archetypeCategory
      ? ARCHETYPE_DEFAULT_HIDDEN[archetypeCategory]
      : undefined;
    return defaults ? new Set(defaults) : new Set<string>();
  }, [searchParams, archetypeCategory]);

  const [createPopover, setCreatePopover] = useState<{ date: string; endDate?: string } | null>(null);
  const [agentScheduler, setAgentScheduler] = useState<{ date: string } | null>(null);
  const [dateChooser, setDateChooser] = useState<{ date: string; endDate?: string; rect: DOMRect | null } | null>(null);
  const [detailPopover, setDetailPopover] = useState<{
    event: {
      id: string; title: string; start: string; end: string | null;
      allDay: boolean; category: string; eventType: string; sourceType: string; color: string;
      digestCount?: number; digestSchedule?: string; digestLastStatus?: string | null;
    };
    anchorRect: { top: number; left: number; width: number; height: number };
  } | null>(null);
  const [liveEvents, setLiveEvents] = useState<CalendarEventView[]>(initialEvents);
  const [fetching, setFetching] = useState(false);

  function toggleCategory(cat: string) {
    const next = new Set(hiddenCategories);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    const params = new URLSearchParams(searchParams.toString());
    if (next.size > 0) {
      params.set("hidden", Array.from(next).join(","));
    } else {
      params.delete("hidden");
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function toggleSource(key: string) {
    const next = new Set(hiddenSources);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    const params = new URLSearchParams(searchParams.toString());
    if (next.size > 0) {
      params.set("sourceHidden", Array.from(next).join(","));
    } else {
      params.delete("sourceHidden");
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
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

  // Event click: digest → drill-down to day view; all others → detail popover
  const handleEventClick = useCallback((info: EventClickArg) => {
    const eventType = info.event.extendedProps.eventType as string;

    // Digest events drill down to day view
    if (eventType === "recurring-digest") {
      const api = calendarRef.current?.getApi();
      if (api) {
        api.changeView("timeGridDay", info.event.startStr);
      }
      return;
    }

    // Skip operating-hours (background tint, not interactive)
    if (eventType === "operating-hours") return;

    // Show detail popover positioned near the clicked element
    const rect = info.el.getBoundingClientRect();
    setDetailPopover({
      event: {
        id: info.event.id,
        title: info.event.title,
        start: info.event.startStr,
        end: info.event.endStr || null,
        allDay: info.event.allDay,
        category: info.event.extendedProps.category as string,
        eventType,
        sourceType: info.event.extendedProps.sourceType as string,
        color: info.event.backgroundColor || "#8888a0",
        digestCount: info.event.extendedProps.digestCount as number | undefined,
        digestSchedule: info.event.extendedProps.digestSchedule as string | undefined,
        digestLastStatus: info.event.extendedProps.digestLastStatus as string | null | undefined,
      },
      anchorRect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    });
  }, []);

  const filteredEvents = useMemo(() =>
    liveEvents
      .filter((e) => !hiddenCategories.has(e.category))
      .filter((e) => {
        for (const [key, cfg] of Object.entries(SOURCE_FILTER_CONFIG)) {
          if (hiddenSources.has(key) && cfg.matchFn({ sourceType: e.sourceType, eventType: e.eventType })) {
            return false;
          }
        }
        return true;
      })
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
    [liveEvents, hiddenCategories, hiddenSources],
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

      {/* Source filters — collapsible for progressive disclosure */}
      <details className="mb-3">
        <summary className="text-[10px] text-[var(--dpf-muted)] cursor-pointer select-none uppercase tracking-widest">
          Source filters
        </summary>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {Object.entries(SOURCE_FILTER_CONFIG).map(([key, { label }]) => {
            const hidden = hiddenSources.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleSource(key)}
                className="px-2 py-0.5 text-[10px] rounded-full border transition-colors"
                style={{
                  borderColor: hidden ? "var(--dpf-border)" : "var(--dpf-accent)",
                  background: hidden ? "transparent" : "color-mix(in srgb, var(--dpf-accent) 10%, transparent)",
                  color: hidden ? "var(--dpf-muted)" : "var(--dpf-text)",
                  opacity: hidden ? 0.5 : 1,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </details>

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
          const evType = info.event.extendedProps.eventType as string;
          if (evType === "recurring-digest") {
            info.el.setAttribute("data-digest", "true");
            const count = info.event.extendedProps.digestCount;
            const schedule = info.event.extendedProps.digestSchedule;
            info.el.title = `${info.event.title}\nSchedule: ${schedule}\nClick to drill into day view`;
            if (count) {
              info.el.title += `\n${count} occurrences`;
            }
          }
          // Operating hours render as translucent background tint
          if (evType === "operating-hours") {
            info.el.style.opacity = "0.15";
            info.el.style.pointerEvents = "none";
            info.el.style.borderLeft = "3px solid #14b8a6";
          }
        }}
        dateClick={(info) => {
          setDateChooser({ date: info.dateStr, rect: info.dayEl.getBoundingClientRect() });
        }}
        select={(info) => {
          setDateChooser({ date: info.startStr, endDate: info.endStr, rect: null });
        }}
      />

      {/* Date click chooser: create event or schedule agent */}
      {dateChooser && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 99 }}
            onClick={() => setDateChooser(null)}
          />
          <div
            style={{
              position: "fixed",
              zIndex: 100,
              top: dateChooser.rect
                ? Math.min(dateChooser.rect.bottom + 4, window.innerHeight - 100)
                : "50%",
              left: dateChooser.rect
                ? Math.min(dateChooser.rect.left, window.innerWidth - 220)
                : "50%",
              ...(!dateChooser.rect ? { transform: "translate(-50%, -50%)" } : {}),
              background: "var(--dpf-surface-1)",
              border: "1px solid var(--dpf-border)",
              borderRadius: 8,
              padding: 8,
              width: 200,
              boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
            }}
          >
            <button
              type="button"
              onClick={() => {
                setCreatePopover({ date: dateChooser.date, endDate: dateChooser.endDate });
                setDateChooser(null);
              }}
              style={{
                display: "block", width: "100%", padding: "8px 12px", fontSize: 12,
                background: "transparent", border: "none", color: "var(--dpf-text)",
                textAlign: "left", cursor: "pointer", borderRadius: 4,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--dpf-surface-2)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              Create event
            </button>
            <button
              type="button"
              onClick={() => {
                setAgentScheduler({ date: dateChooser.date });
                setDateChooser(null);
              }}
              style={{
                display: "block", width: "100%", padding: "8px 12px", fontSize: 12,
                background: "transparent", border: "none", color: "#14b8a6",
                textAlign: "left", cursor: "pointer", borderRadius: 4, fontWeight: 600,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--dpf-surface-2)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              Schedule AI coworker
            </button>
          </div>
        </>
      )}

      {createPopover && (
        <CalendarEventPopover
          defaultDate={createPopover.date}
          defaultEndDate={createPopover.endDate}
          onClose={() => setCreatePopover(null)}
        />
      )}

      {agentScheduler && (
        <CalendarAgentScheduler
          defaultDate={agentScheduler.date}
          onClose={() => setAgentScheduler(null)}
        />
      )}

      {detailPopover && (
        <CalendarDetailPopover
          event={detailPopover.event}
          anchorRect={detailPopover.anchorRect}
          onClose={() => setDetailPopover(null)}
        />
      )}

      <CalendarSyncPanel />
    </div>
  );
}
