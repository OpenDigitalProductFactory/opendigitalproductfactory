"use client";

// Import a Visio or Draw diagram and review what it proposes (BI-4C17BF51).
// Shapes and connectors become candidates; accepting one records the review,
// it does not add anything to the model.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importEaDiagram } from "@/lib/actions/ea-diagram-import";
import { reviewReferenceProposal } from "@/lib/actions/ea";
import type { DiagramImportView } from "@/lib/ea/diagram-import/load-imports";

type Props = { imports: Array<Omit<DiagramImportView, "importedAt"> & { importedAt: string }>; canManage: boolean };

const STATUS_LABEL: Record<string, string> = { proposed: "To review", approved: "Accepted", rejected: "Rejected" };

function ReviewButtons({ id, status, disabled, onReview }: {
  id: string;
  status: string;
  disabled: boolean;
  onReview: (id: string, status: "approved" | "rejected") => void;
}) {
  const button = "rounded border px-2 py-0.5 text-[11px] disabled:opacity-50";
  return (
    <span className="flex gap-1">
      <button type="button" disabled={disabled || status === "approved"} onClick={() => onReview(id, "approved")}
        className={`${button} border-[var(--dpf-border)] text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]`}>
        Accept
      </button>
      <button type="button" disabled={disabled || status === "rejected"} onClick={() => onReview(id, "rejected")}
        className={`${button} border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-error)]`}>
        Reject
      </button>
    </span>
  );
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

  function review(id: string, status: "approved" | "rejected") {
    startTransition(async () => {
      try {
        await reviewReferenceProposal({ proposalId: id, status });
        router.refresh();
      } catch {
        setMessage({ tone: "error", text: "The review was not saved. Try again." });
      }
    });
  }

  return (
    <section aria-labelledby="diagram-imports" className="mt-8 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <h2 id="diagram-imports" className="text-sm font-semibold text-[var(--dpf-text)]">Imported diagrams</h2>
      <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">
        Shapes and connectors from a Visio or Draw file become candidates to review. Nothing is added to the model.
      </p>

      {canManage && (
        <form action={upload} className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="diagram-file" className="text-xs text-[var(--dpf-text)]">Diagram file</label>
          <input ref={input} id="diagram-file" name="file" type="file" accept=".vsd,.vsdx,.odg" required
            className="text-xs text-[var(--dpf-muted)]" />
          <button type="submit" disabled={pending}
            className="rounded bg-[var(--dpf-accent)] px-3 py-1 text-xs font-medium text-[var(--dpf-on-accent)] disabled:opacity-60">
            {pending ? "Importing…" : "Import diagram"}
          </button>
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
          <table className="mt-3 w-full text-left text-xs">
            <caption className="sr-only">Candidate elements from {item.fileName}</caption>
            <thead className="text-[var(--dpf-muted)]">
              <tr><th className="py-1 font-normal">Shape</th><th className="font-normal">Page</th><th className="font-normal">Status</th>{canManage && <th />}</tr>
            </thead>
            <tbody>
              {item.elements.map((element) => (
                <tr key={element.id} className="border-t border-[var(--dpf-border)] text-[var(--dpf-text)]">
                  <td className="py-1">{element.label}{element.suggestedLayer && <span className="text-[var(--dpf-muted)]"> · {element.suggestedLayer} layer</span>}</td>
                  <td>{element.page}</td>
                  <td>{STATUS_LABEL[element.status] ?? element.status}</td>
                  {canManage && <td><ReviewButtons id={element.id} status={element.status} disabled={pending} onReview={review} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {item.relationships.length > 0 && (
            <table className="mt-3 w-full text-left text-xs">
              <caption className="sr-only">Candidate relationships from {item.fileName}</caption>
              <thead className="text-[var(--dpf-muted)]">
                <tr><th className="py-1 font-normal">Connection</th><th className="font-normal">Page</th><th className="font-normal">Status</th>{canManage && <th />}</tr>
              </thead>
              <tbody>
                {item.relationships.map((relationship) => (
                  <tr key={relationship.id} className="border-t border-[var(--dpf-border)] text-[var(--dpf-text)]">
                    <td className="py-1">
                      {relationship.fromLabel} → {relationship.toLabel}
                      {relationship.label && <span className="text-[var(--dpf-muted)]"> ({relationship.label})</span>}
                    </td>
                    <td>{relationship.page}</td>
                    <td>{STATUS_LABEL[relationship.status] ?? relationship.status}</td>
                    {canManage && <td><ReviewButtons id={relationship.id} status={relationship.status} disabled={pending} onReview={review} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </details>
      ))}
    </section>
  );
}
