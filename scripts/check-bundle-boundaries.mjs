#!/usr/bin/env node
/**
 * BI-98AF1066 — Static bundle-boundary guard (EP-VERIFY-PROC).
 *
 * Catches "Docker-only" bundling failures in SECONDS, before a slow Next/Docker
 * build — or worse, a shipped-but-corrupt runtime like the 2026-06-06 lazy-node
 * `TypeError: d is not a function` crash that crash-looped /build. The point of
 * EP-VERIFY-PROC: move this from "a human eventually notices in production" to a
 * deterministic procedure the pipeline runs up front.
 *
 * Three checks (all pure string scans — no deps, runs with plain node):
 *
 *   1. BUNDLE-HOSTILE DYNAMIC REQUIRE: `new Function(... return require ...)`.
 *      This shim is invisible to the bundler's static analysis and is undefined
 *      in some Next server-chunk scopes — the exact lazy-node failure. The fix
 *      is direct `import * as x from "node:<mod>"`.
 *   2. NODE BUILT-INS IN A "use client" COMPONENT: fs / child_process / path /
 *      crypto / etc. don't exist in the browser bundle and break the client
 *      build. Server-only code must live in a server module / route / action.
 *   3. HOST-ONLY STATIC IMPORTS IN SERVER ENTRYPOINTS: route/page/action/Inngest
 *      modules must not statically import Docker-only promoter code. Use a
 *      dynamic import() boundary so Next/Turbopack does not trace that graph at
 *      page-load or route-build time.
 *
 * Run: node scripts/check-bundle-boundaries.mjs
 * Exit 0 = clean; exit 1 = violations (with a clear, actionable report).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = [join(ROOT, "apps", "web")];

// Node built-ins that have no browser equivalent. Importing any of these into a
// client bundle breaks the build.
const NODE_BUILTINS = [
  "fs", "fs/promises", "child_process", "path", "crypto", "os", "net",
  "http", "https", "stream", "zlib", "module", "dns", "tls", "cluster",
  "worker_threads", "perf_hooks", "v8", "vm", "readline", "http2", "dgram",
];

// Allowlist for the dynamic-require check. Should stay EMPTY — direct node:
// imports are always preferable. Add an entry only with a one-line reason.
const DYNAMIC_REQUIRE_ALLOW = new Set([
  // This guard itself documents the banned pattern in its header/comments.
  "scripts/check-bundle-boundaries.mjs",
]);

// `new Function(` ... `require` on the same construct — catches
// new Function("mod", "return require(mod)") and minor variants.
const DYN_REQUIRE = /new\s+Function\s*\([^)]*require/;
const HOST_ONLY_IMPORTS = [
  /self-upgrade\/promoter(?:\.[tj]s)?$/,
  /(?:^|\/)dockerode$/,
];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (["node_modules", ".next", "__snapshots__", "dist", "public", "coverage"].includes(entry)) continue;
      yield* walk(full);
    } else if (s.isFile()) {
      if (full.endsWith(".test.ts") || full.endsWith(".test.tsx") || full.endsWith(".d.ts")) continue;
      if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
      yield full;
    }
  }
}

// A file is a client component if a "use client" directive sits at the top
// (optionally after comments). We only look at the head to avoid matching a
// "use client" string literal deeper in the file.
function isUseClient(body) {
  const head = body.slice(0, 600);
  return /(^|\n)\s*['"]use client['"]\s*;?/.test(head);
}

function clientNodeBuiltinImports(body) {
  const hits = [];
  for (const b of NODE_BUILTINS) {
    const esc = b.replace("/", "\\/");
    // import ... from "fs" | "node:fs" | require("fs")
    const re = new RegExp(`(from\\s*['"](?:node:)?${esc}['"]|require\\(\\s*['"](?:node:)?${esc}['"]\\s*\\))`);
    if (re.test(body)) hits.push(b);
  }
  return hits;
}

function extractStaticImports(body) {
  const noType = body.replace(
    /\b(?:import|export)\s+type\b[\s\S]*?from\s*["'][^"']+["']/g,
    "",
  );
  const specs = new Set();
  for (const m of noType.matchAll(/\bfrom\s*["']([^"']+)["']/g)) specs.add(m[1]);
  for (const m of noType.matchAll(/\bimport\s+["']([^"']+)["']/g)) specs.add(m[1]);
  return [...specs];
}

function isServerBundleEntrypoint(rel) {
  return (
    /^apps\/web\/app\/.*\/(?:page|layout|route)\.(?:ts|tsx)$/.test(rel) ||
    /^apps\/web\/lib\/actions\/.*\.(?:ts|tsx)$/.test(rel) ||
    /^apps\/web\/lib\/queue\/functions\/.*\.ts$/.test(rel)
  );
}

// Check 4 (BI-76651B7B): apps/web statically imports a handful of scripts/*.mjs
// helpers, so Next bundles them AND everything they reach. A promoter-only
// import added to one of those shared helpers therefore breaks the production
// build from outside apps/web, where checks 1-3 never look. Any scripts/ module
// the web bundle reaches must stay bundle-safe: node: builtins and other
// bundle-safe scripts/ modules only — no installer/, no generated catalogs, no
// promoter CLI work. Put that behind its own promoter-only entrypoint instead.
const PROMOTER_ONLY_SPECIFIER = [
  /(^|\/)installer\//,
  /capability-service-catalog\.generated\.json$/,
  /(^|\/)promoter-[a-z-]+\.mjs$/,
];

function isBundleSafeSpecifier(specifier) {
  return specifier.startsWith("node:") || (specifier.startsWith(".") && !PROMOTER_ONLY_SPECIFIER.some((re) => re.test(specifier)));
}

// Static `from "..."` is not enough: the break this check exists for used
// `await import(new URL("../installer/...", here).href)`, which a static-import
// scan reports as clean while the bundler still traces and fails on it. Collect
// dynamic import() and new URL() module references too, over comment-stripped
// source so a path named in prose is not mistaken for a reference.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function moduleReferences(body) {
  const code = stripComments(body);
  const refs = new Set(extractStaticImports(code));
  for (const m of code.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g)) refs.add(m[1]);
  for (const m of code.matchAll(/\bnew\s+URL\s*\(\s*["']([^"']+)["']/g)) refs.add(m[1]);
  for (const m of code.matchAll(/\brequire\s*\(\s*["']([^"']+)["']/g)) refs.add(m[1]);
  return [...refs];
}

function scriptsModulesReachedByWeb() {
  const reached = new Set();
  for (const baseDir of SCAN_DIRS) {
    for (const file of walk(baseDir)) {
      let body;
      try {
        body = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const specifier of extractStaticImports(body)) {
        if (!/(^|\/)scripts\//.test(specifier)) continue;
        const resolved = join(ROOT, "scripts", specifier.replace(/^.*?\/scripts\//, ""));
        try {
          if (statSync(resolved).isFile()) reached.add(relative(ROOT, resolved).replace(/\\/g, "/"));
        } catch {
          // Unresolvable specifier — the build itself will report it.
        }
      }
    }
  }
  return reached;
}

const dynViolations = [];
const clientViolations = [];
const hostOnlyStaticViolations = [];
const bundledScriptViolations = [];

for (const rel of scriptsModulesReachedByWeb()) {
  let body;
  try {
    body = readFileSync(join(ROOT, rel), "utf8");
  } catch {
    continue;
  }
  for (const specifier of moduleReferences(body)) {
    if (!isBundleSafeSpecifier(specifier)) bundledScriptViolations.push(`${rel} -> ${specifier}`);
  }
}

for (const baseDir of SCAN_DIRS) {
  for (const file of walk(baseDir)) {
    let body;
    try {
      body = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const rel = relative(ROOT, file).replace(/\\/g, "/");

    if (DYN_REQUIRE.test(body) && !DYNAMIC_REQUIRE_ALLOW.has(rel)) {
      dynViolations.push(rel);
    }
    if (isUseClient(body)) {
      const hits = clientNodeBuiltinImports(body);
      if (hits.length) clientViolations.push(`${rel}  (imports: ${hits.join(", ")})`);
    }
    if (isServerBundleEntrypoint(rel)) {
      for (const specifier of extractStaticImports(body)) {
        if (HOST_ONLY_IMPORTS.some((re) => re.test(specifier))) {
          hostOnlyStaticViolations.push(`${rel} -> ${specifier}`);
        }
      }
    }
  }
}

let failed = false;

if (dynViolations.length > 0) {
  failed = true;
  console.error("");
  console.error('ERROR: BI-98AF1066 — bundle-hostile dynamic require found.');
  console.error("");
  console.error('`new Function(... require ...)` is invisible to the bundler and can resolve to');
  console.error('undefined in a Next server chunk — the lazy-node "d is not a function" crash that');
  console.error('crash-looped /build. Use a direct import instead:');
  console.error('    import * as childProcess from "node:child_process";');
  console.error("");
  for (const v of dynViolations) console.error("  " + v);
  console.error("");
}

if (clientViolations.length > 0) {
  failed = true;
  console.error("");
  console.error('ERROR: BI-98AF1066 — Node built-in imported by a "use client" component.');
  console.error("");
  console.error("These modules don't exist in the browser bundle and break the client build.");
  console.error("Move the server-only code to a server module, route handler, or server action,");
  console.error("and call it from the client via that boundary.");
  console.error("");
  for (const v of clientViolations) console.error("  " + v);
  console.error("");
}

if (hostOnlyStaticViolations.length > 0) {
  failed = true;
  console.error("");
  console.error("ERROR: BI-98AF1066 — host-only module statically imported into a server bundle entrypoint.");
  console.error("");
  console.error("Routes, pages, server actions, and Inngest functions must not statically import");
  console.error("Docker-only promoter code. Use a dynamic import() boundary at the call site so");
  console.error("Next/Turbopack does not trace the host-only graph during page-load or route builds.");
  console.error("");
  for (const v of hostOnlyStaticViolations) console.error("  " + v);
  console.error("");
}

if (bundledScriptViolations.length > 0) {
  failed = true;
  console.error("");
  console.error("ERROR: BI-76651B7B — a scripts/ module the web bundle reaches imports promoter-only code.");
  console.error("");
  console.error("apps/web statically imports these scripts/ helpers, so Next bundles them AND");
  console.error("everything they reach. Pulling installer modules or a generated catalog into one");
  console.error("breaks the production build with module-not-found - from outside apps/web, where");
  console.error("the other checks never look.");
  console.error("");
  for (const v of bundledScriptViolations) console.error("  " + v);
  console.error("");
  console.error("Keep the shared module pure (node: builtins only) and move the filesystem and");
  console.error("projection work into a promoter-only entrypoint the portal never imports.");
  console.error("");
}

if (failed) {
  console.error("These are caught statically here so they don't surface as a slow Docker build");
  console.error("failure or a corrupt runtime in production. Fix at the source above.");
  console.error("");
  process.exit(1);
}

console.log("✓ Bundle boundaries clean: no bundle-hostile dynamic requires, no Node built-ins in client components, no static host-only imports in server entrypoints.");
