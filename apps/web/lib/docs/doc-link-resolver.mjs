// apps/web/lib/docs/doc-link-resolver.mjs
//
// The single source of truth for how a DPF documentation page and an authored
// link resolve to real URLs on BOTH publishing surfaces:
//   - the public Jekyll site (opendigitalproductfactory.com), and
//   - the in-portal Next.js help renderer (/docs).
//
// Pure ESM JavaScript with zero external dependencies so the exact same logic
// runs in a Node CI script (scripts/check-doc-links.mjs) and in the portal
// server component (apps/web/components/docs/DocRenderer.tsx). Collapsing the
// two surface URLs into one string is what created the historical dead-link
// divergence; every function here derives both from one canonical sourcePath.

import path from "node:path";

export const PUBLIC_ORIGIN = "https://opendigitalproductfactory.com";
export const DOCS_ROOT = "docs";
export const USER_GUIDE_PREFIX = "docs/user-guide/";

// Directories/files under docs/ that Jekyll does NOT publish (mirror of the
// `exclude:` list in docs/_config.yml). A link into one of these is not a valid
// public page. Kept as a prefix list (posix, relative to repo root).
export const PUBLIC_UNPUBLISHED_PREFIXES = [
  "docs/superpowers",
  "docs/Reference",
  "docs/dark-theme-development-guidelines.md",
  "docs/architecture/ea-diagrams",
  "docs/architecture/gaid-diagrams",
  "docs/architecture/tak-diagrams",
];

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif"]);

/** Normalize any path to forward slashes and collapse redundant separators. */
export function toPosix(p) {
  return p.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

/**
 * GFM/kramdown-compatible heading slug. This is the single definition used by
 * the portal renderer, the heading extractor, and the anchor checker, so an
 * in-page anchor that resolves in one place resolves everywhere.
 */
export function slugifyHeading(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** True if a repo-relative source path is published by the public Jekyll site. */
export function isPublicPublished(sourcePath) {
  const p = toPosix(sourcePath);
  if (!p.startsWith(`${DOCS_ROOT}/`)) return false;
  return !PUBLIC_UNPUBLISHED_PREFIXES.some(
    (prefix) => p === prefix || p.startsWith(`${prefix}/`),
  );
}

/** True if a repo-relative source path is served by the in-portal /docs renderer. */
export function isPortalPublished(sourcePath) {
  return toPosix(sourcePath).startsWith(USER_GUIDE_PREFIX);
}

/**
 * Public (Jekyll, `permalink: pretty`) URL for a markdown source page.
 * docs/ is stripped, .md dropped, index collapses to its directory, and every
 * page gets a trailing slash.
 *   docs/user-guide/getting-started/developer-setup.md -> /user-guide/getting-started/developer-setup/
 *   docs/user-guide/getting-started/index.md           -> /user-guide/getting-started/
 *   docs/dev/collision-free-dev-workflow.md            -> /dev/collision-free-dev-workflow/
 */
export function sourcePathToPublicHref(sourcePath) {
  let rel = toPosix(sourcePath).replace(/^docs\//, "").replace(/\.md$/, "");
  rel = rel.replace(/(^|\/)index$/, "");
  return rel ? `/${rel}/` : "/";
}

/**
 * In-portal URL for a markdown source page, or null if the portal does not
 * serve it (only docs/user-guide/** is served). The portal keeps the /index
 * suffix for area index pages (matching DOCS_ROUTE_MAP and the breadcrumbs);
 * the user-guide root index collapses to /docs.
 *   docs/user-guide/getting-started/agent-dev-environments.md -> /docs/getting-started/agent-dev-environments
 *   docs/user-guide/getting-started/index.md                  -> /docs/getting-started/index
 *   docs/user-guide/index.md                                  -> /docs
 */
export function sourcePathToPortalHref(sourcePath) {
  if (!isPortalPublished(sourcePath)) return null;
  const rel = toPosix(sourcePath).replace(new RegExp(`^${USER_GUIDE_PREFIX}`), "").replace(/\.md$/, "");
  if (rel === "index") return "/docs";
  return `/docs/${rel}`;
}

/**
 * The canonical identity of a documentation page: one source path, both surface
 * URLs derived from it. For a page the portal cannot serve, portalHref falls
 * back to the absolute public URL so in-portal links still reach the page.
 */
export function docTargetFor(sourcePath, anchor) {
  const publicHref = sourcePathToPublicHref(sourcePath);
  const portalOwn = sourcePathToPortalHref(sourcePath);
  return {
    sourcePath: toPosix(sourcePath),
    publicHref: anchor ? `${publicHref}#${anchor}` : publicHref,
    portalHref: portalOwn
      ? anchor
        ? `${portalOwn}#${anchor}`
        : portalOwn
      : `${PUBLIC_ORIGIN}${publicHref}${anchor ? `#${anchor}` : ""}`,
    portalOwned: portalOwn !== null,
    anchor: anchor || undefined,
  };
}

function splitAnchor(href) {
  const i = href.indexOf("#");
  if (i === -1) return { pathPart: href, anchor: "" };
  return { pathPart: href.slice(0, i), anchor: href.slice(i + 1) };
}

function isExternal(href) {
  return /^(https?:)?\/\//i.test(href) || /^(mailto|tel):/i.test(href);
}

/**
 * Resolve an authored href from a source page into a classified result.
 *
 * Kinds:
 *   external  — http(s)/mailto/tel/protocol-relative; passed through as-is.
 *   anchor    — same-page "#heading" link; target is the source page.
 *   internal  — a repo-relative link to another markdown page.
 *   asset     — a repo-relative link/image to a static asset (png/svg/...).
 *   absolute  — a site-absolute link ("/user-guide/..." or "/docs/...") authored
 *               in source; a convention violation because surface URLs are
 *               generated outputs, not hand-authored source.
 *   invalid   — could not be resolved (malformed, escapes the repo, etc.).
 *
 * @param {string} sourcePath  repo-relative path of the page containing the link
 * @param {string} authoredHref the raw href/src as written in the markdown
 */
export function resolveDocLink(sourcePath, authoredHref) {
  const href = String(authoredHref || "").trim();
  if (!href) return { kind: "invalid", reason: "empty-href", authoredHref };
  if (isExternal(href)) return { kind: "external", href };

  const { pathPart, anchor } = splitAnchor(href);

  // Pure same-page anchor.
  if (pathPart === "") {
    return {
      kind: "anchor",
      anchor,
      target: docTargetFor(sourcePath, anchor),
    };
  }

  // Site-absolute link authored in source (a convention violation we still
  // classify so the checker can report it precisely).
  if (pathPart.startsWith("/")) {
    return { kind: "absolute", href, pathPart, anchor };
  }

  // Repo-relative: resolve against the source file's directory.
  const endsWithSlash = pathPart.endsWith("/");
  const sourceDir = path.posix.dirname(toPosix(sourcePath));
  const resolved = toPosix(path.posix.normalize(path.posix.join(sourceDir, pathPart)));

  if (resolved.startsWith("..") || !resolved.startsWith(`${DOCS_ROOT}/`)) {
    return { kind: "invalid", reason: "escapes-docs-root", authoredHref: href, resolved };
  }

  const ext = path.posix.extname(resolved).toLowerCase();

  if (IMAGE_EXTENSIONS.has(ext)) {
    // Public (Jekyll) serves the asset as a static file with docs/ stripped.
    // The portal only renders markdown under /docs, so user-guide assets are
    // served through the /api/docs-asset route (see route.ts); assets outside
    // the user guide fall back to the public static path.
    const portalHref = resolved.startsWith(USER_GUIDE_PREFIX)
      ? `/api/docs-asset/${resolved.slice(USER_GUIDE_PREFIX.length)}`
      : `/${resolved.replace(/^docs\//, "")}`;
    return {
      kind: "asset",
      sourcePath: resolved,
      publicHref: `/${resolved.replace(/^docs\//, "")}`,
      portalHref,
    };
  }

  // Internal markdown link. The canonical authored form ends in .md; an
  // extension-less link (`developer-setup`) or a directory link (`getting-started/`)
  // is non-canonical (reported by the checker), but we still resolve the intended
  // target so we can tell "dead" from "untidy".
  let targetSource;
  if (endsWithSlash) targetSource = `${resolved}/index.md`;
  else if (ext === ".md") targetSource = resolved;
  else targetSource = `${resolved}.md`;
  return {
    kind: "internal",
    canonical: !endsWithSlash && ext === ".md",
    target: docTargetFor(targetSource, anchor),
    anchor,
  };
}
