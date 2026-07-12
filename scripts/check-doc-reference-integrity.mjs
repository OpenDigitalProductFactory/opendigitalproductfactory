#!/usr/bin/env node
// scripts/check-doc-reference-integrity.mjs
//
// The Doc Reference Integrity Gate — referential integrity for documentation.
//
// THE PROBLEM IT FIXES: the Spec/Plan/Doc gate (check-spec-plan-doc.mjs) proves a
// PR *touched* some doc; it never proves the docs are *correct*. So documentation
// rots two ways this gate closes:
//   1. A doc links to a local file (another doc, a source module, an image) that
//      does not exist — a dead reference.
//   2. A doc links to an app surface (a /route) that no longer exists in the route
//      manifest — a dead surface reference.
//
// THE KEY INSIGHT — breakage is NON-LOCAL. The change happens on the *referenced*
// side (a route/file is renamed) but the damage lands on the *referencing* side
// (a doc elsewhere that the PR never touched). A gate scoped to the PR's changed
// files is structurally blind to it. So this gate validates the WHOLE live-doc
// corpus on every run, not just the diff.
//
// WHY THIS AUTOMATICALLY CATCHES "surface renamed, doc not in the plan": the route
// manifest is regenerated-and-committed-fresh on every PR (audit-route-manifest.yml
// FAILS any PR that changes routes without regenerating it). So a scan of every doc
// against the CURRENT manifest sees a renamed route as gone — and every doc still
// pointing at the old path becomes newly-broken. No explicit manifest git-diff is
// needed; the ratchet below turns "newly-broken" into a failure. That is the
// manifest-diff trigger, achieved by construction.
//
// RATCHET (mirrors check-module-size.mjs): docs/superpowers/ already holds ~148
// dead links in frozen design history. Failing every PR on pre-existing debt would
// be noise. Instead we freeze a baseline of currently-broken references in
// scripts/docs-reference-baseline.txt and fail ONLY on NET-NEW breakage. Fix a
// broken reference and re-run with --update to retighten the baseline. The broken
// count is a one-way ratchet: it can only go down.
//
// SCOPE: references FROM live docs are policed (docs/** and root governance docs),
// EXCLUDING docs/superpowers/** as a *source* (frozen archive — we do not police
// its outbound links). References are validated AGAINST the whole repo + the global
// route manifest.
//
// WHAT THIS DOES NOT CATCH: semantic staleness — a doc whose link still resolves but
// whose words describe behaviour that changed. No link-checker can see that; that is
// the doc-staleness attention source (BI-AA5DFEA2), not this gate.
//
// Load-descent ladder (EP-1155CEF3): this check is 100% deterministic — a reference
// resolves or it does not. Zero human, zero agent in steady state.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Repo root is the script's parent dir in normal use; DOC_REF_ROOT overrides it so
// the test suite can point the whole gate at a synthetic doc tree in a temp dir.
const REPO_ROOT = process.env.DOC_REF_ROOT
  ? resolve(process.env.DOC_REF_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(REPO_ROOT, "scripts", "docs-reference-baseline.txt");
const ROUTE_MANIFEST_PATH = join(REPO_ROOT, "apps", "web", "lib", "ea", "route-manifest.json");

// Doc roots we police as a *source* of references.
const DOC_ROOT = join(REPO_ROOT, "docs");
const ROOT_DOCS = ["AGENTS.md", "README.md", "CONTRIBUTING.md", "CONVENTIONS.md", "SECURITY.md"];

// Frozen design-history archive — excluded as a source (we don't police its links).
const EXCLUDE_SOURCE_RE = /^docs\/superpowers\//;

// Inline markdown links and images: [text](href) and ![alt](href). We ignore
// reference-style ([x][ref]) and autolinks for v1 — inline is where drift lives.
// The href sub-pattern allows ONE level of nested parens so real repo paths with
// Next.js route groups — apps/web/app/(shell)/… , parallel routes @slot — are
// captured whole instead of truncated at the first ")".
const LINK_RE = /!?\[[^\]]*\]\(\s*((?:[^()\s]|\([^()]*\))+)(?:\s+"[^"]*")?\s*\)/g;

// Fenced code blocks hold *example* links that must not be validated. Strip them
// (``` … ``` and ~~~ … ~~~) before extracting links.
const FENCE_RE = /^([`~]{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm;

const isExternal = (h) => /^(https?:|mailto:|tel:|data:|#)/i.test(h);
const isWindowsAbs = (h) => /^[A-Za-z]:[\\/]/.test(h);

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.isFile() && entry.name.endsWith(".md")) acc.push(full);
  }
  return acc;
}

/** All live-doc source files (repo-relative), excluding the frozen archive. */
function collectSourceDocs() {
  const docs = existsSync(DOC_ROOT) ? walk(DOC_ROOT) : [];
  const rootDocs = ROOT_DOCS.map((f) => join(REPO_ROOT, f)).filter(existsSync);
  return [...docs, ...rootDocs]
    .map((f) => relative(REPO_ROOT, f).split("\\").join("/"))
    .filter((rel) => !EXCLUDE_SOURCE_RE.test(rel));
}

/** Build static set + dynamic-segment matchers from the committed route manifest.
 *  segments = the set of top-level app-route segments (portal, platform, admin…),
 *  used to tell a dead *surface* link (/portal/gone) from a Jekyll permalink
 *  (/user-guide/…) that has no backing file but resolves on the published site. */
function loadRouteMatchers() {
  const staticPaths = new Set();
  const dynamic = [];
  const segments = new Set();
  if (!existsSync(ROUTE_MANIFEST_PATH)) return { staticPaths, dynamic, segments };
  const manifest = JSON.parse(readFileSync(ROUTE_MANIFEST_PATH, "utf8"));
  for (const row of manifest.routes || []) {
    const rp = row.routePath;
    if (typeof rp !== "string") continue;
    const first = rp.split("/")[1];
    if (first && !first.startsWith("[")) segments.add(first);
    if (rp.includes("[")) {
      // /portal/cases/[caseKey] → ^/portal/cases/[^/]+$  (so /portal/cases/123 matches).
      // Build per-segment: dynamic segments ([x], [...x], [[...x]]) → [^/]+; literal
      // segments are regex-escaped (brackets included).
      const rx =
        "^" +
        rp
          .split("/")
          .map((seg) => (/^\[.+\]$/.test(seg) ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
          .join("/") +
        "$";
      dynamic.push(new RegExp(rx));
    } else {
      staticPaths.add(rp);
    }
  }
  return { staticPaths, dynamic, segments };
}

const routeExists = ({ staticPaths, dynamic }, path) =>
  staticPaths.has(path) || dynamic.some((rx) => rx.test(path));

const hasFileExtension = (href) => /\.[a-z0-9]{1,8}$/i.test(href.split("#")[0].split("?")[0]);

/** Clean an href down to a path: drop #anchor / ?query, URL-decode (%20 → space),
 *  and strip a trailing :line or :line-line suffix — the DPF doc convention links
 *  source as `path/to/file.ts:42`. */
function cleanHref(href) {
  let clean = href.split("#")[0].split("?")[0];
  try {
    clean = decodeURIComponent(clean);
  } catch {
    /* malformed escape — keep raw */
  }
  return clean.replace(/:\d+(?:-\d+)?$/, "");
}

/** One filesystem candidate resolves, allowing the Jekyll/markdown-site permalink
 *  convention: an extensionless link resolves to <path>.md or <path>/index.md. */
function candidateResolves(absNoExt, extensionless) {
  const norm = normalize(absNoExt);
  if (!norm.startsWith(REPO_ROOT)) return false; // escapes the repo (…/../.. or D:/…)
  if (existsSync(norm)) return true;
  return extensionless && (existsSync(norm + ".md") || existsSync(join(norm, "index.md")));
}

/** Does an href resolve to a real file/dir/permalink? Relative links resolve from
 *  the doc's dir; "/"-absolute links resolve against BOTH the site root (docs/, the
 *  Jekyll publish root) and the repo root, since docs use both conventions. */
function resolvesToFile(sourceRel, href) {
  const clean = cleanHref(href);
  if (!clean) return true; // empty after stripping anchor ⇒ in-doc, nothing to check
  const extensionless = !hasFileExtension(href);
  const candidates = clean.startsWith("/")
    ? [join(DOC_ROOT, clean), join(REPO_ROOT, clean)]
    : [resolve(REPO_ROOT, dirname(sourceRel), clean)];
  return candidates.some((c) => candidateResolves(c, extensionless));
}

function classifyBroken(sourceRel, href, routes) {
  if (isExternal(href)) return null;
  if (isWindowsAbs(href)) return "windows-absolute-path";
  const clean = cleanHref(href);
  if (!clean) return null; // e.g. (#section) — in-doc anchor
  if (resolvesToFile(sourceRel, href)) return null;
  if (clean.startsWith("/")) {
    // Unresolved "/"-absolute: an app route, a genuinely-dead file link, or an
    // unknown site permalink. Flag the app-route case (dead surface) and the
    // clearly-a-file case; leave ambiguous extensionless permalinks alone.
    if (routeExists(routes, clean)) return null;
    if (hasFileExtension(clean)) return "dead-root-file-link";
    const firstSeg = clean.split("/")[1];
    if (routes.segments.has(firstSeg)) return "dead-surface-link";
    return null;
  }
  return "dead-local-reference"; // relative link to a file/permalink that does not exist
}

/** → array of `${sourceRel}\t${href}` keys, sorted+deduped. */
function collectBrokenRefs() {
  const routes = loadRouteMatchers();
  const broken = new Set();
  for (const sourceRel of collectSourceDocs()) {
    const raw = readFileSync(join(REPO_ROOT, sourceRel), "utf8");
    const text = raw.replace(FENCE_RE, "");
    for (const m of text.matchAll(LINK_RE)) {
      const href = m[1].trim();
      if (classifyBroken(sourceRel, href, routes)) broken.add(`${sourceRel}\t${href}`);
    }
  }
  return [...broken].sort();
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return new Set();
  return new Set(
    readFileSync(BASELINE_PATH, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#")),
  );
}

function serializeBaseline(keys) {
  const header =
    "# scripts/docs-reference-baseline.txt — grandfathered broken doc references.\n" +
    "# Format: <source-doc>\\t<href>. Managed by check-doc-reference-integrity.mjs.\n" +
    "# Fix a reference and run `node scripts/check-doc-reference-integrity.mjs --update`\n" +
    "# to retighten. The count is a one-way ratchet — new breakage fails the PR.\n" +
    "# .gitattributes marks this merge=union so concurrent re-baselines don't clash.\n";
  return header + [...new Set(keys)].sort().join("\n") + "\n";
}

// ── main ─────────────────────────────────────────────────────────────────────
const update = process.argv.includes("--update");
const broken = collectBrokenRefs();

if (update) {
  writeFileSync(BASELINE_PATH, serializeBaseline(broken));
  console.log(`[doc-reference-integrity] baseline rewritten: ${broken.length} grandfathered reference(s).`);
  process.exit(0);
}

const baseline = loadBaseline();
const brokenSet = new Set(broken);
const netNew = broken.filter((k) => !baseline.has(k));
const fixed = [...baseline].filter((k) => !brokenSet.has(k));

if (fixed.length > 0) {
  console.log(`[doc-reference-integrity] ${fixed.length} baselined reference(s) now resolve — run --update to retighten.`);
}

if (netNew.length === 0) {
  console.log(`[doc-reference-integrity] OK — no net-new broken references (${baseline.size} grandfathered).`);
  process.exit(0);
}

console.error("");
console.error(`[doc-reference-integrity] FAILED — ${netNew.length} NET-NEW broken doc reference(s):`);
console.error("");
for (const key of netNew) {
  const [src, href] = key.split("\t");
  console.error(`  • ${src}`);
  console.error(`      → ${href}`);
}
console.error("");
console.error("A live doc references a file or app surface that does not exist. This is");
console.error("usually because a route/spec/file was renamed or removed while a doc elsewhere");
console.error("kept pointing at the old target (breakage is non-local — see the header).");
console.error("");
console.error("To resolve, do ONE of:");
console.error("  1. Fix the reference in the doc(s) above (repoint or remove the dead link).");
console.error("  2. If a surface link broke because you renamed a route, update every doc that");
console.error("     referenced it — this gate lists them all for you.");
console.error("  3. Only if the breakage is genuinely acceptable, accept it into the baseline:");
console.error("       node scripts/check-doc-reference-integrity.mjs --update");
console.error("     and commit scripts/docs-reference-baseline.txt. Use sparingly — the point");
console.error("     of the ratchet is that broken references trend to zero, not grow.");
console.error("");
process.exit(1);
