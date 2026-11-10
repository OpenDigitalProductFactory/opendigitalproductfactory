// Slide and page previews of the current version (BI-543819B1). A generated
// presentation carries one preview image per slide; they show in the Current
// Version panel so a reviewer can read the deck before downloading it.
// UX fit: docs/ux-fit/2026-09-25-slide-previews.ux-fit.json (DI-38FCA318FC23).

type Props = {
  documentId: string;
  version: number;
  pages: number[];
  isPresentation: boolean;
};

export function DocumentPagePreviews({ documentId, version, pages, isPresentation }: Props) {
  if (pages.length === 0) return null;
  const noun = isPresentation ? "Slide" : "Page";
  const base = `/api/documents/${encodeURIComponent(documentId)}/previews`;
  return (
    <section aria-label={`${noun} previews`} className="space-y-2">
      <h2 className="text-sm font-semibold text-[var(--dpf-text)]">
        {pages.length} {noun.toLowerCase()}
        {pages.length === 1 ? "" : "s"}
      </h2>
      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {pages.map((page) => {
          const src = `${base}/${page}?version=${version}`;
          return (
            <li key={page}>
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="block overflow-hidden rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] hover:border-[var(--dpf-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated, generated PNG served as-is */}
                <img src={src} alt={`${noun} ${page} of ${pages.length}`} loading="lazy" className="block h-auto w-full" />
              </a>
              <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                {noun} {page}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
