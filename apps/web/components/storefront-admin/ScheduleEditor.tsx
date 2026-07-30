"use client";
import { useState } from "react";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type AvailabilityRow = {
  id: string;
  days: number[];
  startTime: string;
  endTime: string;
  date: string | null;
  isBlocked: boolean;
  reason: string | null;
};

type DayState = {
  enabled: boolean;
  startTime: string;
  endTime: string;
};

type ExceptionDraft = {
  date: string;
  isBlocked: boolean;
  startTime: string;
  endTime: string;
  reason: string;
};

function buildDayStates(availability: AvailabilityRow[]): DayState[] {
  const regular = availability.filter((r) => !r.date);
  const states: DayState[] = DAY_NAMES.map((_, day) => {
    const row = regular.find((r) => r.days.includes(day));
    return row
      ? { enabled: true, startTime: row.startTime, endTime: row.endTime }
      : { enabled: false, startTime: "09:00", endTime: "17:00" };
  });
  return states;
}

function buildExceptions(availability: AvailabilityRow[]) {
  return availability
    .filter((r) => !!r.date)
    .map((r) => ({
      id: r.id,
      date: r.date!,
      isBlocked: r.isBlocked,
      startTime: r.startTime,
      endTime: r.endTime,
      reason: r.reason ?? "",
    }));
}

export function ScheduleEditor({
  saveEndpoint,
  availability,
  heading = "Weekly schedule",
  onSaved,
}: {
  saveEndpoint: string;
  availability: AvailabilityRow[];
  heading?: string;
  onSaved?: () => void;
}) {
  const [dayStates, setDayStates] = useState<DayState[]>(() => buildDayStates(availability));
  const [exceptions, setExceptions] = useState(() => buildExceptions(availability));
  const [exceptionDraft, setExceptionDraft] = useState<ExceptionDraft>({
    date: "",
    isBlocked: true,
    startTime: "09:00",
    endTime: "17:00",
    reason: "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setDay(index: number, patch: Partial<DayState>) {
    setDayStates((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function addException() {
    if (!exceptionDraft.date) return;
    setExceptions((prev) => [
      ...prev,
      { id: `draft-${Date.now()}`, ...exceptionDraft },
    ]);
    setExceptionDraft({ date: "", isBlocked: true, startTime: "09:00", endTime: "17:00", reason: "" });
  }

  function removeException(id: string) {
    setExceptions((prev) => prev.filter((e) => e.id !== id));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);

    // Compact day states into grouped rows
    const availabilityPayload: Array<{ days: number[]; startTime: string; endTime: string }> = [];
    const grouped = new Map<string, number[]>();
    dayStates.forEach((d, i) => {
      if (!d.enabled) return;
      const key = `${d.startTime}-${d.endTime}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(i);
    });
    for (const [key, days] of grouped) {
      const keyParts = key.split("-");
      const startTime = keyParts[0] ?? "09:00";
      const endTime = keyParts[1] ?? "17:00";
      availabilityPayload.push({ days, startTime, endTime });
    }

    const exceptionsPayload = exceptions.map((e) => ({
      date: e.date,
      isBlocked: e.isBlocked,
      startTime: e.startTime,
      endTime: e.endTime,
      reason: e.reason || undefined,
    }));

    try {
      const res = await fetch(saveEndpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availability: availabilityPayload, exceptions: exceptionsPayload }),
      });
      if (!res.ok) {
        const data = (await res.json()) as {
          error?: string;
          message?: string;
        };
        setError(data.message ?? data.error ?? "Save failed");
      } else {
        setSaved(true);
        onSaved?.();
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="text-[var(--dpf-muted)]" style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {heading}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {DAY_NAMES.map((name, i) => {
          const d = dayStates[i];
          if (!d) return null;
          return (
            <div key={name} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, fontSize: 13 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="checkbox"
                  checked={d.enabled}
                  onChange={(e) => setDay(i, { enabled: e.target.checked })}
                  aria-label={`${name} open`}
                  className="accent-[var(--dpf-accent)]"
                />
                <span className={d.enabled ? undefined : "text-[var(--dpf-muted)]"} style={{ width: 80 }}>{name}</span>
              </label>
              {d.enabled ? (
                <>
                  <input
                    type="time"
                    value={d.startTime}
                    onChange={(e) => setDay(i, { startTime: e.target.value })}
                    aria-label={`${name} opening time`}
                    className="min-h-[44px] min-w-[44px] border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]" style={{ padding: "2px 6px", borderRadius: 4, color: "inherit", fontSize: 12 }}
                  />
                  <span className="text-[var(--dpf-muted)]">–</span>
                  <input
                    type="time"
                    value={d.endTime}
                    onChange={(e) => setDay(i, { endTime: e.target.value })}
                    aria-label={`${name} closing time`}
                    className="min-h-[44px] min-w-[44px] border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]" style={{ padding: "2px 6px", borderRadius: 4, color: "inherit", fontSize: 12 }}
                  />
                </>
              ) : (
                <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>Closed</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Exceptions */}
      <div style={{ marginTop: 16 }}>
        <div className="text-[var(--dpf-muted)]" style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Exceptions
        </div>
        {exceptions.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
            {exceptions.map((ex) => (
              <div key={ex.id} className="bg-[var(--dpf-surface-2)]" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, padding: "4px 8px", borderRadius: 4 }}>
                <span style={{ fontFamily: "monospace" }}>{ex.date}</span>
                <span className={ex.isBlocked ? "text-[var(--dpf-error)]" : "text-[var(--dpf-accent)]"}>
                  {ex.isBlocked ? "Blocked" : `${ex.startTime}–${ex.endTime}`}
                </span>
                {ex.reason && <span className="text-[var(--dpf-muted)]">{ex.reason}</span>}
                <button
                  onClick={() => removeException(ex.id)}
                  aria-label={`Remove schedule exception on ${ex.date}`}
                  className="min-h-[44px] min-w-[44px] text-[var(--dpf-muted)]"
                  style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 12 }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <input
            type="date"
            value={exceptionDraft.date}
            onChange={(e) => setExceptionDraft((p) => ({ ...p, date: e.target.value }))}
            aria-label="Exception date"
            className="min-h-[44px] min-w-[44px] border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]" style={{ padding: "4px 8px", borderRadius: 4, color: "inherit", fontSize: 12 }}
          />
          <select
            value={exceptionDraft.isBlocked ? "blocked" : "custom"}
            onChange={(e) => setExceptionDraft((p) => ({ ...p, isBlocked: e.target.value === "blocked" }))}
            aria-label="Exception type"
            className="min-h-[44px] min-w-[44px] border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]" style={{ padding: "4px 8px", borderRadius: 4, color: "inherit", fontSize: 12 }}
          >
            <option value="blocked" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Block day</option>
            <option value="custom" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Custom hours</option>
          </select>
          {!exceptionDraft.isBlocked && (
            <>
              <input
                type="time"
                value={exceptionDraft.startTime}
                onChange={(e) => setExceptionDraft((p) => ({ ...p, startTime: e.target.value }))}
                aria-label="Exception opening time"
                className="min-h-[44px] min-w-[44px] border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]" style={{ padding: "2px 6px", borderRadius: 4, color: "inherit", fontSize: 12 }}
              />
              <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>–</span>
              <input
                type="time"
                value={exceptionDraft.endTime}
                onChange={(e) => setExceptionDraft((p) => ({ ...p, endTime: e.target.value }))}
                aria-label="Exception closing time"
                className="min-h-[44px] min-w-[44px] border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]" style={{ padding: "2px 6px", borderRadius: 4, color: "inherit", fontSize: 12 }}
              />
            </>
          )}
          <input
            type="text"
            placeholder="Reason (optional)"
            value={exceptionDraft.reason}
            onChange={(e) => setExceptionDraft((p) => ({ ...p, reason: e.target.value }))}
            aria-label="Exception reason (optional)"
            className="min-h-[44px] min-w-[44px] border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]" style={{ padding: "4px 8px", borderRadius: 4, color: "inherit", fontSize: 12, width: 160 }}
          />
          <button
            onClick={addException}
            disabled={!exceptionDraft.date}
            aria-label="Add schedule exception"
            className="min-h-[44px] min-w-[44px] border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]" style={{ padding: "4px 10px", borderRadius: 4, color: "inherit", cursor: "pointer", fontSize: 12 }}
          >
            Add
          </button>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
        <button
          onClick={save}
          disabled={saving}
          className="min-h-[44px] min-w-[44px] bg-[var(--dpf-accent)] text-white" style={{ padding: "6px 14px", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
        >
          {saving ? "Saving…" : "Save Schedule"}
        </button>
        {saved && <span className="text-[var(--dpf-success)]" style={{ fontSize: 12 }}>Saved</span>}
        {error && <span className="text-[var(--dpf-error)]" style={{ fontSize: 12 }}>{error}</span>}
      </div>
    </div>
  );
}
