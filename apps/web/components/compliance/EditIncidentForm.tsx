"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { updateIncident } from "@/lib/actions/compliance";
import { INCIDENT_SEVERITIES, INCIDENT_CATEGORIES } from "@/lib/compliance-types";

const inputClasses = "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

function formatDatetimeLocal(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  // Format as YYYY-MM-DDTHH:mm for datetime-local input
  return date.toISOString().slice(0, 16);
}

type Props = {
  id: string;
  incident: {
    title: string;
    description: string | null;
    severity: string;
    category: string | null;
    occurredAt: Date | string;
    detectedAt: Date | string | null;
    regulatoryNotifiable: boolean;
    notificationDeadline: Date | string | null;
    rootCause: string | null;
  };
};

export function EditIncidentForm({ id, incident }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notifiable, setNotifiable] = useState(incident.regulatoryNotifiable);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const occurredStr = form.get("occurredAt") as string;
    const detectedStr = form.get("detectedAt") as string;
    const deadlineStr = form.get("notificationDeadline") as string;
    const result = await updateIncident(id, {
      title: form.get("title") as string,
      description: (form.get("description") as string) || null,
      severity: form.get("severity") as string,
      category: (form.get("category") as string) || null,
      occurredAt: new Date(occurredStr),
      detectedAt: detectedStr ? new Date(detectedStr) : null,
      regulatoryNotifiable: notifiable,
      notificationDeadline: notifiable && deadlineStr ? new Date(deadlineStr) : null,
      rootCause: (form.get("rootCause") as string) || null,
    });
    setLoading(false);
    if (result.ok) {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] transition-colors">
        Edit
      </button>
      <ComplianceModal open={open} onClose={() => setOpen(false)} title="Edit Incident">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={labelClasses}>Title *</label>
            <input name="title" required className={inputClasses} defaultValue={incident.title} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Occurred At *</label>
              <input name="occurredAt" type="datetime-local" required className={inputClasses} defaultValue={formatDatetimeLocal(incident.occurredAt)} />
            </div>
            <div>
              <label className={labelClasses}>Severity *</label>
              <select name="severity" required className={inputClasses} defaultValue={incident.severity}>
                {INCIDENT_SEVERITIES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Category</label>
              <select name="category" className={inputClasses} defaultValue={incident.category ?? ""}>
                <option value="">None</option>
                {INCIDENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClasses}>Detected At</label>
              <input name="detectedAt" type="datetime-local" className={inputClasses} defaultValue={formatDatetimeLocal(incident.detectedAt)} />
            </div>
          </div>
          <div>
            <label className={labelClasses}>Description</label>
            <textarea name="description" rows={2} className={inputClasses} defaultValue={incident.description ?? ""} />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="editRegNotifiable"
              checked={notifiable}
              onChange={(e) => setNotifiable(e.target.checked)}
              className="rounded border-[var(--dpf-border)]"
            />
            <label htmlFor="editRegNotifiable" className="text-xs text-[var(--dpf-muted)]">
              Regulatory notifiable
            </label>
          </div>
          {notifiable && (
            <div>
              <label className={labelClasses}>Notification Deadline</label>
              <input name="notificationDeadline" type="datetime-local" className={inputClasses} defaultValue={formatDatetimeLocal(incident.notificationDeadline)} />
            </div>
          )}
          <div>
            <label className={labelClasses}>Root Cause</label>
            <textarea name="rootCause" rows={2} className={inputClasses} defaultValue={incident.rootCause ?? ""} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">Cancel</button>
            <button type="submit" disabled={loading}
              className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 disabled:opacity-50">
              {loading ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </ComplianceModal>
    </>
  );
}
