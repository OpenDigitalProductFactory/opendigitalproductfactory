"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unmergeCustomerAccounts } from "@/lib/actions/customer-merge";

/**
 * Undo-merge control on a merge tombstone's detail page. Lineage-based
 * (BI-F7B6D55E): restores exactly the records the merge moved; anything
 * added to the survivor afterwards stays with the survivor.
 */
export function UnmergeCustomerAccountButton({ accountId }: { accountId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function run() {
    startTransition(async () => {
      const result = await unmergeCustomerAccounts(accountId);
      if (!result.ok) {
        setError(result.error);
        setConfirming(false);
        return;
      }
      router.refresh();
    });
  }

  if (error) {
    return <span className="text-xs text-[var(--dpf-muted)]">{error}</span>;
  }
  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="px-2.5 py-1 rounded-md text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] border border-[var(--dpf-border)] whitespace-nowrap"
      >
        Undo merge
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      <button
        onClick={run}
        disabled={isPending}
        className="px-2.5 py-1 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 disabled:opacity-50"
      >
        {isPending ? "Restoring…" : "Confirm undo"}
      </button>
      <button
        onClick={() => setConfirming(false)}
        disabled={isPending}
        className="px-2.5 py-1 rounded-md text-xs text-[var(--dpf-muted)] border border-[var(--dpf-border)]"
      >
        Cancel
      </button>
    </span>
  );
}
