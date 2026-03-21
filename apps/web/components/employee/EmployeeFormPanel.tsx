// apps/web/components/employee/EmployeeFormPanel.tsx
"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createEmployeeProfile,
  updateEmployeeProfile,
  type EmployeeProfileInput,
} from "@/lib/actions/workforce";
import type { WorkforceStatus, EmployeeProfileRecord } from "@/lib/workforce-types";
import type { AddressWithHierarchy } from "@/lib/address-types";
import AddressSection from "@/components/employee/AddressSection";
import { DatePicker } from "@/components/ui/DatePicker";

const HIRE_STATUSES: WorkforceStatus[] = ["offer", "onboarding", "active"];

type RefOption = { id: string; label: string };

type Props = {
  isOpen: boolean;
  onClose: () => void;
  employee?: EmployeeProfileRecord | null;
  departments: RefOption[];
  positions: RefOption[];
  workLocations: RefOption[];
  employmentTypes: RefOption[];
  existingEmployees: RefOption[];
  addresses?: AddressWithHierarchy[];
};

function generateEmployeeId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `EMP-${ts}-${rand}`;
}

function emptyForm(): EmployeeProfileInput {
  return {
    employeeId: generateEmployeeId(),
    firstName: "",
    lastName: "",
    displayName: "",
    workEmail: "",
    personalEmail: "",
    phoneWork: "",
    phoneMobile: "",
    phoneEmergency: "",
    status: "offer",
    departmentId: null,
    positionId: null,
    employmentTypeId: null,
    workLocationId: null,
    managerEmployeeId: null,
    startDate: null,
  };
}

function formFromEmployee(emp: EmployeeProfileRecord): EmployeeProfileInput {
  return {
    employeeProfileId: emp.id,
    employeeId: emp.employeeId,
    firstName: emp.firstName,
    lastName: emp.lastName,
    displayName: emp.displayName,
    workEmail: emp.workEmail ?? "",
    personalEmail: emp.personalEmail ?? "",
    phoneWork: emp.phoneWork ?? "",
    phoneMobile: emp.phoneMobile ?? "",
    phoneEmergency: emp.phoneEmergency ?? "",
    status: emp.status,
    departmentId: emp.departmentId,
    positionId: emp.positionId,
    employmentTypeId: null, // not on EmployeeProfileRecord; keep current
    workLocationId: emp.workLocationId,
    managerEmployeeId: emp.managerEmployeeId,
    startDate: emp.startDate,
  };
}

export function EmployeeFormPanel({
  isOpen,
  onClose,
  employee,
  departments,
  positions,
  workLocations,
  employmentTypes,
  existingEmployees,
  addresses = [],
}: Props) {
  const router = useRouter();
  const isEdit = Boolean(employee);
  const [form, setForm] = useState<EmployeeProfileInput>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (employee) {
      setForm(formFromEmployee(employee));
    } else {
      setForm(emptyForm());
    }
    setError(null);
  }, [employee, isOpen]);

  function setField<K extends keyof EmployeeProfileInput>(
    key: K,
    value: EmployeeProfileInput[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.firstName.trim()) {
      setError("First name is required.");
      return;
    }
    if (!form.lastName.trim()) {
      setError("Last name is required.");
      return;
    }
    setError(null);

    startTransition(async () => {
      try {
        const payload: EmployeeProfileInput = {
          ...form,
          startDate: form.startDate ? new Date(form.startDate) : null,
        };
        const result = isEdit
          ? await updateEmployeeProfile(payload)
          : await createEmployeeProfile(payload);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        router.refresh();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  }

  if (!isOpen) return null;

  const inputClasses =
    "bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)]";
  const labelClasses =
    "text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-8 pointer-events-none">
        <div className="w-3/4 max-w-3xl max-h-[85vh] bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg flex flex-col shadow-2xl pointer-events-auto">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--dpf-border)]">
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">
              {isEdit ? "Edit Employee" : "New Employee"}
            </h2>
            <button
              onClick={onClose}
              className="text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] text-lg leading-none"
            >
              &times;
            </button>
          </div>

          {/* Form */}
          <form
            onSubmit={handleSubmit}
            className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4"
          >
            {/* Name row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <label className="flex flex-col gap-1">
                <span className={labelClasses}>First Name *</span>
                <input
                  type="text"
                  value={form.firstName}
                  onChange={(e) => setField("firstName", e.target.value)}
                  className={inputClasses}
                  placeholder="Jane"
                  required
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClasses}>Last Name *</span>
                <input
                  type="text"
                  value={form.lastName}
                  onChange={(e) => setField("lastName", e.target.value)}
                  className={inputClasses}
                  placeholder="Doe"
                  required
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClasses}>Display Name *</span>
                <input
                  type="text"
                  value={form.displayName ?? ""}
                  onChange={(e) => setField("displayName", e.target.value)}
                  className={inputClasses}
                  placeholder="Jane Doe"
                />
              </label>
            </div>

            {/* Email row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span className={labelClasses}>Work Email</span>
                <input
                  type="email"
                  value={form.workEmail ?? ""}
                  onChange={(e) => setField("workEmail", e.target.value)}
                  className={inputClasses}
                  placeholder="jane@company.com"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClasses}>Personal Email</span>
                <input
                  type="email"
                  value={form.personalEmail ?? ""}
                  onChange={(e) => setField("personalEmail", e.target.value)}
                  className={inputClasses}
                  placeholder="jane@personal.com"
                />
              </label>
            </div>

            {/* Phone row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <label className="flex flex-col gap-1">
                <span className={labelClasses}>Work Phone</span>
                <input
                  type="tel"
                  value={form.phoneWork ?? ""}
                  onChange={(e) => setField("phoneWork", e.target.value)}
                  className={inputClasses}
                  placeholder="+14155551234"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClasses}>Mobile Phone</span>
                <input
                  type="tel"
                  value={form.phoneMobile ?? ""}
                  onChange={(e) => setField("phoneMobile", e.target.value)}
                  className={inputClasses}
                  placeholder="+14155551234"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClasses}>Emergency Phone</span>
                <input
                  type="tel"
                  value={form.phoneEmergency ?? ""}
                  onChange={(e) => setField("phoneEmergency", e.target.value)}
                  className={inputClasses}
                  placeholder="+14155551234"
                />
              </label>
            </div>

            {/* Status + Start Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span className={labelClasses}>Status *</span>
                <select
                  value={form.status}
                  onChange={(e) =>
                    setField("status", e.target.value as WorkforceStatus)
                  }
                  className={inputClasses}
                >
                  {HIRE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-col gap-1">
                <span className={labelClasses}>Start Date</span>
                <DatePicker
                  value={form.startDate ? new Date(form.startDate) : null}
                  onChange={(d) =>
                    setField("startDate", d ?? null)
                  }
                  placeholder="Select start date"
                />
              </div>
            </div>

            {/* Org assignment row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span className={labelClasses}>Department</span>
                <select
                  value={form.departmentId ?? ""}
                  onChange={(e) =>
                    setField("departmentId", e.target.value || null)
                  }
                  className={inputClasses}
                >
                  <option value="">-- None --</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClasses}>Position</span>
                <select
                  value={form.positionId ?? ""}
                  onChange={(e) =>
                    setField("positionId", e.target.value || null)
                  }
                  className={inputClasses}
                >
                  <option value="">-- None --</option>
                  {positions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span className={labelClasses}>Employment Type</span>
                <select
                  value={form.employmentTypeId ?? ""}
                  onChange={(e) =>
                    setField("employmentTypeId", e.target.value || null)
                  }
                  className={inputClasses}
                >
                  <option value="">-- None --</option>
                  {employmentTypes.map((et) => (
                    <option key={et.id} value={et.id}>
                      {et.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClasses}>Work Location</span>
                <select
                  value={form.workLocationId ?? ""}
                  onChange={(e) =>
                    setField("workLocationId", e.target.value || null)
                  }
                  className={inputClasses}
                >
                  <option value="">-- None --</option>
                  {workLocations.map((wl) => (
                    <option key={wl.id} value={wl.id}>
                      {wl.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Manager */}
            <label className="flex flex-col gap-1">
              <span className={labelClasses}>Manager</span>
              <select
                value={form.managerEmployeeId ?? ""}
                onChange={(e) =>
                  setField("managerEmployeeId", e.target.value || null)
                }
                className={inputClasses}
              >
                <option value="">-- None --</option>
                {existingEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.label}
                  </option>
                ))}
              </select>
            </label>

            {/* Addresses (only shown when editing an existing employee) */}
            {isEdit && employee && (
              <AddressSection
                employeeProfileId={employee.id}
                addresses={addresses}
              />
            )}

            {error && <p className="text-xs text-red-400">{error}</p>}
          </form>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-[var(--dpf-border)] flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded border border-[var(--dpf-border)] text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={isPending}
              className="flex-1 py-2 rounded bg-[var(--dpf-accent)] text-xs text-white font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {isPending
                ? "Saving..."
                : isEdit
                  ? "Save Changes"
                  : "Create Employee"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
