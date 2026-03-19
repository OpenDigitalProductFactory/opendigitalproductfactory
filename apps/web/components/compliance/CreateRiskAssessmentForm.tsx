"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { createRiskAssessment } from "@/lib/actions/compliance";
import {
  RISK_LIKELIHOODS,
  RISK_SEVERITIES,
  RISK_LEVELS,
} from "@/lib/compliance-types";

const inputClasses = "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

export function CreateRiskAssessmentForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const result = await createRiskAssessment({
      title: form.get("title") as string,
      hazard: form.get("hazard") as string,
      likelihood: form.get("likelihood") as string,
      severity: form.get("severity") as string,
      inherentRisk: form.get("inherentRisk") as string,
      scope: (form.get("scope") as string) || null,
      residualRisk: (form.get("residualRisk") as string) || null,
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
        Add Risk Assessment
      </button>
      <ComplianceModal open={open} onClose={() => setOpen(false)} title="Add Risk Assessment">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={labelClasses}>Title *</label>
            <input name="title" required className={inputClasses} placeholder="Data exfiltration via API" />
          </div>
          <div>
            <label className={labelClasses}>Hazard *</label>
            <input name="hazard" required className={inputClasses} placeholder="Unauthorised data access" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Likelihood *</label>
              <select name="likelihood" required className={inputClasses}>
                {RISK_LIKELIHOODS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClasses}>Severity *</label>
              <select name="severity" required className={inputClasses}>
                {RISK_SEVERITIES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Inherent Risk *</label>
              <select name="inherentRisk" required className={inputClasses}>
                {RISK_LEVELS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClasses}>Residual Risk</label>
              <select name="residualRisk" className={inputClasses}>
                <option value="">Not assessed</option>
                {RISK_LEVELS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelClasses}>Scope</label>
            <input name="scope" className={inputClasses} placeholder="All public-facing APIs" />
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
