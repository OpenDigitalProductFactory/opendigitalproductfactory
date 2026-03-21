"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { createPolicy } from "@/lib/actions/policy";
import { POLICY_CATEGORIES } from "@/lib/policy-types";

const inputClasses = "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

export function CreatePolicyForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const result = await createPolicy({
      title: form.get("title") as string,
      category: form.get("category") as string,
      description: (form.get("description") as string) || null,
      body: (form.get("body") as string) || null,
      notes: (form.get("notes") as string) || null,
    });
    setLoading(false);
    if (result.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result.message ?? "Failed to create policy.");
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity">
        Add Policy
      </button>
      <ComplianceModal open={open} onClose={() => setOpen(false)} title="Add Policy">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={labelClasses}>Title *</label>
            <input name="title" required className={inputClasses} placeholder="Acceptable Use Policy" />
          </div>
          <div>
            <label className={labelClasses}>Category *</label>
            <select name="category" required className={inputClasses}>
              {POLICY_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClasses}>Description</label>
            <textarea name="description" rows={2} className={inputClasses} placeholder="Brief summary of the policy's purpose" />
          </div>
          <div>
            <label className={labelClasses}>Policy Document</label>
            <textarea name="body" rows={8} className={inputClasses} placeholder="Enter the full policy text here..." />
          </div>
          <div>
            <label className={labelClasses}>Notes</label>
            <textarea name="notes" rows={2} className={inputClasses} placeholder="Internal notes (not shown in published policy)" />
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
