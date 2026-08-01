// scripts/lib/published-doc-roots.mjs
//
// THE PROBLEM IT FIXES: "which docs are published?" was answered independently
// by every doc gate, and the answers drifted. The doc-impact graph
// (scripts/gen-doc-impact.mjs) walked ONLY docs/user-guide, while the public
// Jekyll site at opendigitalproductfactory.com publishes essentially all of
// docs/** — so the entire docs/architecture corpus (72 pages, including
// /architecture/platform-overview/) had ZERO blast-radius coverage. A change
// could retire a whole datastore and no gate would flag the published page that
// described it. That is exactly how the BET-5 Neo4j/Qdrant retirement left
// platform-overview.md describing services that no longer exist.
//
// THE FIX: one module derives the published corpus from the ONE artifact that
// actually decides it — docs/_config.yml's `exclude:` list, which is what
// GitHub Pages itself obeys. A page newly excluded from the site drops out of
// the gates automatically; a new doc directory is covered the day it lands,
// without anyone remembering to widen a script.
//
// AGENTS.md §1 "single source of truth": each fact in exactly one place.
// Zero external dependencies (the doc gates are plain node, no YAML parser).

import fs from "node:fs";
import path from "node:path";

/** Repo-relative root of the published documentation site. */
export const DOCS_DIRNAME = "docs";

/**
 * Extract the `exclude:` block-list from docs/_config.yml.
 *
 * Deliberately narrow: this is the one key we need, the file is ours, and the
 * shape is a plain YAML block list of paths. Anything more warrants a real YAML
 * dependency, which the doc gates intentionally avoid.
 *
 * @param {string} yamlText contents of docs/_config.yml
 * @returns {string[]} excluded paths, relative to docs/
 */
export function parseJekyllExcludes(yamlText) {
  const lines = yamlText.split("\n");
  const excludes = [];
  let inExclude = false;
  for (const line of lines) {
    if (/^exclude\s*:\s*$/.test(line)) { inExclude = true; continue; }
    if (!inExclude) continue;
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item) {
      const value = item[1].trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
      if (value) excludes.push(value);
      continue;
    }
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    break; // next top-level key ends the block
  }
  return excludes;
}

/**
 * True when `relPath` (relative to docs/) is excluded from the published site.
 * Matches a file exactly or any file beneath an excluded directory.
 */
export function isExcludedFromSite(relPath, excludes) {
  return excludes.some((ex) => relPath === ex || relPath.startsWith(`${ex}/`));
}

/**
 * Every markdown page the public site actually publishes, as repo-relative
 * POSIX paths, sorted for deterministic generated output.
 *
 * @param {string} repoRoot absolute path to the repository root
 * @returns {string[]} e.g. ["docs/architecture/platform-overview.md", ...]
 */
export function publishedDocFiles(repoRoot) {
  const docsDir = path.join(repoRoot, DOCS_DIRNAME);
  const configPath = path.join(docsDir, "_config.yml");
  const excludes = fs.existsSync(configPath)
    ? parseJekyllExcludes(fs.readFileSync(configPath, "utf-8"))
    : [];

  const out = [];
  const walk = (absDir, relDir) => {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      // Jekyll never publishes underscore-prefixed dirs (_layouts, _includes).
      if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (isExcludedFromSite(rel, excludes)) continue;
      const abs = path.join(absDir, entry.name);
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.name.endsWith(".md")) out.push(`${DOCS_DIRNAME}/${rel}`);
    }
  };
  walk(docsDir, "");
  return out.sort();
}
