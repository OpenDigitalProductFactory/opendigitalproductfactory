// Type declarations for doc-link-resolver.mjs — the zero-dependency ESM module
// shared between the CI link checker and the portal renderer.

export const PUBLIC_ORIGIN: string;
export const DOCS_ROOT: string;
export const USER_GUIDE_PREFIX: string;
export const PUBLIC_UNPUBLISHED_PREFIXES: string[];

export type DocTarget = {
  /** Canonical repo-relative source path of the target page. */
  sourcePath: string;
  /** Public Jekyll URL (with #anchor if present). */
  publicHref: string;
  /** In-portal URL, or the absolute public URL if the portal does not serve it. */
  portalHref: string;
  /** True when the portal serves this page itself (docs/user-guide/**). */
  portalOwned: boolean;
  anchor?: string;
};

export type ResolvedDocLink =
  | { kind: "external"; href: string }
  | { kind: "anchor"; anchor: string; target: DocTarget }
  | { kind: "internal"; canonical: boolean; target: DocTarget; anchor: string }
  | { kind: "asset"; sourcePath: string; publicHref: string; portalHref: string }
  | { kind: "absolute"; href: string; pathPart: string; anchor: string }
  | { kind: "invalid"; reason: string; authoredHref: string; resolved?: string };

export function toPosix(p: string): string;
export function slugifyHeading(text: string): string;
export function isPublicPublished(sourcePath: string): boolean;
export function isPortalPublished(sourcePath: string): boolean;
export function sourcePathToPublicHref(sourcePath: string): string;
export function sourcePathToPortalHref(sourcePath: string): string | null;
export function docTargetFor(sourcePath: string, anchor?: string): DocTarget;
export function resolveDocLink(sourcePath: string, authoredHref: string): ResolvedDocLink;
