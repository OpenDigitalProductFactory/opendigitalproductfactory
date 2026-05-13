import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { Archive, ArchiveRestore, ArrowLeft, CheckCircle2, FileText } from "lucide-react";
import { auth } from "@/lib/auth";
import { listManagedDocumentReferences, loadManagedDocument } from "@/lib/documents/document-store";
import { changeDocumentStateAction } from "../actions";

type Props = {
  params: Promise<{ documentId: string }>;
};

function StateAction({ documentId, toState, label, icon }: { documentId: string; toState: string; label: string; icon: React.ReactNode }) {
  return (
    <form action={changeDocumentStateAction}>
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="toState" value={toState} />
      <input type="hidden" name="reason" value={`Manual ${toState} from document detail`} />
      <button type="submit" className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--dpf-border)] px-3 text-sm text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-1)]">
        {icon}
        {label}
      </button>
    </form>
  );
}

export default async function DocumentDetailPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { documentId } = await params;
  const [document, references] = await Promise.all([
    loadManagedDocument({ documentId: decodeURIComponent(documentId) }),
    listManagedDocumentReferences(decodeURIComponent(documentId)),
  ]);
  if (!document) notFound();

  const content = document.currentVersion?.contentText ?? document.currentVersion?.summary ?? "";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/workspace/documents" className="inline-flex items-center gap-2 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Documents
        </Link>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--dpf-muted)]">
            <span>{document.documentId}</span>
            <span className="rounded border border-[var(--dpf-border)] px-2 py-0.5 text-[var(--dpf-text)]">{document.currentState}</span>
            <span>{document.documentKind}</span>
            <span>v{document.currentVersion?.version ?? "-"}</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-[var(--dpf-text)]">{document.title}</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--dpf-muted)]">
            Updated {document.updatedAt.toLocaleString()} by {document.createdByName ?? document.ownerName ?? "unknown principal"}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {document.currentState === "draft" && (
            <StateAction documentId={document.documentId} toState="published" label="Publish" icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />} />
          )}
          {document.currentState !== "archived" && (
            <StateAction documentId={document.documentId} toState="archived" label="Archive" icon={<Archive className="h-4 w-4" aria-hidden="true" />} />
          )}
          {document.currentState === "archived" && (
            <StateAction documentId={document.documentId} toState="draft" label="Restore" icon={<ArchiveRestore className="h-4 w-4" aria-hidden="true" />} />
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <article className="min-w-0 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
          <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
            <FileText className="h-4 w-4" aria-hidden="true" />
            Current Version
          </div>
          {document.contentFormat === "text/markdown" ? (
            <div className="prose prose-sm max-w-none text-[var(--dpf-text)] prose-headings:text-[var(--dpf-text)] prose-p:text-[var(--dpf-text)] prose-strong:text-[var(--dpf-text)]">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          ) : (
            <pre className="whitespace-pre-wrap text-sm leading-6 text-[var(--dpf-text)]">{content || "Binary or external content is stored as a managed blob."}</pre>
          )}
        </article>

        <aside className="space-y-4">
          <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Metadata</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--dpf-muted)]">Format</dt>
                <dd className="text-right text-[var(--dpf-text)]">{document.contentFormat}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--dpf-muted)]">Access</dt>
                <dd className="text-right text-[var(--dpf-text)]">{document.accessScope}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--dpf-muted)]">Source</dt>
                <dd className="text-right text-[var(--dpf-text)]">{document.sourceKind}</dd>
              </div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-1">
              {document.tags.map((tag) => (
                <span key={tag} className="rounded border border-[var(--dpf-border)] px-2 py-0.5 text-xs text-[var(--dpf-muted)]">{tag}</span>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Versions</h2>
            <div className="mt-3 space-y-2">
              {document.versions.map((version) => (
                <div key={version.id} className="border-l-2 border-[var(--dpf-border)] pl-3 text-sm">
                  <p className="font-medium text-[var(--dpf-text)]">v{version.version}</p>
                  <p className="text-xs text-[var(--dpf-muted)]">{version.summary ?? "No summary"}</p>
                  <p className="text-[11px] text-[var(--dpf-muted)]">{version.createdAt.toLocaleString()}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Lifecycle</h2>
            <div className="mt-3 space-y-2">
              {document.lifecycleEvents.length === 0 ? (
                <p className="text-sm text-[var(--dpf-muted)]">No lifecycle events yet.</p>
              ) : (
                document.lifecycleEvents.map((event) => (
                  <div key={event.id} className="border-l-2 border-[var(--dpf-border)] pl-3 text-sm">
                    <p className="font-medium text-[var(--dpf-text)]">
                      {event.fromState ?? "created"} {"->"} {event.toState}
                    </p>
                    <p className="text-xs text-[var(--dpf-muted)]">{event.reason ?? "No reason recorded"}</p>
                    <p className="text-[11px] text-[var(--dpf-muted)]">
                      {event.createdAt.toLocaleString()} {event.actorName ? `by ${event.actorName}` : ""}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">References</h2>
            <p className="mt-2 text-xs text-[var(--dpf-muted)]">
              {references.outbound.length} outbound · {references.inbound.length} inbound
            </p>
            <div className="mt-3 space-y-3 text-sm">
              {references.outbound.map((ref: any) => (
                <div key={ref.id} className="text-[var(--dpf-muted)]">
                  <span className="text-[var(--dpf-text)]">{ref.refType}</span>{" "}
                  {ref.targetDocument ? `${ref.targetDocument.documentId} ${ref.targetDocument.title}` : ref.targetExternalRef}
                </div>
              ))}
              {references.inbound.map((ref: any) => (
                <div key={ref.id} className="text-[var(--dpf-muted)]">
                  <span className="text-[var(--dpf-text)]">used by</span>{" "}
                  {ref.sourceDocument ? `${ref.sourceDocument.documentId} ${ref.sourceDocument.title}` : "unknown"}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
