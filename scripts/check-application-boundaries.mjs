#!/usr/bin/env node
// Application-context dependency guard — BI-2E9F6D37.
//
// The registry defines a directed, acyclic target architecture for selected
// apps/web/lib contexts. Existing reverse dependencies are exact, owned debt:
// the guard permits those import statements, blocks new ones, and reports
// exceptions that can be deleted after the source edge disappears.

import {
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateBudget } from "./lib/baseline-budget.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_REPO_ROOT = join(dirname(SCRIPT_PATH), "..");
const DEFAULT_REGISTRY_PATH = join(DEFAULT_REPO_ROOT, "scripts", "application-boundaries.json");
const SOURCE_EXTENSIONS = /\.(?:ts|tsx|mts|cts)$/;
const EXCLUDED_SOURCE = /(?:\.test\.|\.spec\.|\.d\.(?:ts|mts|cts)$)/;
const EXCLUDED_DIRECTORIES = new Set([
  "node_modules",
  ".next",
  "dist",
  "coverage",
  "__tests__",
  "__snapshots__",
]);

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

function walkSourceFiles(root) {
  const files = [];
  function visit(directory) {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && SOURCE_EXTENSIONS.test(entry.name) && !EXCLUDED_SOURCE.test(entry.name)) {
        files.push(full);
      }
    }
  }
  visit(root);
  return files;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

export function extractModuleSpecifiers(source) {
  const code = stripComments(source);
  const specifiers = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?[^;]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers].sort();
}

function contextForSpecifier({ sourceFile, specifier, contextRoot, contextNames }) {
  let candidate;
  if (specifier.startsWith("@/lib/")) {
    candidate = specifier.slice("@/lib/".length).split("/")[0];
  } else if (specifier.startsWith(".")) {
    const absoluteTarget = resolve(dirname(sourceFile), specifier);
    const targetRelative = relative(contextRoot, absoluteTarget);
    if (targetRelative.startsWith("..") || isAbsolute(targetRelative)) return null;
    candidate = targetRelative.split(/[\\/]/)[0];
  } else {
    return null;
  }
  return contextNames.has(candidate) ? candidate : null;
}

function findCycle(contexts) {
  const visited = new Set();
  const active = new Set();
  const stack = [];

  function visit(name) {
    if (active.has(name)) {
      const start = stack.indexOf(name);
      return [...stack.slice(start), name];
    }
    if (visited.has(name)) return null;
    visited.add(name);
    active.add(name);
    stack.push(name);
    for (const dependency of contexts[name]?.allowedDependencies ?? []) {
      if (!(dependency in contexts)) continue;
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    active.delete(name);
    return null;
  }

  for (const name of Object.keys(contexts).sort()) {
    const cycle = visit(name);
    if (cycle) return cycle;
  }
  return null;
}

export function validateBoundaryRegistry(registry, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const failures = [];
  if (registry?.version !== 1) failures.push("Registry version must be 1.");
  // Owned-expiring-budget shape (BI-3F17B16B): the registry as a whole carries
  // an owner + expiry like every other ratchet baseline; per-exception
  // owner/reviewBy stay the finer-grained budget below.
  failures.push(...validateBudget(
    { owner: registry?.owner, expiry: registry?.expiry },
    { label: "registry budget", today },
  ));
  if (typeof registry?.root !== "string" || !registry.root.trim()) {
    failures.push("Registry root must be a non-empty repository-relative path.");
  }
  const contexts = registry?.contexts;
  if (!contexts || typeof contexts !== "object" || Array.isArray(contexts)) {
    failures.push("Registry contexts must be an object.");
    return failures;
  }

  for (const [name, context] of Object.entries(contexts)) {
    if (!context?.owner?.trim()) failures.push(`Context ${name} requires an owner.`);
    if (!context?.description?.trim()) failures.push(`Context ${name} requires a description.`);
    if (!Array.isArray(context?.allowedDependencies)) {
      failures.push(`Context ${name} allowedDependencies must be an array.`);
      continue;
    }
    for (const dependency of context.allowedDependencies) {
      if (!(dependency in contexts)) {
        failures.push(`Context ${name} references unknown context ${dependency}.`);
      }
      if (dependency === name) failures.push(`Context ${name} may not depend on itself.`);
    }
  }

  const seenExceptions = new Set();
  for (const exception of registry?.exceptions ?? []) {
    if (!exception?.key?.trim()) failures.push("Every exception requires an exact key.");
    else if (seenExceptions.has(exception.key)) failures.push(`Duplicate exception key ${exception.key}.`);
    else seenExceptions.add(exception.key);
    if (!exception?.owner?.trim()) failures.push(`Exception ${exception?.key ?? "<missing>"} requires an owner.`);
    if (!exception?.rationale?.trim()) failures.push(`Exception ${exception?.key ?? "<missing>"} requires a rationale.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exception?.reviewBy ?? "")) {
      failures.push(`Exception ${exception?.key ?? "<missing>"} requires reviewBy in YYYY-MM-DD form.`);
    } else if (exception.reviewBy < today) {
      failures.push(`Exception ${exception.key} review expired on ${exception.reviewBy}.`);
    }
  }

  const cycle = findCycle(contexts);
  if (cycle) failures.push(`Allowed dependency cycle: ${cycle.join(" -> ")}.`);
  return failures;
}

export async function analyzeApplicationBoundaries({ repoRoot, registry }) {
  const registryFailures = validateBoundaryRegistry(registry);
  if (registryFailures.length) {
    return {
      registryFailures,
      edges: [],
      newForbiddenEdges: [],
      staleExceptions: [],
    };
  }

  const contextRoot = join(repoRoot, registry.root);
  const contextNames = new Set(Object.keys(registry.contexts));
  const edgesByKey = new Map();

  for (const sourceFile of walkSourceFiles(contextRoot)) {
    const sourceRelativeToRoot = relative(contextRoot, sourceFile);
    const sourceContext = sourceRelativeToRoot.split(/[\\/]/)[0];
    if (!contextNames.has(sourceContext)) continue;
    const source = normalizePath(relative(repoRoot, sourceFile));
    const body = readFileSync(sourceFile, "utf8");
    for (const specifier of extractModuleSpecifiers(body)) {
      const targetContext = contextForSpecifier({
        sourceFile,
        specifier,
        contextRoot,
        contextNames,
      });
      if (!targetContext || targetContext === sourceContext) continue;
      const key = `${source}|${specifier}|${targetContext}`;
      edgesByKey.set(key, { source, sourceContext, targetContext, specifier, key });
    }
  }

  const edges = [...edgesByKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  const exceptionKeys = new Set((registry.exceptions ?? []).map(({ key }) => key));
  const currentForbidden = edges.filter((edge) => (
    !registry.contexts[edge.sourceContext].allowedDependencies.includes(edge.targetContext)
  ));
  const currentForbiddenKeys = new Set(currentForbidden.map(({ key }) => key));

  return {
    registryFailures: [],
    edges,
    newForbiddenEdges: currentForbidden.filter(({ key }) => !exceptionKeys.has(key)),
    staleExceptions: [...exceptionKeys].filter((key) => !currentForbiddenKeys.has(key)).sort(),
  };
}

function loadRegistry(path = DEFAULT_REGISTRY_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeCurrentBaseline(registry, analysis, path = DEFAULT_REGISTRY_PATH) {
  const existingByKey = new Map((registry.exceptions ?? []).map((entry) => [entry.key, entry]));
  const currentForbidden = analysis.edges.filter((edge) => (
    !registry.contexts[edge.sourceContext].allowedDependencies.includes(edge.targetContext)
  ));
  registry.exceptions = currentForbidden.map((edge) => existingByKey.get(edge.key) ?? {
    key: edge.key,
    owner: registry.contexts[edge.sourceContext].owner,
    rationale: "Pre-existing reverse dependency captured by BI-2E9F6D37; remove through the owning context refactor.",
    // A new exception inherits the registry-level budget expiry (BI-3F17B16B)
    // rather than a hardcoded date that goes stale and is born expired.
    reviewBy: registry.expiry,
  });
  writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  return registry.exceptions.length;
}

async function runCli() {
  const registry = loadRegistry();
  const analysis = await analyzeApplicationBoundaries({
    repoRoot: DEFAULT_REPO_ROOT,
    registry,
  });

  if (analysis.registryFailures.length) {
    console.error("Application boundary registry is invalid:");
    for (const failure of analysis.registryFailures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes("--write-baseline")) {
    const count = writeCurrentBaseline(registry, analysis);
    console.log(`Wrote ${count} exact application-boundary exception(s).`);
    return;
  }

  if (analysis.newForbiddenEdges.length) {
    console.error("Application boundary guard failed — new reverse dependencies:");
    for (const edge of analysis.newForbiddenEdges) {
      console.error(`  - ${edge.sourceContext} -> ${edge.targetContext}: ${edge.source} imports ${edge.specifier}`);
    }
    console.error("Refactor toward the allowed DAG. Do not expand the exception baseline without an owned architecture decision.");
    process.exitCode = 1;
    return;
  }

  if (analysis.staleExceptions.length) {
    console.warn(`Application boundary debt shrank — remove ${analysis.staleExceptions.length} stale exception(s) with --write-baseline:`);
    for (const key of analysis.staleExceptions) console.warn(`  - ${key}`);
  }
  console.log(
    `Application boundaries OK — ${Object.keys(registry.contexts).length} contexts, ` +
    `${analysis.edges.length} cross-context import(s), ${registry.exceptions.length} owned exception(s).`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SCRIPT_PATH)) {
  await runCli();
}
