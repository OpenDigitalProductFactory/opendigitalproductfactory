"use client";

// Rate-card admin (EP-LABOR-ECONOMICS Phase 4): "What services do you bill
// labour as?" — a short list of named hourly rates with an active toggle.
// Rows price billable timesheet hours when an invoice is generated.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertBillableRate } from "@/lib/actions/labor";

export type RateCardRow = {
  id: string;
  name: string;
  billRate: number;
  isActive: boolean;
};

type Props = {
  rates: RateCardRow[];
  /** Org base currency code — display only. */
  currency: string;
};

const inputCls =
  "px-2 py-1 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-[var(--dpf-text)]";

export function RateCardManager({ rates, currency }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  // Add-a-service row
  const [newName, setNewName] = useState("");
  const [newRate, setNewRate] = useState("");

  // Inline edit state (one row at a time keeps the list calm)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRate, setEditRate] = useState("");

  function run(input: Parameters<typeof upsertBillableRate>[0], after?: () => void) {
    startTransition(async () => {
      const result = await upsertBillableRate(input);
      setMessage(result.message);
      if (result.ok) {
        after?.();
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">What do you bill labour as?</h2>
        <p className="text-xs text-[var(--dpf-muted)] mt-1">
          Each service has an hourly rate. Your team picks one when they mark timesheet hours as
          billable, and invoices price the hours from this list.
        </p>
      </div>

      {rates.length === 0 ? (
        <p className="text-xs text-[var(--dpf-muted)]">
          No services yet — add your first one below, e.g. “Standard labour”.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rates.map((rate) => (
            <li
              key={rate.id}
              className="flex flex-wrap items-center gap-2 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2"
            >
              {editingId === rate.id ? (
                <>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className={`${inputCls} w-44`}
                    aria-label="Service name"
                  />
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={editRate}
                    onChange={(e) => setEditRate(e.target.value)}
                    className={`${inputCls} w-24`}
                    aria-label={`Rate per hour (${currency})`}
                  />
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() =>
                      run(
                        {
                          id: rate.id,
                          name: editName,
                          billRate: parseFloat(editRate) || 0,
                          isActive: rate.isActive,
                        },
                        () => setEditingId(null),
                      )
                    }
                    className="text-[11px] px-2 py-1 rounded border border-[var(--dpf-accent)]/40 text-[var(--dpf-accent)] hover:bg-[var(--dpf-accent)]/10 disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="text-[11px] px-2 py-1 rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="text-xs font-medium text-[var(--dpf-text)]">{rate.name}</span>
                  <span className="text-xs text-[var(--dpf-muted)]">
                    {currency} {rate.billRate.toLocaleString()} / hour
                  </span>
                  {!rate.isActive && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--dpf-surface-1)] text-[var(--dpf-muted)]">
                      Off
                    </span>
                  )}
                  <span className="flex-1" />
                  <label className="flex items-center gap-1.5 text-[10px] text-[var(--dpf-muted)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rate.isActive}
                      disabled={isPending}
                      onChange={(e) =>
                        run({
                          id: rate.id,
                          name: rate.name,
                          billRate: rate.billRate,
                          isActive: e.target.checked,
                        })
                      }
                    />
                    Active
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(rate.id);
                      setEditName(rate.name);
                      setEditRate(String(rate.billRate));
                    }}
                    className="text-[11px] px-2 py-1 rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
                  >
                    Edit
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--dpf-border)]">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Service name, e.g. Standard labour"
          className={`${inputCls} w-56 placeholder:text-[var(--dpf-muted)]`}
          aria-label="New service name"
        />
        <input
          type="number"
          min={0}
          step={0.5}
          value={newRate}
          onChange={(e) => setNewRate(e.target.value)}
          placeholder={`Rate (${currency}/hour)`}
          className={`${inputCls} w-32 placeholder:text-[var(--dpf-muted)]`}
          aria-label={`New service rate per hour (${currency})`}
        />
        <button
          type="button"
          disabled={isPending || !newName.trim() || !(parseFloat(newRate) > 0)}
          onClick={() =>
            run(
              { name: newName, billRate: parseFloat(newRate) || 0, isActive: true },
              () => {
                setNewName("");
                setNewRate("");
              },
            )
          }
          className="text-[11px] px-3 py-1.5 rounded border border-[var(--dpf-accent)]/40 text-[var(--dpf-accent)] hover:bg-[var(--dpf-accent)]/10 disabled:opacity-50"
        >
          Add service
        </button>
        {message && <span className="text-[11px] text-[var(--dpf-muted)]">{message}</span>}
      </div>
    </div>
  );
}
