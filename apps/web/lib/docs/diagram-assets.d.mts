// Type declarations for diagram-assets.mjs — shared diagram asset addressing.
export const DIAGRAMS_DIR: string;
export function diagramSlug(sourcePath: string): string;
export function diagramPublicHref(slug: string, index: number): string;
export function diagramPortalHref(slug: string, index: number, version?: string): string;
