// apps/web/components/docs/DocRenderer.tsx
// Server component — no "use client". Renders on server, zero client JS cost.

import { MarkdownHtml } from "@/components/shared/MarkdownHtml";
import { escapeHtml, type RenderMarkdownOptions } from "@/lib/shared/markdown";
import { resolveDocLink, slugifyHeading } from "@/lib/docs/doc-link-resolver.mjs";
import { diagramSlug, diagramPortalHref } from "@/lib/docs/diagram-assets.mjs";
import { DIAGRAM_VERSIONS } from "@/lib/docs/diagram-versions.generated.mjs";

/**
 * Resolve an authored markdown link to the URL the in-portal renderer should
 * use, via the shared resolver that also backs the CI link checker. Passing the
 * page's real sourcePath (not the frontmatter `area`) is what lets cross-area
 * and cross-tree links resolve correctly. Returns the href plus whether it
 * leaves the portal (external or a page only the public site serves).
 */
function resolvePortalLink(href: string | undefined, sourcePath: string): { href: string; external: boolean } {
  if (!href) return { href: "#", external: false };
  const res = resolveDocLink(sourcePath, href);
  switch (res.kind) {
    case "external":
      return { href: res.href, external: true };
    case "anchor":
      return { href: res.anchor ? `#${res.anchor}` : "#", external: false };
    case "internal":
      return { href: res.target.portalHref, external: !res.target.portalOwned };
    case "asset":
      return { href: res.portalHref, external: false };
    case "absolute":
      return { href: res.href, external: res.href.startsWith("http") };
    default:
      return { href: "#", external: false };
  }
}

const HEADING_CLASSES = {
  h2: "text-base font-bold text-[var(--dpf-text)] mt-8 mb-3 pb-1 border-b border-[var(--dpf-border)]",
  h3: "text-sm font-semibold text-[var(--dpf-text)] mt-6 mb-2",
  h4: "text-sm font-semibold text-[var(--dpf-muted)] mt-4 mb-2",
};

const IMAGE_CLASS = "my-4 max-w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]";

function buildOptions(sourcePath: string): RenderMarkdownOptions {
  const slug = diagramSlug(sourcePath);
  // ```mermaid fences are pre-rendered to committed SVGs (build-time, WWMD
  // DI-5C7B16CA4472); the Nth fence on the page maps to the Nth committed asset.
  // Counting here in document order matches scripts/render-doc-diagrams.mjs.
  let mermaidIndex = 0;
  return {
    classes: {
      ...HEADING_CLASSES,
      p: "text-sm text-[var(--dpf-text)] leading-relaxed mb-3",
      ul: "text-sm text-[var(--dpf-text)] mb-3 ms-4 list-disc space-y-1",
      ol: "text-sm text-[var(--dpf-text)] mb-3 ms-4 list-decimal space-y-1",
      li: "leading-relaxed",
      strong: "font-semibold text-[var(--dpf-text)]",
      a: "text-[var(--dpf-accent)] hover:underline",
      // Screenshots/images resolve through the shared resolver so a relative
      // src (e.g. ../assets/<page-slug>/foo.png) is served via /api/docs-asset.
      img: IMAGE_CLASS,
      code: "text-xs bg-[var(--dpf-surface-2)] px-1 py-0.5 rounded",
      pre: "text-xs bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-md p-3 overflow-x-auto mb-3",
      table: "text-xs w-full border-collapse",
      th: "text-start px-2 py-1.5 border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] font-semibold text-[var(--dpf-text)]",
      td: "px-2 py-1.5 border border-[var(--dpf-border)] text-[var(--dpf-muted)]",
      hr: "border-t border-[var(--dpf-border)] my-6",
    },
    tableWrapperClass: "overflow-x-auto mb-3",
    headingId: (text, level) => (level >= 2 && level <= 4 ? slugifyHeading(text) : undefined),
    resolveLink: (href) => resolvePortalLink(href, sourcePath),
    resolveImage: (src) => resolvePortalLink(src, sourcePath).href,
    renderFence: (language) => {
      if (language !== "mermaid") return null;
      const index = mermaidIndex++;
      const src = diagramPortalHref(slug, index, DIAGRAM_VERSIONS[`${slug}/${index}`]);
      return `<img src="${escapeHtml(src)}" alt="Diagram" class="${IMAGE_CLASS} p-2">\n`;
    },
  };
}

export function DocRenderer({ content, sourcePath }: { content: string; sourcePath: string }) {
  return <MarkdownHtml className="docs-content" source={content} options={buildOptions(sourcePath)} />;
}
