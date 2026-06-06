"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createWorkbookAction } from "@/lib/actions/workbooks";

export function CreateWorkbookButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createWorkbookAction({ name: name.trim() });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setName("");
      router.push(`/workbooks/${res.data.workbookId}`);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-[var(--dpf-accent)] px-4 py-2 text-sm text-white"
      >
        + New workbook
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
        placeholder="Workbook name"
        className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)]"
      />
      <button
        type="button"
        onClick={submit}
        disabled={pending || !name.trim()}
        className="rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        Create
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded-md border border-[var(--dpf-border)] px-3 py-2 text-sm text-[var(--dpf-text)]"
      >
        Cancel
      </button>
      {error && <span className="text-sm text-[var(--dpf-error)]">{error}</span>}
    </div>
  );
}
