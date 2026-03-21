"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { createIncident } from "@/lib/actions/compliance";
import { INCIDENT_SEVERITIES, INCIDENT_CATEGORIES } from "@/lib/compliance-types";

const inputClasses = "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

export function CreateIncidentForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notifiable, setNotifiable] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const occurredStr = form.get("occurredAt") as string;
    const deadlineStr = form.get("notificationDeadline") as string;
    const result = await createIncident({
      title: form.get("title") as string,
      occurredAt: new Date(occurredStr),
      severity: form.get("severity") as string,
      description: (form.get("description") as string) || null,
      category: (form.get("category") as string) || null,
      regulatoryNotifiable: notifiable,
      notificationDeadline: notifiable && deadlineStr ? new Date(deadlineStr) : null,
      rootCause: (form.get("rootCause") as string) || null,
    });
    setLoading(false);
    if (result.ok) {
      setOpen(false);
      setNotifiable(false);
      router.refresh();
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity">
        Add Incident
      </button>
      <ComplianceModal open={open} onClose={() => setOpen(false)} title="Add Incident">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={labelClasses}>Title *</label>
            <input name="title" required className={inputClasses} placeholder="Unauthorised access to customer records" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Occurred At *</label>
              <input name="occurredAt" type="datetime-local" required className={inputClasses} />
            </div>
            <div>
              <label className={labelClasses}>Severity *</label>
              <select name="severity" required className={inputClasses}>
                {INCIDENT_SEVERITIES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelClasses}>Category</label>
            <select name="category" className={inputClasses}>
              <option value="">None</option>
              {INCIDENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClasses}>Description</label>
            <textarea name="description" rows={2} className={inputClasses} />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="regulatoryNotifiable"
              checked={notifiable}
              onChange={(e) => setNotifiable(e.target.checked)}
              className="rounded border-[var(--dpf-border)]"
            />
            <label htmlFor="regulatoryNotifiable" className="text-xs text-[var(--dpf-muted)]">
              Regulatory notifiable
            </label>
          </div>
          {notifiable && (
            <div>
              <label className={labelClasses}>Notification Deadline</label>
              <input name="notificationDeadline" type="datetime-local" className={inputClasses} />
            </div>
          )}
          <div>
            <label className={labelClasses}>Root Cause</label>
            <textarea name="rootCause" rows={2} className={inputClasses} placeholder="Initial assessment of root cause" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">Cancel</button>
            <button type="submit" disabled={loading}
              className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 disabled:opacity-50">
              {loading ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </ComplianceModal>
    </>
  );
}
