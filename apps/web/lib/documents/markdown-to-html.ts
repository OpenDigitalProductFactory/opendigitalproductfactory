// Markdown -> standalone HTML for document export (BI-4865EB4D, slice S5 of
// BI-815D40C6).
//
// The dpf-doctools engine reads HTML, not markdown, so an exported markdown
// document goes markdown -> HTML -> convertDocument. The HTML comes from
// renderMarkdown() (lib/shared/markdown.ts), the renderer the document page
// uses, so the exported file matches what people read on the page.
//
// Images: an embedded `data:image/...` picture is kept, so it lands inside the
// office file. A linked image becomes its alt text: the engine runs with no
// network, and a document must never make the converter fetch a URL.
// Raw HTML in the markdown is not rendered, and links pass markdown-it's
// URL validation.

// Relative, with its extension: docs/architecture/generate-docx-from-markdown.mjs
// imports this file straight into Node, which resolves neither "@/" nor an
// extensionless path.
import { escapeHtml, renderMarkdown, type RenderMarkdownOptions } from "../shared/markdown.ts";

const EMBEDDED_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

/** The page's print styling: bordered tables, nothing else overridden. */
const EXPORT_STYLE = "table{border-collapse:collapse}th,td{border:1px solid currentColor;padding:4px 8px}";

const EXPORT_OPTIONS: RenderMarkdownOptions = {
  resolveImage: (src) => (EMBEDDED_IMAGE.test(src) ? src : null),
};

/** The HTML body markup for a markdown document. */
export function markdownToHtml(markdown: string): string {
  return renderMarkdown(markdown, EXPORT_OPTIONS);
}

/** A standalone HTML document for the engine, titled with the document's title. */
export function markdownToHtmlDocument(markdown: string, title: string): string {
  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${EXPORT_STYLE}</style>`,
    "</head><body>",
    markdownToHtml(markdown),
    "</body></html>",
  ].join("\n");
}

/** Plain text as a standalone HTML document, whitespace preserved. */
export function plainTextToHtmlDocument(text: string, title: string): string {
  return markdownToHtmlDocument("", title).replace("<body>\n", `<body>\n<pre>${escapeHtml(text)}</pre>`);
}
