import { notFound } from "next/navigation";
import { loadDocPage, loadAllDocs, buildDocsIndex, extractHeadings, AREA_META, AREA_ORDER, type DocsIndex } from "@/lib/docs";
import { resolveDocsTarget } from "@/lib/docs-route-map";
import { DocsLayout } from "@/components/docs/DocsLayout";
import { DocRenderer } from "@/components/docs/DocRenderer";

type Props = {
  params: Promise<{ slug?: string[] }>;
  searchParams?: Promise<{ from?: string }>;
};

export default async function DocsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { from } = searchParams ? await searchParams : {};
  const sourcePath = typeof from === "string" ? from : null;
  const sourceTarget = sourcePath ? resolveDocsTarget(sourcePath) : null;
  const allDocs = loadAllDocs();
  const index = buildDocsIndex(allDocs);

  // Strip content from sidebar data — only slug/title/area/order needed for navigation
  const sidebarIndex: DocsIndex = {};
  for (const [area, pages] of Object.entries(index)) {
    sidebarIndex[area] = pages.map((p) => ({ ...p, content: "" }));
  }

  // Search items — truncated content for Fuse.js
  const searchItems = allDocs.map((d) => ({
    slug: d.slug,
    title: d.title,
    area: d.area,
    content: d.content.slice(0, 500),
  }));

  // No slug = docs home page
  if (!slug || slug.length === 0) {
    return (
      <DocsLayout index={sidebarIndex} currentSlug="" searchItems={searchItems}>
        <DocsContextNotice sourcePath={sourcePath} sourceLabel={sourceTarget?.label ?? null} />
        <DocsHome index={index} />
      </DocsLayout>
    );
  }

  const docSlug = slug.join("/");
  const doc = loadDocPage(docSlug);
  if (!doc) return notFound();

  // Extract headings server-side — pass structured data, not raw markdown
  const tocHeadings = extractHeadings(doc.content);

  return (
    <DocsLayout index={sidebarIndex} currentSlug={docSlug} searchItems={searchItems} headings={tocHeadings}>
      <DocsContextNotice sourcePath={sourcePath} sourceLabel={sourceTarget?.label ?? doc.title} />
      <DocContent doc={doc} />
    </DocsLayout>
  );
}

function DocsContextNotice({ sourcePath, sourceLabel }: { sourcePath: string | null; sourceLabel: string | null }) {
  if (!sourcePath) return null;

  return (
    <div className="mb-4 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-[var(--dpf-text)]">
            {sourceLabel ? `Documentation for ${sourceLabel}` : "Contextual documentation"}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--dpf-muted)]">
            Opened from <span className="font-mono text-[var(--dpf-text)]">{sourcePath}</span>
          </p>
        </div>
        <a
          href="/docs"
          className="text-xs font-medium text-[var(--dpf-accent)] hover:underline"
        >
          All Docs
        </a>
      </div>
    </div>
  );
}

function DocsHome({ index }: { index: Record<string, unknown[]> }) {
  return (
    <div>
      <h1 className="text-xl font-bold text-[var(--dpf-text)] mb-2">Documentation</h1>
      <p className="text-sm text-[var(--dpf-muted)] mb-6">
        Learn how to use every area of the platform.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {AREA_ORDER.map((areaKey) => {
          const meta = AREA_META[areaKey];
          if (!meta) return null;
          const pages = index[areaKey] as unknown[] | undefined;
          const pageCount = pages?.length ?? 0;
          return (
            <a
              key={areaKey}
              href={`/docs/${areaKey}/index`}
              className="block p-4 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors"
            >
              <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-1">{meta.label}</h2>
              <p className="text-xs text-[var(--dpf-muted)]">{meta.description}</p>
              {pageCount > 0 && (
                <p className="text-[10px] text-[var(--dpf-muted)] mt-2">
                  {pageCount} page{pageCount !== 1 ? "s" : ""}
                </p>
              )}
            </a>
          );
        })}
      </div>
    </div>
  );
}

function DocContent({ doc }: { doc: { title: string; content: string; lastUpdated: string; updatedBy: string; area: string } }) {
  const areaLabel = AREA_META[doc.area]?.label ?? doc.area;
  return (
    <div>
      <div className="mb-2">
        <a href="/docs" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">Docs</a>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <a href={`/docs/${doc.area}/index`} className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">{areaLabel}</a>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">{doc.title}</span>
      </div>
      <h1 className="text-xl font-bold text-[var(--dpf-text)] mb-1">{doc.title}</h1>
      <p className="text-[10px] text-[var(--dpf-muted)] mb-6">
        Updated {doc.lastUpdated} by {doc.updatedBy}
      </p>
      <DocRenderer content={doc.content} currentArea={doc.area} />
    </div>
  );
}
