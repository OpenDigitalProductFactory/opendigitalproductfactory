"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { updateCorrectiveAction } from "@/lib/actions/compliance";
import {
  CORRECTIVE_ACTION_SOURCE_TYPES,
  CORRECTIVE_ACTION_STATUSES,
} from "@/lib/compliance-types";

const inputClasses = "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  return date.toISOString().split("T")[0] ?? "";
}

type Props = {
  id: string;
  action: {
    title: string;
    description?: string | null;
    sourceType: string;
    rootCause?: string | null;
    dueDate?: Date | string | null;
    status: string;
  };
};

export function EditCorrectiveActionForm({ id, action }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const dueDateStr = form.get("dueDate") as string;
    const result = await updateCorrectiveAction(id, {
      title: form.get("title") as string,
      description: (form.get("description") as string) || null,
      sourceType: form.get("sourceType") as string,
      rootCause: (form.get("rootCause") as string) || null,
      dueDate: dueDateStr ? new Date(dueDateStr) : null,
      status: form.get("status") as string,
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
        className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-white hover:border-[var(--dpf-accent)] transition-colors">
        Edit
      </button>
      <ComplianceModal open={open} onClose={() => setOpen(false)} title="Edit Corrective Action">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={labelClasses}>Title *</label>
            <input name="title" required className={inputClasses} defaultValue={action.title} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Source Type *</label>
              <select name="sourceType" required className={inputClasses} defaultValue={action.sourceType}>
                {CORRECTIVE_ACTION_SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClasses}>Status</label>
              <select name="status" className={inputClasses} defaultValue={action.status}>
                {CORRECTIVE_ACTION_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelClasses}>Description</label>
            <textarea name="description" rows={2} className={inputClasses} defaultValue={action.description ?? ""} />
          </div>
          <div>
            <label className={labelClasses}>Root Cause</label>
            <textarea name="rootCause" rows={2} className={inputClasses} defaultValue={action.rootCause ?? ""} />
          </div>
          <div>
            <label className={labelClasses}>Due Date</label>
            <input name="dueDate" type="date" className={inputClasses} defaultValue={formatDate(action.dueDate)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs text-[var(--dpf-muted)] hover:text-white">Cancel</button>
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
