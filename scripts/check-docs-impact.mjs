#!/usr/bin/env node
// scripts/check-docs-impact.mjs
//
// EP-DOCS-SYSTEM Phase 3 — the surface-agnostic Docs Impact Gate.
//
// THE PROBLEM IT FIXES: user-guide pages decay because a PR can change a
// user-facing screen without touching the page that documents it, and nothing
// notices. AGENTS.md §6 makes docs an intrinsic resource, but the Spec/Plan/Doc
// gate is satisfied by editing ANY docs/** file — it never ties a specific route
// change to its specific user-guide page.
//
// THE FIX: enforce the link at the one chokepoint every build surface (Claude
// Code / Codex / Grok / Build Studio) traverses — the PR. When a PR changes a
// user-facing route whose page IS documented (via DOCS_ROUTE_MAP, the route->doc
// map that already powers contextual help), this gate requires EITHER an update
// to the linked user-guide page(s) OR a `Docs-Impact-Decision:` trailer saying
// why the docs don't change. It reads the evidence, not which surface produced
// it ("governance approves evidence, not provenance" — AGENTS.md §17). The
// documentation-specialist coworker is the executor that repairs flagged pages;
// this gate is the enforcement that makes the work visible.
//
// It runs AFTER Docs Link Integrity so a required doc update can't satisfy the
// gate while adding broken links.
//
// Single source of truth: docs/superpowers/specs/2026-07-16-documentation-system-design.md §5.4.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { requireChangedFiles } from "./lib/git-changed-files.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROUTE_MAP_TS = path.join(REPO_ROOT, "apps", "web", "lib", "docs-route-map.ts");
const ATTESTATION_RE = /Docs-Impact-Decision:/i;

// Only user-facing page routes gate (not API route.ts). Test/story files never.
const PAGE_FILE_RE = /^apps\/web\/app\/.*\/page\.tsx$/;
const EXCLUDE_RE = /\.(test|spec|stories)\.tsx$/;

// Dependency-manifest files: package manifests, lockfiles, and the workspace
// catalog. A change whose ENTIRE diff is these carries no source (.ts/.tsx/.js)
// and no doc (.md) file, so there is nothing for a *docs* gate to enforce.
// A doc may cite pnpm-lock.yaml / package.json (they become code->doc edges in
// doc-impact.generated.json), which used to flag every dependency bump as an
// "impacting change" needing a Docs-Impact-Decision trailer — a trailer a bot
// author (e.g. Dependabot) structurally cannot add, wedging every bump PR.
// The exemption reads the evidence (the file set), not the author, so it applies
// identically to any surface. It cannot smuggle a source or doc edit past this
// gate: any non-manifest file in the diff makes the set non-manifest and the
// gate runs in full. Other guards (build-script-policy, lockfile age, …) still
// run on these files — only the *docs* concern is short-circuited.
const DEPENDENCY_MANIFEST_RE =
  /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/;

/** True iff the diff is non-empty and EVERY file is a dependency-manifest file. */
export function isDependencyOnlyChange(changedFiles) {
  return changedFiles.length > 0 && changedFiles.every((f) => DEPENDENCY_MANIFEST_RE.test(f));
}

// Command-injection hygiene (mirrors check-ux-fit-decision.mjs): pin the ref /
// path character sets so a forged CI value can't smuggle git option flags or
// shell metachars through execFile. Path set includes Next route punctuation
// — route groups `(shell)` and dynamic/catch-all `[id]` / `[[...slug]]` — and
// `@`, which appears in scoped package dirs and in pnpm's patch filenames
// (`patches/image-size@1.2.1.patch`). `@` is not a shell metachar and these
// values are passed via execFile (no shell), so the injection surface is
// unchanged; the leading-`-` option-smuggling guard below is the real control.
const REF_RE = /^[A-Za-z0-9._\-/]{1,200}$/;
const PATH_RE = /^[A-Za-z0-9._\-/()[\]@]+$/;

function assertSafeRef(ref, label) {
  if (!REF_RE.test(ref) || ref.startsWith("-")) throw new Error(`[docs-impact-gate] refusing unsafe ${label}: ${JSON.stringify(ref)}`);
  return ref;
}
function assertSafePath(p) {
  if (!PATH_RE.test(p) || p.startsWith("-")) throw new Error(`[docs-impact-gate] refusing unsafe path: ${JSON.stringify(p)}`);
  return p;
}
function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    return (e.stdout && e.stdout.toString()) || "";
  }
}

/** Parse DOCS_ROUTE_MAP entries straight from the TS source (a plain array literal). */
export function parseRouteMap(tsSource) {
  const entries = [];
  const re = /\{\s*routePrefix:\s*"([^"]+)",\s*docsPath:\s*"([^"]+)"\s*\}/g;
  let m;
  while ((m = re.exec(tsSource)) !== null) entries.push({ routePrefix: m[1], docsPath: m[2] });
  return entries;
}

/** App-router page file -> route path. Strips route groups (shell) and /page.tsx. */
export function routeForPageFile(file) {
  let p = file.replace(/^apps\/web\/app/, "").replace(/\/page\.tsx$/, "");
  p = p.split("/").filter((seg) => !(seg.startsWith("(") && seg.endsWith(")"))).join("/");
  if (!p.startsWith("/")) p = `/${p}`;
  return p === "/" ? "/" : p.replace(/\/$/, "");
}

function routeMatches(pathname, routePrefix) {
  return pathname === routePrefix || pathname.startsWith(`${routePrefix}/`);
}

/** Longest-prefix match (mirrors resolveByLongestPrefix in docs-route-map.ts). */
export function docsPathForRoute(route, entries) {
  let best = null;
  for (const e of entries) {
    if (routeMatches(route, e.routePrefix) && (!best || e.routePrefix.length > best.routePrefix.length)) best = e;
  }
  return best ? best.docsPath : null;
}

/** DOCS_ROUTE_MAP docsPath (e.g. /docs/finance/accounts-receivable) -> repo doc file. */
export function docFileForDocsPath(docsPath) {
  if (!docsPath || docsPath === "/docs") return "docs/user-guide/index.md";
  const rel = docsPath.replace(/^\/docs\//, "");
  return `docs/user-guide/${rel}.md`;
}

export function computeImpact(changedFiles, entries, codeToDocs = {}) {
  const changed = new Set(changedFiles);
  const impacted = new Map(); // docFile -> [{kind, route?, page?, code?}]
  const add = (docFile, reason) => {
    if (changed.has(docFile)) return; // its doc was updated in the same PR — satisfied
    if (!impacted.has(docFile)) impacted.set(docFile, []);
    if (!impacted.get(docFile).some((r) => r.kind === reason.kind && (r.route === reason.route) && (r.code === reason.code))) {
      impacted.get(docFile).push(reason);
    }
  };

  // Route-based: a documented user-facing page.tsx changed.
  for (const page of changedFiles.filter((f) => PAGE_FILE_RE.test(f) && !EXCLUDE_RE.test(f))) {
    const route = routeForPageFile(page);
    const docsPath = docsPathForRoute(route, entries);
    if (!docsPath) continue; // undocumented route — not gated
    add(docFileForDocsPath(docsPath), { kind: "route", route, page });
  }

  // Code-based: a source file a page opted into via `relatedCode:` changed (a
  // *functionality* change, not just a route-file edit). Opt-in per page.
  for (const f of changedFiles) {
    for (const docFile of codeToDocs[f] || []) add(docFile, { kind: "code", code: f });
  }
  return impacted;
}

function main() {
  const base = assertSafeRef(process.env.BASE_SHA || "origin/main", "BASE_SHA");
  const changed = requireChangedFiles(base, "docs-impact-gate");
  for (const f of changed) assertSafePath(f);

  // Dependency-manifest-only diffs (lockfile / package.json bumps, e.g. from
  // Dependabot) carry no source or doc file, so a docs gate has nothing to
  // enforce. Short-circuit before route/code impact so a bot bump — which
  // cannot author a Docs-Impact-Decision trailer — is not structurally wedged.
  if (isDependencyOnlyChange(changed)) {
    console.log("[docs-impact-gate] Dependency-manifest-only change (no source or doc files) — nothing for a docs gate to enforce. OK.");
    process.exit(0);
  }

  if (!fs.existsSync(ROUTE_MAP_TS)) {
    console.log("[docs-impact-gate] docs-route-map.ts not found — skipping.");
    process.exit(0);
  }
  const entries = parseRouteMap(fs.readFileSync(ROUTE_MAP_TS, "utf-8"));
  // Optional code->doc edges from the generated impact manifest (Phase 4).
  let codeToDocs = {};
  const manifestPath = path.join(REPO_ROOT, "apps", "web", "lib", "docs", "doc-impact.generated.json");
  if (fs.existsSync(manifestPath)) {
    try { codeToDocs = JSON.parse(fs.readFileSync(manifestPath, "utf-8")).codeToDocs || {}; } catch { /* advisory */ }
  }
  const impacted = computeImpact(changed, entries, codeToDocs);

  if (impacted.size === 0) {
    console.log("[docs-impact-gate] No documented route or related-code change without its user-guide page. OK.");
    process.exit(0);
  }

  const commits = git("log", `${base}..HEAD`, "--format=%B");
  const prBody = process.env.PR_BODY || "";
  const attested = ATTESTATION_RE.test(commits) || ATTESTATION_RE.test(prBody);

  const describe = (h) => (h.kind === "route" ? `route ${h.route} (${h.page})` : `code ${h.code}`);

  if (attested) {
    console.log("[docs-impact-gate] Impacting change carries a Docs-Impact-Decision attestation. OK.");
    for (const [doc, hits] of impacted) console.log(`  • ${doc} ← ${hits.map(describe).join(", ")}`);
    process.exit(0);
  }

  console.error("");
  console.error("[docs-impact-gate] FAILED — a documented route or related-code change without updating its user-guide page.");
  console.error("");
  for (const [doc, hits] of impacted) {
    console.error(`  ${doc}`);
    for (const h of hits) console.error(`      ${describe(h)}`);
  }
  console.error("");
  console.error("To resolve, EITHER:");
  console.error("  1. Update the linked user-guide page(s) above (and keep Docs Link Integrity green), OR");
  console.error("  2. Attest that no user-facing documentation changed — add a trailer to a commit or the PR body:");
  console.error("       Docs-Impact-Decision: <why the docs don't change>");
  console.error("     e.g.  Docs-Impact-Decision: internal refactor of /finance/invoices, no user-visible change");
  console.error("");
  console.error("This gate reads the evidence, not which surface produced it — it applies identically to");
  console.error("Claude Code, Codex, Grok, and Build Studio PRs. The documentation-specialist coworker can");
  console.error("repair the flagged page(s) for you.");
  console.error("");
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("check-docs-impact.mjs")) {
  main();
}
