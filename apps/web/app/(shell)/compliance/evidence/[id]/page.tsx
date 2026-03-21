import { getEvidence } from "@/lib/actions/compliance";
import Link from "next/link";
import { notFound } from "next/navigation";

type Props = { params: Promise<{ id: string }> };

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-900/30 text-green-400",
  superseded: "bg-yellow-900/30 text-yellow-400",
  archived: "bg-gray-900/30 text-gray-400",
};

export default async function EvidenceDetailPage({ params }: Props) {
  const { id } = await params;
  let evidence;
  try {
    evidence = await getEvidence(id);
  } catch {
    notFound();
  }

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/compliance/evidence" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">Evidence</Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">{evidence.title}</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">{evidence.title}</h1>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
            {evidence.evidenceType}
          </span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[evidence.status] ?? "bg-gray-900/30 text-gray-400"}`}>
            {evidence.status}
          </span>
        </div>
        {evidence.description && (
          <p className="text-sm text-[var(--dpf-muted)]">{evidence.description}</p>
        )}
      </div>

      {/* Superseded banner */}
      {evidence.status === "superseded" && evidence.supersededBy && (
        <div className="mb-6 p-3 rounded-lg border border-yellow-500/50 bg-yellow-900/10">
          <p className="text-xs text-yellow-400 mb-1">This evidence has been superseded.</p>
          <Link
            href={`/compliance/evidence/${evidence.supersededBy.id}`}
            className="inline-flex items-center gap-2 text-sm text-[var(--dpf-text)] hover:text-blue-400 transition-colors"
          >
            <span>{evidence.supersededBy.title}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{evidence.supersededBy.evidenceId}</span>
            <span className="text-xs text-blue-400">View replacement</span>
          </Link>
        </div>
      )}

      {/* Metadata grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Collected At</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{new Date(evidence.collectedAt).toLocaleString()}</p>
        </div>
        {evidence.collectedBy && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Collected By</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{evidence.collectedBy.displayName}</p>
          </div>
        )}
        {evidence.fileRef && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">File Reference</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)] break-all">{evidence.fileRef}</p>
          </div>
        )}
        {evidence.retentionUntil && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Retain Until</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{new Date(evidence.retentionUntil).toLocaleDateString()}</p>
          </div>
        )}
      </div>

      {/* Linked Obligation */}
      {evidence.obligation && (
        <div className="mb-6">
          <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-2">Obligation</h2>
          <Link
            href={`/compliance/obligations/${evidence.obligation.id}`}
            className="inline-flex items-center gap-2 p-3 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors"
          >
            <span className="text-sm font-semibold text-[var(--dpf-text)]">{evidence.obligation.title}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{evidence.obligation.obligationId}</span>
            <span className="text-xs text-blue-400">View</span>
          </Link>
        </div>
      )}

      {/* Linked Control */}
      {evidence.control && (
        <div className="mb-6">
          <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-2">Control</h2>
          <Link
            href={`/compliance/controls/${evidence.control.id}`}
            className="inline-flex items-center gap-2 p-3 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors"
          >
            <span className="text-sm font-semibold text-[var(--dpf-text)]">{evidence.control.title}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{evidence.control.controlId}</span>
            <span className="text-xs text-blue-400">View</span>
          </Link>
        </div>
      )}
    </div>
  );
}
