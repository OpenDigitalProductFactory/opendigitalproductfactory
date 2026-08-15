"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeOpportunity } from "@/lib/actions/crm-account-admin";

/**
 * Inline "remove" control for an opportunity on the account detail page
 * (BI-15AC1B33). Lets an operator strip a fabricated/erroneous opportunity
 * entirely, with a confirm step. Governed server-side by `operate_customer`;
 * refuses when quotes reference the opportunity.
 */
export function RemoveOpportunityButton({
  opportunityId,
  opportunityTitle,
}: {
  opportunityId: string;
  opportunityTitle: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function remove() {
    setError(null);
    startTransition(async () => {
      try {
        await removeOpportunity({ opportunityId });
        setConfirming(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not remove the opportunity.");
      }
    });
  }

  if (!confirming) {
    return (
      <button
        onClick={() => {
          setConfirming(true);
          setError(null);
        }}
        className="text-[9px] text-[var(--dpf-muted)] hover:text-[var(--dpf-danger)]"
        aria-label={`Remove opportunity ${opportunityTitle}`}
      >
        Remove
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      <button
        onClick={remove}
        disabled={isPending}
        className="text-[9px] font-medium text-[var(--dpf-danger)] hover:opacity-80 disabled:opacity-50"
      >
        {isPending ? "Removing…" : "Confirm remove"}
      </button>
      <button
        onClick={() => setConfirming(false)}
        className="text-[9px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
      >
        Cancel
      </button>
      {error && <span className="text-[9px] text-[var(--dpf-danger)]">{error}</span>}
    </span>
  );
}
