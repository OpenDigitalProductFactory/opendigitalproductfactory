#!/usr/bin/env node
// scripts/fix-doc-links.mjs
//
// One-shot codemod that normalizes user-guide internal links to the canonical
// authoring convention (source-relative markdown paths ending in .md), using the
// same resolver as the checker. Deterministic cases only — it never guesses a
// target for a genuinely dead link. Run once to converge the corpus; the checker
// keeps it converged thereafter.
//
//   node scripts/fix-doc-links.mjs           # rewrite in place
//   node scripts/fix-doc-links.mjs --dry-run # print intended rewrites only

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDocLink, toPosix } from "../apps/web/lib/docs/doc-link-resolver.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USER_GUIDE_DIR = path.join(REPO_ROOT, "docs", "user-guide");
const INDEX = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "apps", "web", "lib", "docs", "doc-index.generated.json"), "utf-8"));

// Map a site-absolute public href back to a repo source path, if one exists.
const PUBLIC_TO_SOURCE = new Map();
for (const [sourcePath, page] of Object.entries(INDEX.pages)) {
  if (page.publishedPublic) PUBLIC_TO_SOURCE.set(page.publicHref, sourcePath);
}

/** Canonical source-relative .md link (plus anchor) from source page to target. */
function canonicalHref(sourcePath, targetSourcePath, anchor) {
  const rel = toPosix(path.posix.relative(path.posix.dirname(toPosix(sourcePath)), targetSourcePath));
  return anchor ? `${rel}#${anchor}` : rel;
}

function absoluteToSource(pathPart) {
  // Normalize to a pretty publicHref form and look it up.
  let href = pathPart.endsWith("/") ? pathPart : `${pathPart}/`;
  if (PUBLIC_TO_SOURCE.has(href)) return PUBLIC_TO_SOURCE.get(href);
  // Non-pretty (no trailing slash) — try appending .md source directly.
  const candidate = `docs${pathPart}.md`;
  if (INDEX.pages[candidate]?.publishedPublic) return candidate;
  const dirIndex = `docs${pathPart.replace(/\/$/, "")}/index.md`;
  if (INDEX.pages[dirIndex]?.publishedPublic) return dirIndex;
  return null;
}

function rewriteLine(sourcePath, line) {
  // Protect inline code spans.
  const codeSpans = [];
  const masked = line.replace(/`[^`]*`/g, (m) => { codeSpans.push(m); return `\x00${codeSpans.length - 1}\x00`; });
  const re = /(!?\[[^\]]*\]\()(\s*)(<[^>]*>|[^)\s]+)((?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\))/g;
  let changed = false;
  const out = masked.replace(re, (full, open, ws, rawHref, close) => {
    let href = rawHref;
    const angled = href.startsWith("<") && href.endsWith(">");
    if (angled) href = href.slice(1, -1);
    const res = resolveDocLink(sourcePath, href);
    let next = null;
    if (res.kind === "internal" && !res.canonical) {
      const tgt = res.target.sourcePath;
      if (INDEX.pages[tgt]?.publishedPublic) next = canonicalHref(sourcePath, tgt, res.anchor);
    } else if (res.kind === "absolute") {
      const src = absoluteToSource(res.pathPart);
      if (src) next = canonicalHref(sourcePath, src, res.anchor);
    }
    if (next && next !== href) {
      changed = true;
      return `${open}${ws}${angled ? `<${next}>` : next}${close}`;
    }
    return full;
  });
  const restored = out.replace(/\x00(\d+)\x00/g, (_, i) => codeSpans[Number(i)]);
  return { line: restored, changed };
}

function processFile(file, dryRun) {
  const sourcePath = toPosix(path.relative(REPO_ROOT, file));
  const raw = fs.readFileSync(file, "utf-8");
  const lines = raw.split("\n");
  let fence = null;
  let fileChanged = false;
  const changes = [];
  const nextLines = lines.map((line) => {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      if (fence && line.trimStart().startsWith(fence)) fence = null;
      else if (!fence) fence = fenceMatch[1].slice(0, 3);
      return line;
    }
    if (fence) return line;
    const { line: rewritten, changed } = rewriteLine(sourcePath, line);
    if (changed) { fileChanged = true; changes.push([line.trim(), rewritten.trim()]); }
    return rewritten;
  });
  if (fileChanged && !dryRun) fs.writeFileSync(file, nextLines.join("\n"));
  return { sourcePath, fileChanged, changes };
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.name.endsWith(".md")) out.push(full);
  }
  return out;
}

const dryRun = process.argv.includes("--dry-run");
let files = 0;
let total = 0;
for (const file of walk(USER_GUIDE_DIR).sort()) {
  const { sourcePath, fileChanged, changes } = processFile(file, dryRun);
  if (fileChanged) {
    files += 1;
    total += changes.length;
    if (dryRun) {
      console.log(`\n${sourcePath}`);
      for (const [before, after] of changes) console.log(`  - ${before}\n  + ${after}`);
    }
  }
}
console.log(`\n${dryRun ? "[dry-run] would rewrite" : "Rewrote"} ${total} link(s) across ${files} file(s).`);
