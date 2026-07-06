"use client";

// Compensation on the employee record (EP-LABOR-ECONOMICS Phase 4).
// Plain-language pay setup: pick a person, say whether they're paid hourly or
// salaried, enter one number. Standard annual hours (the salary→hourly cost
// divisor) stays behind an advanced disclosure with a sensible default.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setEmployeeCompensation } from "@/lib/actions/workforce";
import type { EmployeeCompensationRow } from "@/lib/hr/compensation-data";

type Props = {
  employees: EmployeeCompensationRow[];
  /** Org base currency code, e.g. "GBP" — display only. */
  currency: string;
};

const inputCls =
  "w-32 px-2 py-1 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-[var(--dpf-text)]";

function describePay(e: EmployeeCompensationRow, currency: string): string {
  if (e.payType === "hourly" && e.hourlyRate != null) {
    return `Paid hourly — ${currency} ${e.hourlyRate.toLocaleString()} per hour`;
  }
  if (e.payType === "salary" && e.annualSalary != null) {
    return `Salaried — ${currency} ${e.annualSalary.toLocaleString()} per year`;
  }
  return "Pay not set yet";
}

export function CompensationPanel({ employees, currency }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState(employees[0]?.employeeProfileId ?? "");
  const selected = useMemo(
    () => employees.find((e) => e.employeeProfileId === selectedId) ?? null,
    [employees, selectedId],
  );

  const [payType, setPayType] = useState<"hourly" | "salary">(selected?.payType ?? "hourly");
  const [hourlyRate, setHourlyRate] = useState<string>(selected?.hourlyRate?.toString() ?? "");
  const [annualSalary, setAnnualSalary] = useState<string>(selected?.annualSalary?.toString() ?? "");
  const [standardHours, setStandardHours] = useState<string>(
    selected?.standardAnnualHours?.toString() ?? "",
  );
  const [message, setMessage] = useState<string | null>(null);

  function selectEmployee(id: string) {
    setSelectedId(id);
    const e = employees.find((emp) => emp.employeeProfileId === id) ?? null;
    setPayType(e?.payType ?? "hourly");
    setHourlyRate(e?.hourlyRate?.toString() ?? "");
    setAnnualSalary(e?.annualSalary?.toString() ?? "");
    setStandardHours(e?.standardAnnualHours?.toString() ?? "");
    setMessage(null);
  }

  function handleSave() {
    if (!selected) return;
    startTransition(async () => {
      const result = await setEmployeeCompensation({
        employeeProfileId: selected.employeeProfileId,
        payType,
        ...(payType === "hourly"
          ? { hourlyRate: parseFloat(hourlyRate) || 0 }
          : {
              annualSalary: parseFloat(annualSalary) || 0,
              standardAnnualHours: standardHours ? parseInt(standardHours, 10) || null : null,
            }),
      });
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  return (
    <section className="rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Pay</h2>
        <p className="text-xs text-[var(--dpf-muted)] mt-1">
          How each person is paid. This feeds payroll and what your labour costs on jobs.
        </p>
      </div>

      {employees.length === 0 ? (
        <p className="text-xs text-[var(--dpf-muted)]">Add an employee first, then set their pay here.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedId}
              onChange={(e) => selectEmployee(e.target.value)}
              className="px-2 py-1 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] max-w-56"
              aria-label="Employee"
            >
              {employees.map((e) => (
                <option key={e.employeeProfileId} value={e.employeeProfileId} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                  {e.displayName}
                </option>
              ))}
            </select>
            {selected && (
              <span className="text-[10px] text-[var(--dpf-muted)]">{describePay(selected, currency)}</span>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-[var(--dpf-text)]">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="payType"
                checked={payType === "hourly"}
                onChange={() => setPayType("hourly")}
              />
              Paid hourly
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="payType"
                checked={payType === "salary"}
                onChange={() => setPayType("salary")}
              />
              Salaried
            </label>
          </div>

          {payType === "hourly" ? (
            <label className="flex items-center gap-2 text-xs text-[var(--dpf-text)]">
              Hourly pay rate ({currency})
              <input
                type="number"
                min={0}
                step={0.5}
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                className={inputCls}
              />
            </label>
          ) : (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-[var(--dpf-text)]">
                Annual salary ({currency})
                <input
                  type="number"
                  min={0}
                  step={500}
                  value={annualSalary}
                  onChange={(e) => setAnnualSalary(e.target.value)}
                  className={inputCls}
                />
              </label>
              <details className="text-xs">
                <summary className="cursor-pointer text-[var(--dpf-muted)]">Advanced</summary>
                <label className="mt-2 flex items-center gap-2 text-xs text-[var(--dpf-text)]">
                  Standard hours per year
                  <input
                    type="number"
                    min={1}
                    max={8760}
                    step={1}
                    placeholder="2080"
                    value={standardHours}
                    onChange={(e) => setStandardHours(e.target.value)}
                    className={inputCls}
                  />
                </label>
                <p className="mt-1 text-[10px] text-[var(--dpf-muted)]">
                  Used to work out an hourly cost for job pricing. Leave blank for 2,080 (40 hours × 52 weeks).
                </p>
              </details>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isPending || !selected}
              onClick={handleSave}
              className="text-[11px] px-3 py-1.5 rounded border border-[var(--dpf-accent)]/40 text-[var(--dpf-accent)] hover:bg-[var(--dpf-accent)]/10 disabled:opacity-50"
            >
              Save pay
            </button>
            {message && <span className="text-[11px] text-[var(--dpf-muted)]">{message}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
