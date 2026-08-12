"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { convertAccountToActiveCustomer, convertOrderToSubscription } from "@/lib/actions/subscriptions";
import { cancelSubscription } from "@/lib/actions/crm-account-admin";

export type LifecycleContext = {
  accountId: string;
  status: string;
  // The most recent accepted sales order without a support contract yet, if any.
  contractableOrder: { id: string; orderRef: string } | null;
  // The active support contract, if one already exists.
  contract: {
    id: string;
    subscriptionRef: string;
    planName: string;
    status: string;
    currency: string;
    totalValue: string;
    billingCadence: string;
    renewalDate: string | null;
  } | null;
};

const btn =
  "rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-sm font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50";
const btnPrimary =
  "rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";

export function AccountLifecycleActions(ctx: LifecycleContext) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function run(fn: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  const isProspect = ctx.status !== "active" && ctx.status !== "closed";

  return (
    <div className="mb-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
          Engagement lifecycle
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {isProspect && (
            <button
              className={btnPrimary}
              disabled={isPending}
              onClick={() => run(() => convertAccountToActiveCustomer(ctx.accountId))}
            >
              Convert to active customer
            </button>
          )}
          {ctx.contractableOrder && !ctx.contract && (
            <button
              className={btn}
              disabled={isPending}
              onClick={() => run(() => convertOrderToSubscription(ctx.contractableOrder!.id))}
              title={`Create a support contract from order ${ctx.contractableOrder.orderRef}`}
            >
              Create support contract
            </button>
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {ctx.contract && (
        <div className="mt-3 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-[var(--dpf-text)]">
              Support contract — {ctx.contract.planName}
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--dpf-accent)]">
                {ctx.contract.status}
              </span>
              {ctx.contract.status !== "cancelled" && (
                <button
                  className="text-[10px] text-[var(--dpf-muted)] hover:text-[var(--dpf-danger)]"
                  disabled={isPending}
                  onClick={() =>
                    run(() => cancelSubscription({ subscriptionId: ctx.contract!.id }))
                  }
                  title="Cancel this support contract"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
          <p className="mt-1 text-[11px] font-mono text-[var(--dpf-muted)]">
            {ctx.contract.subscriptionRef}
          </p>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            {ctx.contract.currency} {Number(ctx.contract.totalValue).toLocaleString()} ·{" "}
            {ctx.contract.billingCadence}
            {ctx.contract.renewalDate
              ? ` · renews ${new Date(ctx.contract.renewalDate).toLocaleDateString()}`
              : ""}
          </p>
        </div>
      )}
    </div>
  );
}
