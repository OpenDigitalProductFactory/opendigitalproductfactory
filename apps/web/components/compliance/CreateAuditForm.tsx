"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { createAudit } from "@/lib/actions/compliance";
import { AUDIT_TYPES } from "@/lib/compliance-types";

const inputClasses = "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

export function CreateAuditForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const scheduledStr = form.get("scheduledAt") as string;
    const result = await createAudit({
      title: form.get("title") as string,
      auditType: form.get("auditType") as string,
      scope: (form.get("scope") as string) || null,
      auditorName: (form.get("auditorName") as string) || null,
      scheduledAt: scheduledStr ? new Date(scheduledStr) : null,
      notes: (form.get("notes") as string) || null,
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
        className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity">
        Add Audit
      </button>
      <ComplianceModal open={open} onClose={() => setOpen(false)} title="Add Audit">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={labelClasses}>Title *</label>
            <input name="title" required className={inputClasses} placeholder="Annual ISO 27001 surveillance audit" />
          </div>
          <div>
            <label className={labelClasses}>Audit Type *</label>
            <select name="auditType" required className={inputClasses}>
              {AUDIT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClasses}>Scope</label>
            <input name="scope" className={inputClasses} placeholder="Information security management system" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Auditor Name</label>
              <input name="auditorName" className={inputClasses} placeholder="Jane Smith" />
            </div>
            <div>
              <label className={labelClasses}>Scheduled At</label>
              <input name="scheduledAt" type="date" className={inputClasses} />
            </div>
          </div>
          <div>
            <label className={labelClasses}>Notes</label>
            <textarea name="notes" rows={2} className={inputClasses} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs text-[var(--dpf-muted)] hover:text-white">Cancel</button>
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
