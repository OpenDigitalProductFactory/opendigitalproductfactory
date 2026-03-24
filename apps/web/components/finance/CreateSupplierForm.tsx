"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupplier } from "@/lib/actions/ap";

const inputClasses =
  "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] rounded px-3 py-2 text-sm focus:border-[var(--dpf-accent)] focus:outline-none placeholder:text-[var(--dpf-muted)] w-full";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

export function CreateSupplierForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [taxId, setTaxId] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("Net 30");
  const [defaultCurrency, setDefaultCurrency] = useState("USD");
  const [notes, setNotes] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Supplier name is required.");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      await createSupplier({
        name: name.trim(),
        contactName: contactName.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        taxId: taxId.trim() || undefined,
        paymentTerms,
        defaultCurrency,
        notes: notes.trim() || undefined,
      });
      router.push("/finance/suppliers");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create supplier");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label className={labelClasses}>Supplier Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Supplies Ltd"
            required
            className={inputClasses}
          />
        </div>
        <div>
          <label className={labelClasses}>Contact Name</label>
          <input
            type="text"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="e.g. John Smith"
            className={inputClasses}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label className={labelClasses}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="accounts@supplier.com"
            className={inputClasses}
          />
        </div>
        <div>
          <label className={labelClasses}>Phone</label>
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 123 4567"
            className={inputClasses}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label className={labelClasses}>Tax ID</label>
          <input
            type="text"
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            placeholder="e.g. EIN or VAT number"
            className={inputClasses}
          />
        </div>
        <div>
          <label className={labelClasses}>Payment Terms</label>
          <select
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(e.target.value)}
            className={inputClasses}
          >
            <option value="Net 7">Net 7</option>
            <option value="Net 14">Net 14</option>
            <option value="Net 30">Net 30</option>
            <option value="Net 45">Net 45</option>
            <option value="Net 60">Net 60</option>
            <option value="Due on Receipt">Due on Receipt</option>
          </select>
        </div>
      </div>

      <div className="max-w-xs">
        <label className={labelClasses}>Default Currency</label>
        <select
          value={defaultCurrency}
          onChange={(e) => setDefaultCurrency(e.target.value)}
          className={inputClasses}
        >
          <option value="USD">USD</option>
          <option value="GBP">GBP</option>
          <option value="EUR">EUR</option>
          <option value="CAD">CAD</option>
          <option value="AUD">AUD</option>
        </select>
      </div>

      <div>
        <label className={labelClasses}>Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes about this supplier"
          rows={3}
          className={inputClasses}
        />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="px-4 py-2 rounded-md text-sm font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {loading ? "Creating..." : "Add Supplier"}
      </button>
    </form>
  );
}
