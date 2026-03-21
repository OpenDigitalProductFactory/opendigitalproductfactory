"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createInvoice } from "@/lib/actions/finance";

const inputClasses =
  "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] rounded px-3 py-2 text-sm focus:border-[var(--dpf-accent)] focus:outline-none placeholder:text-[var(--dpf-muted)]";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

interface Customer {
  id: string;
  accountId: string;
  name: string;
  currency: string;
}

interface Props {
  customers: Customer[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function getDefaultDueDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().split("T")[0];
}

export function CreateInvoiceForm({ customers }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [dueDate, setDueDate] = useState(getDefaultDueDate());
  const [currency, setCurrency] = useState("GBP");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: "", quantity: 1, unitPrice: 0, taxRate: 20 },
  ]);

  const handleCustomerChange = useCallback(
    (accountId: string) => {
      setSelectedAccountId(accountId);
      const customer = customers.find((c) => c.id === accountId);
      if (customer?.currency) {
        setCurrency(customer.currency);
      }
    },
    [customers]
  );

  const addLineItem = () => {
    setLineItems((prev) => [
      ...prev,
      { description: "", quantity: 1, unitPrice: 0, taxRate: 20 },
    ]);
  };

  const removeLineItem = (index: number) => {
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateLineItem = (
    index: number,
    field: keyof LineItem,
    value: string | number
  ) => {
    setLineItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      )
    );
  };

  // Live totals
  const lineTotals = lineItems.map((item) => {
    const lineSubtotal = round2(item.quantity * item.unitPrice);
    const lineTax = round2(lineSubtotal * (item.taxRate / 100));
    return round2(lineSubtotal + lineTax);
  });
  const subtotal = round2(
    lineItems.reduce((sum, item) => sum + round2(item.quantity * item.unitPrice), 0)
  );
  const taxTotal = round2(
    lineItems.reduce((sum, item) => {
      const lineSubtotal = round2(item.quantity * item.unitPrice);
      return sum + round2(lineSubtotal * (item.taxRate / 100));
    }, 0)
  );
  const total = round2(subtotal + taxTotal);

  const formatMoney = (amount: number) =>
    amount.toLocaleString("en-GB", { minimumFractionDigits: 2 });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedAccountId) {
      setError("Please select a customer.");
      return;
    }
    if (lineItems.length === 0) {
      setError("Please add at least one line item.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await createInvoice({
        accountId: selectedAccountId,
        dueDate,
        currency,
        paymentTerms: paymentTerms || undefined,
        notes: notes || undefined,
        lineItems: lineItems.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate,
        })),
      });
      router.push(`/finance/invoices/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invoice.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
      {error && (
        <div className="px-3 py-2 rounded border border-red-500/40 bg-red-500/10 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Customer & invoice details */}
      <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
        <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-4">
          Invoice Details
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClasses}>Customer *</label>
            <select
              value={selectedAccountId}
              onChange={(e) => handleCustomerChange(e.target.value)}
              required
              className={`${inputClasses} w-full`}
            >
              <option value="">Select a customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClasses}>Due Date *</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              required
              className={`${inputClasses} w-full`}
            />
          </div>
          <div>
            <label className={labelClasses}>Currency</label>
            <input
              type="text"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
              className={`${inputClasses} w-full`}
            />
          </div>
          <div>
            <label className={labelClasses}>Payment Terms</label>
            <input
              type="text"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              placeholder="e.g. Net 30"
              className={`${inputClasses} w-full`}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClasses}>Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional notes for the customer"
              className={`${inputClasses} w-full resize-none`}
            />
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Line Items
          </h2>
          <button
            type="button"
            onClick={addLineItem}
            className="text-[10px] px-2 py-1 rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] transition-colors"
          >
            + Add Row
          </button>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[1fr_80px_100px_80px_90px_32px] gap-2 mb-1 px-1">
          <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Description
          </span>
          <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] text-right">
            Qty
          </span>
          <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] text-right">
            Unit Price
          </span>
          <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] text-right">
            Tax %
          </span>
          <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] text-right">
            Total
          </span>
          <span />
        </div>

        <div className="space-y-2">
          {lineItems.map((item, idx) => (
            <div
              key={idx}
              className="grid grid-cols-[1fr_80px_100px_80px_90px_32px] gap-2 items-center"
            >
              <input
                type="text"
                value={item.description}
                onChange={(e) =>
                  updateLineItem(idx, "description", e.target.value)
                }
                placeholder="Description"
                required
                className={`${inputClasses} w-full`}
              />
              <input
                type="number"
                value={item.quantity}
                min={0}
                step="any"
                onChange={(e) =>
                  updateLineItem(idx, "quantity", parseFloat(e.target.value) || 0)
                }
                className={`${inputClasses} w-full text-right`}
              />
              <input
                type="number"
                value={item.unitPrice}
                min={0}
                step="any"
                onChange={(e) =>
                  updateLineItem(
                    idx,
                    "unitPrice",
                    parseFloat(e.target.value) || 0
                  )
                }
                className={`${inputClasses} w-full text-right`}
              />
              <input
                type="number"
                value={item.taxRate}
                min={0}
                max={100}
                step="any"
                onChange={(e) =>
                  updateLineItem(idx, "taxRate", parseFloat(e.target.value) || 0)
                }
                className={`${inputClasses} w-full text-right`}
              />
              <span className="text-sm text-[var(--dpf-text)] text-right pr-1">
                {currency} {formatMoney(lineTotals[idx] ?? 0)}
              </span>
              <button
                type="button"
                onClick={() => removeLineItem(idx)}
                disabled={lineItems.length === 1}
                className="text-[var(--dpf-muted)] hover:text-red-400 disabled:opacity-30 transition-colors text-sm font-bold"
                aria-label="Remove row"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="mt-4 pt-4 border-t border-[var(--dpf-border)] flex flex-col items-end gap-1">
          <div className="flex gap-8 text-xs">
            <span className="text-[var(--dpf-muted)]">Subtotal</span>
            <span className="text-[var(--dpf-text)] w-28 text-right">
              {currency} {formatMoney(subtotal)}
            </span>
          </div>
          {taxTotal > 0 && (
            <div className="flex gap-8 text-xs">
              <span className="text-[var(--dpf-muted)]">Tax</span>
              <span className="text-[var(--dpf-muted)] w-28 text-right">
                {currency} {formatMoney(taxTotal)}
              </span>
            </div>
          )}
          <div className="flex gap-8 text-sm font-bold mt-1">
            <span className="text-[var(--dpf-muted)]">Total</span>
            <span className="text-[var(--dpf-text)] w-28 text-right">
              {currency} {formatMoney(total)}
            </span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <a
          href="/finance/invoices"
          className="px-4 py-2 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
        >
          Cancel
        </a>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 rounded-md text-sm font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading ? "Saving…" : "Save as Draft"}
        </button>
      </div>
    </form>
  );
}
