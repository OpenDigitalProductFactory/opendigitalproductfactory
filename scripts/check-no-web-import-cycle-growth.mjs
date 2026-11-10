#!/usr/bin/env node
// Web import-cycle ratchet — dependency-diet plan M11 step 2
// (docs/superpowers/plans/2026-09-08-dependency-diet-and-vertical-integration-plan.md).
//
// TypeScript project references need an acyclic graph between projects, and
// that graph counts EVERY import: `import type`, `export ... from`, dynamic
// `import()` and inline `import("x").T` type queries alike. apps/web's largest
// strongly connected component under that "all imports" graph was 678 files
// by this guard's count; moving the MCP tool contract types to a leaf module
// (apps/web/lib/mcp-tool-types.ts) cut it to 134. This guard stops it growing
// back while the remaining hubs are cut one move at a time.
//
// What it measures: production apps/web sources — the set apps/web/tsconfig.json
// type-checks (tests, scripts, e2e and test-support excluded, .d.ts excluded).
// Imports resolve through the `@/` alias and relative paths; package imports
// are outside the graph. The largest cycle's size may only shrink.
//
// Static-value mode (spec docs/superpowers/specs/2026-09-30-web-runtime-import-
// cycle-and-project-references-design.md §8): a second pass classifies every
// edge as value / type / dynamic (see "Edge kinds" below) and FORBIDS any
// cycle in the static value-import graph — the graph that fixes module load
// order. Budget 0 files: those cycles were cut, and one that comes back is a
// latent temporal-dead-zone crash at startup (an adapter that `extends` a class
// from the hub that imports it). The all-imports budget above is separate.
//
// Auto-discovered by scripts/check-guards.mjs (the check-no-* loop). Uses the
// pinned guard TypeScript from @dpf/repo-guard-runtime, so it runs in the
// lightweight source guard job without a workspace install.
//
//   node scripts/check-no-web-import-cycle-growth.mjs            # check (CI)
//   node scripts/check-no-web-import-cycle-growth.mjs --update   # retighten

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateBudget, readJsonBudget } from "./lib/baseline-budget.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const WEB_ROOT = join(REPO_ROOT, "apps", "web");
export const BASELINE_PATH = join(SCRIPT_DIR, "web-import-cycle-baseline.json");
const BASELINE_NOTE =
  "apps/web largest import cycle (all imports, type-only included) — the blocker for TypeScript project references (dependency-diet plan M11 step 2). Shrink-only: cut a hub, then retighten. Regenerate with: node scripts/check-no-web-import-cycle-growth.mjs --update";

// Directory names never walked (mirrors apps/web/tsconfig.json "exclude").
const SKIP_DIRS = new Set(["node_modules", ".next", "scripts", "e2e", "tests", "test-support", "coverage"]);

export function isProductionSource(relPath) {
  return /\.(ts|tsx)$/.test(relPath)
    && !/\.d\.ts$/.test(relPath)
    && !/\.(test|spec)\.tsx?$/.test(relPath);
}

function listWebSources() {
  const out = [];
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name);
      } else if (entry.isFile()) {
        const path = rel ? `${rel}/${entry.name}` : entry.name;
        if (isProductionSource(path)) out.push(path);
      }
    }
  };
  walk(WEB_ROOT, "");
  return out.sort();
}

/** Resolve an import specifier from `from` to a file in `known`, or null. */
export function resolveSpecifier(from, specifier, known) {
  let base;
  if (specifier.startsWith("@/")) base = specifier.slice(2);
  else if (specifier.startsWith(".")) base = posix.normalize(posix.join(posix.dirname(from), specifier));
  else return null;
  const candidates = [
    base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`,
    base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"),
  ];
  for (const candidate of candidates) if (known.has(candidate)) return candidate;
  return null;
}

/**
 * Build the all-imports graph. `files` is [{ path, source }] with paths
 * relative to apps/web; `ts` is a TypeScript module (preProcessFile).
 */
export function buildImportGraph(files, ts) {
  const known = new Set(files.map((f) => f.path));
  const graph = new Map();
  for (const { path, source } of files) {
    const edges = new Set();
    const { importedFiles } = ts.preProcessFile(source, true, true);
    for (const { fileName } of importedFiles) {
      const target = resolveSpecifier(path, fileName, known);
      if (target && target !== path) edges.add(target);
    }
    graph.set(path, edges);
  }
  return graph;
}

// ── Edge kinds (static-value mode) ─────────────────────────────────────────
//
// The all-imports graph above is what project references see. Module LOAD
// order is a smaller graph: only static value imports run the target before
// the importer. Each reference gets one kind (spec 2026-09-30 §1):
//   - "value":   a static import / `export … from` that binds at least one
//                runtime name. A side-effect `import "x"`, a namespace or
//                default import and `export *` all count. A named binding is
//                value unless it resolves to an exported interface or type
//                alias in the target (following `export *` and named
//                re-exports) — the isolatedModules elision SWC and tsc apply.
//                Conservative: a class or enum used only as a type is value.
//   - "dynamic": `import("x")` in expression position (deferred to call time).
//   - "type":    `import type`, `export type`, type-only named bindings, and
//                `import("x").T` type queries.

function hasModifier(node, ts, kind) {
  return (ts.getModifiers?.(node) ?? node.modifiers ?? []).some((m) => m.kind === kind);
}

function bindingNames(name, ts, out) {
  if (ts.isIdentifier(name)) out.push(name.text);
  else for (const element of name.elements ?? []) if (element.name) bindingNames(element.name, ts, out);
  return out;
}

/**
 * Parse one file into the facts the classifier needs: its top-level
 * declarations, its imports and exports, and every dynamic `import()` /
 * `import("x").T` reference.
 */
export function scanModule(source, ts, fileName = "module.tsx") {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const localTypes = new Set();
  const localValues = new Set();
  const imports = []; // { specifier, typeOnly, sideEffect, bindings: [{ local, imported, typeOnly }] }
  const exports = new Map(); // exported name -> { local, typeOnly } | { specifier, name, typeOnly }
  const starExports = []; // { specifier, typeOnly, namespace }
  const lazy = []; // { specifier, kind: "dynamic" | "type" }
  const isExported = (node) => hasModifier(node, ts, ts.SyntaxKind.ExportKeyword);
  const isDefault = (node) => hasModifier(node, ts, ts.SyntaxKind.DefaultKeyword);

  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      const entry = { specifier: statement.moduleSpecifier.text, typeOnly: Boolean(clause?.isTypeOnly), sideEffect: !clause, bindings: [] };
      if (clause?.name) entry.bindings.push({ local: clause.name.text, imported: "default", typeOnly: false });
      const named = clause?.namedBindings;
      if (named && ts.isNamespaceImport(named)) entry.bindings.push({ local: named.name.text, imported: "*", typeOnly: false });
      else if (named) {
        for (const element of named.elements) {
          entry.bindings.push({ local: element.name.text, imported: (element.propertyName ?? element.name).text, typeOnly: element.isTypeOnly });
        }
      }
      imports.push(entry);
    } else if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null;
      const clause = statement.exportClause;
      if (!clause) {
        if (specifier) starExports.push({ specifier, typeOnly: statement.isTypeOnly, namespace: false });
      } else if (ts.isNamespaceExport(clause)) {
        if (specifier) {
          exports.set(clause.name.text, { specifier, name: "*", typeOnly: statement.isTypeOnly });
          starExports.push({ specifier, typeOnly: statement.isTypeOnly, namespace: true });
        }
      } else {
        for (const element of clause.elements) {
          const original = (element.propertyName ?? element.name).text;
          const typeOnly = statement.isTypeOnly || element.isTypeOnly;
          exports.set(element.name.text, specifier ? { specifier, name: original, typeOnly } : { local: original, typeOnly });
        }
      }
    } else if (ts.isExportAssignment(statement)) {
      exports.set("default", { local: null, typeOnly: false });
    } else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      localTypes.add(statement.name.text);
      if (isExported(statement)) exports.set(isDefault(statement) ? "default" : statement.name.text, { local: statement.name.text, typeOnly: false });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(declaration.name, ts, [])) {
          localValues.add(name);
          if (isExported(statement)) exports.set(name, { local: name, typeOnly: false });
        }
      }
    } else if (
      ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)
      || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement)
      || ts.isImportEqualsDeclaration(statement)
    ) {
      const name = statement.name && ts.isIdentifier(statement.name) ? statement.name.text : null;
      if (name) localValues.add(name);
      if (isExported(statement)) exports.set(isDefault(statement) ? "default" : name, { local: name, typeOnly: false });
    }
  }

  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [arg] = node.arguments;
      if (arg && ts.isStringLiteralLike(arg)) lazy.push({ specifier: arg.text, kind: "dynamic" });
    } else if (ts.isImportTypeNode(node)) {
      const arg = node.argument;
      if (ts.isLiteralTypeNode(arg) && ts.isStringLiteral(arg.literal)) lazy.push({ specifier: arg.literal.text, kind: "type" });
    }
    ts.forEachChild(node, visit);
  };
  if (/\bimport\s*\(/.test(source)) visit(sf); // walking every node is the slow part; skip files with none
  return { localTypes, localValues, imports, exports, starExports, lazy };
}

/**
 * Kind of the export `name` of `path`: "type", "value", or undefined when the
 * module does not export it. Follows named re-exports, re-exported imports and
 * `export *`. A name declared as both (interface + const) is value.
 */
export function exportKind(path, name, ctx, seen = new Set()) {
  const key = `${path}\0${name}`;
  if (seen.has(key)) return undefined;
  seen.add(key);
  const mod = ctx.modules.get(path);
  if (!mod) return "value";
  const entry = mod.exports.get(name);
  if (entry) {
    if (entry.typeOnly) return "type";
    if (entry.specifier) {
      if (entry.name === "*") return "value";
      const target = resolveSpecifier(path, entry.specifier, ctx.known);
      return target ? (exportKind(target, entry.name, ctx, seen) ?? "value") : "value";
    }
    const local = entry.local;
    if (local === null || mod.localValues.has(local)) return "value";
    if (mod.localTypes.has(local)) return "type";
    for (const imp of mod.imports) {
      const binding = imp.bindings.find((b) => b.local === local);
      if (!binding) continue;
      if (imp.typeOnly || binding.typeOnly) return "type";
      if (binding.imported === "*") return "value";
      const target = resolveSpecifier(path, imp.specifier, ctx.known);
      return target ? (exportKind(target, binding.imported, ctx, seen) ?? "value") : "value";
    }
    return "value";
  }
  if (name === "default") return undefined; // `export *` never re-exports default
  for (const star of mod.starExports) {
    if (star.namespace) continue;
    const target = resolveSpecifier(path, star.specifier, ctx.known);
    if (!target) continue;
    const kind = exportKind(target, name, ctx, seen);
    if (kind) return star.typeOnly ? "type" : kind;
  }
  return undefined;
}

/**
 * Classify every in-graph reference of every file. `files` is [{ path,
 * source }]; returns [{ from, to, kind, names }], one entry per statement, so
 * a report can name what each edge binds.
 */
export function classifyEdges(files, ts) {
  const known = new Set(files.map((f) => f.path));
  const modules = new Map(files.map(({ path, source }) => [path, scanModule(source, ts, path)]));
  const ctx = { known, modules };
  const edges = [];
  const push = (from, specifier, kind, names) => {
    const to = resolveSpecifier(from, specifier, known);
    if (to && to !== from) edges.push({ from, to, kind, names });
  };
  for (const [from, mod] of modules) {
    for (const imp of mod.imports) {
      const target = resolveSpecifier(from, imp.specifier, known);
      if (!target) continue;
      const valueNames = imp.typeOnly ? [] : imp.bindings
        .filter((b) => !b.typeOnly && (b.imported === "*" || exportKind(target, b.imported, ctx) !== "type"))
        .map((b) => b.imported);
      const isValue = !imp.typeOnly && (imp.sideEffect || valueNames.length > 0);
      push(from, imp.specifier, isValue ? "value" : "type", isValue ? valueNames : imp.bindings.map((b) => b.imported));
    }
    for (const [exported, entry] of mod.exports) {
      if (!entry.specifier) continue;
      const target = resolveSpecifier(from, entry.specifier, known);
      if (!target) continue;
      const isType = entry.typeOnly || (entry.name !== "*" && exportKind(target, entry.name, ctx) === "type");
      push(from, entry.specifier, isType ? "type" : "value", [exported]);
    }
    for (const star of mod.starExports) {
      if (!star.namespace) push(from, star.specifier, star.typeOnly ? "type" : "value", ["*"]);
    }
    for (const ref of mod.lazy) push(from, ref.specifier, ref.kind, []);
  }
  return edges;
}

/** Graph over only the edges whose kind is in `kinds`. */
export function graphOfKinds(paths, edges, kinds) {
  const graph = new Map(paths.map((path) => [path, new Set()]));
  for (const edge of edges) if (kinds.includes(edge.kind)) graph.get(edge.from).add(edge.to);
  return graph;
}

/** Every strongly connected component of more than one file, largest first, each sorted. */
export function stronglyConnectedComponents(graph) {
  const components = [];
  tarjan(graph, (component) => { if (component.length > 1) components.push(component.sort()); });
  return components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

/** Largest strongly connected component, sorted. */
export function largestCycle(graph) {
  let best = [];
  tarjan(graph, (component) => { if (component.length > best.length) best = component; });
  // A single file is only a cycle if it imports itself, which the graph drops.
  return best.length > 1 ? best.sort() : [];
}

/** Iterative Tarjan; calls `onComponent` with each strongly connected component. */
function tarjan(graph, onComponent) {
  let counter = 0;
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  for (const root of graph.keys()) {
    if (index.has(root)) continue;
    const work = [[root, [...graph.get(root)], 0]];
    index.set(root, counter); low.set(root, counter); counter++;
    stack.push(root); onStack.add(root);
    while (work.length) {
      const frame = work[work.length - 1];
      const [node, next] = frame;
      if (frame[2] < next.length) {
        const w = next[frame[2]++];
        if (!index.has(w)) {
          index.set(w, counter); low.set(w, counter); counter++;
          stack.push(w); onStack.add(w);
          work.push([w, [...(graph.get(w) ?? [])], 0]);
        } else if (onStack.has(w)) {
          low.set(node, Math.min(low.get(node), index.get(w)));
        }
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent), low.get(node)));
      }
      if (low.get(node) === index.get(node)) {
        const component = [];
        let w;
        do { w = stack.pop(); onStack.delete(w); component.push(w); } while (w !== node);
        onComponent(component);
      }
    }
  }
}

export function validateBaseline(baseline) {
  const failures = validateBudget(readJsonBudget(baseline), { label: "web-import-cycle-baseline.json" });
  if (!Number.isInteger(baseline?.largestCycle) || baseline.largestCycle < 0) {
    failures.push("web-import-cycle-baseline.json: largestCycle must be a non-negative integer.");
  }
  if (!Array.isArray(baseline?.members)) {
    failures.push("web-import-cycle-baseline.json: members must be an array of apps/web paths.");
  }
  return failures;
}

// Static value-import cycles are forbidden outright (spec 2026-09-30 §8): the
// three that existed (11, 4 and 2 files around lib/ai-inference.ts and
// lib/inference/*) were cut, so the budget is zero files, not a baseline.
export const STATIC_VALUE_CYCLE_BUDGET = 0;

/**
 * Static-value mode: every SCC of the value-edge graph, each with the value
 * edges inside it (and the names they bind) so a failure says what to cut.
 */
export function runStaticValueCheck({ components, edges }) {
  const files = components.reduce((sum, component) => sum + component.length, 0);
  const report = components.map((members) => {
    const inside = new Set(members);
    return {
      members,
      edges: edges.filter((e) => e.kind === "value" && inside.has(e.from) && inside.has(e.to)),
    };
  });
  return { ok: files <= STATIC_VALUE_CYCLE_BUDGET, files, components: report };
}

export function runCheck({ cycle, baseline }) {
  const baselineFailures = validateBaseline(baseline);
  if (baselineFailures.length) return { ok: false, baselineFailures, entrants: [], size: cycle.length };
  const recorded = new Set(baseline.members);
  const entrants = cycle.filter((file) => !recorded.has(file));
  return {
    ok: cycle.length <= baseline.largestCycle,
    baselineFailures: [],
    entrants,
    size: cycle.length,
    shrunk: baseline.largestCycle - cycle.length,
  };
}

async function main() {
  const { loadPinnedGuardTypeScript } = await import("./lib/load-pinned-guard-typescript.mjs");
  const ts = loadPinnedGuardTypeScript({ repoRoot: REPO_ROOT });
  const files = listWebSources().map((path) => ({ path, source: readFileSync(join(WEB_ROOT, path), "utf8") }));
  const cycle = largestCycle(buildImportGraph(files, ts));
  const edges = classifyEdges(files, ts);
  const staticValue = runStaticValueCheck({
    components: stronglyConnectedComponents(graphOfKinds(files.map((f) => f.path), edges, ["value"])),
    edges,
  });
  if (!staticValue.ok) {
    console.error(`apps/web has ${staticValue.components.length} static value-import cycle(s) (${staticValue.files} file(s); budget ${STATIC_VALUE_CYCLE_BUDGET}).`);
    console.error("These modules load in a cycle: one of them evaluates before an import it");
    console.error("depends on has finished, so a top-level use (e.g. `extends` an imported class)");
    console.error("throws at startup. `import type` and dynamic import() edges do not count.");
    for (const { members, edges: inside } of staticValue.components) {
      console.error(`  cycle of ${members.length}:`);
      for (const e of inside) console.error(`    apps/web/${e.from} -> apps/web/${e.to}  [${e.names.join(", ") || "side effect"}]`);
    }
    console.error("Usual fix: move the shared helper/class into a leaf both sides import, or import");
    console.error("it from the module that defines it rather than a re-exporting hub.");
    process.exitCode = 1;
  }

  if (process.argv.includes("--update")) {
    let owner = "platform-architecture";
    let expiry = "2026-12-31";
    try {
      const existing = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
      owner = existing.owner ?? owner;
      expiry = existing.expiry ?? expiry;
    } catch {
      // first write — defaults above
    }
    const baseline = { version: 1, owner, expiry, note: BASELINE_NOTE, largestCycle: cycle.length, members: cycle };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`Wrote web import-cycle baseline: largest cycle ${cycle.length} file(s) of ${files.length}.`);
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error("Missing/unreadable scripts/web-import-cycle-baseline.json — run: node scripts/check-no-web-import-cycle-growth.mjs --update");
    process.exit(1);
  }
  const result = runCheck({ cycle, baseline });
  if (result.baselineFailures.length) {
    console.error("web-import-cycle baseline is invalid:");
    for (const failure of result.baselineFailures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  if (!result.ok) {
    console.error(`apps/web import cycle grew: ${baseline.largestCycle} -> ${result.size} file(s).`);
    console.error("TypeScript project references need this graph acyclic (M11 step 2), and every");
    console.error("import counts, `import type` included. Files now in the cycle that were not before:");
    for (const file of result.entrants) console.error(`  - apps/web/${file}`);
    console.error("Usual fix: import a type from its leaf contract module (e.g. @/lib/mcp-tool-types)");
    console.error("instead of from a runtime hub, or move the type into a types-only module.");
    console.error("Do not raise the baseline without an owned platform-architecture decision.");
    process.exit(1);
  }
  if (result.shrunk > 0) {
    console.warn(`apps/web import cycle shrank by ${result.shrunk} — retighten with --update in this PR.`);
  }
  if (!staticValue.ok) process.exit(1);
  console.log(
    `Web import cycle OK — largest ${result.size} file(s) (budget ${baseline.largestCycle}), ` +
      `owner ${baseline.owner}, review by ${baseline.expiry}; static value-import cycles: none.`,
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
