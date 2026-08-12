#!/usr/bin/env node
// scripts/gen-doc-index.mjs
//
// Generate apps/web/lib/docs/doc-index.generated.json — the corpus index the
// link checker and portal use to validate that a resolved DocTarget points at a
// real, published page and a real heading anchor. Zero external dependencies.
//
// Usage:
//   node scripts/gen-doc-index.mjs           # write the index
//   node scripts/gen-doc-index.mjs --check   # fail if the committed index is stale

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  slugifyHeading,
  sourcePathToPublicHref,
  sourcePathToPortalHref,
  isPublicPublished,
  isPortalPublished,
  toPosix,
} from "../apps/web/lib/docs/doc-link-resolver.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_DIR = path.join(REPO_ROOT, "docs");
const OUT_PATH = path.join(REPO_ROOT, "apps", "web", "lib", "docs", "doc-index.generated.json");

/** Recursively collect every .md file under docs/. */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** Strip YAML frontmatter, then extract heading anchors, skipping fenced code. */
export function extractAnchors(markdown) {
  let body = markdown;
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end !== -1) body = body.slice(body.indexOf("\n", end + 1) + 1);
  }
  const anchors = [];
  const seen = new Map();
  let fence = null; // active code-fence marker (``` or ~~~), or null
  for (const line of body.split("\n")) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      if (fence && line.trimStart().startsWith(fence)) fence = null;
      else if (!fence) fence = fenceMatch[1].slice(0, 3);
      continue;
    }
    if (fence) continue;
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!h) continue;
    let slug = slugifyHeading(h[2]);
    if (!slug) continue;
    // De-duplicate the way GFM/kramdown do: append -1, -2, ...
    if (seen.has(slug)) {
      const n = seen.get(slug) + 1;
      seen.set(slug, n);
      slug = `${slug}-${n}`;
    } else {
      seen.set(slug, 0);
    }
    anchors.push(slug);
  }
  return anchors;
}

export function buildIndex() {
  const pages = {};
  for (const file of walk(DOCS_DIR).sort()) {
    const sourcePath = toPosix(path.relative(REPO_ROOT, file));
    const publishedPublic = isPublicPublished(sourcePath);
    const publishedPortal = isPortalPublished(sourcePath);
    if (!publishedPublic && !publishedPortal) continue;
    // Normalize newlines so Windows (CRLF) and Linux (LF) checkouts produce
    // the same anchors/index. Without this, --check fails on CI after a
    // Windows pre-commit regen (heading splits and frontmatter edges differ).
    const raw = fs.readFileSync(file, "utf-8").replace(/\r\n/g, "\n");
    pages[sourcePath] = {
      publicHref: sourcePathToPublicHref(sourcePath),
      portalHref: sourcePathToPortalHref(sourcePath),
      publishedPublic,
      publishedPortal,
      anchors: extractAnchors(raw),
    };
  }
  return { generatedBy: "scripts/gen-doc-index.mjs", root: "docs", pageCount: Object.keys(pages).length, pages };
}

function serialize(index) {
  return `${JSON.stringify(index, null, 2)}\n`;
}

function main() {
  const check = process.argv.includes("--check");
  const index = buildIndex();
  const next = serialize(index);
  if (check) {
    const current = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, "utf-8") : "";
    if (current !== next) {
      console.error("doc-index.generated.json is stale. Run: node scripts/gen-doc-index.mjs");
      process.exit(1);
    }
    console.log(`doc index fresh (${index.pageCount} pages).`);
    return;
  }
  fs.writeFileSync(OUT_PATH, next);
  console.log(`Wrote ${path.relative(REPO_ROOT, OUT_PATH)} (${index.pageCount} pages).`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("gen-doc-index.mjs")) {
  main();
}
