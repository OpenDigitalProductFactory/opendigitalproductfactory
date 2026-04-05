"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createExpenseClaim, submitExpenseClaim } from "@/lib/actions/expenses";
import { EXPENSE_CATEGORIES, createExpenseClaimSchema } from "@/lib/expense-validation";

const inputClasses =
  "bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-text)] rounded px-3 py-2 text-sm focus:border-[var(--dpf-accent)] focus:outline-none placeholder:text-[var(--dpf-muted)]";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

interface ExpenseItem {
  date: string;
  category: string;
  description: string;
  amount: string;
  receiptUrl: string;
}

function getToday(): string {
  return new Date().toISOString().split("T")[0]!;
}

interface CreateExpenseFormProps {
  currencySymbol: string;
}

export function CreateExpenseForm({ currencySymbol }: CreateExpenseFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<"draft" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ExpenseItem[]>([
    { date: getToday(), category: "travel", description: "", amount: "", receiptUrl: "" },
  ]);

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      { date: getToday(), category: "travel", description: "", amount: "", receiptUrl: "" },
    ]);
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof ExpenseItem, value: string) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  };

  const liveTotal = items.reduce((sum, item) => {
    const amount = parseFloat(item.amount) || 0;
    return sum + amount;
  }, 0);

  const formatMoney = (n: number) =>
    n.toLocaleString("en-GB", { minimumFractionDigits: 2 });

  function buildInput() {
    return createExpenseClaimSchema.parse({
      title,
      notes: notes || undefined,
      items: items.map((item) => ({
        date: item.date,
        category: item.category,
        description: item.description,
        amount: parseFloat(item.amount) || 0,
        receiptUrl: item.receiptUrl || undefined,
      })),
    });
  }

  async function handleSaveDraft(e: React.FormEvent) {
    e.preventDefault();
    setLoading("draft");
    setError(null);
    try {
      await createExpenseClaim(buildInput());
      router.push("/finance/my-expenses");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save draft");
    } finally {
      setLoading(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading("submit");
    setError(null);
    try {
      const claim = await createExpenseClaim(buildInput());
      await submitExpenseClaim(claim.id);
      router.push("/finance/my-expenses");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit claim");
    } finally {
      setLoading(null);
    }
  }

  const isDisabled = loading !== null;

  return (
    <form className="space-y-6">
      {/* Title */}
      <div>
        <label className={labelClasses}>Title *</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="e.g. Client visit expenses — March 2026"
          className={inputClasses + " w-full"}
        />
      </div>

      {/* Expense items */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Expense Items
          </h2>
          <button
            type="button"
            onClick={addItem}
            className="text-xs text-[var(--dpf-accent)] hover:underline"
          >
            + Add item
          </button>
        </div>

        <div className="space-y-4">
          {items.map((item, idx) => (
            <div
              key={idx}
              className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
                  Item {idx + 1}
                </span>
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-error)] transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div>
                  <label className={labelClasses}>Date *</label>
                  <input
                    type="date"
                    value={item.date}
                    onChange={(e) => updateItem(idx, "date", e.target.value)}
                    required
                    className={inputClasses + " w-full"}
                  />
                </div>
                <div>
                  <label className={labelClasses}>Category *</label>
                  <select
                    value={item.category}
                    onChange={(e) => updateItem(idx, "category", e.target.value)}
                    required
                    className={inputClasses + " w-full"}
                  >
                    {EXPENSE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClasses}>Amount ({currencySymbol}) *</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={item.amount}
                    onChange={(e) => updateItem(idx, "amount", e.target.value)}
                    required
                    placeholder="0.00"
                    className={inputClasses + " w-full"}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div>
                  <label className={labelClasses}>Description *</label>
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) => updateItem(idx, "description", e.target.value)}
                    required
                    placeholder="Brief description of expense"
                    className={inputClasses + " w-full"}
                  />
                </div>
                <div>
                  <label className={labelClasses}>Receipt URL (optional)</label>
                  <input
                    type="url"
                    value={item.receiptUrl}
                    onChange={(e) => updateItem(idx, "receiptUrl", e.target.value)}
                    placeholder="https://…"
                    className={inputClasses + " w-full"}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Live total */}
        <div className="mt-4 pt-4 border-t border-[var(--dpf-border)] flex justify-end">
          <p className="text-sm font-bold text-[var(--dpf-text)]">
            Total: {currencySymbol}{formatMoney(liveTotal)}
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
          placeholder="Any additional notes for the approver…"
          className={inputClasses + " w-full resize-none"}
        />
      </div>

      {error && <p className="text-sm text-[var(--dpf-error)]">{error}</p>}

      {/* Action buttons */}
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
          disabled={isDisabled}
          onClick={handleSaveDraft}
          className="px-4 py-2 rounded-md text-sm font-medium border border-[var(--dpf-border)] text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] transition-colors disabled:opacity-50"
        >
          {loading === "draft" ? "Saving…" : "Save as Draft"}
        </button>
        <button
          type="submit"
          disabled={isDisabled}
          onClick={handleSubmit}
          className="px-4 py-2 rounded-md text-sm font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {loading === "submit" ? "Submitting…" : "Submit for Approval"}
        </button>
      </div>
    </form>
  );
}
