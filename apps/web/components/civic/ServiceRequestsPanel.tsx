"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateServiceRequestStatus } from "@/lib/actions/civic-governance";

const STATUS_CHIPS: Record<string, string> = {
  new: "bg-[var(--dpf-info)]/15 text-[var(--dpf-info)]",
  "in-progress": "bg-[var(--dpf-warning)]/15 text-[var(--dpf-warning)]",
  closed: "bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]",
};

export type ServiceRequestRow = {
  id: string;
  ref: string;
  requesterName: string;
  requesterEmail: string;
  message: string | null;
  department: string | null;
  status: string;
  createdAt: string;
};

export function ServiceRequestsPanel({ requests }: { requests: ServiceRequestRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [departmentFilter, setDepartmentFilter] = useState("");

  const departments = Array.from(
    new Set(requests.map((r) => r.department).filter((d): d is string => !!d)),
  ).sort();

  const visible = departmentFilter
    ? requests.filter((r) => r.department === departmentFilter)
    : requests;

  async function transition(id: string, status: "in-progress" | "closed") {
    setBusy(id);
    setError(null);
    const result = await updateServiceRequestStatus(id, status);
    setBusy(null);
    if (!result.ok) setError(result.message);
    else router.refresh();
  }

  return (
    <div className="space-y-4">
      {departments.length > 0 && (
        <select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1.5 text-xs text-[var(--dpf-text)] focus:border-[var(--dpf-accent)] focus:outline-none"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      )}

      {error && <p className="text-xs text-[var(--dpf-error)]">{error}</p>}

      <ul className="space-y-2">
        {visible.map((r) => (
          <li key={r.id} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_CHIPS[r.status] ?? STATUS_CHIPS.new}`}>
                {r.status.replace(/-/g, " ")}
              </span>
              <span className="text-xs font-mono text-[var(--dpf-muted)]">{r.ref}</span>
              {r.department && (
                <span className="rounded bg-[var(--dpf-surface-2)] px-2 py-0.5 text-[11px] text-[var(--dpf-muted)]">
                  {r.department}
                </span>
              )}
              <span className="text-sm font-medium text-[var(--dpf-text)]">{r.requesterName}</span>
              <span className="ml-auto text-xs text-[var(--dpf-muted)]">
                {new Date(r.createdAt).toLocaleDateString()}
              </span>
            </div>
            {r.message && <p className="mt-1 text-sm text-[var(--dpf-muted)]">{r.message}</p>}
            {r.status !== "closed" && (
              <div className="mt-2 flex gap-2">
                {r.status === "new" && (
                  <button
                    onClick={() => transition(r.id, "in-progress")}
                    disabled={busy === r.id}
                    className="px-2 py-1 text-[11px] rounded border border-[var(--dpf-border)] text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50"
                  >
                    Start
                  </button>
                )}
                <button
                  onClick={() => transition(r.id, "closed")}
                  disabled={busy === r.id}
                  className="px-2 py-1 text-[11px] rounded border border-[var(--dpf-border)] text-[var(--dpf-success)] hover:border-[var(--dpf-success)] disabled:opacity-50"
                >
                  Close
                </button>
              </div>
            )}
          </li>
        ))}
        {visible.length === 0 && (
          <li className="rounded-lg border border-dashed border-[var(--dpf-border)] p-6 text-center text-sm text-[var(--dpf-muted)]">
            No service requests{departmentFilter ? ` for ${departmentFilter}` : ""}. Resident
            submissions from the public site land here.
          </li>
        )}
      </ul>
    </div>
  );
}
