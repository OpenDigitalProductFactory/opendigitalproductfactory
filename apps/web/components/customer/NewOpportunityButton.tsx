"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createOpportunity } from "@/lib/actions/crm";

const inputClasses =
  "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] rounded px-3 py-2 text-sm focus:border-[var(--dpf-accent)] focus:outline-none placeholder:text-[var(--dpf-muted)] w-full";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

// + New Opportunity on the Pipeline tab — opportunity creation previously had
// no UI door (coworker tool only). Defaults: qualification stage, GBP.
export function NewOpportunityButton({
  accounts,
}: {
  accounts: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [expectedValue, setExpectedValue] = useState("");

  function submit() {
    if (!accountId || !title.trim()) {
      setError("An account and a title are required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const value = Number(expectedValue);
        await createOpportunity({
          title: title.trim(),
          accountId,
          expectedValue: Number.isFinite(value) && value > 0 ? value : undefined,
          currency: "GBP",
        });
        setTitle("");
        setExpectedValue("");
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
        + New Opportunity
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-label="New opportunity">
      <div className="w-full max-w-md rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
        <h2 className="mb-4 text-sm font-semibold text-[var(--dpf-text)]">New opportunity</h2>
        <div className="space-y-3">
          <div>
            <label className={labelClasses}>Account *</label>
            <select className={inputClasses} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClasses}>Title *</label>
            <input
              className={inputClasses}
              placeholder="e.g. Acme — DPF managed instance & support"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClasses}>Expected value (GBP)</label>
            <input className={inputClasses} type="number" min="0" value={expectedValue} onChange={(e) => setExpectedValue(e.target.value)} />
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
              {isPending ? "Creating…" : "Create opportunity"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
