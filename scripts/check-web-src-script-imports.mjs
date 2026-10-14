#!/usr/bin/env node
// check-web-src-script-imports.mjs — BI-PIR-53d2c42d.
//
// The portal image ships a source snapshot of apps/web at /app/apps/web-src and
// runs TypeScript scripts from it with tsx: the wiki re-embed at every boot
// (scripts/portal-migrate-boot.sh), the MCP token and Grok credential issuers
// (scripts/dpf-bootstrap-agent-toolchain.{sh,ps1}), the edge bootstrap token
// (scripts/setup.sh, scripts/fresh-install.ps1). Those scripts do NOT resolve
// packages the way the Next server does:
//
//   - the server resolves from its standalone output's own traced/bundled deps;
//   - web-src has no node_modules except the @dpf/* links added by
//     scripts/link-web-src-workspace.sh, so a bare import walks up to
//     /app/node_modules — which the Dockerfile re-installs to the `@dpf/db...`
//     runtime dependency set (BI-C7C6D827) in pnpm's isolated layout, leaving
//     only the root importer's direct deps at its top level (see
//     runtimeDependencySet).
//
// So a web-only npm dependency anywhere in a script's import graph resolves in
// every developer clone, in vitest, and in `next build`, and dies only in the
// image with "Cannot find module '<pkg>'". Measured instance: lib/operate/metrics
// imported prom-client at top level; reembed-wiki-store.ts reached it through
// embeddings -> inference -> routing -> nonprod/environment-lease, and
// approval-convergence-probe.ts through lib/mcp-tools, and both crashed.
//
// Invariant: every module reachable from a script the image runs from web-src
// (static imports throughout, plus the entry script's own dynamic imports)
// imports only Node built-ins, @dpf/* workspace packages, and npm packages
// resolvable from web-src in the image. A dependency that is
// genuinely optional there is loaded with a guarded `require` and listed in
// GUARDED_OPTIONAL_REQUIRES with the file that guards it.
//
// The entry list is DERIVED from the files that invoke the scripts (never typed
// by hand), and the check asserts a floor on how many entries and modules it
// walked, so a parse that silently finds nothing fails instead of passing.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isEntryModule } from "./lib/entry-module.mjs";
import { DEPENDENCY_KINDS, parseImporters } from "./lib/pnpm-lock.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(new URL(import.meta.url))), "..");

/**
 * Files that run apps/web scripts inside the portal image (from
 * /app/apps/web-src). `@dpf/db exec` lines in them run packages/db scripts,
 * which the runtime dependency set covers by construction, and are skipped.
 */
export const IMAGE_SCRIPT_INVOKERS = Object.freeze([
  "docker-entrypoint.sh",
  "scripts/portal-migrate-boot.sh",
  "scripts/dpf-bootstrap-agent-toolchain.sh",
  "scripts/dpf-bootstrap-agent-toolchain.ps1",
  "scripts/setup.sh",
  "scripts/fresh-install.ps1",
]);

/**
 * Scripts an agent runs inside the portal container that no checked-in file
 * invokes. Each needs a reason.
 */
export const ADDITIONAL_IMAGE_SCRIPTS = Object.freeze({
  // Read-only approval-convergence probe (BI-C8EC05C9): agents run it in the
  // portal container against the live database; it crashed there on
  // prom-client via lib/mcp-tools -> lib/operate/metrics (BI-PIR-53d2c42d).
  "apps/web/scripts/approval-convergence-probe.ts": "agent-run in the portal container",
});

/**
 * `require(<specifier>)` calls that are wrapped in a guard degrading to a
 * no-op when the package is absent. Keyed by repo-relative file.
 */
export const GUARDED_OPTIONAL_REQUIRES = Object.freeze({
  // BI-PIR-53d2c42d: metrics degrade to typed no-ops without prom-client; the
  // server keeps it via outputFileTracingIncludes in apps/web/next.config.mjs.
  "apps/web/lib/operate/metrics.ts": ["prom-client"],
});

/**
 * Violations that already exist on main, observed when this guard landed. Each
 * is a REAL image defect, verified 2026-10-13 on the live portal image with
 * `require.resolve` from /app/apps/web-src: undici, zod, pg, next, prom-client
 * all fail to resolve there (react, server-only, markdown-it and inngest are
 * not installed at all). They are tolerated only so the guard can ratchet: a
 * NEW violation fails, and an entry that no longer occurs also fails, so a fix
 * must delete its line. Keyed "<importing file> -> <specifier>".
 */
export const KNOWN_VIOLATIONS = Object.freeze({
  // reembed-wiki-store.ts (every boot) -> lib/inference/embedding ->
  // provider-inference-transport -> off-threadpool-fetch, which needs undici's
  // Agent at import. With prom-client made optional this is the NEXT failure
  // of the boot-time re-embed in the image.
  "apps/web/lib/network/off-threadpool-fetch.ts -> undici": "reembed-wiki-store: next image blocker after prom-client",
  // approval-convergence-probe.ts reaches the whole MCP pack registry through
  // lib/mcp-tools. Its documented dev invocation maps server-only to a stub
  // (scripts/tsconfig.gpp-map.json); nothing covers the rest.
  "apps/web/lib/govern/authority/resolve-coworker-tool-authority.ts -> server-only": "approval-convergence-probe graph",
  "apps/web/lib/coworker/authority-approval-envelope.ts -> server-only": "approval-convergence-probe graph",
  "apps/web/lib/govern/authority/coworker-tool-authority-gate.ts -> server-only": "approval-convergence-probe graph",
  "apps/web/lib/agent-toolchain/fleet-readiness.ts -> server-only": "approval-convergence-probe graph",
  "apps/web/lib/tak/delegation-authority.ts -> server-only": "approval-convergence-probe graph",
  "apps/web/lib/coworker/human-approved-execution.ts -> server-only": "approval-convergence-probe graph",
  "apps/web/lib/mcp-task-approval-recovery.ts -> server-only": "approval-convergence-probe graph",
  "apps/web/lib/finance/banking-validation.ts -> zod": "approval-convergence-probe graph",
  "apps/web/lib/finance/ap-validation.ts -> zod": "approval-convergence-probe graph",
  "apps/web/lib/change-review/semantic-review-request.ts -> zod": "approval-convergence-probe graph",
  "apps/web/lib/change-review/semantic-change-review.ts -> zod": "approval-convergence-probe graph",
  "apps/web/lib/change-review/failure-analysis.ts -> zod": "approval-convergence-probe graph",
  "apps/web/lib/work-capsules/activity-events.ts -> pg": "approval-convergence-probe graph",
  "apps/web/lib/portal-context/invalidation.ts -> next/cache": "approval-convergence-probe graph",
  "apps/web/lib/workforce/leave-data.ts -> react": "approval-convergence-probe graph",
  "apps/web/lib/shared/markdown.ts -> markdown-it": "approval-convergence-probe graph",
  "apps/web/lib/jobs/inngest-adapter.ts -> inngest": "approval-convergence-probe graph",
});

/** The root of the runtime dependency set: Dockerfile `--filter "@dpf/db..."`. */
export const RUNTIME_ROOT_PACKAGE = "@dpf/db";

/** Fewest entry scripts a healthy derivation finds (measured 2026-10-13: 5). */
export const MIN_ENTRY_SCRIPTS = 4;
/** Fewest modules a healthy walk reads (measured 2026-10-13: 913). */
export const MIN_MODULES_WALKED = 300;

const WEB_DIR = "apps/web";
const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json"];
const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

/**
 * Entry scripts named in an invoker's text: `scripts/<name>.ts` (run from
 * web-src) or `apps/web/scripts/<name>.ts`, on lines not running @dpf/db.
 *
 * @param {string} text
 * @returns {string[]} repo-relative apps/web/scripts paths (unverified)
 */
export function scriptsInvokedBy(text) {
  const found = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (line.includes("@dpf/db")) continue;
    for (const m of line.matchAll(/(?:^|[\s"'/=(])((?:apps\/web\/)?scripts\/[A-Za-z0-9._-]+\.ts)\b/g)) {
      const rel = m[1].startsWith("apps/web/") ? m[1] : `${WEB_DIR}/${m[1]}`;
      found.add(rel);
    }
  }
  return [...found];
}

/** @param {string} root */
export function deriveEntryScripts(root = REPO_ROOT) {
  const entries = new Set();
  for (const invoker of IMAGE_SCRIPT_INVOKERS) {
    const abs = path.join(root, invoker);
    if (!existsSync(abs)) continue;
    for (const rel of scriptsInvokedBy(readFileSync(abs, "utf8"))) {
      if (existsSync(path.join(root, rel))) entries.add(rel);
    }
  }
  for (const rel of Object.keys(ADDITIONAL_IMAGE_SCRIPTS)) entries.add(rel);
  return [...entries].sort();
}

/** Strip comments so commented-out imports are not counted. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/**
 * Value specifiers a module needs at runtime: static imports/re-exports (not
 * type-only), side-effect imports, string-literal dynamic imports, and
 * string-literal requires.
 *
 * @param {string} source
 * @returns {{ specifier: string, kind: "static"|"dynamic"|"require" }[]}
 */
export function runtimeImports(source) {
  const text = stripComments(source);
  const out = [];
  const staticRe =
    /(?:^|[\n;])\s*(import|export)\s+((?:type\s+)?)([^;"'`]*?)\s*from\s*["']([^"']+)["']/g;
  for (const m of text.matchAll(staticRe)) {
    if (m[2].trim() === "type") continue;
    const clause = m[3].trim();
    // `import { type A, type B } from "x"` is erased entirely.
    const braces = /^\{([^}]*)\}$/.exec(clause);
    if (braces) {
      const names = braces[1].split(",").map((s) => s.trim()).filter(Boolean);
      if (names.length > 0 && names.every((n) => n.startsWith("type "))) continue;
    }
    out.push({ specifier: m[4], kind: "static" });
  }
  for (const m of text.matchAll(/(?:^|[\n;])\s*import\s*["']([^"']+)["']/g)) {
    out.push({ specifier: m[1], kind: "static" });
  }
  for (const m of text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    out.push({ specifier: m[1], kind: "dynamic" });
  }
  for (const m of text.matchAll(/(?<![.\w])require\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    out.push({ specifier: m[1], kind: "require" });
  }
  return out;
}

/** `@scope/name/sub` -> `@scope/name`; `name/sub` -> `name`. */
export function packageNameOf(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function readJson(abs) {
  return JSON.parse(readFileSync(abs, "utf8"));
}

/** name -> repo-relative dir for every workspace package under packages/. */
export function workspacePackages(root = REPO_ROOT) {
  const map = new Map();
  const dir = path.join(root, "packages");
  if (!existsSync(dir)) return map;
  for (const entry of readdirSync(dir)) {
    const pkgJson = path.join(dir, entry, "package.json");
    if (!existsSync(pkgJson)) continue;
    const { name } = readJson(pkgJson);
    if (typeof name === "string") map.set(name, `packages/${entry}`);
  }
  return map;
}

/**
 * What a bare import from /app/apps/web-src can actually resolve in the image.
 *
 * The image installs with pnpm's default ISOLATED layout (the Dockerfile does
 * not copy .npmrc, so the repo's node-linker=hoisted does not apply there), via
 * `pnpm install --filter "@dpf/db..."`. That gives:
 *   - each selected workspace project (@dpf/db and the workspace packages it
 *     links) its OWN node_modules under /app/packages/<dir> — visible only to
 *     files inside that package;
 *   - /app/node_modules top level = the root importer's direct dependencies
 *     (measured on the live image 2026-10-13: tsx, @playwright/test,
 *     @axe-core/playwright and nothing else); everything else sits under
 *     /app/node_modules/.pnpm, which Node never searches from web-src.
 * So from web-src only Node built-ins, @dpf/* links, and the root importer's
 * direct dependencies resolve. Read from pnpm-lock.yaml; no install needed.
 *
 * @returns {{ projects: Set<string>, packages: Set<string> }}
 *   projects: workspace packages with their own installed node_modules;
 *   packages: npm packages resolvable from web-src.
 */
export function runtimeDependencySet(root = REPO_ROOT) {
  const ws = workspacePackages(root);
  const importers = parseImporters(readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"));

  const packages = new Set();
  for (const kind of DEPENDENCY_KINDS) {
    for (const dep of importers["."]?.[kind] ?? []) {
      if (!dep.version.startsWith("link:")) packages.add(dep.name);
    }
  }

  const projects = new Set();
  const queue = [ws.get(RUNTIME_ROOT_PACKAGE)];
  const seen = new Set();
  while (queue.length > 0) {
    const importer = queue.shift();
    if (!importer || seen.has(importer)) continue;
    seen.add(importer);
    projects.add(readJson(path.join(root, importer, "package.json")).name);
    for (const kind of DEPENDENCY_KINDS) {
      for (const dep of importers[importer]?.[kind] ?? []) {
        if (dep.version.startsWith("link:")) {
          queue.push(path.posix.normalize(path.posix.join(importer, dep.version.slice(5))));
        }
      }
    }
  }
  return { projects, packages };
}

function isFile(abs) {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

/** Resolve a path-like target (no extension, .js-for-.ts, or a directory index). */
function resolveFile(root, relNoExt) {
  const abs = path.join(root, relNoExt);
  if (isFile(abs) && RESOLVE_EXTENSIONS.includes(path.extname(abs))) return relNoExt;
  const stem = relNoExt.replace(/\.(m|c)?js$/, "");
  for (const ext of RESOLVE_EXTENSIONS) {
    if (isFile(path.join(root, stem + ext))) return stem + ext;
  }
  for (const ext of RESOLVE_EXTENSIONS) {
    const idx = path.posix.join(relNoExt, `index${ext}`);
    if (isFile(path.join(root, idx))) return idx;
  }
  return null;
}

/** Entry source file of a workspace package import (`@dpf/x` or `@dpf/x/sub`). */
function resolveWorkspaceImport(root, ws, specifier) {
  const name = packageNameOf(specifier);
  const dir = ws.get(name);
  if (!dir) return null;
  const pkg = readJson(path.join(root, dir, "package.json"));
  const sub = specifier.slice(name.length); // "" or "/x"
  const key = sub ? `.${sub}` : ".";
  let target = null;
  const exp = pkg.exports;
  if (exp && typeof exp === "object" && !Array.isArray(exp)) {
    const hit = exp[key];
    target = typeof hit === "string" ? hit : hit?.import ?? hit?.default ?? hit?.require ?? null;
    if (!target) {
      // Wildcard subpath export: "./*": "./src/*.ts"
      for (const [pattern, value] of Object.entries(exp)) {
        if (!pattern.includes("*") || typeof value !== "string") continue;
        const [pre, post] = pattern.split("*");
        if (key.startsWith(pre) && key.endsWith(post)) {
          target = value.replaceAll("*", key.slice(pre.length, key.length - post.length));
          break;
        }
      }
    }
  } else if (typeof exp === "string" && key === ".") {
    target = exp;
  }
  if (!target && key === ".") target = pkg.main ?? "index";
  if (!target) target = sub.slice(1);
  return resolveFile(root, path.posix.join(dir, target));
}

/**
 * Walk the runtime import graph from each entry and report every bare import
 * the image cannot resolve from web-src.
 *
 * @param {{ root?: string, entries?: string[], readSource?: (rel: string) => string }} [options]
 */
export function findUnresolvableImports(options = {}) {
  const root = options.root ?? REPO_ROOT;
  const entries = options.entries ?? deriveEntryScripts(root);
  const readSource = options.readSource ?? ((rel) => readFileSync(path.join(root, rel), "utf8"));
  const ws = workspacePackages(root);
  const { projects, packages } = runtimeDependencySet(root);

  const violations = [];
  const visited = new Set();
  const via = new Map(); // module -> parent, for an import chain in the report

  const entrySet = new Set(entries);
  const queue = [];
  for (const entry of entries) {
    if (!visited.has(entry)) {
      visited.add(entry);
      via.set(entry, null);
      queue.push(entry);
    }
  }

  const enqueue = (rel, parent) => {
    if (!rel || visited.has(rel)) return;
    visited.add(rel);
    via.set(rel, parent);
    queue.push(rel);
  };

  while (queue.length > 0) {
    const file = queue.shift();
    if (file.endsWith(".json")) continue;
    const guarded = new Set(GUARDED_OPTIONAL_REQUIRES[file] ?? []);
    const isEntry = entrySet.has(file);
    for (const { specifier, kind } of runtimeImports(readSource(file))) {
      // A dynamic import in the entry script runs on its main path; one inside
      // library code is a lazy branch the script may never take (and is how a
      // server-only dependency is deliberately kept off a script's graph).
      if (kind === "dynamic" && !isEntry) continue;
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        enqueue(resolveFile(root, path.posix.join(path.posix.dirname(file), specifier)), file);
        continue;
      }
      if (specifier.startsWith("@/")) {
        enqueue(resolveFile(root, path.posix.join(WEB_DIR, specifier.slice(2))), file);
        continue;
      }
      if (BUILTINS.has(specifier) || BUILTINS.has(packageNameOf(specifier))) continue;
      const name = packageNameOf(specifier);
      if (ws.has(name)) {
        // Linked into web-src. A package outside the runtime set has no deps
        // of its own installed, so its source graph must pass the same check.
        if (!projects.has(name)) enqueue(resolveWorkspaceImport(root, ws, specifier), file);
        continue;
      }
      if (packages.has(name)) continue;
      if (kind === "require" && guarded.has(specifier)) continue;
      violations.push({ file, specifier, kind, chain: chainOf(via, file) });
    }
  }
  return { entries, modulesWalked: visited.size, violations };
}

/** "<file> -> <specifier>" */
export function violationKey(v) {
  return `${v.file} -> ${v.specifier}`;
}

/**
 * Split violations against the KNOWN_VIOLATIONS ratchet.
 *
 * @param {ReturnType<typeof findUnresolvableImports>["violations"]} violations
 * @param {Record<string, string>} [known]
 */
export function classifyViolations(violations, known = KNOWN_VIOLATIONS) {
  const seen = new Set(violations.map(violationKey));
  return {
    fresh: violations.filter((v) => !(violationKey(v) in known)),
    stale: Object.keys(known).filter((key) => !seen.has(key)),
    tolerated: violations.filter((v) => violationKey(v) in known).length,
  };
}

function chainOf(via, file) {
  const chain = [];
  for (let cur = file; cur; cur = via.get(cur)) chain.unshift(cur);
  return chain;
}

function main() {
  const { entries, modulesWalked, violations } = findUnresolvableImports();
  if (entries.length < MIN_ENTRY_SCRIPTS || modulesWalked < MIN_MODULES_WALKED) {
    console.error(
      `[web-src-script-imports] FAILED — derived ${entries.length} entry scripts (floor ${MIN_ENTRY_SCRIPTS}) ` +
        `and walked ${modulesWalked} modules (floor ${MIN_MODULES_WALKED}).`,
    );
    console.error("The parse found too little to vouch for anything: an invoker path or invocation shape changed under it.");
    process.exit(1);
  }
  const { fresh, stale, tolerated } = classifyViolations(violations);
  if (stale.length > 0) {
    console.error("[web-src-script-imports] FAILED — KNOWN_VIOLATIONS lists imports that no longer occur. Delete them:");
    for (const key of stale) console.error(`  ${key}`);
    process.exit(1);
  }
  if (fresh.length === 0) {
    console.log(
      `[web-src-script-imports] OK — ${entries.length} image-run web-src scripts, ${modulesWalked} modules walked; ` +
        `no new unresolvable imports (${tolerated} known, tracked in KNOWN_VIOLATIONS).`,
    );
    return;
  }
  console.error(
    "[web-src-script-imports] FAILED — a script the portal image runs from /app/apps/web-src imports an npm package\n" +
      "the image's runtime dependency set does not install. It resolves in a dev clone, vitest and `next build`, and\n" +
      "dies only in the image with \"Cannot find module\".\n",
  );
  for (const v of fresh) {
    console.error(`  ${v.file}: ${v.kind} import of '${v.specifier}'`);
    console.error(`    via ${v.chain.join("\n     -> ")}\n`);
  }
  console.error(
    "Fix by keeping web-only packages out of the script's graph (inject the dependency, or import it lazily from the\n" +
      "server-only caller), or, when the dependency is genuinely optional, load it with a guarded require that degrades\n" +
      "to a no-op and list it in GUARDED_OPTIONAL_REQUIRES in scripts/check-web-src-script-imports.mjs.",
  );
  process.exit(1);
}

if (isEntryModule(import.meta.url)) main();
