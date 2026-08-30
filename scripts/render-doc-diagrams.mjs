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
// Requires @mermaid-js/mermaid-cli AND its puppeteer browser — runs in the
// convergence sandbox or a compile-ready environment, NOT a source-only
// worktree. The mermaid-cli JS entry is resolved and run through the current
// Node, which is portable across platforms; override with
// MMDC=/path/to/mermaid-cli/src/cli.js.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { diagramSlug, DIAGRAMS_DIR } from "../apps/web/lib/docs/diagram-assets.mjs";
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
// Resolve mermaid-cli's JS ENTRY by default, not the `.bin` shim.
//
// `node_modules/.bin/mmdc` is a POSIX `sh` script; on Windows the runnable
// sibling is `mmdc.CMD`, and Node's execFileSync refuses to spawn either
// without a shell. The failure surfaces as an execFileSync object dump with
// `pid: 0` and no stderr, which reads as an unexplained crash rather than
// "wrong file for this platform" (BI-334CB7DE).
//
// Running the JS entry through the CURRENT Node interpreter is portable on
// every platform and needs no shell, so it is the default. The `.bin` shim
// stays as the fallback for a layout where the entry is missing, and MMDC
// still overrides both.
function resolveMmdc() {
  if (process.env.MMDC) return process.env.MMDC;
  const jsEntry = path.join(REPO_ROOT, "node_modules", "@mermaid-js", "mermaid-cli", "src", "cli.js");
  if (fs.existsSync(jsEntry)) return jsEntry;
  return path.join(REPO_ROOT, "node_modules", ".bin", "mmdc");
}
const MMDC = resolveMmdc();

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

function renderOne(content, outAbs, tmpDir, puppeteerCfg) {
  const tmp = path.join(tmpDir, `d-${sha(content)}.mmd`);
  fs.writeFileSync(tmp, `${content}\n`);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const mmdcArgs = ["-i", tmp, "-o", outAbs, "-b", "transparent", "--puppeteerConfigFile", puppeteerCfg];
  // MMDC may point at mermaid-cli's JS entry (e.g. .../mermaid-cli/src/cli.js):
  // on Windows the .bin shim is a .cmd, which Node refuses to spawn without a
  // shell, so running the JS entry through the current Node is the portable path.
  const [cmd, args] = /\.[cm]?js$/i.test(MMDC)
    ? [process.execPath, [MMDC, ...mmdcArgs]]
    : [MMDC, mmdcArgs];
  try {
    execFileSync(cmd, args, {
      stdio: ["ignore", "ignore", "inherit"],
    });
  } catch (err) {
    // mermaid-cli drives headless Chrome through puppeteer. A worktree that
    // installed dependencies without the browser download fails here, and the
    // raw execFileSync error is an object dump that names neither cause nor
    // remedy. Say both (BI-334CB7DE).
    const hint =
      "\n  Rendering a Mermaid fence needs mermaid-cli AND its puppeteer browser." +
      "\n  If the error above mentions chrome-headless-shell or a browser download," +
      "\n  install it once:  npx puppeteer browsers install chrome-headless-shell" +
      `\n  Binary in use: ${MMDC}` +
      "\n  Override with MMDC=/path/to/mermaid-cli/src/cli.js if it lives elsewhere.";
    throw new Error(`render-doc-diagrams: failed to render ${path.relative(REPO_ROOT, outAbs)}${hint}`, {
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
  // and puppeteer config — avoids the predictable-temp-path race/symlink class.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dpf-diagrams-"));
  const puppeteerCfg = path.join(tmpDir, "puppeteer.json");
  const cfg = { args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] };
  // On Alpine/musl (the convergence sandbox), point at the system chromium —
  // Google's glibc Chrome cannot run there. Set PUPPETEER_EXECUTABLE_PATH.
  if (process.env.PUPPETEER_EXECUTABLE_PATH) cfg.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  fs.writeFileSync(puppeteerCfg, JSON.stringify(cfg));

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
        renderOne(f.content, abs, tmpDir, puppeteerCfg);
        rendered++;
      }
      next[key] = hash;
    }
    fs.writeFileSync(MANIFEST, `${JSON.stringify({ generatedBy: "scripts/render-doc-diagrams.mjs", diagrams: next }, null, 2)}\n`);
    fs.writeFileSync(PORTAL_VERSIONS, portalVersionsSource(next));
    console.log(`Rendered ${rendered} diagram(s); ${wanted.size} total in manifest.`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
