"use client";

// Compensation on the employee record (EP-LABOR-ECONOMICS Phase 4).
// Plain-language pay setup: pick a person, say whether they're paid hourly or
// salaried, enter one number. Standard annual hours (the salary→hourly cost
// divisor) stays behind an advanced disclosure with a sensible default.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setEmployeeCompensation } from "@/lib/actions/workforce";
import type { EmployeeCompensationRow } from "@/lib/hr/compensation-data";
import {
  SelectField,
  TextField,
  SubmitButton,
  FormStatus,
} from "@/components/ui/form";

type Props = {
  employees: EmployeeCompensationRow[];
  /** Org base currency code, e.g. "GBP" — display only. */
  currency: string;
};

type SaveResult = { ok: boolean; message: string };

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
  const [result, setResult] = useState<SaveResult | null>(null);

  function selectEmployee(id: string) {
    setSelectedId(id);
    const e = employees.find((emp) => emp.employeeProfileId === id) ?? null;
    setPayType(e?.payType ?? "hourly");
    setHourlyRate(e?.hourlyRate?.toString() ?? "");
    setAnnualSalary(e?.annualSalary?.toString() ?? "");
    setStandardHours(e?.standardAnnualHours?.toString() ?? "");
    setResult(null);
  }

  function handleSave() {
    if (!selected) return;
    startTransition(async () => {
      const saved = await setEmployeeCompensation({
        employeeProfileId: selected.employeeProfileId,
        payType,
        ...(payType === "hourly"
          ? { hourlyRate: parseFloat(hourlyRate) || 0 }
          : {
              annualSalary: parseFloat(annualSalary) || 0,
              standardAnnualHours: standardHours ? parseInt(standardHours, 10) || null : null,
            }),
      });
      setResult(saved);
      if (saved.ok) router.refresh();
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
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
          noValidate
          className="space-y-3"
        >
          <SelectField
            name="pay-employee"
            label="Employee"
            value={selectedId}
            onValueChange={selectEmployee}
            options={employees.map((e) => ({ value: e.employeeProfileId, label: e.displayName }))}
          />
          {selected && (
            <p className="text-[11px] text-[var(--dpf-muted)]">{describePay(selected, currency)}</p>
          )}

          <fieldset className="flex items-center gap-3 text-sm text-[var(--dpf-text)]">
            <legend className="text-sm font-medium text-[var(--dpf-text)]">How is this person paid?</legend>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="pay-type"
                checked={payType === "hourly"}
                onChange={() => setPayType("hourly")}
              />
              Paid hourly
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="pay-type"
                checked={payType === "salary"}
                onChange={() => setPayType("salary")}
              />
              Salaried
            </label>
          </fieldset>

          {payType === "hourly" ? (
            <TextField
              name="hourly-rate"
              label={`Hourly pay rate (${currency})`}
              type="number"
              value={hourlyRate}
              onValueChange={setHourlyRate}
              required
              autoComplete="off"
              min={0}
              step={0.5}
              inputClassName="max-w-40"
            />
          ) : (
            <div className="space-y-2">
              <TextField
                name="annual-salary"
                label={`Annual salary (${currency})`}
                type="number"
                value={annualSalary}
                onValueChange={setAnnualSalary}
                required
                autoComplete="off"
                min={0}
                step={500}
                inputClassName="max-w-40"
              />
              <details className="text-xs">
                <summary className="cursor-pointer text-[var(--dpf-muted)]">Advanced</summary>
                <div className="mt-2">
                  <TextField
                    name="standard-annual-hours"
                    label="Standard hours per year"
                    type="number"
                    value={standardHours}
                    onValueChange={setStandardHours}
                    optional
                    autoComplete="off"
                    min={1}
                    max={8760}
                    step={1}
                    placeholder="2080"
                    hint="Used to work out an hourly cost for job pricing. Leave blank for 2,080 (40 hours × 52 weeks)."
                    inputClassName="max-w-40"
                  />
                </div>
              </details>
            </div>
          )}

          <div className="flex items-center gap-3">
            <SubmitButton pending={isPending} pendingLabel="Saving…" disabled={!selected}>
              Save pay
            </SubmitButton>
            <FormStatus
              error={result && !result.ok ? result.message : null}
              success={result?.ok ? result.message : null}
            />
          </div>
        </form>
      )}
    </section>
  );
}
