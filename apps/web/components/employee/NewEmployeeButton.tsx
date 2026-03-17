// apps/web/components/employee/NewEmployeeButton.tsx
"use client";

import { useState } from "react";
import { EmployeeFormPanel } from "./EmployeeFormPanel";

type RefOption = { id: string; label: string };

type Props = {
  departments: RefOption[];
  positions: RefOption[];
  workLocations: RefOption[];
  employmentTypes: RefOption[];
  existingEmployees: RefOption[];
};

export function NewEmployeeButton({
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
        className="px-3 py-1.5 rounded bg-[var(--dpf-accent)] text-xs text-white font-semibold hover:opacity-90"
      >
        + New Employee
      </button>

      <EmployeeFormPanel
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        departments={departments}
        positions={positions}
        workLocations={workLocations}
        employmentTypes={employmentTypes}
        existingEmployees={existingEmployees}
      />
    </>
  );
}
