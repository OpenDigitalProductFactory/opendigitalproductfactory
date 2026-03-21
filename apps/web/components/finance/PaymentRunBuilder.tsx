"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createPaymentRun } from "@/lib/actions/ap";

interface Bill {
  id: string;
  billRef: string;
  supplierId: string;
  supplierName: string;
  currency: string;
  amountDue: number;
}

interface Props {
  approvedBills: Bill[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function PaymentRunBuilder({ approvedBills }: Props) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [consolidate, setConsolidate] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const toggleBill = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === approvedBills.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(approvedBills.map((b) => b.id)));
    }
  };

  const selectedBills = approvedBills.filter((b) => selectedIds.has(b.id));
  const total = round2(selectedBills.reduce((sum, b) => sum + b.amountDue, 0));
  const uniqueSuppliers = new Set(selectedBills.map((b) => b.supplierId)).size;

  const formatMoney = (n: number) =>
    n.toLocaleString("en-GB", { minimumFractionDigits: 2 });

  async function handleExecute() {
    if (selectedIds.size === 0) return;
    setLoading(true);
    setError(null);
    try {
      await createPaymentRun({
        billIds: Array.from(selectedIds),
        consolidatePerSupplier: consolidate,
      });
      setSelectedIds(new Set());
      setConfirming(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment run failed");
    } finally {
      setLoading(false);
    }
  }

  if (approvedBills.length === 0) {
    return (
      <p className="text-sm text-[var(--dpf-muted)]">
        No approved bills ready for payment.
      </p>
    );
  }

  return (
    <div>
      {/* Consolidate toggle */}
      <div className="flex items-center gap-3 mb-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={consolidate}
            onChange={(e) => setConsolidate(e.target.checked)}
            className="rounded border-[var(--dpf-border)] accent-[var(--dpf-accent)]"
          />
          <span className="text-xs text-[var(--dpf-muted)]">
            Consolidate per supplier (one payment per supplier)
          </span>
        </label>
      </div>

      {/* Bills table */}
      <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden mb-4">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--dpf-border)]">
              <th className="px-4 py-2 w-10">
                <input
                  type="checkbox"
                  checked={selectedIds.size === approvedBills.length && approvedBills.length > 0}
                  onChange={toggleAll}
                  className="rounded border-[var(--dpf-border)] accent-[var(--dpf-accent)]"
                />
              </th>
              <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                Bill Ref
              </th>
              <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                Supplier
              </th>
              <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                Amount Due
              </th>
            </tr>
          </thead>
          <tbody>
            {approvedBills.map((bill) => {
              const isSelected = selectedIds.has(bill.id);
              return (
                <tr
                  key={bill.id}
                  onClick={() => toggleBill(bill.id)}
                  className={`border-b border-[var(--dpf-border)] last:border-0 cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-[var(--dpf-accent)]/5"
                      : "hover:bg-[var(--dpf-surface-2)]"
                  }`}
                >
                  <td className="px-4 py-2.5 w-10" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleBill(bill.id)}
                      className="rounded border-[var(--dpf-border)] accent-[var(--dpf-accent)]"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-[9px] font-mono text-[var(--dpf-muted)]">
                      {bill.billRef}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[var(--dpf-text)]">{bill.supplierName}</td>
                  <td className="px-4 py-2.5 text-right text-[var(--dpf-text)]">
                    {bill.currency} {formatMoney(bill.amountDue)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      {selectedIds.size > 0 && (
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] mb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-[var(--dpf-muted)]">
                {selectedIds.size} bill{selectedIds.size !== 1 ? "s" : ""} selected
                {consolidate && uniqueSuppliers > 0
                  ? ` · ${uniqueSuppliers} supplier payment${uniqueSuppliers !== 1 ? "s" : ""}`
                  : ""}
              </p>
              <p className="text-xl font-bold text-[var(--dpf-text)] mt-1">
                GBP {formatMoney(total)}
              </p>
            </div>
            <button
              onClick={() => setConfirming(true)}
              disabled={loading}
              className="px-4 py-2 rounded-md text-sm font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              Execute Payment Run
            </button>
          </div>
        </div>
      )}

      {/* Confirmation dialog */}
      {confirming && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-[var(--dpf-text)] mb-2">
              Confirm Payment Run
            </h3>
            <p className="text-sm text-[var(--dpf-muted)] mb-4">
              This will pay{" "}
              <span className="text-[var(--dpf-text)] font-semibold">
                {selectedIds.size} bill{selectedIds.size !== 1 ? "s" : ""}
              </span>{" "}
              totalling{" "}
              <span className="text-[var(--dpf-text)] font-semibold">
                GBP {formatMoney(total)}
              </span>
              . This action cannot be undone.
            </p>
            {error && <p className="text-xs text-[#ef4444] mb-4">{error}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => setConfirming(false)}
                disabled={loading}
                className="flex-1 px-4 py-2 rounded-md text-sm border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleExecute}
                disabled={loading}
                className="flex-1 px-4 py-2 rounded-md text-sm font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {loading ? "Processing…" : "Confirm & Pay"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
