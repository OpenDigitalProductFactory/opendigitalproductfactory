"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { updateControl } from "@/lib/actions/compliance";
import {
  CONTROL_TYPES,
  CONTROL_IMPLEMENTATION_STATUSES,
  CONTROL_EFFECTIVENESS,
} from "@/lib/compliance-types";

const inputClasses = "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

const REVIEW_FREQUENCIES = ["annual", "quarterly", "continuous"] as const;

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  return date.toISOString().split("T")[0] ?? "";
}

type Props = {
  id: string;
  control: {
    title: string;
    description?: string | null;
    controlType: string;
    implementationStatus: string;
    reviewFrequency?: string | null;
    nextReviewDate?: Date | string | null;
    effectiveness?: string | null;
  };
};

export function EditControlForm({ id, control }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const nextReviewDateStr = form.get("nextReviewDate") as string;
    const result = await updateControl(id, {
      title: form.get("title") as string,
      controlType: form.get("controlType") as string,
      description: (form.get("description") as string) || null,
      implementationStatus: (form.get("implementationStatus") as string) || undefined,
      reviewFrequency: (form.get("reviewFrequency") as string) || null,
      nextReviewDate: nextReviewDateStr ? new Date(nextReviewDateStr) : null,
      effectiveness: (form.get("effectiveness") as string) || null,
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
      <ComplianceModal open={open} onClose={() => setOpen(false)} title="Edit Control">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={labelClasses}>Title *</label>
            <input name="title" required className={inputClasses} defaultValue={control.title} />
          </div>
          <div>
            <label className={labelClasses}>Control Type *</label>
            <select name="controlType" required className={inputClasses} defaultValue={control.controlType}>
              {CONTROL_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Implementation Status</label>
              <select name="implementationStatus" className={inputClasses} defaultValue={control.implementationStatus}>
                {CONTROL_IMPLEMENTATION_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClasses}>Review Frequency</label>
              <select name="reviewFrequency" className={inputClasses} defaultValue={control.reviewFrequency ?? ""}>
                <option value="">None</option>
                {REVIEW_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Effectiveness</label>
              <select name="effectiveness" className={inputClasses} defaultValue={control.effectiveness ?? ""}>
                <option value="">Not assessed</option>
                {CONTROL_EFFECTIVENESS.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClasses}>Next Review Date</label>
              <input name="nextReviewDate" type="date" className={inputClasses} defaultValue={formatDate(control.nextReviewDate)} />
            </div>
          </div>
          <div>
            <label className={labelClasses}>Description</label>
            <textarea name="description" rows={2} className={inputClasses} defaultValue={control.description ?? ""} />
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
