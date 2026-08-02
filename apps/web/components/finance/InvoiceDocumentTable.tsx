"use client";

import { DataTable, type Column } from "@/components/ui/report-kit/DataTable";
import { LocalTime } from "@/components/ui/LocalTime";

export type InvoiceDocumentRow = {
  id: string;
  revision: number;
  role: string;
  sentToEmail: string | null;
  createdAt: string | Date;
  sizeBytes: number | null;
};

const ROLE_LABELS: Record<string, string> = {
  "sent-copy": "Sent copy",
  "signed-copy": "Signed copy",
  "credit-note": "Credit note",
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Thin client child so the server component can still use report-kit's DataTable,
 * which is interactive and therefore client-only.
 */
export function InvoiceDocumentTable({
  invoiceId,
  rows,
}: {
  invoiceId: string;
  rows: InvoiceDocumentRow[];
}) {
  const columns: Column<InvoiceDocumentRow>[] = [
    {
      key: "revision",
      header: "Revision",
      cell: (r) => `${ROLE_LABELS[r.role] ?? r.role} · r${r.revision}`,
      sortAccessor: (r) => r.revision,
    },
    {
      key: "sent",
      header: "Sent",
      cell: (r) => <LocalTime value={r.createdAt} utc />,
      sortAccessor: (r) => new Date(r.createdAt).getTime(),
    },
    {
      key: "recipient",
      header: "Recipient",
      cell: (r) => r.sentToEmail ?? "—",
    },
    {
      key: "size",
      header: "Size",
      align: "right",
      cell: (r) => formatBytes(r.sizeBytes),
      sortAccessor: (r) => r.sizeBytes ?? 0,
    },
    {
      key: "download",
      header: "",
      align: "right",
      cell: (r) => (
        <a
          href={`/api/v1/finance/invoices/${invoiceId}/documents/${r.id}`}
          className="text-dpf-caption text-[var(--dpf-accent)] hover:underline"
        >
          Download
        </a>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowKey={(r) => r.id}
      initialSort={{ key: "revision", dir: "desc" }}
      dense
    />
  );
}
