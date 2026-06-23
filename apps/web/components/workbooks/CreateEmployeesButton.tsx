"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createEmployeesFromTableAction } from "@/lib/actions/workbooks";

// EP-ONBOARDING-INTAKE P4 (grid convergence): commit the rows of an edited
// workbook table into EmployeeProfile records. Shown on custom tables so a roster
// imported + fixed in the grid becomes real employees in one click. The grid edit
// is the review step; this is the explicit "create" action.
export function CreateEmployeesButton({ tableId }: { tableId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  function onClick() {
    setMessage(null);
    setIsError(false);
    startTransition(async () => {
      const res = await createEmployeesFromTableAction(tableId);
      if (!res.ok) {
        setIsError(true);
        setMessage(res.error);
        return;
      }
      const d = res.data;
      setMessage(
        `Added ${d.created} ${d.created === 1 ? "person" : "people"}` +
          (d.skippedExisting ? `, skipped ${d.skippedExisting} already on file` : "") +
          (d.failed ? `, ${d.failed} could not be added` : "") +
          ".",
      );
      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={onClick}
        className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-text)] disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create employees from this sheet"}
      </button>
      {message && (
        <span className={`text-sm ${isError ? "text-[var(--dpf-error)]" : "text-[var(--dpf-muted)]"}`}>
          {message}
        </span>
      )}
    </span>
  );
}
