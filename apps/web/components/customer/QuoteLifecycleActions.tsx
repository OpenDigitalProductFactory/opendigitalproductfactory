"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptQuote, sendQuote } from "@/lib/actions/crm";

// Quote lifecycle controls. The server actions (sendQuote / acceptQuote) existed
// but had NO UI surface — a quote could only leave draft via a coworker tool call,
// which the local model performs unreliably. acceptQuote also creates the sales
// order and auto-generates the invoice, so this single button advances
// quote → order → invoice deterministically.

const btn =
  "rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-sm font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50";
const btnPrimary =
  "rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";

export function QuoteLifecycleActions({ quoteId, status }: { quoteId: string; status: string }) {
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

  if (status === "accepted" || status === "rejected" || status === "superseded") return null;

  return (
    <div className="flex items-center gap-2">
      {status === "draft" && (
        <button className={btn} disabled={isPending} onClick={() => run(() => sendQuote(quoteId))}>
          Mark as sent
        </button>
      )}
      <button
        className={btnPrimary}
        disabled={isPending}
        title="Accept the quote — creates the sales order and generates the invoice"
        onClick={() => run(() => acceptQuote(quoteId))}
      >
        {isPending ? "Working…" : "Accept quote → create order"}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
