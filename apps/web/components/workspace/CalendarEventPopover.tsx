"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCalendarEvent } from "@/lib/actions/calendar";

const EVENT_TYPES = [
  { value: "meeting", label: "Meeting" },
  { value: "reminder", label: "Reminder" },
  { value: "deadline", label: "Deadline" },
  { value: "personal", label: "Personal" },
];

const CATEGORIES = [
  { value: "hr", label: "HR", color: "var(--dpf-accent)" },
  { value: "operations", label: "Operations", color: "var(--dpf-info)" },
  { value: "platform", label: "Platform", color: "var(--dpf-warning)" },
  { value: "compliance", label: "Compliance", color: "#e879f9" },
  { value: "finance", label: "Finance", color: "#facc15" },
  { value: "personal", label: "Personal", color: "var(--dpf-success)" },
];

type Props = {
  defaultDate?: string;
  defaultEndDate?: string | undefined;
  onClose: () => void;
};

export function CalendarEventPopover({ defaultDate, defaultEndDate, onClose }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({
    title: "",
    eventType: "meeting",
    category: "personal",
    startAt: defaultDate ?? new Date().toISOString().split("T")[0]!,
    endAt: defaultEndDate ?? "",
    allDay: true,
    description: "",
  });
  const [message, setMessage] = useState<string | null>(null);

  function handleSubmit() {
    if (!form.title.trim()) { setMessage("Title is required"); return; }
    startTransition(async () => {
      const result = await createCalendarEvent({
        title: form.title,
        eventType: form.eventType,
        category: form.category,
        startAt: form.startAt,
        ...(form.endAt ? { endAt: form.endAt } : {}),
        allDay: form.allDay,
        ...(form.description ? { description: form.description } : {}),
      });
      if (result.success) {
        onClose();
        router.refresh();
      } else {
        setMessage(result.error ?? "Failed to create event");
      }
    });
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "var(--dpf-surface-1)",
          border: "1px solid var(--dpf-border)",
          borderRadius: 10,
          padding: 20,
          width: 360,
          maxWidth: "90vw",
        }}
      >
        <h3 style={{ color: "var(--dpf-text)", fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
          New Calendar Event
        </h3>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            type="text"
            placeholder="Event title"
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            autoFocus
            style={{
              padding: "6px 10px", fontSize: 13, borderRadius: 4,
              border: "1px solid var(--dpf-border)", background: "var(--dpf-bg)", color: "var(--dpf-text)",
            }}
          />

          <div style={{ display: "flex", gap: 6 }}>
            <select
              value={form.eventType}
              onChange={(e) => setForm((p) => ({ ...p, eventType: e.target.value }))}
              style={{
                flex: 1, padding: "6px 8px", fontSize: 12, borderRadius: 4,
                border: "1px solid var(--dpf-border)", background: "var(--dpf-bg)", color: "var(--dpf-text)",
              }}
            >
              {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <select
              value={form.category}
              onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
              style={{
                flex: 1, padding: "6px 8px", fontSize: 12, borderRadius: 4,
                border: "1px solid var(--dpf-border)", background: "var(--dpf-bg)", color: "var(--dpf-text)",
              }}
            >
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="date"
              value={form.startAt}
              onChange={(e) => setForm((p) => ({ ...p, startAt: e.target.value }))}
              style={{
                flex: 1, padding: "6px 8px", fontSize: 12, borderRadius: 4,
                border: "1px solid var(--dpf-border)", background: "var(--dpf-bg)", color: "var(--dpf-text)",
              }}
            />
            <input
              type="date"
              value={form.endAt}
              onChange={(e) => setForm((p) => ({ ...p, endAt: e.target.value }))}
              placeholder="End date"
              style={{
                flex: 1, padding: "6px 8px", fontSize: 12, borderRadius: 4,
                border: "1px solid var(--dpf-border)", background: "var(--dpf-bg)", color: "var(--dpf-text)",
              }}
            />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--dpf-muted)" }}>
            <input
              type="checkbox"
              checked={form.allDay}
              onChange={(e) => setForm((p) => ({ ...p, allDay: e.target.checked }))}
            />
            All day
          </label>

          <textarea
            placeholder="Description (optional)"
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            rows={2}
            style={{
              padding: "6px 10px", fontSize: 12, borderRadius: 4, resize: "none",
              border: "1px solid var(--dpf-border)", background: "var(--dpf-bg)", color: "var(--dpf-text)",
            }}
          />
        </div>

        {message && (
          <p style={{ fontSize: 11, color: message.includes("required") || message.includes("Failed") ? "var(--dpf-error)" : "var(--dpf-success)", marginTop: 8 }}>
            {message}
          </p>
        )}

        <div style={{ display: "flex", gap: 6, marginTop: 12, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "6px 14px", fontSize: 12, borderRadius: 4,
              border: "1px solid var(--dpf-border)", background: "transparent", color: "var(--dpf-muted)", cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            style={{
              padding: "6px 14px", fontSize: 12, borderRadius: 4,
              border: "1px solid color-mix(in srgb, var(--dpf-accent) 40%, transparent)", background: "color-mix(in srgb, var(--dpf-accent) 15%, transparent)",
              color: "var(--dpf-accent)", cursor: "pointer", opacity: isPending ? 0.5 : 1,
            }}
          >
            {isPending ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
