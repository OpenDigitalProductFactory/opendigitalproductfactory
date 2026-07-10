"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, StatusBadge, type Column } from "@/components/ui/report-kit";
import { LocalTime } from "@/components/ui/LocalTime";
import { confirmDialog } from "@/components/ui/Dialog";
import { forgetMyFact } from "@/lib/actions/memory-audit";
import type { MemoryAuditRow } from "@/lib/actions/memory-audit-shape";

// Self-serve "what your coworker remembers about you" table with a per-item
// Forget affordance (BI-DC8B03AB). Destructive step goes through the themed
// confirmDialog — never a native window.confirm (AGENTS.md §12).

export function MyMemoryAuditClient({ rows }: { rows: MemoryAuditRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function onForget(row: MemoryAuditRow) {
    const ok = await confirmDialog({
      title: "Forget this?",
      message: `Your coworker will forget "${row.label}: ${row.value}". This can't be undone.`,
      tone: "danger",
      confirmLabel: "Forget",
    });
    if (!ok) return;
    setBusyId(row.id);
    try {
      await forgetMyFact(row.id);
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<MemoryAuditRow>[] = [
    {
      key: "label",
      header: "What it remembers",
      cell: (row) => (
        <span className="text-[var(--dpf-text)]">
          {row.label}: {row.value}
        </span>
      ),
      sortAccessor: (row) => row.label,
    },
    {
      key: "scope",
      header: "Visible to",
      cell: (row) =>
        row.scope === "org" ? (
          <StatusBadge intent="info" label="Your team" />
        ) : (
          <StatusBadge intent="neutral" label="Just you" />
        ),
      sortAccessor: (row) => row.scope,
    },
    {
      key: "sensitive",
      header: "Sensitive",
      cell: (row) =>
        row.sensitive ? <StatusBadge intent="warning" label="Sensitive" /> : <span className="text-[var(--dpf-muted)]">—</span>,
    },
    {
      key: "provenance",
      header: "Source",
      cell: (row) => <span className="text-[var(--dpf-muted)] text-xs">{row.provenance}</span>,
    },
    {
      key: "createdAt",
      header: "Since",
      cell: (row) => <LocalTime value={row.createdAt} />,
      sortAccessor: (row) => row.createdAt.getTime(),
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <button
          type="button"
          onClick={() => onForget(row)}
          disabled={busyId === row.id}
          data-dialog-action="forget"
          className="text-xs px-2 py-1 rounded border border-[var(--dpf-border)] text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] disabled:opacity-50"
        >
          {busyId === row.id ? "Forgetting…" : "Forget"}
        </button>
      ),
    },
  ];

  return <DataTable rows={rows} columns={columns} getRowKey={(row) => row.id} />;
}
