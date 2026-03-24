"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCustomerAccount } from "@/lib/actions/crm";

const inputClasses =
  "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] rounded px-3 py-2 text-sm focus:border-[var(--dpf-accent)] focus:outline-none placeholder:text-[var(--dpf-muted)] w-full";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

export function NewCustomerButton() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [notes, setNotes] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Account name is required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await createCustomerAccount({
          name: name.trim(),
          website: website.trim() || undefined,
          industry: industry.trim() || undefined,
          notes: notes.trim() || undefined,
        });
        setOpen(false);
        setName("");
        setWebsite("");
        setIndustry("");
        setNotes("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create account");
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
      >
        + New Account
      </button>
    );
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={() => setOpen(false)}
      />
      <div className="fixed top-20 right-8 z-50 w-[420px] bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--dpf-border)]">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">New Customer Account</h2>
          <button
            onClick={() => setOpen(false)}
            className="text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] text-lg"
          >
            x
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className={labelClasses}>Account Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Riverside Medical Group"
              required
              autoFocus
              className={inputClasses}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Industry</label>
              <input
                type="text"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="e.g. Healthcare"
                className={inputClasses}
              />
            </div>
            <div>
              <label className={labelClasses}>Website</label>
              <input
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://..."
                className={inputClasses}
              />
            </div>
          </div>
          <div>
            <label className={labelClasses}>Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes"
              rows={2}
              className={inputClasses}
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 rounded-md text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] border border-[var(--dpf-border)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {isPending ? "Creating..." : "Create Account"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
