import Link from "next/link";
import { redirect } from "next/navigation";
import { Archive, FileText, Search } from "lucide-react";
import { auth } from "@/lib/auth";
import { searchManagedDocuments } from "@/lib/documents/document-store";
import { prisma } from "@dpf/db";
import { LocalTime } from "@/components/ui/LocalTime";

type Props = {
  searchParams: Promise<{
    q?: string;
    state?: string;
    kind?: string;
    tag?: string;
    owner?: string;
  }>;
};

const STATE_TABS = [
  { label: "All", value: "" },
  { label: "Draft", value: "draft" },
  { label: "Published", value: "published" },
  { label: "Archived", value: "archived" },
];

function buildHref(params: Record<string, string | undefined>) {
  const url = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) url.set(key, value);
  }
  const query = url.toString();
  return `/workspace/documents${query ? `?${query}` : ""}`;
}

export default async function DocumentsPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const sp = await searchParams;
  const [documents, owners] = await Promise.all([
    searchManagedDocuments({
      query: sp.q ?? null,
      currentState: sp.state || null,
      documentKind: sp.kind || null,
      ownerPrincipalId: sp.owner || null,
      tags: sp.tag ? [sp.tag] : [],
      limit: 50,
    }),
    prisma.principal.findMany({
      where: { ownedDocuments: { some: {} } },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true },
      take: 100,
    }),
  ]);

  const updated = documents.filter((doc) => doc.updatedAt.getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000).length;
  const published = documents.filter((doc) => doc.currentState === "published").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Workspace</p>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--dpf-text)]">Documents</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--dpf-muted)]">
            Managed briefs, policies, plans, and other coworker outputs with stable IDs, lifecycle state, references, and independent versions.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-right">
          <div className="border-l border-[var(--dpf-border)] pl-4">
            <p className="text-xl font-semibold text-[var(--dpf-text)]">{documents.length}</p>
            <p className="text-[11px] text-[var(--dpf-muted)]">shown</p>
          </div>
          <div className="border-l border-[var(--dpf-border)] pl-4">
            <p className="text-xl font-semibold text-[var(--dpf-text)]">{published}</p>
            <p className="text-[11px] text-[var(--dpf-muted)]">published</p>
          </div>
          <div className="border-l border-[var(--dpf-border)] pl-4">
            <p className="text-xl font-semibold text-[var(--dpf-text)]">{updated}</p>
            <p className="text-[11px] text-[var(--dpf-muted)]">this week</p>
          </div>
        </div>
      </div>

      <form className="grid gap-2 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 md:grid-cols-[minmax(0,1fr)_140px_140px_180px_auto]">
        <label className="flex items-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3">
          <Search className="h-4 w-4 text-[var(--dpf-muted)]" aria-hidden="true" />
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Search phrase, concept, title, or ID"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm text-[var(--dpf-text)] outline-none placeholder:text-[var(--dpf-muted)]"
          />
        </label>
        <input
          name="kind"
          defaultValue={sp.kind ?? ""}
          placeholder="Kind"
          className="h-10 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 text-sm text-[var(--dpf-text)] outline-none placeholder:text-[var(--dpf-muted)]"
        />
        <input
          name="tag"
          defaultValue={sp.tag ?? ""}
          placeholder="Tag"
          className="h-10 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 text-sm text-[var(--dpf-text)] outline-none placeholder:text-[var(--dpf-muted)]"
        />
        <select
          name="owner"
          defaultValue={sp.owner ?? ""}
          className="h-10 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 text-sm text-[var(--dpf-text)] outline-none"
        >
          <option value="" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Any owner</option>
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
              {owner.displayName}
            </option>
          ))}
        </select>
        <button type="submit" className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--dpf-accent)] px-4 text-sm font-medium text-white">
          <Search className="h-4 w-4" aria-hidden="true" />
          Search
        </button>
      </form>

      <div className="flex flex-wrap gap-1 border-b border-[var(--dpf-border)]">
        {STATE_TABS.map((tab) => {
          const active = (sp.state ?? "") === tab.value;
          return (
            <Link
              key={tab.label}
              href={buildHref({ q: sp.q, kind: sp.kind, tag: sp.tag, owner: sp.owner, state: tab.value })}
              className={[
                "px-3 py-2 text-xs font-medium transition-colors",
                active
                  ? "border-b-2 border-[var(--dpf-accent)] text-[var(--dpf-text)]"
                  : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
              ].join(" ")}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {documents.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm text-[var(--dpf-muted)]">
          <Archive className="h-5 w-5 text-[var(--dpf-muted)]" aria-hidden="true" />
          No managed documents match these filters.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--dpf-border)]">
          <table className="min-w-full divide-y divide-[var(--dpf-border)] text-sm">
            <thead className="bg-[var(--dpf-surface-1)] text-left text-[11px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">Document</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Kind</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">Tags</th>
                <th className="px-4 py-3 text-right font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--dpf-border)] bg-[var(--dpf-bg)]">
              {documents.map((doc) => (
                <tr key={doc.documentId} className="hover:bg-[var(--dpf-surface-1)]">
                  <td className="px-4 py-3">
                    <Link href={`/workspace/documents/${encodeURIComponent(doc.documentId)}`} className="flex min-w-0 items-center gap-3">
                      <FileText className="h-4 w-4 shrink-0 text-[var(--dpf-accent)]" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-[var(--dpf-text)]">{doc.title}</span>
                        <span className="block text-xs text-[var(--dpf-muted)]">{doc.documentId} · v{doc.currentVersion?.version ?? "-"}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--dpf-text)]">{doc.currentState}</td>
                  <td className="px-4 py-3 text-[var(--dpf-muted)]">{doc.documentKind}</td>
                  <td className="px-4 py-3 text-[var(--dpf-muted)]">{doc.ownerName ?? doc.createdByName ?? "Unknown"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {doc.tags.slice(0, 4).map((tag) => (
                        <span key={tag} className="rounded border border-[var(--dpf-border)] px-1.5 py-0.5 text-[10px] text-[var(--dpf-muted)]">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-[var(--dpf-muted)]">
                    <LocalTime value={doc.updatedAt} mode="date" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
