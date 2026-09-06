"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCustomerAccount } from "@/lib/actions/crm";
import type { DedupCandidate } from "@/lib/mdm/dedup-gate";

const inputClasses =
  "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] rounded px-3 py-2 text-sm focus:border-[var(--dpf-accent)] focus:outline-none placeholder:text-[var(--dpf-muted)] w-full";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

/** Human wording for the match signals the dedup gate reports. */
function matchSummary(candidate: DedupCandidate): string {
  const parts = candidate.reasons.map((r) =>
    r.attribute === "domain"
      ? "same website"
      : r.attribute === "name" && r.kind === "exact"
        ? "same name"
        : r.attribute === "name"
          ? "similar name"
          : `same ${r.attribute}`,
  );
  return [...new Set(parts)].join(", ");
}

type NewCustomerCopy = {
  buttonLabel: string;
  title: string;
  nameLabel: string;
  namePlaceholder: string;
};

const DEFAULT_COPY: NewCustomerCopy = {
  buttonLabel: "+ New Account",
  title: "New Customer Account",
  nameLabel: "Account Name *",
  namePlaceholder: "e.g. Riverside Medical Group",
};

export function NewCustomerButton({ copy = DEFAULT_COPY }: { copy?: NewCustomerCopy }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [notes, setNotes] = useState("");

  // Duplicate-check state (MDM write-time gate): when the create call returns
  // candidates, the same modal switches to a one-decision picker.
  const [candidates, setCandidates] = useState<DedupCandidate[] | null>(null);
  const [verdict, setVerdict] = useState<"possible-duplicate" | "likely-duplicate" | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);

  function resetForm() {
    setName("");
    setWebsite("");
    setIndustry("");
    setNotes("");
    setCandidates(null);
    setVerdict(null);
    setConfirmChecked(false);
    setError(null);
  }

  function submit(confirmNew: boolean) {
    if (!name.trim()) {
      setError("Account name is required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await createCustomerAccount(
          {
            name: name.trim(),
            website: website.trim() || undefined,
            industry: industry.trim() || undefined,
            notes: notes.trim() || undefined,
          },
          confirmNew
            ? { kind: "confirm-new", reason: "confirmed different company in + New Account" }
            : undefined,
        );
        if (result.outcome === "duplicates-found") {
          setCandidates(result.check.candidates);
          setVerdict(
            result.check.verdict === "likely-duplicate" ? "likely-duplicate" : "possible-duplicate",
          );
          setConfirmChecked(false);
          return;
        }
        setOpen(false);
        resetForm();
        if (result.outcome === "existing") {
          router.push(`/customer/${result.account.id}`);
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create account");
      }
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
      >
        {copy.buttonLabel}
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
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">{copy.title}</h2>
          <button
            onClick={() => {
              setOpen(false);
              resetForm();
            }}
            className="text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] text-lg"
            aria-label="Close"
          >
            x
          </button>
        </div>

        {candidates ? (
          <div className="p-4 space-y-3">
            <p className="text-xs text-[var(--dpf-text)]">
              {verdict === "likely-duplicate"
                ? `"${name.trim()}" looks like an account you already have:`
                : `"${name.trim()}" is similar to an existing account:`}
            </p>
            <ul className="space-y-2">
              {candidates.slice(0, 5).map((candidate) => (
                <li
                  key={candidate.id}
                  className="flex items-center justify-between gap-2 border border-[var(--dpf-border)] rounded px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-[var(--dpf-text)] truncate">{candidate.label}</p>
                    <p className="text-xs text-[var(--dpf-muted)] truncate">
                      {matchSummary(candidate)}
                      {candidate.detail ? ` · ${candidate.detail}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      resetForm();
                      router.push(`/customer/${candidate.id}`);
                    }}
                    className="shrink-0 px-2.5 py-1 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
                  >
                    Use this account
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t border-[var(--dpf-border)] pt-3 space-y-2">
              {verdict === "likely-duplicate" && (
                <label className="flex items-start gap-2 text-xs text-[var(--dpf-muted)]">
                  <input
                    type="checkbox"
                    checked={confirmChecked}
                    onChange={(e) => setConfirmChecked(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>This is a different company, not one of the accounts above.</span>
                </label>
              )}
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setCandidates(null)}
                  className="px-3 py-1.5 rounded-md text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] border border-[var(--dpf-border)]"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={isPending || (verdict === "likely-duplicate" && !confirmChecked)}
                  onClick={() => submit(true)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {isPending ? "Creating..." : "Create new anyway"}
                </button>
              </div>
            </div>
            {error && <p className="text-xs text-[var(--dpf-text)]">{error}</p>}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-4 space-y-4">
            <div>
              <label className={labelClasses}>{copy.nameLabel}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={copy.namePlaceholder}
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
            {error && <p className="text-xs text-[var(--dpf-text)]">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  resetForm();
                }}
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
        )}
      </div>
    </>
  );
}
