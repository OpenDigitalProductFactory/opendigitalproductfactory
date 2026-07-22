import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";
import { loadDocPage, loadAllDocs, buildDocsIndex, extractHeadings, AREA_META, AREA_ORDER, type DocsIndex } from "@/lib/docs";
import { DocsLayout } from "@/components/docs/DocsLayout";
import { DocRenderer } from "@/components/docs/DocRenderer";
import { ContextualQuickHelp } from "@/components/docs/ContextualQuickHelp";
import { resolveQuickHelp, type QuickHelp } from "@/lib/docs-quick-help";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";
import { resolveVocabularyKey } from "@/lib/storefront/resolve-vocabulary";

type Props = {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<{ sourceRoute?: string }>;
};

/**
 * Resolve route-specific quick help for the source route (BI-2DD18122).
 *
 * Storefront routes are rendered in the install's OWN archetype vocabulary — a
 * Restaurant reads menu / tables / reservations / guests — so the help matches
 * the words on the screen the owner just left. Vocabulary needs the database, so
 * it is resolved here (server) and injected; every other area resolves statically.
 */
async function loadQuickHelp(sourceRoute: string | undefined): Promise<QuickHelp | null> {
  if (!sourceRoute) return null;

  const normalized = sourceRoute.split("?")[0] ?? "";
  const isStorefront =
    normalized.startsWith("/storefront") || normalized.startsWith("/admin/storefront");
  if (!isStorefront) return resolveQuickHelp(sourceRoute);

  const config = await prisma.storefrontConfig.findFirst({
    select: { archetype: { select: { category: true, customVocabulary: true } } },
  });
  const businessContext = config
    ? null
    : await prisma.businessContext.findFirst({ select: { industry: true } });

  const archetypeCategory = config?.archetype?.category ?? null;
  const vocab = getVocabulary(
    resolveVocabularyKey({ archetypeCategory, industry: businessContext?.industry ?? null }),
    (config?.archetype?.customVocabulary as Record<string, string> | null) ?? null,
  );

  return resolveQuickHelp(sourceRoute, { vocab, archetypeCategory });
}

export default async function DocsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { sourceRoute } = await searchParams;
  const quickHelp = await loadQuickHelp(sourceRoute);
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

  // Arrived contextually from a specific page — demote the catalog so the
  // immediate explanation is not competing with the full docs manual.
  const contextual = Boolean(sourceRoute);

  // No slug = docs home page
  if (!slug || slug.length === 0) {
    return (
      <DocsLayout index={sidebarIndex} currentSlug="" searchItems={searchItems} collapseCatalog={contextual}>
        <DocsHome index={index} sourceRoute={sourceRoute} quickHelp={quickHelp} />
      </DocsLayout>
    );
  }

  const docSlug = slug.join("/");
  const doc = loadDocPage(docSlug);
  if (!doc) return notFound();

  // Extract headings server-side — pass structured data, not raw markdown
  const tocHeadings = extractHeadings(doc.content);

  return (
    <DocsLayout
      index={sidebarIndex}
      currentSlug={docSlug}
      searchItems={searchItems}
      headings={tocHeadings}
      collapseCatalog={contextual}
    >
      <DocContent doc={doc} sourceRoute={sourceRoute} quickHelp={quickHelp} />
    </DocsLayout>
  );
}

function DocsHome({
  index,
  sourceRoute,
  quickHelp,
}: {
  index: Record<string, unknown[]>;
  sourceRoute?: string;
  quickHelp?: QuickHelp | null;
}) {
  const contextual = Boolean(sourceRoute);
  const catalog = (
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
  );

  // Contextual arrival: quick help leads, and the full catalog is demoted into
  // a collapsed disclosure so it does not compete with the immediate answer.
  if (contextual && sourceRoute) {
    return (
      <div>
        <ContextualQuickHelp sourceRoute={sourceRoute} help={quickHelp} />
        <details className="rounded-lg border border-[var(--dpf-border)]">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[var(--dpf-text)]">
            Browse the full documentation catalog
          </summary>
          <div className="px-4 pb-4">{catalog}</div>
        </details>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-[var(--dpf-text)] mb-2">Documentation</h1>
      <p className="text-sm text-[var(--dpf-muted)] mb-6">
        Learn how to use every area of the platform.
      </p>
      {catalog}
    </div>
  );
}

function DocContent({
  doc,
  sourceRoute,
  quickHelp,
}: {
  doc: { title: string; content: string; area: string; slug: string };
  sourceRoute?: string;
  quickHelp?: QuickHelp | null;
}) {
  const areaLabel = AREA_META[doc.area]?.label ?? doc.area;
  return (
    <div>
      {sourceRoute ? <ContextualQuickHelp sourceRoute={sourceRoute} help={quickHelp} /> : null}
      <div className="mb-2">
        <a href="/docs" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">Docs</a>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <a href={`/docs/${doc.area}/index`} className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">{areaLabel}</a>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">{doc.title}</span>
      </div>
      <h1 className="text-xl font-bold text-[var(--dpf-text)] mb-6">{doc.title}</h1>
      <DocRenderer content={doc.content} sourcePath={`docs/user-guide/${doc.slug}.md`} />
    </div>
  );
}
