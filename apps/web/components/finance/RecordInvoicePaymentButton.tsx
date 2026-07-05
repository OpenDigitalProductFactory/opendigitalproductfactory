"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordPayment } from "@/lib/actions/finance";

// Record an incoming payment against a customer invoice for its outstanding
// amount. The recordPayment action (and its GL posting) existed but AR had no
// UI control — only AP bills had a record-payment button — so an invoice could
// never be settled through the portal.

export function RecordInvoicePaymentButton({
  invoiceId,
  outstanding,
  currency,
  status,
}: {
  invoiceId: string;
  outstanding: number;
  currency: string;
  status: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (status === "paid" || status === "void" || outstanding <= 0) return null;

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        await recordPayment({
          direction: "inbound",
          method: "bank_transfer",
          amount: outstanding,
          currency,
          invoiceId,
          notes: "Recorded from invoice page",
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        className="rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        disabled={isPending}
        title={`Record an incoming ${currency} ${outstanding.toLocaleString()} payment against this invoice`}
        onClick={handleClick}
      >
        {isPending ? "Recording…" : "Record payment"}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
