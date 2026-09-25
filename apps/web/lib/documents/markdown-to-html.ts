// Markdown -> standalone HTML for document export (BI-4865EB4D, slice S5 of
// BI-815D40C6).
//
// The dpf-doctools engine reads HTML, not markdown, so an exported markdown
// document goes markdown -> HTML -> convertDocument. The HTML comes from the
// renderer the document page already uses (react-markdown, with remark-gfm for
// tables), so the exported file matches what people read on the page. Its
// element tree is serialised here to a string: react-markdown builds plain
// intrinsic elements, and react-dom/server has no place in server code.
//
// Images: an embedded `data:image/...` picture is kept, so it lands inside the
// office file. A linked image becomes its alt text: the engine runs with no
// network, and a document must never make the converter fetch a URL.
// Raw HTML in the markdown is not rendered (react-markdown's default), and
// links pass react-markdown's safe-URL filter.

import { Fragment, isValidElement, type ReactNode } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

const EMBEDDED_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

const VOID_ELEMENTS = new Set(["area", "br", "col", "embed", "hr", "img", "input", "source", "track", "wbr"]);

/** The page's print styling: bordered tables, nothing else overridden. */
const EXPORT_STYLE = "table{border-collapse:collapse}th,td{border:1px solid currentColor;padding:4px 8px}";

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

/** Replace every non-embedded image with its alt text, before any URL is kept. */
function rehypeOfflineImages() {
  const visit = (node: HastNode) => {
    if (!node.children) return;
    node.children = node.children.map((child) => {
      if (child.type === "element" && child.tagName === "img") {
        const src = String(child.properties?.["src"] ?? "");
        if (!EMBEDDED_IMAGE.test(src)) {
          const alt = String(child.properties?.["alt"] ?? "").trim();
          return { type: "text", value: alt ? `[${alt}]` : "" };
        }
      }
      visit(child);
      return child;
    });
  };
  return (tree: HastNode) => visit(tree);
}

function urlTransform(url: string, key: string): string {
  if (key === "src" && EMBEDDED_IMAGE.test(url)) return url;
  return defaultUrlTransform(url);
}

function styleText(style: Record<string, unknown>): string {
  return Object.entries(style)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([name, value]) => `${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${String(value)}`)
    .join(";");
}

function attributes(props: Record<string, unknown>): string {
  let out = "";
  for (const [key, value] of Object.entries(props)) {
    if (key === "children" || key === "node" || value === false || value === null || value === undefined) continue;
    const name = key === "className" ? "class" : key === "htmlFor" ? "for" : key.toLowerCase();
    if (value === true) {
      out += ` ${name}`;
    } else if (key === "style" && typeof value === "object") {
      const css = styleText(value as Record<string, unknown>);
      if (css) out += ` style="${escapeAttribute(css)}"`;
    } else {
      out += ` ${name}="${escapeAttribute(Array.isArray(value) ? value.join(" ") : String(value))}"`;
    }
  }
  return out;
}

/** Serialise the intrinsic element tree react-markdown returns. */
function serialize(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return escapeText(String(node));
  if (Array.isArray(node)) return node.map(serialize).join("");
  if (!isValidElement(node)) return "";
  const props = (node.props ?? {}) as Record<string, unknown> & { children?: ReactNode };
  if (node.type === Fragment || typeof node.type !== "string") return serialize(props.children);
  const tag = node.type;
  if (VOID_ELEMENTS.has(tag)) return `<${tag}${attributes(props)}>`;
  return `<${tag}${attributes(props)}>${serialize(props.children)}</${tag}>`;
}

/** The HTML body markup for a markdown document. */
export function markdownToHtml(markdown: string): string {
  const tree = Markdown({
    children: markdown,
    remarkPlugins: [remarkGfm],
    rehypePlugins: [rehypeOfflineImages],
    urlTransform,
  });
  return serialize(tree);
}

/** A standalone HTML document for the engine, titled with the document's title. */
export function markdownToHtmlDocument(markdown: string, title: string): string {
  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8">',
    `<title>${escapeText(title)}</title>`,
    `<style>${EXPORT_STYLE}</style>`,
    "</head><body>",
    markdownToHtml(markdown),
    "</body></html>",
  ].join("\n");
}

/** Plain text as a standalone HTML document, whitespace preserved. */
export function plainTextToHtmlDocument(text: string, title: string): string {
  return markdownToHtmlDocument("", title).replace("<body>\n", `<body>\n<pre>${escapeText(text)}</pre>`);
}
