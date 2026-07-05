"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createQuote } from "@/lib/actions/crm";

const inputClasses =
  "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] rounded px-3 py-2 text-sm focus:border-[var(--dpf-accent)] focus:outline-none placeholder:text-[var(--dpf-muted)] w-full";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

// Draft-quote control on the opportunity page — quote creation previously had
// no UI door (coworker tool only). One line item covers the common case; more
// lines can be added on the quote after drafting (reviseQuote).
export function DraftQuoteButton({
  opportunityId,
  defaultDescription,
  defaultAmount,
  currency,
}: {
  opportunityId: string;
  defaultDescription: string;
  defaultAmount: number | null;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const [description, setDescription] = useState(defaultDescription);
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState(defaultAmount ? String(defaultAmount) : "");

  function submit() {
    const qty = Number(quantity);
    const price = Number(unitPrice);
    if (!description.trim() || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
      setError("A description, quantity, and unit price are required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + 30);
        const quote = await createQuote({
          opportunityId,
          validUntil: validUntil.toISOString(),
          currency,
          lineItems: [{ description: description.trim(), quantity: qty, unitPrice: price }],
        });
        setOpen(false);
        router.push(`/customer/quotes/${quote.id}`);
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
        Draft quote
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-label="Draft quote">
      <div className="w-full max-w-md rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
        <h2 className="mb-1 text-sm font-semibold text-[var(--dpf-text)]">Draft quote</h2>
        <p className="mb-4 text-xs text-[var(--dpf-muted)]">
          Valid for 30 days. You can revise line items on the quote afterwards.
        </p>
        <div className="space-y-3">
          <div>
            <label className={labelClasses}>Line item description *</label>
            <input className={inputClasses} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Quantity *</label>
              <input className={inputClasses} type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div>
              <label className={labelClasses}>Unit price ({currency}) *</label>
              <input className={inputClasses} type="number" min="0" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
            </div>
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
              {isPending ? "Drafting…" : "Create draft quote"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
