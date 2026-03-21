"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { createObligation } from "@/lib/actions/compliance";
import { OBLIGATION_CATEGORIES, OBLIGATION_FREQUENCIES } from "@/lib/compliance-types";

const inputClasses = "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

type Regulation = { id: string; shortName: string };

type Props = {
  regulations: Regulation[];
  /** Pre-select a regulation (e.g. when adding from a regulation detail page) */
  defaultRegulationId?: string;
};

export function CreateObligationForm({ regulations, defaultRegulationId }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const result = await createObligation({
      title: form.get("title") as string,
      regulationId: form.get("regulationId") as string,
      reference: (form.get("reference") as string) || null,
      description: (form.get("description") as string) || null,
      category: (form.get("category") as string) || null,
      frequency: (form.get("frequency") as string) || null,
      applicability: (form.get("applicability") as string) || null,
      penaltySummary: (form.get("penaltySummary") as string) || null,
    });
    setLoading(false);
    if (result.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result.message ?? "Failed to create obligation.");
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity">
        Add Obligation
      </button>
      <ComplianceModal open={open} onClose={() => setOpen(false)} title="Add Obligation">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={labelClasses}>Title *</label>
            <input name="title" required className={inputClasses} placeholder="Data subject access request handling" />
          </div>
          <div>
            <label className={labelClasses}>Regulation *</label>
            <select name="regulationId" required className={inputClasses} defaultValue={defaultRegulationId ?? ""}>
              {!defaultRegulationId && <option value="">Select a regulation...</option>}
              {regulations.map((r) => (
                <option key={r.id} value={r.id}>{r.shortName}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Reference</label>
              <input name="reference" className={inputClasses} placeholder="Article 5(1)" />
            </div>
            <div>
              <label className={labelClasses}>Category</label>
              <select name="category" className={inputClasses}>
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
              <select name="frequency" className={inputClasses}>
                <option value="">None</option>
                {OBLIGATION_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClasses}>Applicability</label>
              <input name="applicability" className={inputClasses} placeholder="All EU data processing" />
            </div>
          </div>
          <div>
            <label className={labelClasses}>Description</label>
            <textarea name="description" rows={2} className={inputClasses} />
          </div>
          <div>
            <label className={labelClasses}>Penalty Summary</label>
            <textarea name="penaltySummary" rows={2} className={inputClasses} placeholder="Up to 4% of annual global turnover" />
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
