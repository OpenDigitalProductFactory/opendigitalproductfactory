"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTableAction } from "@/lib/actions/workbooks";

export function CreateTableButton({ workbookId }: { workbookId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createTableAction(workbookId, { name: name.trim() });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setName("");
      router.push(`/workbooks/${workbookId}?table=${res.data.tableId}`);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
      >
        + New table
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) submit();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Table name"
        className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
      />
      <button
        type="button"
        onClick={submit}
        disabled={pending || !name.trim()}
        className="rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        Create
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
      >
        Cancel
      </button>
      {error && <span className="text-sm text-[var(--dpf-error)]">{error}</span>}
    </div>
  );
}
