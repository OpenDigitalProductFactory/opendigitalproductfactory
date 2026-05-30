// apps/web/app/(shell)/complaints/ComplaintsClient.tsx
"use client";

import { useState } from "react";

import { LocalTime } from "@/components/ui/LocalTime";
import {
  DataTable,
  FilterBar,
  StatusBadge,
  type Column,
} from "@/components/ui/report-kit";

type Complaint = {
  id: string;
  customerName: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  category: string;
  status: "open" | "investigating" | "resolved" | "closed";
  createdAt: string;
};

// Severity ordering for the sortable column (low → critical).
const SEVERITY_RANK: Record<Complaint["severity"], number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
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
const STATUSES: Complaint["status"][] = ["open", "investigating", "resolved", "closed"];

const COLUMNS: Column<Complaint>[] = [
  { key: "id", header: "ID", cell: (c) => c.id, mono: true },
  {
    key: "customer",
    header: "Customer",
    cell: (c) => <span className="font-medium text-[var(--dpf-text)]">{c.customerName}</span>,
    sortAccessor: (c) => c.customerName,
  },
  {
    key: "description",
    header: "Description",
    cell: (c) => <span className="block max-w-[320px] truncate">{c.description}</span>,
  },
  {
    key: "severity",
    header: "Severity",
    cell: (c) => (
      <StatusBadge domain="complaintSeverity" status={c.severity} variant="soft" uppercase={false} />
    ),
    sortAccessor: (c) => SEVERITY_RANK[c.severity],
  },
  {
    key: "category",
    header: "Category",
    cell: (c) => <span className="text-[var(--dpf-muted)]">{c.category}</span>,
  },
  {
    key: "status",
    header: "Status",
    cell: (c) => (
      <StatusBadge domain="complaintStatus" status={c.status} variant="soft" uppercase={false} />
    ),
    sortAccessor: (c) => c.status,
  },
  {
    key: "date",
    header: "Date",
    cell: (c) => (
      <span className="text-[var(--dpf-muted)]">
        <LocalTime value={c.createdAt} mode="date" />
      </span>
    ),
    sortAccessor: (c) => c.createdAt,
  },
];

export function ComplaintsClient() {
  const [complaints, setComplaints] = useState<Complaint[]>(DEMO_COMPLAINTS);
  const [showForm, setShowForm] = useState(false);
  // Empty status = "all".
  const [filters, setFilters] = useState<Record<string, string>>({ status: "" });
  const [formData, setFormData] = useState({ customerName: "", description: "", severity: "medium" as Complaint["severity"], category: "Other" });

  const activeStatus = filters.status ?? "";
  const filtered = activeStatus
    ? complaints.filter((c) => c.status === activeStatus)
    : complaints;

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
      <div className="flex items-center justify-between gap-4 mb-4">
        <FilterBar
          mode="client"
          facets={[
            {
              kind: "pills",
              key: "status",
              label: "Status",
              options: STATUSES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
            },
          ]}
          value={filters}
          onChange={setFilters}
          resultCount={filtered.length}
        />
        <button
          onClick={() => setShowForm(!showForm)}
          className="shrink-0 px-4 py-1.5 text-sm font-semibold text-white rounded-md transition-opacity hover:opacity-90"
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
      <div className="rounded-lg p-1" style={{ border: "1px solid var(--dpf-border)" }}>
        <DataTable
          columns={COLUMNS}
          rows={filtered}
          getRowKey={(c) => c.id}
          initialSort={{ key: "date", dir: "desc" }}
          empty="No complaints match the current filter."
        />
      </div>

      <p className="mt-3 text-xs" style={{ color: "var(--dpf-muted)" }}>
        {filtered.length} complaint{filtered.length !== 1 ? "s" : ""} shown
        {activeStatus ? ` (filtered: ${activeStatus})` : ""}
      </p>
    </div>
  );
}
