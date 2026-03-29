// apps/web/app/(shell)/complaints/ComplaintsClient.tsx
"use client";

import { useState } from "react";

type Complaint = {
  id: string;
  customerName: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  category: string;
  status: "open" | "investigating" | "resolved" | "closed";
  createdAt: string;
};

const SEVERITY_COLORS: Record<string, string> = {
  low: "#22c55e",
  medium: "#eab308",
  high: "#f97316",
  critical: "#ef4444",
};

const STATUS_COLORS: Record<string, string> = {
  open: "#3b82f6",
  investigating: "#a855f7",
  resolved: "#22c55e",
  closed: "#6b7280",
};

const DEMO_COMPLAINTS: Complaint[] = [
  { id: "C-001", customerName: "Sarah Chen", description: "Payment processing error during checkout — charged twice for order #4521", severity: "high", category: "Billing", status: "investigating", createdAt: "2026-03-28T14:30:00Z" },
  { id: "C-002", customerName: "Marcus Johnson", description: "Product page shows incorrect pricing for the Enterprise tier", severity: "medium", category: "Product", status: "open", createdAt: "2026-03-29T09:15:00Z" },
  { id: "C-003", customerName: "Emily Rodriguez", description: "Cannot reset password — reset email never arrives", severity: "high", category: "Account", status: "open", createdAt: "2026-03-29T10:45:00Z" },
  { id: "C-004", customerName: "David Kim", description: "Dashboard loading time exceeds 30 seconds on mobile", severity: "low", category: "Performance", status: "resolved", createdAt: "2026-03-27T16:00:00Z" },
  { id: "C-005", customerName: "Lisa Patel", description: "Data export missing records from February", severity: "critical", category: "Data", status: "investigating", createdAt: "2026-03-28T11:20:00Z" },
];

const CATEGORIES = ["Billing", "Product", "Account", "Performance", "Data", "Other"];
const SEVERITIES: Complaint["severity"][] = ["low", "medium", "high", "critical"];

export function ComplaintsClient() {
  const [complaints, setComplaints] = useState<Complaint[]>(DEMO_COMPLAINTS);
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [formData, setFormData] = useState({ customerName: "", description: "", severity: "medium" as Complaint["severity"], category: "Other" });

  const filtered = filterStatus === "all" ? complaints : complaints.filter((c) => c.status === filterStatus);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newComplaint: Complaint = {
      id: `C-${String(complaints.length + 1).padStart(3, "0")}`,
      ...formData,
      status: "open",
      createdAt: new Date().toISOString(),
    };
    setComplaints([newComplaint, ...complaints]);
    setFormData({ customerName: "", description: "", severity: "medium", category: "Other" });
    setShowForm(false);
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          {["all", "open", "investigating", "resolved", "closed"].map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
              style={{
                background: filterStatus === s ? "var(--dpf-accent)" : "var(--dpf-surface-2)",
                color: filterStatus === s ? "#fff" : "var(--dpf-muted)",
                border: `1px solid ${filterStatus === s ? "var(--dpf-accent)" : "var(--dpf-border)"}`,
              }}
            >
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-1.5 text-sm font-semibold text-white rounded-md transition-opacity hover:opacity-90"
          style={{ background: "var(--dpf-accent)" }}
        >
          {showForm ? "Cancel" : "+ New Complaint"}
        </button>
      </div>

      {/* Submit Form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 p-5 rounded-lg"
          style={{ background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)" }}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--dpf-muted)" }}>Customer Name</label>
              <input
                required
                value={formData.customerName}
                onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-md outline-none"
                style={{ background: "var(--dpf-surface-2)", border: "1px solid var(--dpf-border)", color: "var(--dpf-text)" }}
              />
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--dpf-muted)" }}>Severity</label>
                <select
                  value={formData.severity}
                  onChange={(e) => setFormData({ ...formData, severity: e.target.value as Complaint["severity"] })}
                  className="w-full px-3 py-2 text-sm rounded-md outline-none"
                  style={{ background: "var(--dpf-surface-2)", border: "1px solid var(--dpf-border)", color: "var(--dpf-text)" }}
                >
                  {SEVERITIES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--dpf-muted)" }}>Category</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-md outline-none"
                  style={{ background: "var(--dpf-surface-2)", border: "1px solid var(--dpf-border)", color: "var(--dpf-text)" }}
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--dpf-muted)" }}>Description</label>
            <textarea
              required
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-md outline-none resize-none"
              style={{ background: "var(--dpf-surface-2)", border: "1px solid var(--dpf-border)", color: "var(--dpf-text)" }}
            />
          </div>
          <button
            type="submit"
            className="px-5 py-2 text-sm font-semibold text-white rounded-md transition-opacity hover:opacity-90"
            style={{ background: "var(--dpf-accent)" }}
          >
            Submit Complaint
          </button>
        </form>
      )}

      {/* Complaints Table */}
      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--dpf-border)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--dpf-surface-2)" }}>
              <th className="text-left px-4 py-2.5 font-medium" style={{ color: "var(--dpf-muted)" }}>ID</th>
              <th className="text-left px-4 py-2.5 font-medium" style={{ color: "var(--dpf-muted)" }}>Customer</th>
              <th className="text-left px-4 py-2.5 font-medium" style={{ color: "var(--dpf-muted)" }}>Description</th>
              <th className="text-left px-4 py-2.5 font-medium" style={{ color: "var(--dpf-muted)" }}>Severity</th>
              <th className="text-left px-4 py-2.5 font-medium" style={{ color: "var(--dpf-muted)" }}>Category</th>
              <th className="text-left px-4 py-2.5 font-medium" style={{ color: "var(--dpf-muted)" }}>Status</th>
              <th className="text-left px-4 py-2.5 font-medium" style={{ color: "var(--dpf-muted)" }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} style={{ borderTop: "1px solid var(--dpf-border)" }}>
                <td className="px-4 py-3 font-mono text-xs" style={{ color: "var(--dpf-muted)" }}>{c.id}</td>
                <td className="px-4 py-3 font-medium" style={{ color: "var(--dpf-text)" }}>{c.customerName}</td>
                <td className="px-4 py-3 max-w-[300px] truncate" style={{ color: "var(--dpf-text)" }}>{c.description}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: `${SEVERITY_COLORS[c.severity]}20`, color: SEVERITY_COLORS[c.severity] }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: SEVERITY_COLORS[c.severity] }} />
                    {c.severity}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs" style={{ color: "var(--dpf-muted)" }}>{c.category}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: `${STATUS_COLORS[c.status]}20`, color: STATUS_COLORS[c.status] }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_COLORS[c.status] }} />
                    {c.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs" style={{ color: "var(--dpf-muted)" }}>{new Date(c.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm" style={{ color: "var(--dpf-muted)" }}>
                  No complaints match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs" style={{ color: "var(--dpf-muted)" }}>
        {filtered.length} complaint{filtered.length !== 1 ? "s" : ""} shown
        {filterStatus !== "all" ? ` (filtered: ${filterStatus})` : ""}
      </p>
    </div>
  );
}
