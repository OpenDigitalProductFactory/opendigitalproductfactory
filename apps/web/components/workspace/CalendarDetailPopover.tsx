"use client";

import { useRouter } from "next/navigation";

// ─── Event type → platform deep link + human label ──────────────────────────

const EVENT_META: Record<string, { label: string; href?: string; icon: string }> = {
  // HR
  leave:              { label: "Leave Request",        href: "/employee",                   icon: "\uD83C\uDFD6" },
  review:             { label: "Review Cycle",         href: "/employee",                   icon: "\uD83D\uDCDD" },
  timesheet:          { label: "Timesheet",            href: "/employee?view=timesheets",   icon: "\u23F0" },
  onboarding:         { label: "Onboarding Task",      href: "/employee",                   icon: "\uD83D\uDCCB" },
  lifecycle:          { label: "Lifecycle Event",       href: "/employee",                   icon: "\uD83D\uDCC5" },

  // Operations
  "change-request":    { label: "Change Request",      href: "/ops/changes",                icon: "\uD83D\uDD04" },
  blackout:            { label: "Blackout Period",      href: "/ops/changes",                icon: "\uD83D\uDEAB" },
  "deployment-window": { label: "Maintenance Window",  href: "/admin/operating-hours",       icon: "\uD83D\uDD27" },

  // Platform / Scheduled
  "recurring-digest":  { label: "Scheduled Job (digest)", href: "/platform",                icon: "\u2699\uFE0F" },
  maintenance:         { label: "Scheduled Job",        href: "/platform",                   icon: "\u2699\uFE0F" },

  // Compliance
  "compliance-deadline": { label: "Compliance Deadline", href: "/compliance",               icon: "\u26A0\uFE0F" },
  audit:                 { label: "Compliance Audit",    href: "/compliance",               icon: "\uD83D\uDD0D" },
  regulatory:            { label: "Regulatory Item",     href: "/compliance",               icon: "\uD83D\uDCDC" },

  // Finance
  invoice:              { label: "Invoice Due",          href: "/finance",                  icon: "\uD83D\uDCB3" },
  bill:                 { label: "Bill Due",             href: "/finance",                  icon: "\uD83D\uDCB8" },
  "recurring-invoice":  { label: "Recurring Invoice",    href: "/finance",                  icon: "\uD83D\uDD01" },

  // Business
  booking:              { label: "Booking",              href: "/storefront",               icon: "\uD83D\uDCC6" },
  "crm-activity":       { label: "CRM Activity",        href: "/customer",                 icon: "\uD83D\uDCDE" },
  "pipeline-deadline":  { label: "Pipeline Deadline",    href: "/customer",                 icon: "\uD83C\uDFAF" },
  "operating-hours":    { label: "Operating Hours",      href: "/admin/operating-hours",    icon: "\uD83D\uDD53" },
  "provider-schedule":  { label: "Provider Schedule",    href: "/storefront",               icon: "\uD83D\uDC64" },

  // Scheduled agent tasks
  "agent-task":         { label: "AI Coworker Task",    href: "/workspace",                icon: "\uD83E\uDD16" },

  // Generic / native
  meeting:             { label: "Meeting",                                                  icon: "\uD83D\uDCAC" },
  reminder:            { label: "Reminder",                                                 icon: "\uD83D\uDD14" },
  deadline:            { label: "Deadline",                                                 icon: "\u2757" },
  personal:            { label: "Personal",                                                 icon: "\uD83D\uDC64" },
};

const CATEGORY_LABELS: Record<string, string> = {
  hr: "HR",
  operations: "Operations",
  platform: "Platform",
  compliance: "Compliance",
  finance: "Finance",
  business: "Business",
  personal: "Personal",
  external: "External",
};

type EventDetail = {
  id: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  category: string;
  eventType: string;
  sourceType: string;
  color: string;
  digestCount?: number;
  digestSchedule?: string;
  digestLastStatus?: string | null;
};

type Props = {
  event: EventDetail;
  anchorRect: { top: number; left: number; width: number; height: number };
  onClose: () => void;
};

function formatDate(iso: string, allDay: boolean): string {
  const d = new Date(iso);
  if (allDay) {
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }
  return d.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatTimeRange(start: string, end: string | null, allDay: boolean): string {
  if (allDay) {
    const s = formatDate(start, true);
    if (!end) return s;
    const e = formatDate(end, true);
    return s === e ? s : `${s} \u2013 ${e}`;
  }
  const s = new Date(start);
  const timeStart = s.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (!end) {
    return `${formatDate(start, true)} at ${timeStart}`;
  }
  const e = new Date(end);
  const timeEnd = e.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const dateStr = formatDate(start, true);
  return `${dateStr}, ${timeStart} \u2013 ${timeEnd}`;
}

export function CalendarDetailPopover({ event, anchorRect, onClose }: Props) {
  const router = useRouter();
  const meta = EVENT_META[event.eventType] ?? { label: event.eventType, icon: "\uD83D\uDCC5" };
  const categoryLabel = CATEGORY_LABELS[event.category] ?? event.category;
  const href = meta.href;

  // Position popover near the clicked event
  const popoverStyle: React.CSSProperties = {
    position: "fixed",
    zIndex: 200,
    top: Math.min(anchorRect.top + anchorRect.height + 4, window.innerHeight - 280),
    left: Math.min(anchorRect.left, window.innerWidth - 320),
  };

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 199 }}
        onClick={onClose}
      />

      {/* Popover card */}
      <div
        style={{
          ...popoverStyle,
          background: "var(--dpf-surface-1)",
          border: "1px solid var(--dpf-border)",
          borderRadius: 8,
          padding: 16,
          width: 300,
          maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
        }}
      >
        {/* Header: icon + type badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 18 }}>{meta.icon}</span>
          <span
            style={{
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 12,
              background: `${event.color}25`,
              color: event.color,
              border: `1px solid ${event.color}40`,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {meta.label}
          </span>
          <span
            style={{
              fontSize: 10,
              color: "var(--dpf-muted)",
              marginLeft: "auto",
            }}
          >
            {categoryLabel}
          </span>
        </div>

        {/* Title */}
        <h4 style={{ color: "var(--dpf-text)", fontSize: 14, fontWeight: 600, margin: "0 0 6px" }}>
          {event.title}
        </h4>

        {/* Time */}
        <p style={{ color: "var(--dpf-muted)", fontSize: 12, margin: "0 0 4px" }}>
          {formatTimeRange(event.start, event.end, event.allDay)}
        </p>

        {/* Source badge */}
        <p style={{ color: "var(--dpf-muted)", fontSize: 10, margin: "0 0 8px" }}>
          {event.sourceType === "native" ? "User-created event" : "Auto-projected from platform data"}
        </p>

        {/* Digest detail (for recurring jobs) */}
        {event.digestCount != null && (
          <div style={{
            fontSize: 11, color: "var(--dpf-muted)",
            padding: "6px 8px", borderRadius: 4,
            background: "var(--dpf-surface-2)", margin: "0 0 8px",
          }}>
            <span style={{ fontWeight: 600 }}>{event.digestCount}</span> occurrences
            {event.digestSchedule ? ` (${event.digestSchedule})` : ""}
            {event.digestLastStatus === "error" && (
              <span style={{ color: "#ef4444", marginLeft: 8, fontWeight: 600 }}>Last run failed</span>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 6, marginTop: 12, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "5px 12px", fontSize: 11, borderRadius: 4,
              border: "1px solid var(--dpf-border)", background: "transparent",
              color: "var(--dpf-muted)", cursor: "pointer",
            }}
          >
            Close
          </button>
          {href && (
            <button
              type="button"
              onClick={() => { onClose(); router.push(href); }}
              style={{
                padding: "5px 12px", fontSize: 11, borderRadius: 4,
                border: `1px solid color-mix(in srgb, ${event.color} 40%, transparent)`,
                background: `color-mix(in srgb, ${event.color} 12%, transparent)`,
                color: event.color, cursor: "pointer", fontWeight: 600,
              }}
            >
              View details
            </button>
          )}
        </div>
      </div>
    </>
  );
}
