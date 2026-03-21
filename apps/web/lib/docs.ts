// apps/web/lib/docs.ts
// Utilities for loading and parsing user-guide markdown documentation.
// Server-only — uses Node fs for file reading.
// Client-safe types/constants are in docs-types.ts (no Node imports).

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

// Re-export everything from docs-types so server code can import from one place
export { AREA_META, AREA_ORDER } from "./docs-types";
export type { DocPage, DocHeading, DocsIndex } from "./docs-types";
import type { DocPage, DocHeading, DocsIndex } from "./docs-types";

// ── Frontmatter parsing ─────────────────────────────────────────────────────

export function parseDocFrontmatter(raw: string): DocPage {
  const { data, content } = matter(raw);
  return {
    slug: "",
    title: (data.title as string) ?? "Untitled",
    area: (data.area as string) ?? "unknown",
    order: (data.order as number) ?? 99,
    lastUpdated: data.lastUpdated instanceof Date
      ? data.lastUpdated.toISOString().slice(0, 10)
      : (data.lastUpdated as string) ?? "",
    updatedBy: (data.updatedBy as string) ?? "",
    content: content.trim(),
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
    const slug = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-");
    headings.push({ level, text, slug });
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

// Next.js runs from apps/web — go up two levels to repo root (same as codebase-tools.ts)
const PROJECT_ROOT = path.resolve(process.cwd(), "..", "..");
const USER_GUIDE_DIR = path.join(PROJECT_ROOT, "docs", "user-guide");

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
