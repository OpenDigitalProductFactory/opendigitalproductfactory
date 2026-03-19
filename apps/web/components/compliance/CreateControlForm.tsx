"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { createControl } from "@/lib/actions/compliance";
import {
  CONTROL_TYPES,
  CONTROL_IMPLEMENTATION_STATUSES,
  CONTROL_EFFECTIVENESS,
} from "@/lib/compliance-types";

const inputClasses = "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

const REVIEW_FREQUENCIES = ["annual", "quarterly", "continuous"] as const;

export function CreateControlForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const result = await createControl({
      title: form.get("title") as string,
      controlType: form.get("controlType") as string,
      description: (form.get("description") as string) || null,
      implementationStatus: (form.get("implementationStatus") as string) || undefined,
      reviewFrequency: (form.get("reviewFrequency") as string) || null,
      effectiveness: (form.get("effectiveness") as string) || null,
    });
    setLoading(false);
    if (result.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result.message ?? "Failed to create control.");
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity">
        Add Control
      </button>
      <ComplianceModal open={open} onClose={() => setOpen(false)} title="Add Control">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={labelClasses}>Title *</label>
            <input name="title" required className={inputClasses} placeholder="Access control review" />
          </div>
          <div>
            <label className={labelClasses}>Control Type *</label>
            <select name="controlType" required className={inputClasses}>
              {CONTROL_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Implementation Status</label>
              <select name="implementationStatus" className={inputClasses}>
                {CONTROL_IMPLEMENTATION_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClasses}>Review Frequency</label>
              <select name="reviewFrequency" className={inputClasses}>
                <option value="">None</option>
                {REVIEW_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelClasses}>Effectiveness</label>
            <select name="effectiveness" className={inputClasses}>
              <option value="">Not assessed</option>
              {CONTROL_EFFECTIVENESS.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClasses}>Description</label>
            <textarea name="description" rows={2} className={inputClasses} />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
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
