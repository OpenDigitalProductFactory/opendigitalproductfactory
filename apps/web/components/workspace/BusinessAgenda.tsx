// apps/web/components/workspace/BusinessAgenda.tsx
//
// "Today & Next" — the purposed business schedule for the default workspace
// home. It shows only business-context events (bookings, money due, provider
// availability, customer/CRM deadlines, capacity-relevant people events,
// compliance deadlines) drawn from the SAME calendar projection the full
// calendar uses — never platform cron digests, deployment windows, blackouts,
// or AI task runs. Those live on the operator schedule (/platform/schedule).
//
// Server component. Real data only: it renders whatever upcoming business
// events the loader returns and shows an empty state when there are none — it
// never synthesizes rows.

import { LocalTime } from "@/components/ui/LocalTime";
import { StatusBadge } from "@/components/ui/report-kit";
import type { Intent } from "@/components/ui/report-kit/statusColors";
import type { CalendarEventView } from "@/lib/calendar-data";

/** Categories that belong to the operator schedule, never the business home. */
const PLATFORM_CATEGORIES = new Set(["platform", "operations"]);
/** Event types that are platform/ops minutia, never the business home. */
const PLATFORM_EVENT_TYPES = new Set([
  "recurring-digest",
  "maintenance",
  "deployment-window",
  "blackout",
  "change-request",
  "agent-task",
]);

const CATEGORY_BADGE: Record<string, { intent: Intent; label: string }> = {
  business: { intent: "accent", label: "Business" },
  finance: { intent: "warning", label: "Money" },
  compliance: { intent: "danger", label: "Compliance" },
  hr: { intent: "info", label: "People" },
  personal: { intent: "neutral", label: "Personal" },
};

export function isBusinessAgendaEvent(e: Pick<CalendarEventView, "category" | "eventType">): boolean {
  if (PLATFORM_CATEGORIES.has(e.category)) return false;
  if (PLATFORM_EVENT_TYPES.has(e.eventType)) return false;
  // Operating-hours render as a translucent background tint on the full
  // calendar; they are not agenda items.
  if (e.eventType === "operating-hours") return false;
  return true;
}

function dayKey(iso: string): string {
  // Group by calendar day using the ISO date prefix (stable across server/client).
  return iso.slice(0, 10);
}

type Props = {
  events: CalendarEventView[];
  /** Reference instant; defaults to now. Injectable for deterministic tests. */
  now?: Date;
  /** Max agenda rows to show before linking to the full calendar. */
  limit?: number;
  /** Where "Open full calendar" points. */
  fullCalendarHref?: string;
};

export function BusinessAgenda({
  events,
  now = new Date(),
  limit = 10,
  fullCalendarHref = "/workspace/calendar",
}: Props) {
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  const upcoming = events
    .filter(isBusinessAgendaEvent)
    .filter((e) => {
      const ends = new Date(e.end ?? e.start).getTime();
      return Number.isFinite(ends) && ends >= cutoff;
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .slice(0, limit);

  const groups: { key: string; items: CalendarEventView[] }[] = [];
  for (const ev of upcoming) {
    const key = dayKey(ev.start);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(ev);
    else groups.push({ key, items: [ev] });
  }

  return (
    <section
      aria-labelledby="business-agenda-title"
      className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
    >
      <div className="flex items-center justify-between border-b border-[var(--dpf-border)] px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
            Today &amp; next
          </p>
          <h2 id="business-agenda-title" className="mt-0.5 text-sm font-semibold text-[var(--dpf-text)]">
            What&apos;s on for the business
          </h2>
        </div>
        <a
          href={fullCalendarHref}
          className="text-xs font-medium text-[var(--dpf-accent)] hover:underline"
        >
          Open full calendar →
        </a>
      </div>

      {groups.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-[var(--dpf-muted)]">
          Nothing scheduled for the business right now.
          <br />
          <a href={fullCalendarHref} className="text-[var(--dpf-accent)] hover:underline">
            Add something to the calendar
          </a>{" "}
          to see it here.
        </div>
      ) : (
        <ul className="divide-y divide-[var(--dpf-border)]">
          {groups.map((group) => (
            <li key={group.key} className="px-4 py-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
                <LocalTime value={`${group.key}T00:00:00.000Z`} mode="date" utc />
              </p>
              <ul className="space-y-2">
                {group.items.map((ev) => {
                  const badge = CATEGORY_BADGE[ev.category] ?? { intent: "neutral" as Intent, label: ev.category };
                  return (
                    <li key={ev.id} className="flex items-center gap-3">
                      <span className="w-16 shrink-0 text-xs tabular-nums text-[var(--dpf-muted)]">
                        {ev.allDay ? "All day" : <LocalTime value={ev.start} mode="time" />}
                      </span>
                      <StatusBadge intent={badge.intent} label={badge.label} variant="soft" />
                      <span className="min-w-0 flex-1 truncate text-sm text-[var(--dpf-text)]">{ev.title}</span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
