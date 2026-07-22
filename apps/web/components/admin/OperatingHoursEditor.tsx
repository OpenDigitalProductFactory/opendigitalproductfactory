"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { WeeklySchedule, DaySchedule } from "@/lib/operating-hours-types";

const DAY_ORDER = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
] as const;

const DAY_LABELS: Record<string, string> = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday",
  thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};

// Used only if the runtime lacks Intl.supportedValuesOf (older engines). Covers
// UTC + the common North American zones; the operator can still type-search the
// full list on any modern browser, which is the normal path.
const FALLBACK_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Australia/Sydney",
];

/** The full IANA zone list when available, always including `current`. */
function listTimeZones(current: string, detected: string | null): string[] {
  let zones: string[] = [];
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf;
    if (typeof supported === "function") zones = supported("timeZone");
  } catch {
    zones = [];
  }
  if (zones.length === 0) zones = [...FALLBACK_TIMEZONES];
  // Make sure the currently-stored and detected zones are always selectable even
  // if a given runtime omits them from the catalog.
  for (const z of [current, detected]) {
    if (z && !zones.includes(z)) zones = [z, ...zones];
  }
  return zones;
}

/**
 * The current UTC offset for a zone as a display string ("UTC−05:00") plus its
 * signed minutes, so options can be sorted by offset like a conventional picker.
 */
function zoneOffset(zone: string): { label: string; minutes: number } {
  try {
    const name =
      new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    let minutes = 0;
    if (m) {
      const sign = m[1] === "-" ? -1 : 1;
      minutes = sign * (parseInt(m[2], 10) * 60 + parseInt(m[3] ?? "0", 10));
    }
    const hh = String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0");
    const mm = String(Math.abs(minutes) % 60).padStart(2, "0");
    const body = minutes === 0 ? "±00:00" : `${minutes < 0 ? "−" : "+"}${hh}:${mm}`;
    return { label: `UTC${body}`, minutes };
  } catch {
    return { label: "UTC±00:00", minutes: 0 };
  }
}

type ZoneOption = { value: string; label: string; minutes: number };

/**
 * Turn the raw IANA catalog into conventional picker options — each labelled
 * "(UTC−06:00) America/Chicago" (offset prefix + de-underscored name) and ordered
 * by offset, so the operator scans a familiar list instead of raw zone ids in
 * "Africa/Abidjan first" alphabetical order.
 */
function buildZoneOptions(current: string, detected: string | null): ZoneOption[] {
  return listTimeZones(current, detected)
    .map((z) => {
      const { label, minutes } = zoneOffset(z);
      return { value: z, label: `(${label}) ${z.replace(/_/g, " ")}`, minutes };
    })
    .sort((a, b) => a.minutes - b.minutes || a.value.localeCompare(b.value));
}

/** The browser's own timezone — the sensible default a layman shouldn't have to type. */
function detectBrowserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

type Props = {
  defaultSchedule: WeeklySchedule;
  timezone: string;
  /** Persists the schedule AND the selected operating-hours timezone. */
  onSave: (schedule: WeeklySchedule, timezone: string) => Promise<void>;
  saving?: boolean;
};

export function OperatingHoursEditor({ defaultSchedule, timezone, onSave, saving: externalSaving }: Props) {
  const [schedule, setSchedule] = useState<WeeklySchedule>(defaultSchedule);
  const detected = useMemo(() => detectBrowserTimeZone(), []);
  // Default to the stored zone, but when it's still the UTC placeholder fall
  // back to the browser's detected zone so a fresh install doesn't silently keep
  // evaluating operating hours (and the maintenance/upgrade window) in UTC.
  const [tz, setTz] = useState<string>(
    timezone && timezone !== "UTC" ? timezone : detected ?? timezone,
  );
  const zones = useMemo(() => buildZoneOptions(tz, detected), [tz, detected]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const busy = externalSaving || isPending;

  // Auto-dismiss the success toast a few seconds after a save.
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 3000);
    return () => clearTimeout(t);
  }, [saved]);

  function updateDay(day: string, patch: Partial<DaySchedule>) {
    setSchedule((prev) => ({
      ...prev,
      [day]: { ...prev[day as keyof WeeklySchedule], ...patch },
    }));
    setError(null);
    setSaved(false);
  }

  function handleSave() {
    // Client-side validation
    const anyEnabled = DAY_ORDER.some((d) => schedule[d].enabled);
    if (!anyEnabled) {
      setError("At least one day must be enabled");
      return;
    }
    for (const day of DAY_ORDER) {
      const d = schedule[day];
      if (d.enabled && d.close <= d.open) {
        setError(`${DAY_LABELS[day]}: closing time must be after opening time`);
        return;
      }
    }

    setSaved(false);
    startTransition(async () => {
      try {
        await onSave(schedule, tz);
        setError(null);
        setSaved(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Timezone — operating hours, bookings, AND the maintenance/upgrade window
          are all evaluated in this zone. Previously read-only, which left every
          install on UTC and put the upgrade window in the middle of the open day. */}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="op-hours-tz" className="text-sm font-medium text-[var(--dpf-text)]">
            Timezone
          </label>
          <select
            id="op-hours-tz"
            name="operatingHoursTimezone"
            value={tz}
            onChange={(e) => {
              setTz(e.target.value);
              setSaved(false);
            }}
            aria-label="Business timezone — bookings and the maintenance window use this zone"
            className="min-h-[44px] max-w-full px-2 py-1 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] text-sm"
          >
            {zones.map((z) => (
              <option key={z.value} value={z.value} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                {z.label}
              </option>
            ))}
          </select>
          {detected && detected !== tz && (
            <button
              type="button"
              onClick={() => {
                setTz(detected);
                setSaved(false);
              }}
              className="text-xs text-[var(--dpf-accent)] hover:underline"
            >
              Use detected ({detected})
            </button>
          )}
        </div>
        <p className="text-[11px] text-[var(--dpf-muted)]">
          Bookings, availability, and the platform maintenance / self-upgrade window are all
          evaluated in this timezone.
        </p>
      </div>

      <div className="space-y-2">
        {DAY_ORDER.map((day) => {
          const d = schedule[day];
          return (
            <div
              key={day}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]"
            >
              {/* Open/closed toggle — 44px hit area wraps the small visual switch. */}
              <button
                type="button"
                role="switch"
                aria-checked={d.enabled}
                aria-label={`Open on ${DAY_LABELS[day]}`}
                onClick={() => updateDay(day, { enabled: !d.enabled })}
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] shrink-0 rounded-md"
              >
                <span
                  className={`relative block h-5 w-10 rounded-full transition-colors ${
                    d.enabled ? "bg-[var(--dpf-accent)]" : "bg-[var(--dpf-border-strong)]"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--dpf-surface-1)] transition-transform ${
                      d.enabled ? "left-5" : "left-0.5"
                    }`}
                  />
                </span>
              </button>

              {/* Day label */}
              <span
                className={`w-20 shrink-0 text-sm font-medium sm:w-24 ${
                  d.enabled ? "text-[var(--dpf-text)]" : "text-[var(--dpf-muted)]"
                }`}
              >
                {DAY_LABELS[day]}
              </span>

              {/* Time pickers — each labelled by owner outcome so assistive tech and
                  the mobile audit read "Monday opens" / "Monday closes", not two
                  anonymous 09:00 fields. Wraps to its own line on narrow phones. */}
              {d.enabled ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <input
                    type="time"
                    name={`${day}-opens`}
                    value={d.open}
                    onChange={(e) => updateDay(day, { open: e.target.value })}
                    aria-label={`${DAY_LABELS[day]} opens`}
                    className="min-h-[44px] px-2 py-1 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] text-sm"
                  />
                  <span className="text-[var(--dpf-muted)]">to</span>
                  <input
                    type="time"
                    name={`${day}-closes`}
                    value={d.close}
                    onChange={(e) => updateDay(day, { close: e.target.value })}
                    aria-label={`${DAY_LABELS[day]} closes`}
                    className="min-h-[44px] px-2 py-1 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] text-sm"
                  />
                </div>
              ) : (
                <span className="text-sm text-[var(--dpf-muted)]">Closed</span>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="text-xs text-[var(--dpf-destructive)]">{error}</div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={busy}
          className="px-4 py-2 text-sm rounded-lg border transition-colors disabled:opacity-50"
          style={{
            color: "var(--dpf-accent)",
            borderColor: "var(--dpf-accent)",
            backgroundColor: "color-mix(in srgb, var(--dpf-accent) 15%, transparent)",
          }}
        >
          {busy ? "Saving..." : "Save Operating Hours"}
        </button>
      </div>

      {/* Success toast — auto-dismissing confirmation that the save persisted. */}
      {saved && !busy && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            right: 24,
            bottom: 24,
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px",
            borderRadius: 8,
            border: "1px solid var(--dpf-border)",
            background: "var(--dpf-surface-2)",
            color: "var(--dpf-text)",
            fontSize: 13,
            fontWeight: 600,
            boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
          }}
        >
          <span style={{ color: "var(--dpf-success, #22c55e)" }}>✓</span>
          Operating hours saved
        </div>
      )}
    </div>
  );
}
