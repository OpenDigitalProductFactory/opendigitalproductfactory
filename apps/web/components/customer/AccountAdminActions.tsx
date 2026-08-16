"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCustomerAccount, archiveCustomerAccount } from "@/lib/actions/crm-account-admin";

// Operator-settable account statuses (superseded is merge-only; archived has its
// own action). Labels mirror ACCOUNT_STATUS_META in lib/crm/presentation.ts.
const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "prospect", label: "Prospect" },
  { value: "qualified", label: "Qualified" },
  { value: "onboarding", label: "Onboarding" },
  { value: "active", label: "Active" },
  { value: "at_risk", label: "At risk" },
  { value: "suspended", label: "Suspended" },
  { value: "closed", label: "Closed" },
];

const inputClasses =
  "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] rounded px-3 py-2 text-sm focus:border-[var(--dpf-accent)] focus:outline-none w-full";

type AccountFields = {
  id: string;
  name: string;
  status: string;
  industry: string | null;
  website: string | null;
  notes: string | null;
};

/**
 * Account hygiene controls on the detail page (BI-15AC1B33): edit the core
 * fields + status (e.g. reclassify a mislabeled Active account back to Prospect)
 * and archive the account. Both are governed server-side by `operate_customer`.
 */
export function AccountAdminActions({ account }: { account: AccountFields }) {
  const [open, setOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [name, setName] = useState(account.name);
  const [status, setStatus] = useState(account.status);
  const [industry, setIndustry] = useState(account.industry ?? "");
  const [website, setWebsite] = useState(account.website ?? "");
  const [notes, setNotes] = useState(account.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function saveEdits() {
    setError(null);
    startTransition(async () => {
      try {
        await updateCustomerAccount({
          accountId: account.id,
          name,
          status,
          industry,
          website,
          notes,
        });
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save the account.");
      }
    });
  }

  function archive() {
    setError(null);
    startTransition(async () => {
      try {
        await archiveCustomerAccount({ accountId: account.id });
        setConfirmArchive(false);
        router.push("/customer");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not archive the account.");
      }
    });
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            setOpen(true);
            setError(null);
          }}
          className="px-3 py-1.5 rounded-md text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] border border-[var(--dpf-border)]"
        >
          Edit
        </button>
        <button
          onClick={() => {
            setConfirmArchive(true);
            setError(null);
          }}
          className="px-3 py-1.5 rounded-md text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] border border-[var(--dpf-border)]"
        >
          Archive
        </button>
      </div>

      {open && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setOpen(false)} />
          <div className="fixed top-20 right-8 z-50 w-[440px] bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--dpf-border)]">
              <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Edit account</h2>
              <button
                onClick={() => setOpen(false)}
                className="text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] text-lg"
                aria-label="Close"
              >
                x
              </button>
            </div>
            <div className="p-4 space-y-3">
              <label className="block">
                <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputClasses} />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Status</span>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClasses}>
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Industry</span>
                <input value={industry} onChange={(e) => setIndustry(e.target.value)} className={inputClasses} />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Website</span>
                <input value={website} onChange={(e) => setWebsite(e.target.value)} className={inputClasses} />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Notes</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className={inputClasses}
                />
              </label>

              {error && <p className="text-xs text-[var(--dpf-danger)]">{error}</p>}

              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-3 py-1.5 rounded-md text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] border border-[var(--dpf-border)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isPending || !name.trim()}
                  onClick={saveEdits}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {isPending ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {confirmArchive && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setConfirmArchive(false)} />
          <div className="fixed top-24 right-8 z-50 w-[400px] bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--dpf-border)]">
              <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Archive account</h2>
              <button
                onClick={() => setConfirmArchive(false)}
                className="text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] text-lg"
                aria-label="Close"
              >
                x
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-[var(--dpf-muted)]">
                Archiving hides “{account.name}” from active account lists but keeps
                its full history. You can still reach it by direct link and change
                its status back later. Nothing is deleted.
              </p>
              {error && <p className="text-xs text-[var(--dpf-danger)]">{error}</p>}
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setConfirmArchive(false)}
                  className="px-3 py-1.5 rounded-md text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] border border-[var(--dpf-border)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={archive}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {isPending ? "Archiving…" : "Archive account"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
