"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  listCustomerAccountMergeTargets,
  mergeCustomerAccounts,
  previewCustomerAccountMerge,
  type MergeImpactPreview,
} from "@/lib/actions/customer-merge";

const selectClasses =
  "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] rounded px-3 py-2 text-sm focus:border-[var(--dpf-accent)] focus:outline-none w-full";

/** Plain-language wording for the repoint impact steps. */
const IMPACT_LABELS: Record<string, string> = {
  "customerContact.accountId": "contacts",
  "contactAccountRole.accountId": "contact roles",
  "customerSite.accountId": "sites",
  "opportunity.accountId": "opportunities",
  "quote.accountId": "quotes",
  "salesOrder.accountId": "sales orders",
  "invoice.accountId": "invoices",
  "engagement.accountId": "engagements",
  "activity.accountId": "activity history",
  "serviceTicket.customerAccountId": "service tickets",
  "customerAccount.parentAccountId": "child accounts",
};

function impactLabel(step: string): string {
  return IMPACT_LABELS[step] ?? step.split(".")[0] ?? step;
}

/**
 * Steward merge control on the account detail page: merges THIS account (the
 * duplicate) into a chosen survivor, with a usage-impact preview before the
 * destructive-ish confirm. Admin-gated server-side.
 */
export function MergeCustomerAccountButton({ accountId, accountName }: { accountId: string; accountName: string }) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<Array<{ id: string; name: string; accountId: string }> | null>(null);
  const [survivorId, setSurvivorId] = useState("");
  const [preview, setPreview] = useState<MergeImpactPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function openModal() {
    setOpen(true);
    setError(null);
    setPreview(null);
    setSurvivorId("");
    startTransition(async () => {
      const result = await listCustomerAccountMergeTargets(accountId);
      if (result.ok) setTargets(result.data);
      else setError(result.error);
    });
  }

  function loadPreview(id: string) {
    setSurvivorId(id);
    setPreview(null);
    setError(null);
    if (!id) return;
    startTransition(async () => {
      const result = await previewCustomerAccountMerge(accountId, id);
      if (result.ok) setPreview(result.data);
      else setError(result.error);
    });
  }

  function confirmMerge() {
    if (!survivorId) return;
    startTransition(async () => {
      const result = await mergeCustomerAccounts(accountId, survivorId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.push(`/customer/${survivorId}`);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        onClick={openModal}
        className="px-3 py-1.5 rounded-md text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] border border-[var(--dpf-border)]"
      >
        Merge into…
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setOpen(false)} />
      <div className="fixed top-20 right-8 z-50 w-[440px] bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--dpf-border)]">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Merge “{accountName}” into…</h2>
          <button
            onClick={() => setOpen(false)}
            className="text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] text-lg"
            aria-label="Close"
          >
            x
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-[var(--dpf-muted)]">
            Everything on this account moves to the account you pick; this one is kept as a
            superseded record pointing at it. Nothing is deleted.
          </p>
          <select
            value={survivorId}
            onChange={(e) => loadPreview(e.target.value)}
            className={selectClasses}
            disabled={targets === null}
          >
            <option value="">{targets === null ? "Loading accounts…" : "Choose the account to keep"}</option>
            {(targets ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.accountId})
              </option>
            ))}
          </select>

          {preview && (
            <div className="rounded border border-[var(--dpf-border)] px-3 py-2 space-y-1">
              <p className="text-xs font-semibold text-[var(--dpf-text)]">
                Will move to {preview.survivor.name}:
              </p>
              {Object.keys(preview.impact).length === 0 ? (
                <p className="text-xs text-[var(--dpf-muted)]">No related records — only the account itself.</p>
              ) : (
                <ul className="text-xs text-[var(--dpf-muted)]">
                  {Object.entries(preview.impact).map(([step, count]) => (
                    <li key={step}>
                      {count} {impactLabel(step)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && <p className="text-xs text-[var(--dpf-text)]">{error}</p>}

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
              disabled={isPending || !preview}
              onClick={confirmMerge}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {isPending ? "Merging…" : "Merge accounts"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
