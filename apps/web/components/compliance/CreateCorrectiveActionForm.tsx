"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { createCorrectiveAction } from "@/lib/actions/compliance";
import { CORRECTIVE_ACTION_SOURCE_TYPES } from "@/lib/compliance-types";

const inputClasses = "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

export function CreateCorrectiveActionForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const dueDateStr = form.get("dueDate") as string;
    const result = await createCorrectiveAction({
      title: form.get("title") as string,
      sourceType: form.get("sourceType") as string,
      description: (form.get("description") as string) || null,
      rootCause: (form.get("rootCause") as string) || null,
      dueDate: dueDateStr ? new Date(dueDateStr) : null,
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
        Add Corrective Action
      </button>
      <ComplianceModal open={open} onClose={() => setOpen(false)} title="Add Corrective Action">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={labelClasses}>Title *</label>
            <input name="title" required className={inputClasses} placeholder="Implement MFA for admin accounts" />
          </div>
          <div>
            <label className={labelClasses}>Source Type *</label>
            <select name="sourceType" required className={inputClasses}>
              {CORRECTIVE_ACTION_SOURCE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClasses}>Description</label>
            <textarea name="description" rows={2} className={inputClasses} />
          </div>
          <div>
            <label className={labelClasses}>Root Cause</label>
            <textarea name="rootCause" rows={2} className={inputClasses} placeholder="Describe the underlying cause" />
          </div>
          <div>
            <label className={labelClasses}>Due Date</label>
            <input name="dueDate" type="date" className={inputClasses} />
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
