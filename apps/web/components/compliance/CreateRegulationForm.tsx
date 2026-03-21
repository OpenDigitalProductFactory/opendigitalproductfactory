"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { createRegulation } from "@/lib/actions/compliance";
import { REGULATION_SOURCE_TYPES } from "@/lib/compliance-types";

const inputClasses = "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

export function CreateRegulationForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const result = await createRegulation({
      name: form.get("name") as string,
      shortName: form.get("shortName") as string,
      jurisdiction: form.get("jurisdiction") as string,
      industry: (form.get("industry") as string) || null,
      sourceType: (form.get("sourceType") as string) || "external",
      effectiveDate: form.get("effectiveDate") ? new Date(form.get("effectiveDate") as string) : null,
      sourceUrl: (form.get("sourceUrl") as string) || null,
      notes: (form.get("notes") as string) || null,
    });
    setLoading(false);
    if (result.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result.message ?? "Failed to create regulation.");
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity">
        Add Regulation
      </button>
      <ComplianceModal open={open} onClose={() => setOpen(false)} title="Add Regulation">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={labelClasses}>Name *</label>
            <input name="name" required className={inputClasses} placeholder="General Data Protection Regulation" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Short Name *</label>
              <input name="shortName" required className={inputClasses} placeholder="GDPR" />
            </div>
            <div>
              <label className={labelClasses}>Jurisdiction *</label>
              <input name="jurisdiction" required className={inputClasses} placeholder="EU" />
            </div>
          </div>
          <div>
            <label className={labelClasses}>Industry</label>
            <input name="industry" className={inputClasses} placeholder="cross-industry" />
          </div>
          <div>
            <label className={labelClasses}>Source Type *</label>
            <select name="sourceType" required className={inputClasses}>
              {REGULATION_SOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClasses}>Effective Date</label>
            <input name="effectiveDate" type="date" className={inputClasses} />
          </div>
          <div>
            <label className={labelClasses}>Source URL</label>
            <input name="sourceUrl" className={inputClasses} placeholder="https://..." />
          </div>
          <div>
            <label className={labelClasses}>Notes</label>
            <textarea name="notes" rows={2} className={inputClasses} />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
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
