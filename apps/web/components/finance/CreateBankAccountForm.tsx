"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBankAccount } from "@/lib/actions/banking";

const inputClasses =
  "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] rounded px-3 py-2 text-sm focus:border-[var(--dpf-accent)] focus:outline-none placeholder:text-[var(--dpf-muted)] w-full";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

const ACCOUNT_TYPES = [
  { value: "current", label: "Current Account" },
  { value: "savings", label: "Savings Account" },
  { value: "credit_card", label: "Credit Card" },
  { value: "loan", label: "Loan" },
  { value: "merchant", label: "Merchant Account" },
];

export function CreateBankAccountForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [sortCode, setSortCode] = useState("");
  const [iban, setIban] = useState("");
  const [swift, setSwift] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [accountType, setAccountType] = useState("current");
  const [openingBalance, setOpeningBalance] = useState(0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Account name is required.");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      await createBankAccount({
        name: name.trim(),
        bankName: bankName.trim() || undefined,
        accountNumber: accountNumber.trim() || undefined,
        sortCode: sortCode.trim() || undefined,
        iban: iban.trim() || undefined,
        swift: swift.trim() || undefined,
        currency,
        accountType: accountType as "current" | "savings" | "credit_card" | "loan" | "merchant",
        openingBalance,
      });
      router.push("/finance/banking");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label className={labelClasses}>Account Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Business Current Account"
            required
            className={inputClasses}
          />
        </div>
        <div>
          <label className={labelClasses}>Bank Name</label>
          <input
            type="text"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="e.g. Barclays, Chase"
            className={inputClasses}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label className={labelClasses}>Account Type</label>
          <select
            value={accountType}
            onChange={(e) => setAccountType(e.target.value)}
            className={inputClasses}
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClasses}>Currency</label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className={inputClasses}
          >
            <option value="GBP">GBP</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="CAD">CAD</option>
            <option value="AUD">AUD</option>
            <option value="NZD">NZD</option>
            <option value="CHF">CHF</option>
            <option value="JPY">JPY</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label className={labelClasses}>Account Number</label>
          <input
            type="text"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="12345678"
            className={inputClasses}
          />
        </div>
        <div>
          <label className={labelClasses}>Sort Code</label>
          <input
            type="text"
            value={sortCode}
            onChange={(e) => setSortCode(e.target.value)}
            placeholder="12-34-56"
            className={inputClasses}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label className={labelClasses}>IBAN</label>
          <input
            type="text"
            value={iban}
            onChange={(e) => setIban(e.target.value)}
            placeholder="GB12 BARC 1234 5678 9012 34"
            className={inputClasses}
          />
        </div>
        <div>
          <label className={labelClasses}>SWIFT / BIC</label>
          <input
            type="text"
            value={swift}
            onChange={(e) => setSwift(e.target.value)}
            placeholder="BARCGB22"
            className={inputClasses}
          />
        </div>
      </div>

      <div className="max-w-xs">
        <label className={labelClasses}>Opening Balance</label>
        <input
          type="number"
          step="0.01"
          value={openingBalance}
          onChange={(e) => setOpeningBalance(parseFloat(e.target.value) || 0)}
          className={inputClasses}
        />
        <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
          The current balance in this account. You can adjust this later.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="px-4 py-2 rounded-md text-sm font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {loading ? "Creating..." : "Add Bank Account"}
      </button>
    </form>
  );
}
