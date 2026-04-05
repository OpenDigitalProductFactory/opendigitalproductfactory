"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBill } from "@/lib/actions/ap";

const inputClasses =
  "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] rounded px-3 py-2 text-sm focus:border-[var(--dpf-accent)] focus:outline-none placeholder:text-[var(--dpf-muted)]";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

interface Supplier {
  id: string;
  supplierId: string;
  name: string;
  defaultCurrency: string;
}

interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  lineItems: {
    description: string;
    quantity: number | string;
    unitPrice: number | string;
    taxRate: number | string;
  }[];
}

interface Props {
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  defaultSupplierId?: string;
  defaultCurrency?: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function getToday(): string {
  return new Date().toISOString().split("T")[0]!;
}

function getDefaultDueDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().split("T")[0]!;
}

export function CreateBillForm({ suppliers, purchaseOrders, defaultSupplierId, defaultCurrency }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedSupplierId, setSelectedSupplierId] = useState(defaultSupplierId ?? "");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [issueDate, setIssueDate] = useState(getToday());
  const [dueDate, setDueDate] = useState(getDefaultDueDate());
  const [currency, setCurrency] = useState(defaultCurrency ?? "GBP");
  const [selectedPoId, setSelectedPoId] = useState("");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: "", quantity: 1, unitPrice: 0, taxRate: 20 },
  ]);

  // When supplier changes, update currency default
  const handleSupplierChange = useCallback(
    (supplierId: string) => {
      setSelectedSupplierId(supplierId);
      const supplier = suppliers.find((s) => s.id === supplierId);
      if (supplier?.defaultCurrency) {
        setCurrency(supplier.defaultCurrency);
      }
      // Clear PO if supplier changes
      setSelectedPoId("");
    },
    [suppliers],
  );

  // When PO is selected, auto-populate line items
  useEffect(() => {
    if (!selectedPoId) return;
    const po = purchaseOrders.find((p) => p.id === selectedPoId);
    if (!po) return;
    setLineItems(
      po.lineItems.map((li) => ({
        description: li.description,
        quantity: Number(li.quantity),
        unitPrice: Number(li.unitPrice),
        taxRate: Number(li.taxRate),
      })),
    );
  }, [selectedPoId, purchaseOrders]);

  const availablePOs = purchaseOrders.filter(
    (po) => !selectedSupplierId || po.supplierId === selectedSupplierId,
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
    value: string | number,
  ) => {
    setLineItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        return { ...item, [field]: typeof value === "string" && field !== "description" ? parseFloat(value) || 0 : value };
      }),
    );
  };

  // Live total calculation
  const totals = lineItems.reduce(
    (acc, li) => {
      const subtotal = round2(li.quantity * li.unitPrice);
      const tax = round2(subtotal * (li.taxRate / 100));
      return {
        subtotal: round2(acc.subtotal + subtotal),
        tax: round2(acc.tax + tax),
        total: round2(acc.total + subtotal + tax),
      };
    },
    { subtotal: 0, tax: 0, total: 0 },
  );

  const formatMoney = (n: number) =>
    n.toLocaleString("en-GB", { minimumFractionDigits: 2 });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSupplierId) {
      setError("Please select a supplier.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const bill = await createBill({
        supplierId: selectedSupplierId,
        invoiceRef: invoiceRef || undefined,
        issueDate,
        dueDate,
        currency,
        purchaseOrderId: selectedPoId || undefined,
        notes: notes || undefined,
        lineItems: lineItems.map((li) => ({
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          taxRate: li.taxRate,
        })),
      });
      router.push(`/finance/bills/${bill.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create bill");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Supplier and PO */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label className={labelClasses}>Supplier *</label>
          <select
            value={selectedSupplierId}
            onChange={(e) => handleSupplierChange(e.target.value)}
            required
            className={inputClasses + " w-full"}
          >
            <option value="">Select supplier…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <a
            href="/finance/suppliers"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-[var(--dpf-accent)] hover:underline mt-1 inline-block"
          >
            + Create new supplier
          </a>
        </div>
        <div>
          <label className={labelClasses}>Link to Purchase Order (optional)</label>
          <select
            value={selectedPoId}
            onChange={(e) => setSelectedPoId(e.target.value)}
            className={inputClasses + " w-full"}
          >
            <option value="">None</option>
            {availablePOs.map((po) => (
              <option key={po.id} value={po.id}>
                {po.poNumber}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Dates and currency */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div>
          <label className={labelClasses}>Invoice Ref (optional)</label>
          <input
            type="text"
            value={invoiceRef}
            onChange={(e) => setInvoiceRef(e.target.value)}
            placeholder="Supplier's invoice number"
            className={inputClasses + " w-full"}
          />
        </div>
        <div>
          <label className={labelClasses}>Issue Date *</label>
          <input
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            required
            className={inputClasses + " w-full"}
          />
        </div>
        <div>
          <label className={labelClasses}>Due Date *</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            required
            className={inputClasses + " w-full"}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div>
          <label className={labelClasses}>Currency</label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className={inputClasses + " w-full"}
          >
            {["GBP", "USD", "EUR"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Line items */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Line Items
          </h2>
          <button
            type="button"
            onClick={addLineItem}
            className="text-xs text-[var(--dpf-accent)] hover:underline"
          >
            + Add line
          </button>
        </div>

        <div className="space-y-2">
          {lineItems.map((item, idx) => (
            <div
              key={idx}
              className="grid grid-cols-12 gap-2 items-center"
            >
              <div className="col-span-5">
                {idx === 0 && <p className={labelClasses}>Description</p>}
                <input
                  type="text"
                  value={item.description}
                  onChange={(e) => updateLineItem(idx, "description", e.target.value)}
                  placeholder="Description"
                  required
                  className={inputClasses + " w-full"}
                />
              </div>
              <div className="col-span-2">
                {idx === 0 && <p className={labelClasses}>Qty</p>}
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  value={item.quantity}
                  onChange={(e) => updateLineItem(idx, "quantity", e.target.value)}
                  required
                  className={inputClasses + " w-full"}
                />
              </div>
              <div className="col-span-2">
                {idx === 0 && <p className={labelClasses}>Unit Price</p>}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.unitPrice}
                  onChange={(e) => updateLineItem(idx, "unitPrice", e.target.value)}
                  required
                  className={inputClasses + " w-full"}
                />
              </div>
              <div className="col-span-2">
                {idx === 0 && <p className={labelClasses}>Tax %</p>}
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={item.taxRate}
                  onChange={(e) => updateLineItem(idx, "taxRate", e.target.value)}
                  required
                  className={inputClasses + " w-full"}
                />
              </div>
              <div className="col-span-1 flex items-end pb-0.5">
                {idx === 0 && <p className={labelClasses}>&nbsp;</p>}
                {lineItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLineItem(idx)}
                    className="text-[var(--dpf-muted)] hover:text-[var(--dpf-error)] text-xs transition-colors"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Live totals */}
        <div className="mt-4 pt-4 border-t border-[var(--dpf-border)] flex flex-col items-end gap-1">
          <p className="text-xs text-[var(--dpf-muted)]">
            Subtotal: <span className="text-[var(--dpf-text)]">{currency} {formatMoney(totals.subtotal)}</span>
          </p>
          <p className="text-xs text-[var(--dpf-muted)]">
            Tax: <span className="text-[var(--dpf-text)]">{currency} {formatMoney(totals.tax)}</span>
          </p>
          <p className="text-sm font-bold text-[var(--dpf-text)]">
            Total: {currency} {formatMoney(totals.total)}
          </p>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className={labelClasses}>Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Internal notes…"
          className={inputClasses + " w-full resize-none"}
        />
      </div>

      {error && (
        <p className="text-sm text-[var(--dpf-error)]">{error}</p>
      )}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 rounded-md text-sm border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 rounded-md text-sm font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {loading ? "Saving…" : "Save as Draft"}
        </button>
      </div>
    </form>
  );
}
