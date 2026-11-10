// apps/web/components/shared/markdown-document-options.ts
//
// Element styling for markdown shown as a plain document: the workspace
// document viewer and the Build Studio brief. The portal does not ship
// @tailwindcss/typography, so `prose` classes style nothing; each element gets
// its classes here instead, from --dpf-* theme tokens only (light, dark and
// per-org branding follow the theme). The user guide (DocRenderer) and wiki
// pages (WikiBodyRenderer) keep their own maps because they also resolve links,
// images, heading ids and wikilinks.

import type { RenderMarkdownOptions } from "@/lib/shared/markdown";

const HEADING = "font-semibold text-[var(--dpf-text)] first:mt-0";

export const DOCUMENT_MARKDOWN_OPTIONS: RenderMarkdownOptions = {
  classes: {
    h1: `text-lg ${HEADING} mt-6 mb-3`,
    h2: `text-base ${HEADING} mt-6 mb-2 pb-1 border-b border-[var(--dpf-border)]`,
    h3: `text-sm ${HEADING} mt-4 mb-2`,
    h4: `text-sm ${HEADING} mt-3 mb-1`,
    h5: `text-xs ${HEADING} mt-3 mb-1`,
    h6: `text-xs ${HEADING} mt-3 mb-1 text-[var(--dpf-muted)]`,
    p: "text-sm text-[var(--dpf-text)] leading-relaxed mb-3",
    ul: "text-sm text-[var(--dpf-text)] mb-3 ms-4 list-disc space-y-1",
    ol: "text-sm text-[var(--dpf-text)] mb-3 ms-4 list-decimal space-y-1",
    li: "leading-relaxed [&>ul]:mt-1 [&>ul]:mb-0 [&>ol]:mt-1 [&>ol]:mb-0",
    blockquote: "border-s-2 border-[var(--dpf-border)] ps-3 my-3 text-[var(--dpf-muted)] italic",
    hr: "border-t border-[var(--dpf-border)] my-6",
    a: "text-[var(--dpf-accent)] underline-offset-2 hover:underline",
    strong: "font-semibold text-[var(--dpf-text)]",
    em: "italic",
    s: "line-through text-[var(--dpf-muted)]",
    code: "text-xs px-1 py-0.5 rounded bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] border border-[var(--dpf-border)]",
    pre: "text-xs p-3 mb-3 rounded-md bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] border border-[var(--dpf-border)] overflow-x-auto",
    img: "max-w-full h-auto rounded-md border border-[var(--dpf-border)] my-3",
    table: "text-xs w-full border-collapse",
    th: "text-start px-2 py-1.5 border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] font-semibold text-[var(--dpf-text)]",
    td: "px-2 py-1.5 border border-[var(--dpf-border)] text-[var(--dpf-text)]",
  },
  tableWrapperClass: "overflow-x-auto mb-3",
  externalLinksInNewTab: true,
};
