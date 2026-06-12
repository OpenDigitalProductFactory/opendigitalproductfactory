"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordPayment } from "@/lib/actions/finance";

const PAYMENT_METHODS = [
  "bank_transfer", "card", "cash", "cheque", "direct_debit", "stripe",
] as const;

const METHOD_LABELS: Record<string, string> = {
  bank_transfer: "Bank transfer",
  card: "Card",
  cash: "Cash",
  cheque: "Cheque",
  direct_debit: "Direct debit",
  stripe: "Stripe",
};

interface Props {
  billId: string;
  amountDue: number;
  currency: string;
}

function getToday(): string {
  return new Date().toISOString().split("T")[0]!;
}

export function RecordBillPaymentButton({ billId, amountDue, currency }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(amountDue > 0 ? String(amountDue) : "");
  const [method, setMethod] = useState<string>("bank_transfer");
  const [receivedAt, setReceivedAt] = useState(getToday());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = parseFloat(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter a payment amount greater than zero.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await recordPayment({
        direction: "outbound",
        method: method as (typeof PAYMENT_METHODS)[number],
        amount: value,
        currency,
        billId,
        receivedAt,
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 rounded-md text-sm font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
      >
        Record Payment
      </button>
    );
  }

  const inputClasses =
    "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] rounded px-3 py-2 text-sm focus:border-[var(--dpf-accent)] focus:outline-none";
  const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-[var(--dpf-border)] p-4 w-72 space-y-3 bg-[var(--dpf-surface-2)]"
    >
      <div className="text-sm font-semibold text-[var(--dpf-text)]">Record payment</div>
      <div>
        <label className={labelClasses}>Amount ({currency})</label>
        <input
          type="number"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          className={inputClasses + " w-full"}
        />
      </div>
      <div>
        <label className={labelClasses}>Method</label>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className={inputClasses + " w-full"}
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
              {METHOD_LABELS[m] ?? m}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClasses}>Payment date</label>
        <input
          type="date"
          value={receivedAt}
          onChange={(e) => setReceivedAt(e.target.value)}
          required
          className={inputClasses + " w-full"}
        />
      </div>
      {error && <p className="text-xs text-[var(--dpf-error)]">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-3 py-1.5 rounded-md text-sm border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="px-3 py-1.5 rounded-md text-sm font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Recording…" : "Confirm payment"}
        </button>
      </div>
    </form>
  );
}
