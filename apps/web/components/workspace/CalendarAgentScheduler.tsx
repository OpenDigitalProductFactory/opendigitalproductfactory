"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { scheduleAgentTask } from "@/lib/actions/agent-task-scheduler";

const AGENTS = [
  { id: "coo", name: "COO", route: "/workspace" },
  { id: "portfolio-advisor", name: "Portfolio Analyst", route: "/portfolio" },
  { id: "inventory-specialist", name: "Inventory Specialist", route: "/inventory" },
  { id: "ea-architect", name: "EA Architect", route: "/ea" },
  { id: "hr-specialist", name: "HR Specialist", route: "/employee" },
  { id: "customer-advisor", name: "Customer Advisor", route: "/customer" },
  { id: "ops-coordinator", name: "Operations Coordinator", route: "/ops" },
  { id: "platform-engineer", name: "Platform Engineer", route: "/platform" },
  { id: "build-specialist", name: "Build Specialist", route: "/build" },
  { id: "admin-assistant", name: "Admin Assistant", route: "/admin" },
  { id: "marketing-specialist", name: "Marketing Specialist", route: "/storefront" },
];

const SCHEDULE_PRESETS = [
  { label: "Once (at selected time)", value: "once" },
  { label: "Daily", value: "daily" },
  { label: "Every weekday", value: "weekdays" },
  { label: "Weekly (same day)", value: "weekly" },
  { label: "Monthly (1st)", value: "monthly" },
];

function buildCronExpression(preset: string, date: string, time: string): string {
  const [hour, minute] = (time || "09:00").split(":").map(Number);
  const d = new Date(date);
  const dow = d.getDay(); // 0=Sun

  switch (preset) {
    case "daily":    return `${minute} ${hour} * * *`;
    case "weekdays": return `${minute} ${hour} * * 1-5`;
    case "weekly":   return `${minute} ${hour} * * ${dow}`;
    case "monthly":  return `${minute} ${hour} 1 * *`;
    case "once":
    default:         return `${minute} ${hour} ${d.getDate()} ${d.getMonth() + 1} *`;
  }
}

type Props = {
  defaultDate: string;
  onClose: () => void;
};

export function CalendarAgentScheduler({ defaultDate, onClose }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({
    agentId: "coo",
    title: "",
    prompt: "",
    schedule: "once",
    time: "09:00",
  });
  const [message, setMessage] = useState<string | null>(null);

  const selectedAgent = AGENTS.find((a) => a.id === form.agentId);

  function handleSubmit() {
    if (!form.title.trim()) { setMessage("Title is required"); return; }
    if (!form.prompt.trim()) { setMessage("Prompt is required"); return; }

    const cronExpr = buildCronExpression(form.schedule, defaultDate, form.time);

    startTransition(async () => {
      const result = await scheduleAgentTask({
        agentId: form.agentId,
        title: form.title,
        prompt: form.prompt,
        routeContext: selectedAgent?.route ?? "/workspace",
        schedule: cronExpr,
      });
      if (result.success) {
        onClose();
        router.refresh();
      } else {
        setMessage(result.error ?? "Failed to schedule");
      }
    });
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)",
          borderRadius: 10, padding: 20, width: 400, maxWidth: "90vw",
        }}
      >
        <h3 style={{ color: "var(--dpf-text)", fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
          Schedule AI Coworker Task
        </h3>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Agent selector */}
          <select
            value={form.agentId}
            onChange={(e) => setForm((p) => ({ ...p, agentId: e.target.value }))}
            style={{
              padding: "6px 8px", fontSize: 12, borderRadius: 4,
              border: "1px solid var(--dpf-border)", background: "var(--dpf-bg)", color: "var(--dpf-text)",
            }}
          >
            {AGENTS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>

          {/* Title */}
          <input
            type="text"
            placeholder="Task title (e.g. Weekly portfolio report)"
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            style={{
              padding: "6px 10px", fontSize: 13, borderRadius: 4,
              border: "1px solid var(--dpf-border)", background: "var(--dpf-bg)", color: "var(--dpf-text)",
            }}
          />

          {/* Prompt */}
          <textarea
            placeholder="What should the coworker do? (e.g. Analyze portfolio health and flag any risks)"
            value={form.prompt}
            onChange={(e) => setForm((p) => ({ ...p, prompt: e.target.value }))}
            rows={3}
            style={{
              padding: "6px 10px", fontSize: 12, borderRadius: 4, resize: "none",
              border: "1px solid var(--dpf-border)", background: "var(--dpf-bg)", color: "var(--dpf-text)",
            }}
          />

          {/* Schedule + time */}
          <div style={{ display: "flex", gap: 6 }}>
            <select
              value={form.schedule}
              onChange={(e) => setForm((p) => ({ ...p, schedule: e.target.value }))}
              style={{
                flex: 1, padding: "6px 8px", fontSize: 12, borderRadius: 4,
                border: "1px solid var(--dpf-border)", background: "var(--dpf-bg)", color: "var(--dpf-text)",
              }}
            >
              {SCHEDULE_PRESETS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <input
              type="time"
              value={form.time}
              onChange={(e) => setForm((p) => ({ ...p, time: e.target.value }))}
              style={{
                width: 100, padding: "6px 8px", fontSize: 12, borderRadius: 4,
                border: "1px solid var(--dpf-border)", background: "var(--dpf-bg)", color: "var(--dpf-text)",
              }}
            />
          </div>

          {/* Date context */}
          <p style={{ fontSize: 10, color: "var(--dpf-muted)", margin: 0 }}>
            Starting: {new Date(defaultDate).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            {form.schedule !== "once" && " (recurring)"}
          </p>
        </div>

        {message && (
          <p style={{ fontSize: 11, color: "var(--dpf-error)", marginTop: 8 }}>{message}</p>
        )}

        <div style={{ display: "flex", gap: 6, marginTop: 12, justifyContent: "flex-end" }}>
          <button
            type="button" onClick={onClose}
            style={{
              padding: "6px 14px", fontSize: 12, borderRadius: 4,
              border: "1px solid var(--dpf-border)", background: "transparent",
              color: "var(--dpf-muted)", cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button" onClick={handleSubmit} disabled={isPending}
            style={{
              padding: "6px 14px", fontSize: 12, borderRadius: 4,
              border: "1px solid color-mix(in srgb, #14b8a6 40%, transparent)",
              background: "color-mix(in srgb, #14b8a6 15%, transparent)",
              color: "#14b8a6", cursor: "pointer", fontWeight: 600,
              opacity: isPending ? 0.5 : 1,
            }}
          >
            {isPending ? "Scheduling..." : "Schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}
