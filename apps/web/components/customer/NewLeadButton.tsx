"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLead } from "@/lib/actions/leads";

const inputClasses =
  "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] rounded px-3 py-2 text-sm focus:border-[var(--dpf-accent)] focus:outline-none placeholder:text-[var(--dpf-muted)] w-full";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

// Manual lead capture: one small dialog lands the whole trio — contact (email
// identity), account (dedup-aware reuse-or-create), engagement (status new).
export function NewLeadButton() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [note, setNote] = useState("");

  function submit() {
    if (!firstName.trim() || !email.trim() || !company.trim()) {
      setError("First name, email, and company are required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await createLead({
          firstName: firstName.trim(),
          lastName: lastName.trim() || undefined,
          email: email.trim(),
          company: company.trim(),
          note: note.trim() || undefined,
        });
        setFirstName(""); setLastName(""); setEmail(""); setCompany(""); setNote("");
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  if (!open) {
    return (
      <button
        className="rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        onClick={() => setOpen(true)}
      >
        + New lead
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-label="New lead">
      <div className="w-full max-w-md rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
        <h2 className="mb-1 text-sm font-semibold text-[var(--dpf-text)]">New lead</h2>
        <p className="mb-4 text-xs text-[var(--dpf-muted)]">
          Creates the contact, links (or creates) the company, and starts the engagement.
        </p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>First name *</label>
              <input className={inputClasses} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <label className={labelClasses}>Last name</label>
              <input className={inputClasses} value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div>
            <label className={labelClasses}>Email *</label>
            <input className={inputClasses} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className={labelClasses}>Company *</label>
            <input className={inputClasses} value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div>
            <label className={labelClasses}>Note</label>
            <input className={inputClasses} placeholder="Where did this lead come from?" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className="px-3 py-1.5 text-sm text-[var(--dpf-muted)]" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              disabled={isPending}
              onClick={submit}
            >
              {isPending ? "Creating…" : "Create lead"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
