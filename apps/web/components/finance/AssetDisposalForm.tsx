"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { disposeAsset } from "@/lib/actions/assets";

const inputClasses =
  "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] rounded px-3 py-2 text-sm focus:border-[var(--dpf-accent)] focus:outline-none placeholder:text-[var(--dpf-muted)] w-full";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

interface Props {
  assetId: string;
  currentBookValue: number;
  currencySymbol: string;
}

export function AssetDisposalForm({ assetId, currentBookValue, currencySymbol }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disposalAmount, setDisposalAmount] = useState(currentBookValue.toFixed(2));
  const [disposedAt, setDisposedAt] = useState(new Date().toISOString().split("T")[0]!);

  async function handleDispose(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await disposeAsset(assetId, {
        disposalAmount: parseFloat(disposalAmount),
        disposedAt,
      });
      router.push("/finance/assets");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dispose asset");
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--dpf-error)] text-[var(--dpf-error)] hover:bg-[color-mix(in_srgb,var(--dpf-error)_12%,transparent)] transition-colors"
      >
        Dispose Asset
      </button>
    );
  }

  return (
    <div className="p-4 rounded-lg border border-[var(--dpf-error)] bg-[var(--dpf-surface-1)] w-72">
      <p className="text-xs font-semibold text-[var(--dpf-text)] mb-3">Dispose Asset</p>

      {error && (
        <div className="p-2 rounded border border-[var(--dpf-error)] bg-[color-mix(in_srgb,var(--dpf-error)_12%,transparent)] text-[10px] text-[var(--dpf-error)] mb-3">
          {error}
        </div>
      )}

      <form onSubmit={handleDispose} className="space-y-3">
        <div>
          <label className={labelClasses}>Disposal Amount</label>
          <input
            type="number"
            value={disposalAmount}
            onChange={(e) => setDisposalAmount(e.target.value)}
            className={inputClasses}
            min="0"
            step="0.01"
            required
          />
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
            Book value: {currencySymbol}{currentBookValue.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div>
          <label className={labelClasses}>Disposal Date</label>
          <input
            type="date"
            value={disposedAt}
            onChange={(e) => setDisposedAt(e.target.value)}
            className={inputClasses}
            required
          />
        </div>
        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={loading}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-error)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? "Disposing..." : "Confirm Disposal"}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
