"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importSheetAction } from "@/lib/actions/workbooks";

/** Upload a spreadsheet (.xlsx or .csv/.tsv) and create a new workbook table from
 *  it (columns + rows inferred). */
export function ImportSheetButton({ workbookId }: { workbookId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMessage(null);
    setIsError(false);
    const fd = new FormData();
    fd.append("file", file);
    startTransition(async () => {
      const res = await importSheetAction(workbookId, fd);
      if (inputRef.current) inputRef.current.value = "";
      if (!res.ok) {
        setIsError(true);
        setMessage(res.error);
        return;
      }
      setMessage(
        `Imported ${res.data.rowCount} rows, ${res.data.columnCount} columns` +
          (res.data.truncated ? " (truncated to the import limit)" : ""),
      );
      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
        className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-text)] disabled:opacity-50"
      >
        {pending ? "Importing…" : "Import sheet"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.csv,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        className="hidden"
        onChange={onFile}
      />
      {message && (
        <span className={`text-sm ${isError ? "text-[var(--dpf-error)]" : "text-[var(--dpf-muted)]"}`}>
          {message}
        </span>
      )}
    </span>
  );
}
