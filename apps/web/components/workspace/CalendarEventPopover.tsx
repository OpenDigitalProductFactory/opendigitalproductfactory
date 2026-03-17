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
  { value: "hr", label: "HR", color: "#a78bfa" },
  { value: "operations", label: "Operations", color: "#38bdf8" },
  { value: "platform", label: "Platform", color: "#fb923c" },
  { value: "personal", label: "Personal", color: "#4ade80" },
];

type Props = {
  defaultDate?: string;
  defaultEndDate?: string;
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
        endAt: form.endAt || undefined,
        allDay: form.allDay,
        description: form.description || undefined,
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
          background: "#1a1a2e",
          border: "1px solid #2a2a40",
          borderRadius: 10,
          padding: 20,
          width: 360,
          maxWidth: "90vw",
        }}
      >
        <h3 style={{ color: "#fff", fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
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
              border: "1px solid #2a2a40", background: "#0d0d18", color: "#fff",
            }}
          />

          <div style={{ display: "flex", gap: 6 }}>
            <select
              value={form.eventType}
              onChange={(e) => setForm((p) => ({ ...p, eventType: e.target.value }))}
              style={{
                flex: 1, padding: "6px 8px", fontSize: 12, borderRadius: 4,
                border: "1px solid #2a2a40", background: "#0d0d18", color: "#fff",
              }}
            >
              {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <select
              value={form.category}
              onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
              style={{
                flex: 1, padding: "6px 8px", fontSize: 12, borderRadius: 4,
                border: "1px solid #2a2a40", background: "#0d0d18", color: "#fff",
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
                border: "1px solid #2a2a40", background: "#0d0d18", color: "#fff",
              }}
            />
            <input
              type="date"
              value={form.endAt}
              onChange={(e) => setForm((p) => ({ ...p, endAt: e.target.value }))}
              placeholder="End date"
              style={{
                flex: 1, padding: "6px 8px", fontSize: 12, borderRadius: 4,
                border: "1px solid #2a2a40", background: "#0d0d18", color: "#fff",
              }}
            />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#b0b0c8" }}>
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
              border: "1px solid #2a2a40", background: "#0d0d18", color: "#fff",
            }}
          />
        </div>

        {message && (
          <p style={{ fontSize: 11, color: message.includes("required") || message.includes("Failed") ? "#ef4444" : "#4ade80", marginTop: 8 }}>
            {message}
          </p>
        )}

        <div style={{ display: "flex", gap: 6, marginTop: 12, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "6px 14px", fontSize: 12, borderRadius: 4,
              border: "1px solid #2a2a40", background: "transparent", color: "#b0b0c8", cursor: "pointer",
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
              border: "1px solid rgba(124,140,248,0.4)", background: "rgba(124,140,248,0.15)",
              color: "#7c8cf8", cursor: "pointer", opacity: isPending ? 0.5 : 1,
            }}
          >
            {isPending ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
