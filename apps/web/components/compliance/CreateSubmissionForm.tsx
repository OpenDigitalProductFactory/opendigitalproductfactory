"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { createSubmission } from "@/lib/actions/compliance";
import { SUBMISSION_TYPES } from "@/lib/compliance-types";

const inputClasses = "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

type Regulation = { id: string; shortName: string };

type Props = {
  regulations: Regulation[];
};

export function CreateSubmissionForm({ regulations }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const dueDateStr = form.get("dueDate") as string;
    const result = await createSubmission({
      title: form.get("title") as string,
      recipientBody: form.get("recipientBody") as string,
      submissionType: form.get("submissionType") as string,
      regulationId: (form.get("regulationId") as string) || null,
      dueDate: dueDateStr ? new Date(dueDateStr) : null,
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
        Add Submission
      </button>
      <ComplianceModal open={open} onClose={() => setOpen(false)} title="Add Submission">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={labelClasses}>Title *</label>
            <input name="title" required className={inputClasses} placeholder="Annual GDPR compliance report" />
          </div>
          <div>
            <label className={labelClasses}>Recipient Body *</label>
            <input name="recipientBody" required className={inputClasses} placeholder="Information Commissioner's Office" />
          </div>
          <div>
            <label className={labelClasses}>Submission Type *</label>
            <select name="submissionType" required className={inputClasses}>
              {SUBMISSION_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClasses}>Regulation</label>
            <select name="regulationId" className={inputClasses}>
              <option value="">None</option>
              {regulations.map((r) => (
                <option key={r.id} value={r.id}>{r.shortName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClasses}>Due Date</label>
            <input name="dueDate" type="date" className={inputClasses} />
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
