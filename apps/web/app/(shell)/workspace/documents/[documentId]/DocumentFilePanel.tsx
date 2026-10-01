// The stored-file panel of the document page (BI-9D43CBEF). For a version
// stored as a file it offers the original as a download and, for an office
// file, its PDF rendition and extracted text once the rendition job has run.
// UX fit: docs/ux-fit/2026-09-25-document-renditions.ux-fit.json.
import { Download, FileText } from "lucide-react";
import type { ManagedDocumentVersion } from "@/lib/documents/document-store";

type Props = {
  documentId: string;
  version: ManagedDocumentVersion;
  isOfficeFile: boolean;
  textPreview: string | null;
  failureMessage: string | null;
};

const ACTION_CLASS =
  "inline-flex h-9 items-center gap-2 rounded-md border border-[var(--dpf-border)] px-3 text-sm text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]";

export function DocumentFilePanel({ documentId, version, isOfficeFile, textPreview, failureMessage }: Props) {
  const base = `/api/documents/${encodeURIComponent(documentId)}/content?version=${version.version}`;
  const hasPdf = version.renditions.some((rendition) => rendition.kind === "pdf" && rendition.blobId);
  const status = !isOfficeFile || hasPdf
    ? null
    : failureMessage ?? "Preparing a PDF and searchable text for this file. Refresh the page in a minute.";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {hasPdf && (
          <a href={`${base}&rendition=pdf`} target="_blank" rel="noopener noreferrer" className={ACTION_CLASS}>
            <FileText className="h-4 w-4" aria-hidden="true" />
            View PDF
          </a>
        )}
        <a href={base} className={ACTION_CLASS}>
          <Download className="h-4 w-4" aria-hidden="true" />
          Download original
        </a>
      </div>
      {status && (
        <p role="status" className="text-sm text-[var(--dpf-muted)]">
          {status}
        </p>
      )}
      {textPreview ? (
        <pre className="whitespace-pre-wrap text-sm leading-6 text-[var(--dpf-text)]">{textPreview}</pre>
      ) : (
        !status && <p className="text-sm text-[var(--dpf-muted)]">This version is stored as a file. Download it to open it.</p>
      )}
    </div>
  );
}
