"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { submitBooking } from "@/lib/storefront-actions";

// ── Types ─────────────────────────────────────────────────────────────────────

type AvailableSlot = {
  startTime: string;
  endTime: string;
  providerId?: string;
  providerName?: string;
  remainingCapacity?: number;
};

type SlotsByProvider = {
  provider: { id: string; name: string; avatarUrl?: string | null };
  slots: AvailableSlot[];
};

type SlotsResult =
  | { mode: "next-available"; slots: AvailableSlot[] }
  | { mode: "customer-choice"; providers: SlotsByProvider[] }
  | { mode: "class"; slots: AvailableSlot[] };

type Step = "date" | "slot" | "form" | "confirmation";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface SlotBookingFlowProps {
  orgSlug: string;
  itemId: string;         // business key e.g. "itm-abc"
  itemInternalId: string; // cuid for FK references
  itemName: string;
  timezone: string;
  bookingConfig: Record<string, unknown> | null;
}

// ── Shared style helpers ──────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid var(--dpf-border)",
  borderRadius: 6,
  fontSize: 14,
  background: "var(--dpf-surface-1)",
  color: "var(--dpf-text)",
  width: "100%",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: "var(--dpf-text)",
};

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

function primaryBtnStyle(disabled?: boolean): React.CSSProperties {
  return {
    padding: "10px 20px",
    background: disabled ? "var(--dpf-muted)" : "var(--dpf-accent, #4f46e5)",
    color: "var(--dpf-surface-1, #fff)",
    border: "none",
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.7 : 1,
  };
}

function ghostBtnStyle(): React.CSSProperties {
  return {
    background: "none",
    border: "none",
    color: "var(--dpf-accent, #4f46e5)",
    cursor: "pointer",
    fontSize: 13,
    padding: 0,
    textDecoration: "underline",
  };
}

// ── Calendar helpers ──────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getMonthString(year: number, month: number): string {
  // month is 1-based
  return `${year}-${String(month).padStart(2, "0")}`;
}

function getMonthLabel(year: number, month: number): string {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleString("default", { month: "long", year: "numeric" });
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay(); // 0=Sun
}

function formatDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatDisplayDate(dateStr: string): string {
  const parts = dateStr.split("-").map(Number);
  const y = parts[0] as number;
  const m = parts[1] as number;
  const d = parts[2] as number;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("default", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function formatTime(timeStr: string): string {
  // timeStr is "HH:MM" (24h)
  const parts = timeStr.split(":").map(Number);
  const h = parts[0] as number;
  const min = parts[1] as number;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}

// ── Main component ────────────────────────────────────────────────────────────

export function SlotBookingFlow({
  orgSlug,
  itemId,
  itemInternalId,
  itemName,
  timezone,
}: SlotBookingFlowProps) {
  const router = useRouter();

  // Navigation state
  const [step, setStep] = useState<Step>("date");

  // Date step
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth() + 1); // 1-based
  const [availableDates, setAvailableDates] = useState<Set<string>>(new Set());
  const [datesLoading, setDatesLoading] = useState(false);
  const [datesError, setDatesError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Slot step
  const [slotsResult, setSlotsResult] = useState<SlotsResult | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<{ id: string; name: string; avatarUrl?: string | null } | null>(null);

  // Hold + form step
  const [holderToken, setHolderToken] = useState<string | null>(null);
  const [holdLoading, setHoldLoading] = useState(false);
  const [holdError, setHoldError] = useState<string | null>(null);

  // Submit step
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Fetch available dates ───────────────────────────────────────────────────

  const fetchDates = useCallback(async (year: number, month: number) => {
    setDatesLoading(true);
    setDatesError(null);
    try {
      const monthStr = getMonthString(year, month);
      const res = await fetch(
        `/api/storefront/${orgSlug}/dates?itemId=${encodeURIComponent(itemId)}&month=${monthStr}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to load availability");
      }
      const data = await res.json();
      setAvailableDates(new Set<string>(data.dates ?? []));
    } catch (err) {
      setDatesError(err instanceof Error ? err.message : "Failed to load availability");
    } finally {
      setDatesLoading(false);
    }
  }, [orgSlug, itemId]);

  useEffect(() => {
    void fetchDates(viewYear, viewMonth);
  }, [fetchDates, viewYear, viewMonth]);

  // ── Month navigation ────────────────────────────────────────────────────────

  function prevMonth() {
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  // ── Date selection ──────────────────────────────────────────────────────────

  async function handleDateSelect(dateStr: string) {
    if (!availableDates.has(dateStr)) return;
    setSelectedDate(dateStr);
    setSelectedSlot(null);
    setSelectedProvider(null);
    setSlotsResult(null);
    setSlotsError(null);
    setStep("slot");

    setSlotsLoading(true);
    try {
      const res = await fetch(
        `/api/storefront/${orgSlug}/slots?itemId=${encodeURIComponent(itemId)}&date=${dateStr}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to load slots");
      }
      const data: SlotsResult = await res.json();
      setSlotsResult(data);
    } catch (err) {
      setSlotsError(err instanceof Error ? err.message : "Failed to load slots");
    } finally {
      setSlotsLoading(false);
    }
  }

  // ── Slot selection + hold ───────────────────────────────────────────────────

  async function handleSlotSelect(slot: AvailableSlot, provider?: { id: string; name: string; avatarUrl?: string | null }) {
    setSelectedSlot(slot);
    setSelectedProvider(provider ?? null);
    setHoldError(null);
    setHoldLoading(true);

    try {
      // Build UTC ISO strings from the selected date + slot times
      const slotStart = buildUtcIso(selectedDate!, slot.startTime, timezone);
      const slotEnd = buildUtcIso(selectedDate!, slot.endTime, timezone);

      const res = await fetch(`/api/storefront/${orgSlug}/hold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: itemInternalId,
          providerId: provider?.id ?? slot.providerId,
          slotStart,
          slotEnd,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to hold slot");
      }

      const data = await res.json();
      setHolderToken(data.holderToken);
      setStep("form");
    } catch (err) {
      setHoldError(err instanceof Error ? err.message : "Failed to hold slot");
    } finally {
      setHoldLoading(false);
    }
  }

  // ── Form submit ─────────────────────────────────────────────────────────────

  async function handleFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitLoading(true);
    setSubmitError(null);

    const fd = new FormData(e.currentTarget);
    const slot = selectedSlot!;
    const scheduledAt = new Date(buildUtcIso(selectedDate!, slot.startTime, timezone));
    const durationMinutes = computeDurationMinutes(slot.startTime, slot.endTime);
    const providerId = selectedProvider?.id ?? slot.providerId;

    const result = await submitBooking(orgSlug, {
      itemId: itemInternalId,
      holderToken: holderToken ?? undefined,
      providerId,
      scheduledAt,
      durationMinutes,
      customerEmail: fd.get("email") as string,
      customerName: fd.get("name") as string,
      customerPhone: (fd.get("phone") as string) || undefined,
      notes: (fd.get("notes") as string) || undefined,
      idempotencyKey: crypto.randomUUID(),
    });

    if (!result.success) {
      setSubmitError(result.error);
      setSubmitLoading(false);
      return;
    }

    router.push(`/s/${orgSlug}/checkout?ref=${result.ref}&type=booking`);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {step === "date" && (
        <DateStep
          viewYear={viewYear}
          viewMonth={viewMonth}
          availableDates={availableDates}
          loading={datesLoading}
          error={datesError}
          timezone={timezone}
          onPrevMonth={prevMonth}
          onNextMonth={nextMonth}
          onSelectDate={handleDateSelect}
        />
      )}

      {step === "slot" && selectedDate && (
        <SlotStep
          selectedDate={selectedDate}
          slotsResult={slotsResult}
          loading={slotsLoading || holdLoading}
          error={slotsError ?? holdError}
          onBack={() => setStep("date")}
          onSelectSlot={handleSlotSelect}
        />
      )}

      {step === "form" && selectedDate && selectedSlot && (
        <FormStep
          selectedDate={selectedDate}
          selectedSlot={selectedSlot}
          selectedProvider={selectedProvider}
          itemName={itemName}
          loading={submitLoading}
          error={submitError}
          onBack={() => setStep("slot")}
          onSubmit={handleFormSubmit}
        />
      )}
    </div>
  );
}

// ── Date Step ─────────────────────────────────────────────────────────────────

function DateStep({
  viewYear,
  viewMonth,
  availableDates,
  loading,
  error,
  timezone,
  onPrevMonth,
  onNextMonth,
  onSelectDate,
}: {
  viewYear: number;
  viewMonth: number;
  availableDates: Set<string>;
  loading: boolean;
  error: string | null;
  timezone: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onSelectDate: (date: string) => void;
}) {
  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDow = getFirstDayOfWeek(viewYear, viewMonth);
  const todayStr = (new Date().toISOString().split("T")[0]) as string;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Month header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={onPrevMonth} style={ghostBtnStyle()} aria-label="Previous month">
          ‹ Prev
        </button>
        <span style={{ fontWeight: 600, fontSize: 16, color: "var(--dpf-text)" }}>
          {getMonthLabel(viewYear, viewMonth)}
        </span>
        <button onClick={onNextMonth} style={ghostBtnStyle()} aria-label="Next month">
          Next ›
        </button>
      </div>

      {/* Timezone notice */}
      <div style={{ fontSize: 12, color: "var(--dpf-muted)", textAlign: "center" }}>
        Times shown in {timezone}
      </div>

      {/* Calendar grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {WEEKDAY_LABELS.map((d) => (
          <div
            key={d}
            style={{
              textAlign: "center",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--dpf-muted)",
              padding: "4px 0",
            }}
          >
            {d}
          </div>
        ))}

        {/* Empty cells before first day */}
        {Array.from({ length: firstDow }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}

        {/* Day cells */}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
          const dateStr = formatDateStr(viewYear, viewMonth, day);
          const isAvailable = availableDates.has(dateStr);
          const isPast = dateStr < todayStr;
          const isClickable = isAvailable && !isPast && !loading;

          return (
            <button
              key={day}
              disabled={!isClickable}
              onClick={() => isClickable && onSelectDate(dateStr)}
              style={{
                textAlign: "center",
                padding: "8px 4px",
                borderRadius: 6,
                border: "1px solid transparent",
                fontSize: 14,
                cursor: isClickable ? "pointer" : "not-allowed",
                opacity: isPast || (!isAvailable && !loading) ? 0.4 : 1,
                background: isAvailable && !isPast ? "var(--dpf-surface-2)" : "transparent",
                color: "var(--dpf-text)",
                fontWeight: isAvailable && !isPast ? 600 : 400,
                transition: "background 0.15s",
              }}
            >
              {day}
            </button>
          );
        })}
      </div>

      {loading && (
        <div style={{ textAlign: "center", fontSize: 13, color: "var(--dpf-muted)" }}>
          Loading availability…
        </div>
      )}
      {error && (
        <div style={{ fontSize: 13, color: "var(--dpf-error)" }}>{error}</div>
      )}
    </div>
  );
}

// ── Slot Step ─────────────────────────────────────────────────────────────────

function SlotStep({
  selectedDate,
  slotsResult,
  loading,
  error,
  onBack,
  onSelectSlot,
}: {
  selectedDate: string;
  slotsResult: SlotsResult | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onSelectSlot: (slot: AvailableSlot, provider?: { id: string; name: string; avatarUrl?: string | null }) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={ghostBtnStyle()}>
          ‹ Back to calendar
        </button>
      </div>

      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--dpf-text)" }}>
        {formatDisplayDate(selectedDate)}
      </div>

      {loading && (
        <div style={{ fontSize: 13, color: "var(--dpf-muted)" }}>Loading slots…</div>
      )}
      {error && (
        <div style={{ fontSize: 13, color: "var(--dpf-error)" }}>{error}</div>
      )}

      {!loading && !error && slotsResult && (
        <>
          {slotsResult.mode === "next-available" && (
            <NextAvailableSlots
              slots={slotsResult.slots}
              onSelect={(slot) => onSelectSlot(slot)}
            />
          )}
          {slotsResult.mode === "customer-choice" && (
            <CustomerChoiceSlots
              providers={slotsResult.providers}
              onSelect={onSelectSlot}
            />
          )}
          {slotsResult.mode === "class" && (
            <ClassSlots
              slots={slotsResult.slots}
              onSelect={(slot) => onSelectSlot(slot)}
            />
          )}
        </>
      )}

      {!loading && !error && slotsResult && isEmpty(slotsResult) && (
        <div style={{ fontSize: 14, color: "var(--dpf-muted)" }}>
          No available slots on this date. Please pick another day.
        </div>
      )}
    </div>
  );
}

function isEmpty(result: SlotsResult): boolean {
  if (result.mode === "customer-choice") return result.providers.length === 0;
  return result.slots.length === 0;
}

function NextAvailableSlots({
  slots,
  onSelect,
}: {
  slots: AvailableSlot[];
  onSelect: (slot: AvailableSlot) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 13, color: "var(--dpf-muted)" }}>Select a time:</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {slots.map((slot) => (
          <button
            key={`${slot.startTime}-${slot.providerId ?? "any"}`}
            onClick={() => onSelect(slot)}
            style={{
              padding: "8px 14px",
              border: "1px solid var(--dpf-border)",
              borderRadius: 6,
              background: "var(--dpf-surface-2)",
              color: "var(--dpf-text)",
              fontSize: 14,
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            {formatTime(slot.startTime)}
          </button>
        ))}
      </div>
    </div>
  );
}

function CustomerChoiceSlots({
  providers,
  onSelect,
}: {
  providers: SlotsByProvider[];
  onSelect: (slot: AvailableSlot, provider: { id: string; name: string; avatarUrl?: string | null }) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {providers.map(({ provider, slots }) => (
        <div
          key={provider.id}
          style={{
            border: "1px solid var(--dpf-border)",
            borderRadius: 8,
            padding: 16,
            background: "var(--dpf-surface-1)",
          }}
        >
          {/* Provider header */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            {provider.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={provider.avatarUrl}
                alt={provider.name}
                style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }}
              />
            ) : (
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: "var(--dpf-accent, #4f46e5)",
                  color: "var(--dpf-surface-1, #fff)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                {provider.name.charAt(0).toUpperCase()}
              </div>
            )}
            <span style={{ fontWeight: 600, fontSize: 15, color: "var(--dpf-text)" }}>
              {provider.name}
            </span>
          </div>

          {/* Slot grid */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {slots.map((slot) => (
              <button
                key={slot.startTime}
                onClick={() => onSelect(slot, provider)}
                style={{
                  padding: "8px 14px",
                  border: "1px solid var(--dpf-border)",
                  borderRadius: 6,
                  background: "var(--dpf-surface-2)",
                  color: "var(--dpf-text)",
                  fontSize: 14,
                  cursor: "pointer",
                  fontWeight: 500,
                }}
              >
                {formatTime(slot.startTime)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ClassSlots({
  slots,
  onSelect,
}: {
  slots: AvailableSlot[];
  onSelect: (slot: AvailableSlot) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 13, color: "var(--dpf-muted)" }}>Select a session:</div>
      {slots.map((slot) => (
        <button
          key={slot.startTime}
          onClick={() => onSelect(slot)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            border: "1px solid var(--dpf-border)",
            borderRadius: 8,
            background: "var(--dpf-surface-2)",
            color: "var(--dpf-text)",
            fontSize: 14,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span style={{ fontWeight: 500 }}>
            {formatTime(slot.startTime)} — {formatTime(slot.endTime)}
          </span>
          {slot.remainingCapacity !== undefined && (
            <span style={{ fontSize: 13, color: "var(--dpf-muted)" }}>
              {slot.remainingCapacity} spot{slot.remainingCapacity !== 1 ? "s" : ""} left
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Form Step ─────────────────────────────────────────────────────────────────

function FormStep({
  selectedDate,
  selectedSlot,
  selectedProvider,
  itemName,
  loading,
  error,
  onBack,
  onSubmit,
}: {
  selectedDate: string;
  selectedSlot: AvailableSlot;
  selectedProvider: { id: string; name: string; avatarUrl?: string | null } | null;
  itemName: string;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
}) {
  const providerName =
    selectedProvider?.name ?? selectedSlot.providerName;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <button onClick={onBack} style={ghostBtnStyle()}>
        ‹ Back to slots
      </button>

      {/* Booking summary */}
      <div
        style={{
          padding: 16,
          background: "var(--dpf-surface-2)",
          borderRadius: 8,
          border: "1px solid var(--dpf-border)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 15, color: "var(--dpf-text)" }}>{itemName}</div>
        <div style={{ fontSize: 14, color: "var(--dpf-muted)" }}>
          {formatDisplayDate(selectedDate)}
        </div>
        <div style={{ fontSize: 14, color: "var(--dpf-muted)" }}>
          {formatTime(selectedSlot.startTime)} — {formatTime(selectedSlot.endTime)}
        </div>
        {providerName && (
          <div style={{ fontSize: 14, color: "var(--dpf-muted)" }}>
            with {providerName}
          </div>
        )}
      </div>

      {/* Contact form */}
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {error && (
          <div style={{ fontSize: 13, color: "var(--dpf-error)" }}>{error}</div>
        )}

        <div style={fieldStyle}>
          <label style={labelStyle}>Full name *</label>
          <input type="text" name="name" required style={inputStyle} autoComplete="name" />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Email address *</label>
          <input type="email" name="email" required style={inputStyle} autoComplete="email" />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Phone (optional)</label>
          <input type="tel" name="phone" style={inputStyle} autoComplete="tel" />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Notes (optional)</label>
          <textarea
            name="notes"
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </div>

        <button type="submit" disabled={loading} style={primaryBtnStyle(loading)}>
          {loading ? "Confirming…" : `Confirm booking`}
        </button>
      </form>
    </div>
  );
}

// ── UTC conversion helpers ────────────────────────────────────────────────────

/**
 * Convert a local date + HH:MM time to a UTC ISO string.
 * We use the Intl API to find the UTC offset for this timezone at this date,
 * then subtract it to produce the equivalent UTC time.
 */
function buildUtcIso(dateStr: string, timeStr: string, timezone: string): string {
  const timeParts = timeStr.split(":").map(Number);
  const h = timeParts[0] as number;
  const min = timeParts[1] as number;
  const dateParts = dateStr.split("-").map(Number);
  const year = dateParts[0] as number;
  const month = dateParts[1] as number;
  const day = dateParts[2] as number;

  // The reliable approach: use Intl.DateTimeFormat to find the local time that
  // a naive UTC date maps to, then adjust by the delta to get the true UTC time.
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  // We need to find UTC time T such that local(T, timezone) = dateStr + timeStr
  // Strategy: start with the naive UTC interpretation, then adjust.
  const naiveUtc = new Date(`${dateStr}T${timeStr.padStart(5, "0")}:00Z`);

  // What local time does naiveUtc produce in the target timezone?
  const parts = formatter.formatToParts(naiveUtc);
  const localH = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0");
  const localMin = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0");
  const localYear = parseInt(parts.find((p) => p.type === "year")?.value ?? String(year));
  const localMonth = parseInt(parts.find((p) => p.type === "month")?.value ?? String(month));
  const localDay = parseInt(parts.find((p) => p.type === "day")?.value ?? String(day));

  // Delta in minutes
  const localTotalMin = (localYear * 525960) + (localMonth * 43800) + (localDay * 1440) + localH * 60 + localMin;
  const targetTotalMin = (year * 525960) + (month * 43800) + (day * 1440) + h * 60 + min;
  const deltaMs = (targetTotalMin - localTotalMin) * 60 * 1000;

  const corrected = new Date(naiveUtc.getTime() + deltaMs);
  return corrected.toISOString();
}

function computeDurationMinutes(startTime: string, endTime: string): number {
  const sp = startTime.split(":").map(Number);
  const ep = endTime.split(":").map(Number);
  const sh = sp[0] as number;
  const sm = sp[1] as number;
  const eh = ep[0] as number;
  const em = ep[1] as number;
  return (eh * 60 + em) - (sh * 60 + sm);
}
