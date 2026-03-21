"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createAsset } from "@/lib/actions/assets";

const inputClasses =
  "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] rounded px-3 py-2 text-sm focus:border-[var(--dpf-accent)] focus:outline-none placeholder:text-[var(--dpf-muted)] w-full";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

const CATEGORIES = ["equipment", "vehicle", "furniture", "IT", "property", "other"] as const;
const DEPRECIATION_METHODS = [
  { value: "straight_line", label: "Straight Line" },
  { value: "reducing_balance", label: "Reducing Balance" },
] as const;
const CURRENCIES = ["GBP", "USD", "EUR"];
const USEFUL_LIFE_SUGGESTIONS = [12, 24, 36, 60, 120];

function getToday(): string {
  return new Date().toISOString().split("T")[0]!;
}

export function CreateAssetForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState<typeof CATEGORIES[number]>("equipment");
  const [purchaseDate, setPurchaseDate] = useState(getToday());
  const [purchaseCost, setPurchaseCost] = useState("");
  const [currency, setCurrency] = useState("GBP");
  const [depreciationMethod, setDepreciationMethod] = useState<"straight_line" | "reducing_balance">("straight_line");
  const [usefulLifeMonths, setUsefulLifeMonths] = useState("");
  const [residualValue, setResidualValue] = useState("0");
  const [location, setLocation] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [notes, setNotes] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await createAsset({
        name,
        category,
        purchaseDate,
        purchaseCost: parseFloat(purchaseCost),
        currency,
        depreciationMethod,
        usefulLifeMonths: parseInt(usefulLifeMonths, 10),
        residualValue: parseFloat(residualValue) || 0,
        location: location || undefined,
        serialNumber: serialNumber || undefined,
        notes: notes || undefined,
      });
      router.push("/finance/assets");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create asset");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="p-3 rounded-lg border border-[#ef4444] bg-[#ef444420] text-xs text-[#ef4444]">
          {error}
        </div>
      )}

      {/* Name */}
      <div>
        <label className={labelClasses}>Asset Name *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClasses}
          placeholder="e.g. Dell XPS 15 Laptop"
          required
        />
      </div>

      {/* Category */}
      <div>
        <label className={labelClasses}>Category *</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as typeof CATEGORIES[number])}
          className={inputClasses}
          required
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.charAt(0).toUpperCase() + c.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* Purchase Date + Currency */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClasses}>Purchase Date *</label>
          <input
            type="date"
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
            className={inputClasses}
            required
          />
        </div>
        <div>
          <label className={labelClasses}>Currency</label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className={inputClasses}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Purchase Cost + Residual Value */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClasses}>Purchase Cost *</label>
          <input
            type="number"
            value={purchaseCost}
            onChange={(e) => setPurchaseCost(e.target.value)}
            className={inputClasses}
            placeholder="0.00"
            min="0.01"
            step="0.01"
            required
          />
        </div>
        <div>
          <label className={labelClasses}>Residual Value</label>
          <input
            type="number"
            value={residualValue}
            onChange={(e) => setResidualValue(e.target.value)}
            className={inputClasses}
            placeholder="0.00"
            min="0"
            step="0.01"
          />
        </div>
      </div>

      {/* Depreciation Method */}
      <div>
        <label className={labelClasses}>Depreciation Method *</label>
        <select
          value={depreciationMethod}
          onChange={(e) => setDepreciationMethod(e.target.value as typeof depreciationMethod)}
          className={inputClasses}
          required
        >
          {DEPRECIATION_METHODS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Useful Life */}
      <div>
        <label className={labelClasses}>Useful Life (months) *</label>
        <div className="flex gap-2 mb-2">
          {USEFUL_LIFE_SUGGESTIONS.map((months) => (
            <button
              key={months}
              type="button"
              onClick={() => setUsefulLifeMonths(String(months))}
              className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                usefulLifeMonths === String(months)
                  ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent)]/10 text-[var(--dpf-text)]"
                  : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
              }`}
            >
              {months}m
            </button>
          ))}
        </div>
        <input
          type="number"
          value={usefulLifeMonths}
          onChange={(e) => setUsefulLifeMonths(e.target.value)}
          className={inputClasses}
          placeholder="e.g. 36"
          min="1"
          step="1"
          required
        />
      </div>

      {/* Location + Serial Number */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClasses}>Location</label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className={inputClasses}
            placeholder="e.g. Head Office"
          />
        </div>
        <div>
          <label className={labelClasses}>Serial Number</label>
          <input
            type="text"
            value={serialNumber}
            onChange={(e) => setSerialNumber(e.target.value)}
            className={inputClasses}
            placeholder="e.g. SN-12345"
          />
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className={labelClasses}>Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={`${inputClasses} resize-none`}
          rows={3}
          placeholder="Optional notes..."
        />
      </div>

      {/* Submit */}
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {loading ? "Adding..." : "Add Asset"}
        </button>
        <a
          href="/finance/assets"
          className="px-4 py-2 rounded-md text-xs font-medium border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
