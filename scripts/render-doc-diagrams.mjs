#!/usr/bin/env node
// scripts/render-doc-diagrams.mjs
//
// Build-time Mermaid rendering (EP-DOCS-SYSTEM Phase 2, WWMD DI-5C7B16CA4472).
// Renders every ```mermaid fence in the user guide to a committed, sanitized
// static SVG so BOTH surfaces (public Jekyll site + in-portal renderer) show an
// identical diagram with no client-side Mermaid runtime and no external CDN.
//
// Diagrams are keyed by ORDINAL (page slug + fence index), not content hash, so
// the Jekyll browser shim and the portal renderer can derive the same asset URL
// without re-canonicalizing the fence text. A manifest records the content hash
// of each fence purely to power `--check` freshness in CI.
//
//   node scripts/render-doc-diagrams.mjs           # render/refresh SVGs
//   node scripts/render-doc-diagrams.mjs --check    # fail if any SVG is stale/missing/orphaned
//
// Rendering goes through scripts/lib/mermaid-renderer.mjs: a local mermaid-cli
// if one is installed (MMDC=... overrides), otherwise the pinned
// minlag/mermaid-cli tool image through Docker. mermaid-cli is no longer a
// workspace dependency (BI-DBDB8C6D). `--check` stays pure Node.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { diagramSlug, DIAGRAMS_DIR } from "../apps/web/lib/docs/diagram-assets.mjs";
import { availableMermaidRenderer, renderMermaid, MERMAID_RENDERER_HINT } from "./lib/mermaid-renderer.mjs";
import {
  hasIntrinsicDocDiagramSize,
  normalizeDocDiagramSvg,
  normalizeDocDiagramSvgFile,
} from "./lib/doc-diagram-svg.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Doc roots whose ```mermaid fences are rendered to committed SVGs. The public
// Jekyll site publishes both docs/user-guide and docs/architecture pages.
const SOURCE_DIRS = [
  path.join(REPO_ROOT, "docs", "user-guide"),
  path.join(REPO_ROOT, "docs", "architecture"),
];
const DIAGRAMS_ABS = path.join(REPO_ROOT, DIAGRAMS_DIR);
const MANIFEST = path.join(DIAGRAMS_ABS, "manifest.json");
const PORTAL_VERSIONS = path.join(REPO_ROOT, "apps", "web", "lib", "docs", "diagram-versions.generated.mjs");

/**
 * Extract every ```mermaid fence body from one markdown document, in order.
 *
 * Exported and pure so the line-ending invariant is directly testable: fence
 * content is hashed to decide whether a committed SVG is stale, so CR must not
 * survive into that hash (BI-334CB7DE).
 */
export function extractFenceBodies(text) {
  // Strip CR before splitting. A file rewritten with CRLF endings would
  // otherwise re-hash EVERY fence in it and demand a re-render even though no
  // diagram changed - and git normalises on commit, so `git diff` shows nothing
  // to explain it. Line endings are not part of a diagram's identity.
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const bodies = [];
  let fence = null;
  let buf = [];
  for (const line of lines) {
    const m = line.match(/^\s*(```+|~~~+)\s*mermaid\s*$/i);
    if (!fence && m) {
      fence = m[1].slice(0, 3);
      buf = [];
      continue;
    }
    if (fence && line.trimStart().startsWith(fence)) {
      bodies.push(buf.join("\n").trim());
      fence = null;
      continue;
    }
    if (fence) buf.push(line);
  }
  return bodies;
}

/** Collect every ```mermaid fence: { slug, index, content }. */
function collectFences() {
  const fences = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith(".md")) continue;
      const rel = path.relative(REPO_ROOT, full).split(path.sep).join("/");
      const slug = diagramSlug(rel);
      const bodies = extractFenceBodies(fs.readFileSync(full, "utf-8"));
      bodies.forEach((content, index) => fences.push({ slug, index, content }));
    }
  };
  for (const dir of SOURCE_DIRS) walk(dir);
  return fences;
}

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
const assetRel = (slug, index) => `${DIAGRAMS_DIR}/${slug}/${index}.svg`;

// No output sanitization step: the SVGs are trusted build-time content (rendered
// from repo-authored ```mermaid fences, not user input) and are consumed only
// via <img src> — an <img>-loaded SVG is non-scriptable by the HTML spec — and
// the portal route additionally serves them under a `default-src 'none'` CSP.
// Regex-based HTML sanitization is intentionally NOT used (it is provably
// incomplete; the architectural control above is the real boundary).

function renderOne(content, outAbs, tmpDir, renderer) {
  const tmp = path.join(tmpDir, `d-${sha(content)}.mmd`);
  fs.writeFileSync(tmp, `${content}
`);
  try {
    renderMermaid({ input: tmp, output: outAbs, background: "transparent", renderer });
  } catch (err) {
    throw new Error(`render-doc-diagrams: failed to render ${path.relative(REPO_ROOT, outAbs)}${MERMAID_RENDERER_HINT}`, {
      cause: err,
    });
  }
  fs.writeFileSync(outAbs, normalizeDocDiagramSvg(fs.readFileSync(outAbs, "utf-8")));
  fs.rmSync(tmp, { force: true });
}

function loadManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, "utf-8")).diagrams || {}; } catch { return {}; }
}

function portalVersionsSource(diagrams) {
  return `// Generated by scripts/render-doc-diagrams.mjs. Do not edit.\nexport const DIAGRAM_VERSIONS = Object.freeze(${JSON.stringify(diagrams, null, 2)});\n`;
}

function main() {
  const check = process.argv.includes("--check");
  const fences = collectFences();
  const wanted = new Map(fences.map((f) => [`${f.slug}/${f.index}`, f]));
  const manifest = loadManifest();

  if (check) {
    const problems = [];
    for (const [key, f] of wanted) {
      const abs = path.join(REPO_ROOT, assetRel(f.slug, f.index));
      if (!fs.existsSync(abs)) problems.push(`missing SVG for ${key} — run: pnpm docs:diagrams`);
      else if (manifest[key] !== sha(f.content)) problems.push(`stale SVG for ${key} (fence changed) — run: pnpm docs:diagrams`);
      else if (!hasIntrinsicDocDiagramSize(fs.readFileSync(abs, "utf-8"))) {
        problems.push(`SVG for ${key} has no intrinsic dimensions — run: pnpm docs:diagrams`);
      }
    }
    for (const key of Object.keys(manifest)) if (!wanted.has(key)) problems.push(`orphaned diagram ${key} — run: pnpm docs:diagrams`);
    const expectedVersions = portalVersionsSource(manifest);
    if (!fs.existsSync(PORTAL_VERSIONS) || fs.readFileSync(PORTAL_VERSIONS, "utf-8") !== expectedVersions) {
      problems.push("portal diagram versions are stale — run: pnpm docs:diagrams");
    }
    if (problems.length) { console.error("Doc diagrams out of date:\n  " + problems.join("\n  ")); process.exit(1); }
    console.log(`Doc diagrams fresh (${wanted.size}).`);
    return;
  }

  // Render mode. Prune orphans, render/refresh, rewrite manifest.
  fs.mkdirSync(DIAGRAMS_ABS, { recursive: true });
  // Unique, unpredictable per-run temp dir (mkdtemp) for the intermediate .mmd
  // — avoids the predictable-temp-path race/symlink class.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dpf-diagrams-"));
  const renderer = availableMermaidRenderer();
  if (!renderer) {
    console.error(`render-doc-diagrams: no Mermaid renderer available.${MERMAID_RENDERER_HINT}`);
    process.exit(1);
  }

  try {
    for (const key of Object.keys(manifest)) {
      if (!wanted.has(key)) {
        const abs = path.join(REPO_ROOT, `${DIAGRAMS_DIR}/${key}.svg`);
        fs.rmSync(abs, { force: true });
      }
    }
    const next = {};
    let rendered = 0;
    for (const [key, f] of wanted) {
      const abs = path.join(REPO_ROOT, assetRel(f.slug, f.index));
      const hash = sha(f.content);
      if (manifest[key] !== hash || !normalizeDocDiagramSvgFile(abs)) {
        renderOne(f.content, abs, tmpDir, renderer);
        rendered++;
      }
      next[key] = hash;
    }
    fs.writeFileSync(MANIFEST, `${JSON.stringify({ generatedBy: "scripts/render-doc-diagrams.mjs", diagrams: next }, null, 2)}\n`);
    fs.writeFileSync(PORTAL_VERSIONS, portalVersionsSource(next));
    console.log(`Rendered ${rendered} diagram(s) via ${renderer.kind}; ${wanted.size} total in manifest.`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
