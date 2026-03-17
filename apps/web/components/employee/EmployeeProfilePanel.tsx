import type { EmployeeProfileRecord } from "@/lib/workforce-types";

type AddressWithHierarchy = {
  id: string;
  isPrimary: boolean;
  address: {
    id: string;
    label: string;
    addressLine1: string;
    addressLine2: string | null;
    postalCode: string;
    validatedAt: Date | null;
    validationSource: string | null;
    city: {
      id: string;
      name: string;
      region: {
        id: string;
        name: string;
        code: string | null;
        country: { id: string; name: string; iso2: string; phoneCode: string };
      };
    };
  };
};

type Props = {
  employee: EmployeeProfileRecord | null;
  addresses?: AddressWithHierarchy[];
};

function formatDate(value: Date | null): string {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(value);
}

function formatAddress(a: AddressWithHierarchy["address"]): string {
  const parts = [a.addressLine1];
  if (a.addressLine2) parts.push(a.addressLine2);
  parts.push(a.city.name);
  if (a.city.region.code) {
    parts.push(a.city.region.code);
  } else {
    parts.push(a.city.region.name);
  }
  parts.push(a.postalCode);
  parts.push(a.city.region.country.name);
  return parts.join(", ");
}

export function EmployeeProfilePanel({ employee, addresses = [] }: Props) {
  const primaryAddress = addresses.find((a) => a.isPrimary) ?? addresses[0] ?? null;
  return (
    <section className="rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Employee profile</h2>
        <p className="text-xs text-[var(--dpf-muted)] mt-1">
          Current portal-facing workforce record and lifecycle dates.
        </p>
      </div>

      {!employee ? (
        <p className="text-sm text-[var(--dpf-muted)]">Select or link an employee profile to view detailed workforce data.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 space-y-2">
            <p className="text-[10px] font-mono text-[var(--dpf-muted)]">{employee.employeeId}</p>
            <p className="text-base font-semibold text-white">{employee.displayName}</p>
            <p className="text-xs text-[var(--dpf-muted)]">
              {employee.positionTitle ?? "Role pending"} in {employee.departmentName ?? "unassigned department"}
            </p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Work email</dt>
                <dd className="text-white">{employee.workEmail ?? "Not set"}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Location</dt>
                <dd className="text-white">{employee.workLocationName ?? "Not set"}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Manager</dt>
                <dd className="text-white">{employee.managerName ?? "None"}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Timezone</dt>
                <dd className="text-white">{employee.timezone ?? "Not set"}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Status</dt>
                <dd className="text-white">{employee.status}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Start date</dt>
                <dd className="text-white">{formatDate(employee.startDate)}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Confirmation date</dt>
                <dd className="text-white">{formatDate(employee.confirmationDate)}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">End date</dt>
                <dd className="text-white">{formatDate(employee.endDate)}</dd>
              </div>
            </dl>
          </div>

          {/* Contact */}
          <div className="col-span-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] font-semibold">Contact</p>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Work Phone</dt>
                <dd className="text-white">{employee.phoneWork ?? "Not set"}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Mobile Phone</dt>
                <dd className="text-white">{employee.phoneMobile ?? "Not set"}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Emergency Phone</dt>
                <dd className="text-white">{employee.phoneEmergency ?? "Not set"}</dd>
              </div>
            </dl>
            {primaryAddress && (
              <div className="text-xs mt-2">
                <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Primary Address</dt>
                <dd className="text-white mt-0.5">{formatAddress(primaryAddress.address)}</dd>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
