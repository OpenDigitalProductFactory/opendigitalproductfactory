// apps/web/lib/docs/diagram-assets.mjs
//
// Single source of truth for where a build-time-rendered Mermaid diagram lives
// and how each surface addresses it. Diagrams are keyed by ORDINAL: the page's
// slug plus the 0-based index of the ```mermaid fence on that page. The render
// script (scripts/render-doc-diagrams.mjs), the portal renderer, and the Jekyll
// browser shim all derive the same path from this module (the shim mirrors the
// tiny bit of logic it needs in JS), so no content hashing / re-canonicalization
// is required for the surfaces to agree. Zero dependencies.

// Repo-relative directory holding committed diagram SVGs. NOT underscore-prefixed
// so the Jekyll site (which ignores _-prefixed paths) publishes it. This is the
// single published diagram-asset root for ALL doc roots: architecture-page
// diagrams live under an `architecture/` subdirectory here so the Jekyll static
// publishing and the portal's /api/docs-asset route need no second root.
export const DIAGRAMS_DIR = "docs/user-guide/assets/diagrams";

/**
 * Page slug from a repo-relative doc source path. User-guide pages keep their
 * historical user-guide-relative slug (committed asset paths and manifest keys
 * predate multi-root support); other doc roots (docs/architecture) keep their
 * root prefix, e.g. `architecture/platform-overview`. Slugs cannot collide:
 * there is no docs/user-guide/architecture/ subtree.
 */
export function diagramSlug(sourcePath) {
  const normalized = String(sourcePath).replace(/\\/g, "/");
  if (normalized.startsWith("docs/user-guide/")) {
    return normalized.replace(/^docs\/user-guide\//, "").replace(/\.md$/, "");
  }
  return normalized.replace(/^docs\//, "").replace(/\.md$/, "");
}

/** Public Jekyll URL for a diagram (docs/ stripped, served as a static file). */
export function diagramPublicHref(slug, index) {
  return `/user-guide/assets/diagrams/${slug}/${index}.svg`;
}

/**
 * In-portal URL for a diagram. The portal serves user-guide static assets via an
 * API route (the /docs route only renders markdown), so diagrams resolve through
 * /api/docs-asset/<repo-relative-path-under-user-guide>.
 */
export function diagramPortalHref(slug, index, version) {
  const base = `/api/docs-asset/assets/diagrams/${slug}/${index}.svg`;
  return version ? `${base}?v=${encodeURIComponent(version)}` : base;
}
