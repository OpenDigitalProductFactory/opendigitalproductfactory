"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startTeamSheetImportAction } from "@/lib/actions/workbooks";

// Optional onboarding accelerator (EP-ONBOARDING-INTAKE P4): upload a team
// spreadsheet (CSV or Excel) and open it in the in-platform editable grid. The
// operator fixes anything in the grid, then clicks "Create employees from this
// sheet" — load → edit → save, reusing the Universal Grid rather than a
// read-only preview. Failure here never blocks setup.
export function RosterImport() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onFile(file: File) {
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    startTransition(async () => {
      const res = await startTeamSheetImportAction(fd);
      if (inputRef.current) inputRef.current.value = "";
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/workbooks/${res.data.workbookId}?table=${res.data.tableId}`);
    });
  }

  return (
    <div style={{ fontSize: 13 }}>
      <label htmlFor="roster-import-file" style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
        Add your team from a spreadsheet{" "}
        <span style={{ fontWeight: 400, color: "var(--dpf-muted)" }}>(optional)</span>
      </label>
      <input
        id="roster-import-file"
        ref={inputRef}
        type="file"
        accept=".csv,.tsv,.xlsx"
        aria-label="Upload a team spreadsheet"
        disabled={pending}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
        style={{ fontSize: 13, color: "var(--dpf-text)" }}
      />
      <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 4 }}>
        Upload a CSV or Excel file of your people. It opens in an editable grid — fix anything that
        looks off, then click &quot;Create employees from this sheet&quot;. Nothing is created until you do.
      </div>
      {pending && <p style={{ color: "var(--dpf-muted)", fontSize: 12, margin: "6px 0 0" }}>Opening the grid…</p>}
      {error && <p style={{ color: "var(--dpf-error)", fontSize: 12, margin: "6px 0 0" }}>{error}</p>}
    </div>
  );
}
