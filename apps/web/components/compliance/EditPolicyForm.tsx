"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { updatePolicy } from "@/lib/actions/policy";
import { POLICY_CATEGORIES, REVIEW_FREQUENCIES } from "@/lib/policy-types";

const inputClasses = "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  return date.toISOString().split("T")[0] ?? "";
}

type Props = {
  id: string;
  policy: {
    title: string;
    description?: string | null;
    category: string;
    reviewDate?: Date | string | null;
    reviewFrequency?: string | null;
    notes?: string | null;
  };
};

export function EditPolicyForm({ id, policy }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const reviewDateStr = form.get("reviewDate") as string;
    const result = await updatePolicy(id, {
      title: form.get("title") as string,
      category: form.get("category") as string,
      description: (form.get("description") as string) || null,
      reviewDate: reviewDateStr ? new Date(reviewDateStr) : null,
      reviewFrequency: (form.get("reviewFrequency") as string) || null,
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
        className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-white hover:border-[var(--dpf-accent)] transition-colors">
        Edit
      </button>
      <ComplianceModal open={open} onClose={() => setOpen(false)} title="Edit Policy">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={labelClasses}>Title *</label>
            <input name="title" required className={inputClasses} defaultValue={policy.title} />
          </div>
          <div>
            <label className={labelClasses}>Category *</label>
            <select name="category" required className={inputClasses} defaultValue={policy.category}>
              {POLICY_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Review Frequency</label>
              <select name="reviewFrequency" className={inputClasses} defaultValue={policy.reviewFrequency ?? ""}>
                <option value="">None</option>
                {REVIEW_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClasses}>Review Date</label>
              <input name="reviewDate" type="date" className={inputClasses} defaultValue={formatDate(policy.reviewDate)} />
            </div>
          </div>
          <div>
            <label className={labelClasses}>Description</label>
            <textarea name="description" rows={2} className={inputClasses} defaultValue={policy.description ?? ""} />
          </div>
          <div>
            <label className={labelClasses}>Notes</label>
            <textarea name="notes" rows={2} className={inputClasses} defaultValue={policy.notes ?? ""} />
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
