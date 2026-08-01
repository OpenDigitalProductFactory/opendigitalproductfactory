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
// SCOPE (BI-DOCIMPACT-CORPUS): frontmatter edges are collected from the WHOLE
// published doc corpus, not just docs/user-guide. The narrower walk was the
// blast-radius hole that let the BET-5 Neo4j/Qdrant retirement ship while
// /architecture/platform-overview/ — a published page whose entire "three data
// layers" section described Neo4j — went unflagged. `docs/architecture/**` is
// as customer-visible as `docs/user-guide/**`; the site publishes both.
// Widening is safe because edges are OPT-IN: a page contributes nothing until
// it declares `relatedCode:` / `relatedRoutes:`.
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
