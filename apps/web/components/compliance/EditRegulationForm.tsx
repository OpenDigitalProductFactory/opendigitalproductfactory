"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { updateRegulation } from "@/lib/actions/compliance";
import { REGULATION_SOURCE_TYPES } from "@/lib/compliance-types";

const inputClasses = "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  return date.toISOString().split("T")[0] ?? "";
}

type Props = {
  id: string;
  regulation: {
    name: string;
    shortName: string;
    jurisdiction: string;
    industry?: string | null;
    sourceType?: string;
    effectiveDate?: Date | string | null;
    reviewDate?: Date | string | null;
    sourceUrl?: string | null;
    notes?: string | null;
  };
};

export function EditRegulationForm({ id, regulation }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const effectiveDateStr = form.get("effectiveDate") as string;
    const reviewDateStr = form.get("reviewDate") as string;
    const result = await updateRegulation(id, {
      name: form.get("name") as string,
      shortName: form.get("shortName") as string,
      jurisdiction: form.get("jurisdiction") as string,
      industry: (form.get("industry") as string) || null,
      sourceType: (form.get("sourceType") as string) || undefined,
      effectiveDate: effectiveDateStr ? new Date(effectiveDateStr) : null,
      reviewDate: reviewDateStr ? new Date(reviewDateStr) : null,
      sourceUrl: (form.get("sourceUrl") as string) || null,
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
      <ComplianceModal open={open} onClose={() => setOpen(false)} title="Edit Regulation">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={labelClasses}>Name *</label>
            <input name="name" required className={inputClasses} defaultValue={regulation.name} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Short Name *</label>
              <input name="shortName" required className={inputClasses} defaultValue={regulation.shortName} />
            </div>
            <div>
              <label className={labelClasses}>Jurisdiction *</label>
              <input name="jurisdiction" required className={inputClasses} defaultValue={regulation.jurisdiction} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Industry</label>
              <input name="industry" className={inputClasses} defaultValue={regulation.industry ?? ""} />
            </div>
            <div>
              <label className={labelClasses}>Source Type</label>
              <select name="sourceType" className={inputClasses} defaultValue={regulation.sourceType}>
                {REGULATION_SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Effective Date</label>
              <input name="effectiveDate" type="date" className={inputClasses} defaultValue={formatDate(regulation.effectiveDate)} />
            </div>
            <div>
              <label className={labelClasses}>Review Date</label>
              <input name="reviewDate" type="date" className={inputClasses} defaultValue={formatDate(regulation.reviewDate)} />
            </div>
          </div>
          <div>
            <label className={labelClasses}>Source URL</label>
            <input name="sourceUrl" className={inputClasses} defaultValue={regulation.sourceUrl ?? ""} />
          </div>
          <div>
            <label className={labelClasses}>Notes</label>
            <textarea name="notes" rows={2} className={inputClasses} defaultValue={regulation.notes ?? ""} />
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
