"use client";

// Billable time on the customer account (EP-LABOR-ECONOMICS Phase 4).
// Shows what the account's approved billable hours cost/earn (report-kit
// StatCards) and turns the un-invoiced ones into a draft invoice. Skipped
// entries are surfaced with a fix-it path — never silently dropped.

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/ui/Dialog";
import { StatCard } from "@/components/ui/report-kit/StatCard";
import { generateBillableInvoice } from "@/lib/actions/labor";
import type { BillableInvoiceResult } from "@/lib/hr/labor-service";
import type { AccountLaborEconomics } from "@/lib/hr/labor-report";

type Props = {
  accountId: string;
  accountName: string;
  economics: AccountLaborEconomics;
  /** Org base currency code — display only. */
  currency: string;
};

function money(currency: string, amount: number): string {
  return `${currency} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function BillableTimeSection({ accountId, accountName, economics, currency }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<BillableInvoiceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    // Await the confirm dialog OUTSIDE the transition — confirmDialog raises a
    // DialogHost state update, and one deferred inside startTransition never
    // renders interactively, wedging the button in its pending state. Every
    // other confirmDialog caller awaits first, then runs the work.
    const ok = await confirmDialog({
      title: "Create a draft invoice?",
      message: `Turn ${economics.unbilledHours} approved billable hour${economics.unbilledHours === 1 ? "" : "s"} for ${accountName} into a draft invoice. You can review it before sending.`,
    });
    if (!ok) return;
    startTransition(async () => {
      setError(null);
      try {
        const r = await generateBillableInvoice(accountId);
        setResult(r);
        if (r.generated) router.refresh();
      } catch {
        setError("Couldn't create the invoice. Try again, or check the finance settings.");
      }
    });
  }

  const skippedNoRate = result?.skipped.filter((s) => s.reason === "no-rate").length ?? 0;

  return (
    <div className="mb-6">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
        Billable Time
      </h2>

      {/* Margin band — cost vs billed revenue vs margin for the account's billable hours */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <StatCard
          label="Labour cost"
          value={money(currency, economics.cost)}
          hint={`${economics.billableHours}h billable worked`}
        />
        <StatCard
          label="Billed value"
          value={money(currency, economics.revenue)}
          hint={economics.unbilledHours > 0 ? `${economics.unbilledHours}h not invoiced yet` : "All hours invoiced"}
        />
        <StatCard
          label="Margin"
          value={money(currency, economics.margin)}
          hint={economics.revenue > 0 ? `${economics.marginPct}% of billed value` : "No billed value yet"}
          intent={economics.margin >= 0 ? "success" : "danger"}
        />
      </div>

      {economics.hoursMissingCompensation > 0 && (
        <p className="mb-3 text-[11px] text-[var(--dpf-warning)]">
          {economics.hoursMissingCompensation}h of this time is from team members with no pay set, so
          the true cost is higher than shown.{" "}
          <Link href="/employee" className="text-[var(--dpf-accent)] hover:underline">
            Set their pay →
          </Link>
        </p>
      )}

      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-[var(--dpf-text)]">
              {economics.unbilledHours > 0
                ? `${economics.unbilledHours} approved hour${economics.unbilledHours === 1 ? "" : "s"} ready to invoice`
                : "No approved hours waiting to be invoiced"}
            </p>
            {economics.unbilledEntriesMissingRate > 0 && (
              <p className="text-[11px] text-[var(--dpf-warning)] mt-1">
                {economics.unbilledEntriesMissingRate} entr{economics.unbilledEntriesMissingRate === 1 ? "y has" : "ies have"} no
                service rate and would be left out.{" "}
                <Link href="/finance/settings/rate-card" className="text-[var(--dpf-accent)] hover:underline">
                  Fix the rates →
                </Link>
              </p>
            )}
          </div>
          {economics.unbilledHours > 0 && (
            <button
              type="button"
              disabled={isPending}
              onClick={handleGenerate}
              className="rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Create draft invoice
            </button>
          )}
        </div>

        {error && <p className="mt-2 text-xs text-[var(--dpf-error)]">{error}</p>}

        {result && (
          <div className="mt-3 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-xs space-y-1">
            {result.generated ? (
              <>
                <p className="text-[var(--dpf-text)]">
                  Draft invoice{" "}
                  <Link
                    href={`/finance/invoices/${result.invoiceId}`}
                    className="text-[var(--dpf-accent)] hover:underline"
                  >
                    {result.invoiceRef}
                  </Link>{" "}
                  created for {result.hoursBilled}h ({result.entriesBilled} timesheet{" "}
                  {result.entriesBilled === 1 ? "entry" : "entries"}). Review and send it from Finance.
                </p>
                {skippedNoRate > 0 && (
                  <p className="text-[var(--dpf-warning)]">
                    {skippedNoRate} entr{skippedNoRate === 1 ? "y was" : "ies were"} left out because no
                    service rate is set.{" "}
                    <Link href="/finance/settings/rate-card" className="text-[var(--dpf-accent)] hover:underline">
                      Add the rate
                    </Link>{" "}
                    and create another invoice to bill them.
                  </p>
                )}
              </>
            ) : (
              <p className="text-[var(--dpf-muted)]">
                {result.reason === "billable-time-disabled"
                  ? "Billable time isn't enabled for your business type."
                  : skippedNoRate > 0
                    ? "Nothing could be billed — the hours are missing service rates."
                    : "Nothing to bill yet — hours must be on an approved timesheet first."}
                {result.reason === "nothing-to-bill" && skippedNoRate > 0 && (
                  <>
                    {" "}
                    <Link href="/finance/settings/rate-card" className="text-[var(--dpf-accent)] hover:underline">
                      Fix the rates →
                    </Link>
                  </>
                )}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
