#!/usr/bin/env node
// scripts/gen-doc-impact.mjs
//
// EP-DOCS-SYSTEM Phase 4 — the doc-impact graph (filesystem-first).
//
// Generates apps/web/lib/docs/doc-impact.generated.json: a small, reviewable,
// bidirectional manifest linking published doc pages to the ROUTES and CODE
// that, when changed, should flag the page for review. Two edge sources:
//   1. DOCS_ROUTE_MAP (route -> doc) — the map that already powers contextual
//      help, inverted here so a route change flags its page (this is what the
//      Phase 3 gate already does structurally; the manifest makes it queryable).
//   2. `relatedRoutes:` / `relatedCode:` frontmatter on a page — explicit edges
//      the route map can't express, especially CODE paths so a *functionality*
//      change (not just a route-file edit) flags the affected pages.
//
// The manifest is the source-controlled contract; projecting stable edges into
// the DocumentReference / Postgres graph mirror is a later step, deliberately
// gated on this being green first (spec §5.5). Zero external dependencies.
//
// SCOPE: frontmatter edges are collected from the WHOLE
// published doc corpus, not just docs/user-guide. The narrower walk was the
// blast-radius hole that let the BET-5 Neo4j/Qdrant retirement ship while
// /architecture/platform-overview/ — a published page whose entire "three data
// layers" section described Neo4j — went unflagged. `docs/architecture/**` is
// as customer-visible as `docs/user-guide/**`; the site publishes both.
// Widening was safe because frontmatter edges are OPT-IN: a page contributed
// nothing until it declared `relatedCode:` / `relatedRoutes:`.
//
// EDGE SOURCE 3 closes that opt-in gap. Frontmatter protects only pages someone
// remembered to annotate, which is not the population that goes stale. A
// markdown link from a doc INTO a source file is an edge the author already
// wrote, so it is derived rather than declared — no annotation, no second place
// to keep in sync. Measured on this corpus: 27 declared code edges -> 155, with
// a maximum fan-out of 4 docs per file, so coverage rises without the gate
// becoming noise.
//
//   node scripts/gen-doc-impact.mjs           # write the manifest
//   node scripts/gen-doc-impact.mjs --check    # fail if stale, or edges are invalid

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRouteMap, docFileForDocsPath } from "./check-docs-impact.mjs";
import { publishedDocFiles } from "./lib/published-doc-roots.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROUTE_MAP_TS = path.join(REPO_ROOT, "apps", "web", "lib", "docs-route-map.ts");
const OUT_PATH = path.join(REPO_ROOT, "apps", "web", "lib", "docs", "doc-impact.generated.json");

/**
 * Extract a frontmatter list value (relatedRoutes / relatedCode). Supports YAML
 * block lists ("- item" lines) and inline arrays ("[a, b]"). Zero-dep.
 */
export function frontmatterList(markdown, key) {
  if (!markdown.startsWith("---")) return [];
  const end = markdown.indexOf("\n---", 3);
  if (end === -1) return [];
  const fm = markdown.slice(3, end);
  const lines = fm.split("\n");
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(new RegExp(`^${key}\\s*:\\s*(.*)$`));
    if (!m) continue;
    const inline = m[1].trim();
    if (inline.startsWith("[")) {
      for (const raw of inline.replace(/^\[|\]$/g, "").split(",")) {
        const v = raw.trim().replace(/^["']|["']$/g, "");
        if (v) items.push(v);
      }
    } else if (inline && inline !== "|") {
      items.push(inline.replace(/^["']|["']$/g, ""));
    }
    // Block list: subsequent "  - value" lines.
    for (let j = i + 1; j < lines.length; j++) {
      const li = lines[j].match(/^\s*-\s+(.*)$/);
      if (li) { items.push(li[1].trim().replace(/^["']|["']$/g, "")); continue; }
      if (/^\S/.test(lines[j])) break; // next top-level key
      if (lines[j].trim() === "") continue;
    }
    break;
  }
  return items;
}

function addEdge(map, key, val) {
  if (!map[key]) map[key] = [];
  if (!map[key].includes(val)) map[key].push(val);
}

// ─── Derived doc → code edges ────────────────────────────────────────────────
// The link/fence patterns are kept deliberately identical to
// scripts/check-doc-reference-integrity.mjs, which already parses these links to
// validate them. Same corpus, same syntax, same nesting rule for Next.js route
// groups — if one gate can see a reference, so should the other.

/** Inline markdown links and images, allowing ONE level of nested parens so
 *  `apps/web/app/(shell)/…` is captured whole rather than truncated at the "(". */
const LINK_RE = /!?\[[^\]]*\]\(\s*((?:[^()\s]|\([^()]*\))+)(?:\s+"[^"]*")?\s*\)/g;
/** Fenced blocks hold EXAMPLE links; stripped before extraction. */
const FENCE_RE = /^([`~]{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm;
const isExternalHref = (h) => /^(https?:|mailto:|tel:|data:|#)/i.test(h);

/** Source-ish extensions. `.md` is excluded on purpose: a doc linking a doc is a
 *  documentation-graph concern, not a code-change blast radius. */
const CODE_EXT_RE = /\.(ts|tsx|mts|mjs|js|jsx|prisma|sql|ya?ml|sh|ps1|json|toml)$/i;

/**
 * Repo-relative source files that `markdown` links to, resolved relative to the
 * doc's own directory.
 *
 * Silently skips links that do not resolve or escape the repo — a dead reference
 * is the Doc Reference Integrity gate's finding to report, and duplicating it
 * here would give the same defect two owners and two error messages.
 *
 * @returns {string[]} sorted, de-duplicated repo-relative POSIX paths
 */
export function linkedCodePaths(markdown, docPath, repoRoot) {
  const body = markdown.replace(FENCE_RE, "");
  const out = new Set();
  for (const m of body.matchAll(LINK_RE)) {
    const href = m[1].split("#")[0].trim();
    if (!href || isExternalHref(href) || !CODE_EXT_RE.test(href)) continue;
    const abs = path.resolve(path.dirname(path.join(repoRoot, docPath)), href);
    const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
    if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    out.add(rel);
  }
  return [...out].sort();
}

export function buildManifest() {
  const entries = parseRouteMap(fs.readFileSync(ROUTE_MAP_TS, "utf-8"));
  const routeToDocs = {};
  const codeToDocs = {};
  const docToRoutes = {};
  const docToCode = {};
  const problems = [];

  // 1. Route -> doc, inverted from DOCS_ROUTE_MAP.
  for (const { routePrefix, docsPath } of entries) {
    const doc = docFileForDocsPath(docsPath);
    addEdge(routeToDocs, routePrefix, doc);
    addEdge(docToRoutes, doc, routePrefix);
  }

  // 2. Frontmatter relatedRoutes / relatedCode edges, across every published page.
  for (const sourcePath of publishedDocFiles(REPO_ROOT)) {
    const raw = fs.readFileSync(path.join(REPO_ROOT, sourcePath), "utf-8");
    for (const route of frontmatterList(raw, "relatedRoutes")) {
      if (!route.startsWith("/")) problems.push(`${sourcePath}: relatedRoutes "${route}" must start with /`);
      addEdge(routeToDocs, route, sourcePath);
      addEdge(docToRoutes, sourcePath, route);
    }
    for (const code of frontmatterList(raw, "relatedCode")) {
      const abs = path.join(REPO_ROOT, code);
      if (!fs.existsSync(abs)) problems.push(`${sourcePath}: relatedCode "${code}" does not exist`);
      addEdge(codeToDocs, code, sourcePath);
      addEdge(docToCode, sourcePath, code);
    }

    // 3. DERIVED edges: source files the page already links to. Declared
    //    `relatedCode:` edges are opt-in, so they protect only pages somebody
    //    remembered to annotate — the same "someone must remember" failure the
    //    graph exists to remove. A markdown link from a doc INTO a source file
    //    is an edge the author already wrote; deriving it needs no annotation
    //    and no second place to keep in sync.
    for (const code of linkedCodePaths(raw, sourcePath, REPO_ROOT)) {
      addEdge(codeToDocs, code, sourcePath);
      addEdge(docToCode, sourcePath, code);
    }
  }

  const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k].sort()]));
  return {
    manifest: {
      generatedBy: "scripts/gen-doc-impact.mjs",
      routeToDocs: sortObj(routeToDocs),
      codeToDocs: sortObj(codeToDocs),
      docToRoutes: sortObj(docToRoutes),
      docToCode: sortObj(docToCode),
    },
    problems,
  };
}

function serialize(m) {
  return `${JSON.stringify(m, null, 2)}\n`;
}

function main() {
  const check = process.argv.includes("--check");
  const { manifest, problems } = buildManifest();
  if (problems.length) {
    console.error("Doc-impact edges invalid:\n  " + problems.join("\n  "));
    process.exit(1);
  }
  const next = serialize(manifest);
  if (check) {
    const cur = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, "utf-8") : "";
    if (cur !== next) {
      console.error("doc-impact.generated.json is stale. Run: node scripts/gen-doc-impact.mjs");
      process.exit(1);
    }
    console.log(`doc-impact manifest fresh (${Object.keys(manifest.codeToDocs).length} code edges, ${Object.keys(manifest.routeToDocs).length} route edges).`);
    return;
  }
  fs.writeFileSync(OUT_PATH, next);
  console.log(`Wrote ${path.relative(REPO_ROOT, OUT_PATH)} (${Object.keys(manifest.codeToDocs).length} code edges, ${Object.keys(manifest.routeToDocs).length} route edges).`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("gen-doc-impact.mjs")) {
  main();
}
