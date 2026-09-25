"use client";

// Import a Visio or Draw diagram and review what it proposes (BI-4C17BF51).
// Shapes and connectors become candidates; accepting one records the review,
// it does not add anything to the model.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importEaDiagram } from "@/lib/actions/ea-diagram-import";
import { reviewReferenceProposal } from "@/lib/actions/ea";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { DataTable, type Column } from "@/components/ui/report-kit";
import type { DiagramImportView } from "@/lib/ea/diagram-import/load-imports";

type ImportItem = Omit<DiagramImportView, "importedAt"> & { importedAt: string };
type Props = { imports: ImportItem[]; canManage: boolean };
type Review = (id: string, status: "approved" | "rejected") => void;

const STATUS_LABEL: Record<string, string> = { proposed: "To review", approved: "Accepted", rejected: "Rejected" };

function ReviewButtons({ id, status, disabled, onReview }: { id: string; status: string; disabled: boolean; onReview: Review }) {
  return (
    <span className="flex gap-1">
      <Button size="sm" variant="secondary" disabled={disabled || status === "approved"} onClick={() => onReview(id, "approved")}>
        Accept
      </Button>
      <Button size="sm" variant="ghost" disabled={disabled || status === "rejected"} onClick={() => onReview(id, "rejected")}>
        Reject
      </Button>
    </span>
  );
}

function withReview<T extends { id: string; status: string }>(
  columns: Column<T>[],
  canManage: boolean,
  pending: boolean,
  onReview: Review,
): Column<T>[] {
  const status: Column<T> = { key: "status", header: "Status", cell: (row) => STATUS_LABEL[row.status] ?? row.status };
  if (!canManage) return [...columns, status];
  return [
    ...columns,
    status,
    {
      key: "review",
      header: <span className="sr-only">Review</span>,
      cell: (row) => <ReviewButtons id={row.id} status={row.status} disabled={pending} onReview={onReview} />,
    },
  ];
}

export function DiagramImportPanel({ imports, canManage }: Props) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function upload(form: FormData) {
    setMessage(null);
    startTransition(async () => {
      const result = await importEaDiagram(form);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      const data = result.data;
      setMessage({
        tone: "info",
        text: data.alreadyImported
          ? "This file was imported before; its candidates are below."
          : `Found ${data.elementCount} shapes and ${data.relationshipCount} connections to review.`,
      });
      if (input.current) input.current.value = "";
      router.refresh();
    });
  }

  const review: Review = (id, status) => {
    startTransition(async () => {
      try {
        await reviewReferenceProposal({ proposalId: id, status });
        router.refresh();
      } catch {
        setMessage({ tone: "error", text: "The review was not saved. Try again." });
      }
    });
  };

  const elementColumns = withReview<ImportItem["elements"][number]>(
    [
      {
        key: "label",
        header: "Shape",
        cell: (row) => (
          <>
            {row.label}
            {row.suggestedLayer && <span className="text-[var(--dpf-muted)]"> · {row.suggestedLayer} layer</span>}
          </>
        ),
      },
      { key: "page", header: "Page", cell: (row) => row.page },
    ],
    canManage,
    pending,
    review,
  );
  const relationshipColumns = withReview<ImportItem["relationships"][number]>(
    [
      {
        key: "connection",
        header: "Connection",
        cell: (row) => (
          <>
            {row.fromLabel} → {row.toLabel}
            {row.label && <span className="text-[var(--dpf-muted)]"> ({row.label})</span>}
          </>
        ),
      },
      { key: "page", header: "Page", cell: (row) => row.page },
    ],
    canManage,
    pending,
    review,
  );

  return (
    <Surface as="section" aria-labelledby="diagram-imports" className="mt-8">
      <h2 id="diagram-imports" className="text-sm font-semibold text-[var(--dpf-text)]">Imported diagrams</h2>
      <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">
        Shapes and connectors from a Visio or Draw file become candidates to review. Nothing is added to the model.
      </p>

      {canManage && (
        <form action={upload} className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="diagram-file" className="text-xs text-[var(--dpf-text)]">Diagram file</label>
          <input ref={input} id="diagram-file" name="file" type="file" accept=".vsd,.vsdx,.odg" required
            className="text-xs text-[var(--dpf-muted)]" />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Importing…" : "Import diagram"}
          </Button>
        </form>
      )}
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"}
          className={`mt-2 text-xs ${message.tone === "error" ? "text-[var(--dpf-error)]" : "text-[var(--dpf-text)]"}`}>
          {message.text}
        </p>
      )}

      {imports.map((item, index) => (
        <details key={item.id} open={index === 0} className="mt-4 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--dpf-text)]">
            {item.fileName} · {item.elements.length} shapes · {item.relationships.length} connections
          </summary>
          {item.previewDataUri ? (
            // eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URI, rendered as an image so it runs no script
            <img src={item.previewDataUri} alt={`Preview of ${item.fileName}`}
              className="mt-3 max-h-80 w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] object-contain" />
          ) : (
            <p className="mt-3 text-xs text-[var(--dpf-muted)]">No preview is available for this file.</p>
          )}
          {(item.unattachedConnectors > 0 || item.truncated) && (
            <p className="mt-2 text-xs text-[var(--dpf-muted)]">
              {item.unattachedConnectors > 0 && `${item.unattachedConnectors} connectors did not join two shapes and are not listed. `}
              {item.truncated && "The diagram was larger than one import holds; only the first part is listed."}
            </p>
          )}
          <DataTable className="mt-3" dense ariaLabel={`Candidate elements from ${item.fileName}`}
            columns={elementColumns} rows={item.elements} getRowKey={(row) => row.id} />
          {item.relationships.length > 0 && (
            <DataTable className="mt-3" dense ariaLabel={`Candidate relationships from ${item.fileName}`}
              columns={relationshipColumns} rows={item.relationships} getRowKey={(row) => row.id} />
          )}
        </details>
      ))}
    </Surface>
  );
}
