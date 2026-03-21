"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { updateObligation } from "@/lib/actions/compliance";
import { OBLIGATION_CATEGORIES, OBLIGATION_FREQUENCIES } from "@/lib/compliance-types";

const inputClasses = "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  return date.toISOString().split("T")[0] ?? "";
}

type Props = {
  id: string;
  obligation: {
    title: string;
    description?: string | null;
    reference?: string | null;
    category?: string | null;
    frequency?: string | null;
    applicability?: string | null;
    penaltySummary?: string | null;
    reviewDate?: Date | string | null;
  };
};

export function EditObligationForm({ id, obligation }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const reviewDateStr = form.get("reviewDate") as string;
    const result = await updateObligation(id, {
      title: form.get("title") as string,
      description: (form.get("description") as string) || null,
      reference: (form.get("reference") as string) || null,
      category: (form.get("category") as string) || null,
      frequency: (form.get("frequency") as string) || null,
      applicability: (form.get("applicability") as string) || null,
      penaltySummary: (form.get("penaltySummary") as string) || null,
      reviewDate: reviewDateStr ? new Date(reviewDateStr) : null,
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
      <ComplianceModal open={open} onClose={() => setOpen(false)} title="Edit Obligation">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={labelClasses}>Title *</label>
            <input name="title" required className={inputClasses} defaultValue={obligation.title} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Reference</label>
              <input name="reference" className={inputClasses} defaultValue={obligation.reference ?? ""} />
            </div>
            <div>
              <label className={labelClasses}>Category</label>
              <select name="category" className={inputClasses} defaultValue={obligation.category ?? ""}>
                <option value="">None</option>
                {OBLIGATION_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Frequency</label>
              <select name="frequency" className={inputClasses} defaultValue={obligation.frequency ?? ""}>
                <option value="">None</option>
                {OBLIGATION_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClasses}>Applicability</label>
              <input name="applicability" className={inputClasses} defaultValue={obligation.applicability ?? ""} />
            </div>
          </div>
          <div>
            <label className={labelClasses}>Description</label>
            <textarea name="description" rows={2} className={inputClasses} defaultValue={obligation.description ?? ""} />
          </div>
          <div>
            <label className={labelClasses}>Penalty Summary</label>
            <textarea name="penaltySummary" rows={2} className={inputClasses} defaultValue={obligation.penaltySummary ?? ""} />
          </div>
          <div>
            <label className={labelClasses}>Review Date</label>
            <input name="reviewDate" type="date" className={inputClasses} defaultValue={formatDate(obligation.reviewDate)} />
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
