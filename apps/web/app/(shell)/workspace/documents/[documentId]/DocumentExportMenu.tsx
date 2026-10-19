// The document page's Export control (BI-4865EB4D, slice S5 of BI-815D40C6).
// One disclosure in the Current Version panel that downloads the version as a
// Word, OpenDocument or PDF file through the document engine. With no engine
// on the install it shows one plain line instead of links that would fail.
// UX fit: docs/ux-fit/2026-09-25-office-export-documents.ux-fit.json (DI-EECCCF15B277).
import { Download } from "lucide-react";
import { Surface } from "@/components/ui/Surface";
import { DOCUMENT_EXPORT_FORMATS, DOCUMENT_EXPORT_LABELS, type DocumentExportFormat } from "@/lib/documents/document-office-export";

type Props = {
  documentId: string;
  version: number;
  /** The formats this version can export to; empty hides the control. */
  formats: readonly DocumentExportFormat[];
  converterAvailable: boolean;
};

export function DocumentExportMenu({ documentId, version, formats, converterAvailable }: Props) {
  if (formats.length === 0) return null;
  if (!converterAvailable) {
    return <p className="text-xs text-[var(--dpf-muted)]">Export needs document conversion, not set up here.</p>;
  }
  const base = `/api/documents/${encodeURIComponent(documentId)}/content?version=${version}&export=`;
  return (
    <details className="relative">
      <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-2 rounded-md border border-[var(--dpf-border)] px-3 text-sm text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]">
        <Download className="h-4 w-4" aria-hidden="true" />
        Export
        <span aria-hidden="true">▾</span>
      </summary>
      <Surface role="menu" rounded="md" padding="none" className="absolute right-0 z-20 mt-1 flex w-52 flex-col gap-1 p-1 shadow-lg">
        {DOCUMENT_EXPORT_FORMATS.filter((format) => formats.includes(format)).map((format) => (
          <a
            key={format}
            role="menuitem"
            href={`${base}${format}`}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
          >
            <Download className="h-4 w-4 text-[var(--dpf-muted)]" aria-hidden="true" />
            {DOCUMENT_EXPORT_LABELS[format]}
          </a>
        ))}
      </Surface>
    </details>
  );
}
