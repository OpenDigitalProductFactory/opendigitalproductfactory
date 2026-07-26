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
// so the Jekyll site (which ignores _-prefixed paths) publishes it.
export const DIAGRAMS_DIR = "docs/user-guide/assets/diagrams";

/** Page slug from a repo-relative user-guide source path. */
export function diagramSlug(sourcePath) {
  return String(sourcePath)
    .replace(/\\/g, "/")
    .replace(/^docs\/user-guide\//, "")
    .replace(/\.md$/, "");
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
