#!/usr/bin/env node
// scripts/check-doc-links.mjs
//
// Docs Link Integrity — validate every inline link, image, and anchor in the
// user guide against the canonical doc index, on BOTH publishing surfaces.
// Zero external dependencies so it runs unchanged in CI and locally.
//
// Exit non-zero on any error-level finding. Warnings are reported but do not
// fail unless --strict is passed (the converged end-state gate).
//
// Usage:
//   node scripts/check-doc-links.mjs            # gate: fail on errors
//   node scripts/check-doc-links.mjs --strict   # also fail on convention warnings
//   node scripts/check-doc-links.mjs --json      # machine-readable findings

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDocLink, toPosix } from "../apps/web/lib/docs/doc-link-resolver.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USER_GUIDE_DIR = path.join(REPO_ROOT, "docs", "user-guide");
const INDEX_PATH = path.join(REPO_ROOT, "apps", "web", "lib", "docs", "doc-index.generated.json");

const ERROR_CATEGORIES = new Set([
  "dead-page",
  "dead-anchor",
  "dead-asset",
  "unpublished-target",
  "noncanonical-extensionless",
  "absolute-surface-url",
  "invalid-link",
]);

function loadIndex() {
  if (!fs.existsSync(INDEX_PATH)) {
    console.error("Missing doc index. Run: node scripts/gen-doc-index.mjs");
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"));
}

function walkMd(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMd(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/**
 * Blank out frontmatter, fenced code, and inline code so example links are not
 * checked. Every stripped line is replaced with an empty line (not removed) so
 * reported line numbers match the real file.
 */
function stripCode(markdown) {
  const lines = markdown.split("\n");
  const out = [];
  let fence = null;
  let inFrontmatter = lines[0] === "---";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inFrontmatter) {
      out.push("");
      if (i > 0 && line === "---") inFrontmatter = false;
      continue;
    }
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      if (fence && line.trimStart().startsWith(fence)) fence = null;
      else if (!fence) fence = fenceMatch[1].slice(0, 3);
      out.push("");
      continue;
    }
    if (fence) { out.push(""); continue; }
    out.push(line.replace(/`[^`]*`/g, (m) => " ".repeat(m.length)));
  }
  return out.join("\n");
}

/** Extract inline links and images: [text](href) and ![alt](src), with line numbers. */
function extractLinks(markdown) {
  const links = [];
  const text = stripCode(markdown);
  const re = /(!?)\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const isImage = m[1] === "!";
    let href = m[2];
    if (href.startsWith("<") && href.endsWith(">")) href = href.slice(1, -1);
    const line = text.slice(0, m.index).split("\n").length;
    links.push({ isImage, href, line });
  }
  return links;
}

export { extractLinks, stripCode, ERROR_CATEGORIES };

export function checkFile(sourcePath, markdown, index, findings) {
  for (const { isImage, href, line } of extractLinks(markdown)) {
    const res = resolveDocLink(sourcePath, href);
    const at = { sourcePath, line, href };
    switch (res.kind) {
      case "external":
      case "anchor-external":
        break; // external URLs validated by the scheduled crawl, not this gate
      case "invalid":
        findings.push({ ...at, category: "invalid-link", detail: res.reason });
        break;
      case "absolute":
        findings.push({ ...at, category: "absolute-surface-url", detail: "site-absolute URL authored in source; link to the source .md instead" });
        break;
      case "asset": {
        const abs = path.join(REPO_ROOT, res.sourcePath);
        if (!fs.existsSync(abs)) findings.push({ ...at, category: "dead-asset", detail: res.sourcePath });
        break;
      }
      case "anchor": {
        // same-page anchor
        const page = index.pages[toPosix(sourcePath)];
        if (res.anchor && page && !page.anchors.includes(res.anchor)) {
          findings.push({ ...at, category: "dead-anchor", detail: `#${res.anchor} not a heading on this page` });
        }
        break;
      }
      case "internal": {
        if (isImage) break; // images handled by asset kind
        const tgt = res.target.sourcePath;
        const page = index.pages[tgt];
        if (!page) { findings.push({ ...at, category: "dead-page", detail: tgt }); break; }
        if (!page.publishedPublic) { findings.push({ ...at, category: "unpublished-target", detail: `${tgt} is not published on the public site; use an external link` }); break; }
        if (!res.canonical) { findings.push({ ...at, category: "noncanonical-extensionless", detail: `link to ${tgt} without .md; append .md so both renderers agree` }); }
        if (res.anchor && !page.anchors.includes(res.anchor)) {
          findings.push({ ...at, category: "dead-anchor", detail: `#${res.anchor} not a heading on ${tgt}` });
        }
        break;
      }
    }
  }
}

function main() {
  const strict = process.argv.includes("--strict");
  const asJson = process.argv.includes("--json");
  const index = loadIndex();
  const findings = [];
  for (const file of walkMd(USER_GUIDE_DIR).sort()) {
    const sourcePath = toPosix(path.relative(REPO_ROOT, file));
    checkFile(sourcePath, fs.readFileSync(file, "utf-8"), index, findings);
  }

  const errors = findings.filter((f) => ERROR_CATEGORIES.has(f.category));
  const failing = strict ? errors : errors; // all current error categories fail; kept explicit for future warn tiers

  if (asJson) {
    console.log(JSON.stringify({ total: findings.length, errors: errors.length, findings }, null, 2));
  } else {
    const byCat = {};
    for (const f of findings) byCat[f.category] = (byCat[f.category] || 0) + 1;
    console.log("Docs Link Integrity");
    console.log("===================");
    console.log(`Scanned ${walkMd(USER_GUIDE_DIR).length} user-guide pages against ${index.pageCount} indexed pages.`);
    console.log("");
    for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${ERROR_CATEGORIES.has(cat) ? "ERROR" : "warn "}  ${String(n).padStart(4)}  ${cat}`);
    }
    console.log("");
    if (failing.length) {
      console.log(`First ${Math.min(40, failing.length)} findings:`);
      for (const f of failing.slice(0, 40)) {
        console.log(`  ${f.sourcePath}:${f.line}  [${f.category}]  (${f.href})  ${f.detail || ""}`);
      }
      console.log("");
      console.log(`FAIL — ${failing.length} error-level finding(s).`);
    } else {
      console.log("PASS — no error-level findings.");
    }
  }
  process.exit(failing.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("check-doc-links.mjs")) {
  main();
}
