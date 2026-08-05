// apps/web/components/employee/EditEmployeeButton.tsx
//
// The door to EmployeeFormPanel's edit mode (BI-00CB9CCC). The panel has always
// supported editing — `employee` prop -> formFromEmployee() -> updateEmployeeProfile,
// plus AddressSection — but its only caller was NewEmployeeButton, which never
// passes an employee. So `isEdit` was permanently false and the entire edit path
// was unreachable. This is the missing affordance, nothing more.
"use client";

import { useState } from "react";
import { EmployeeFormPanel } from "./EmployeeFormPanel";
import type { EmployeeProfileRecord } from "@/lib/workforce-types";
import type { AddressWithHierarchy } from "@/lib/address-types";

type RefOption = { id: string; label: string };

type Props = {
  employee: EmployeeProfileRecord;
  addresses: AddressWithHierarchy[];
  departments: RefOption[];
  positions: RefOption[];
  workLocations: RefOption[];
  employmentTypes: RefOption[];
  existingEmployees: RefOption[];
};

export function EditEmployeeButton({
  employee,
  addresses,
  departments,
  positions,
  workLocations,
  employmentTypes,
  existingEmployees,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="rounded border border-[var(--dpf-border)] px-2.5 py-1 text-xs font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
      >
        Edit
      </button>

      <EmployeeFormPanel
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        employee={employee}
        addresses={addresses}
        departments={departments}
        positions={positions}
        workLocations={workLocations}
        employmentTypes={employmentTypes}
        // An employee cannot be their own manager; the current record is filtered
        // out of the manager options rather than relying on the server to reject it.
        existingEmployees={existingEmployees.filter((e) => e.id !== employee.id)}
      />
    </>
  );
}
