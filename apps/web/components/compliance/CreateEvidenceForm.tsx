"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { createEvidence } from "@/lib/actions/compliance";
import { EVIDENCE_TYPES } from "@/lib/compliance-types";

const inputClasses = "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

type Obligation = { id: string; title: string };
type Control = { id: string; title: string };

type Props = {
  obligations: Obligation[];
  controls: Control[];
};

export function CreateEvidenceForm({ obligations, controls }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const retentionStr = form.get("retentionUntil") as string;
    const result = await createEvidence({
      title: form.get("title") as string,
      evidenceType: form.get("evidenceType") as string,
      description: (form.get("description") as string) || null,
      obligationId: (form.get("obligationId") as string) || null,
      controlId: (form.get("controlId") as string) || null,
      fileRef: (form.get("fileRef") as string) || null,
      retentionUntil: retentionStr ? new Date(retentionStr) : null,
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
        Add Evidence
      </button>
      <ComplianceModal open={open} onClose={() => setOpen(false)} title="Add Evidence">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={labelClasses}>Title *</label>
            <input name="title" required className={inputClasses} placeholder="Q1 access review report" />
          </div>
          <div>
            <label className={labelClasses}>Evidence Type *</label>
            <select name="evidenceType" required className={inputClasses}>
              {EVIDENCE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Obligation</label>
              <select name="obligationId" className={inputClasses}>
                <option value="">None</option>
                {obligations.map((o) => (
                  <option key={o.id} value={o.id}>{o.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClasses}>Control</label>
              <select name="controlId" className={inputClasses}>
                <option value="">None</option>
                {controls.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelClasses}>File Reference</label>
            <input name="fileRef" className={inputClasses} placeholder="/documents/report-q1.pdf" />
          </div>
          <div>
            <label className={labelClasses}>Retention Until</label>
            <input name="retentionUntil" type="date" className={inputClasses} />
          </div>
          <div>
            <label className={labelClasses}>Description</label>
            <textarea name="description" rows={2} className={inputClasses} />
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
