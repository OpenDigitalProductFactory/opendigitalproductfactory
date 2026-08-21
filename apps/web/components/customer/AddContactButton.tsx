"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCustomerContact } from "@/lib/actions/customer-contacts";
import type { DedupCandidate } from "@/lib/mdm/dedup-gate";

const inputClasses =
  "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] rounded px-3 py-2 text-sm focus:border-[var(--dpf-accent)] focus:outline-none placeholder:text-[var(--dpf-muted)] w-full";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

// Structured contact capture on the account page. CustomerContact previously
// had no create door anywhere in the UI, so contacts were parked in account
// notes as free text.
export function AddContactButton({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [candidates, setCandidates] = useState<DedupCandidate[] | null>(null);
  // Labels rendered next to these inputs but were never associated with them:
  // no htmlFor, no id, no nesting. Sighted users saw "First name *"; screen
  // readers announced five unlabelled edit fields (IMP-032 class).
  const fieldId = useId();

  function reset() {
    setFirstName(""); setLastName(""); setEmail(""); setPhone(""); setJobTitle("");
    setCandidates(null); setError(null);
  }

  function submit(confirmNew: boolean) {
    if (!firstName.trim() || !email.trim()) {
      setError("First name and email are required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await createCustomerContact(
          {
            accountId,
            firstName: firstName.trim(),
            lastName: lastName.trim() || undefined,
            email: email.trim(),
            phone: phone.trim() || undefined,
            jobTitle: jobTitle.trim() || undefined,
          },
          confirmNew ? { kind: "confirm-new", reason: "confirmed different person in Add contact" } : undefined,
        );
        if (result.outcome === "duplicates-found") {
          setCandidates(result.check.candidates);
          return;
        }
        reset();
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
        className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-sm font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
        onClick={() => setOpen(true)}
      >
        + Add contact
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-label="Add contact">
      <div className="w-full max-w-md rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
        <h2 className="mb-4 text-sm font-semibold text-[var(--dpf-text)]">Add contact</h2>

        {candidates ? (
          <div>
            <p className="mb-2 text-sm text-[var(--dpf-text)]">
              This looks similar to {candidates.length === 1 ? "an existing contact" : "existing contacts"}:
            </p>
            <ul className="mb-3 space-y-1">
              {candidates.map((c) => (
                <li key={c.id} className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)]">
                  {c.label}
                  {c.detail && <span className="ml-2 text-xs text-[var(--dpf-muted)]">{c.detail}</span>}
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <button className="px-3 py-1.5 text-sm text-[var(--dpf-muted)]" onClick={() => setCandidates(null)}>
                Back
              </button>
              <button
                className="rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                disabled={isPending}
                onClick={() => submit(true)}
              >
                It&apos;s a different person — create
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClasses} htmlFor={`${fieldId}-firstName`}>First name *</label>
                <input id={`${fieldId}-firstName`} className={inputClasses} aria-required="true" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div>
                <label className={labelClasses} htmlFor={`${fieldId}-lastName`}>Last name</label>
                <input id={`${fieldId}-lastName`} className={inputClasses} value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>
            <div>
              <label className={labelClasses} htmlFor={`${fieldId}-email`}>Email *</label>
              <input id={`${fieldId}-email`} className={inputClasses} type="email" aria-required="true" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClasses} htmlFor={`${fieldId}-phone`}>Phone</label>
                <input id={`${fieldId}-phone`} className={inputClasses} value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div>
                <label className={labelClasses} htmlFor={`${fieldId}-jobTitle`}>Job title</label>
                <input id={`${fieldId}-jobTitle`} className={inputClasses} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
              </div>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button className="px-3 py-1.5 text-sm text-[var(--dpf-muted)]" onClick={() => { reset(); setOpen(false); }}>
                Cancel
              </button>
              <button
                className="rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                disabled={isPending}
                onClick={() => submit(false)}
              >
                {isPending ? "Adding…" : "Add contact"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
