// apps/web/lib/docs.ts
// Utilities for loading and parsing user-guide markdown documentation.
// Server-only — uses Node fs for file reading.
// Client-safe types/constants are in docs-types.ts (no Node imports).

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { slugifyHeading } from "../docs/doc-link-resolver.mjs";

// Re-export everything from docs-types so server code can import from one place
export { AREA_META, AREA_ORDER } from "./docs-types";
export type { DocPage, DocHeading, DocsIndex } from "./docs-types";
import type { DocPage, DocHeading, DocsIndex } from "./docs-types";

// ── Frontmatter parsing ─────────────────────────────────────────────────────

function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[`*_~>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveDocDescription(markdown: string): string {
  const prose = markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .split(/\n\s*\n/)
    .find((block) => {
      const trimmed = block.trim();
      return (
        trimmed.length > 0 &&
        !/^(#{1,6}\s|[-*+]\s|\d+\.\s|\|)/.test(trimmed)
      );
    });

  const description = prose ? markdownToPlainText(prose) : "";
  return description.length > 240 ? `${description.slice(0, 237).trimEnd()}...` : description;
}

/** Convert enough of a page to readable Fuse.js input without shipping raw Markdown noise. */
export function buildDocSearchText(markdown: string, limit = 2_000): string {
  return markdownToPlainText(markdown).slice(0, limit).trimEnd();
}

export function parseDocFrontmatter(raw: string): DocPage {
  const { data, content } = matter(raw);
  const normalizedContent = content.trim();
  const authoredDescription =
    typeof data.description === "string" ? data.description.trim() : "";
  return {
    slug: "",
    title: (data.title as string) ?? "Untitled",
    description: authoredDescription || deriveDocDescription(normalizedContent),
    area: (data.area as string) ?? "unknown",
    order: (data.order as number) ?? 99,
    content: normalizedContent,
    relatedSpecs: (data.relatedSpecs as string[]) ?? [],
    roles: (data.roles as string[]) ?? [],
  };
}

// ── Heading extraction (for table of contents) ──────────────────────────────

export function extractHeadings(markdown: string): DocHeading[] {
  const headings: DocHeading[] = [];
  const regex = /^(#{2,3})\s+(.+)$/gm;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const level = match[1]!.length;
    const text = match[2]!.trim();
    headings.push({ level, text, slug: slugifyHeading(text) });
  }
  return headings;
}

// ── Index building ──────────────────────────────────────────────────────────

export function buildDocsIndex(docs: DocPage[]): DocsIndex {
  const index: DocsIndex = {};
  for (const doc of docs) {
    if (!index[doc.area]) index[doc.area] = [];
    index[doc.area]!.push(doc);
  }
  for (const area of Object.keys(index)) {
    index[area]!.sort((a, b) => a.order - b.order);
  }
  return index;
}

// ── File system loading ─────────────────────────────────────────────────────

// In production Docker, cwd is /app and docs live at /app/docs/user-guide.
// In local dev, Next.js cwd is apps/web so we go up two levels to repo root.
const prodPath = path.join(process.cwd(), "docs", "user-guide");
const devPath = path.resolve(process.cwd(), "..", "..", "docs", "user-guide");
const USER_GUIDE_DIR = fs.existsSync(prodPath) ? prodPath : devPath;

/** Load a single doc page by slug (e.g. "getting-started/index"). */
export function loadDocPage(slug: string): DocPage | null {
  const filePath = path.join(USER_GUIDE_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  const doc = parseDocFrontmatter(raw);
  doc.slug = slug;
  return doc;
}

/** Load all doc pages from the user-guide directory. */
export function loadAllDocs(): DocPage[] {
  const docs: DocPage[] = [];
  if (!fs.existsSync(USER_GUIDE_DIR)) return docs;

  function walk(dir: string, prefix: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith(".md")) {
        const slug = `${prefix}${entry.name.replace(/\.md$/, "")}`;
        const raw = fs.readFileSync(path.join(dir, entry.name), "utf-8");
        const doc = parseDocFrontmatter(raw);
        doc.slug = slug;
        docs.push(doc);
      }
    }
  }

  walk(USER_GUIDE_DIR, "");
  return docs;
}
