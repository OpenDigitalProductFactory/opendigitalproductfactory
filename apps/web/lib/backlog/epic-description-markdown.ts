// BI-A63A9476 (spec 2026-10-14 §5 "Rendering"): EpicCard shows its description
// through the one markdown renderer instead of its own URL-splitting regex. The
// card's one special case survives: a repository docs path (bare, or as a
// file:// URL) opens through the portal's docs route.

import type { RenderMarkdownOptions } from "@/lib/shared/markdown";

const FILE_DOCS_URL = /file:\/\/\/\S*?\/(docs\/\S+\.md)/g;
const BARE_DOCS_PATH = /(^|[\s(])(docs\/[^\s)]+\.md)(?=$|[\s).,;:])/gm;

function docsHref(path: string): string {
  return `/api/docs?path=${encodeURIComponent(path)}`;
}

/** The description as markdown, with docs paths turned into portal links. */
export function epicDescriptionMarkdown(description: string): string {
  return description
    .replace(FILE_DOCS_URL, (_m, path: string) => `[${path}](${docsHref(path)})`)
    .replace(BARE_DOCS_PATH, (_m, lead: string, path: string) => `${lead}[${path}](${docsHref(path)})`);
}

export const EPIC_DESCRIPTION_OPTIONS: RenderMarkdownOptions = {
  classes: {
    p: "text-dpf-caption text-[var(--dpf-muted)] mb-2 whitespace-pre-line",
    ul: "text-dpf-caption text-[var(--dpf-muted)] mb-2 ms-4 list-disc",
    ol: "text-dpf-caption text-[var(--dpf-muted)] mb-2 ms-4 list-decimal",
    a: "text-[var(--dpf-accent)] hover:underline break-all",
  },
  resolveLink: (href) => ({ href, external: /^https?:\/\//i.test(href) || href.startsWith("/api/docs?") }),
};
