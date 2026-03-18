"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { createRegulation } from "@/lib/actions/compliance";

const inputClasses = "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

export function CreateRegulationForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const result = await createRegulation({
      name: form.get("name") as string,
      shortName: form.get("shortName") as string,
      jurisdiction: form.get("jurisdiction") as string,
      industry: (form.get("industry") as string) || null,
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
            <label className={labelClasses}>Source URL</label>
            <input name="sourceUrl" className={inputClasses} placeholder="https://..." />
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
