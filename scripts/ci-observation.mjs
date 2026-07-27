#!/usr/bin/env node

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCiObservation,
  calculateSelectionRecall,
  parseVitestJsonReport,
  summarizeCoverage,
} from "./lib/ci-observation.mjs";

const DEFAULT_OWNED_ROOTS = new Map([
  ["web", [
    "apps/web/app",
    "apps/web/components",
    "apps/web/lib",
    "apps/web/proxy.ts",
    "apps/web/instrumentation.ts",
  ]],
  ["@dpf/db", ["packages/db/src"]],
]);

function parsePackagePath(value, flag) {
  const separator = value.indexOf("=");
  if (separator < 1 || separator === value.length - 1) {
    throw new Error(`${flag} requires package=path`);
  }
  return {
    packageName: value.slice(0, separator),
    path: value.slice(separator + 1),
  };
}

function addOwnedRoot(map, value) {
  const { packageName, path } = parsePackagePath(value, "--owned-root");
  map.set(packageName, [...(map.get(packageName) ?? []), path]);
}

export function parseCliArgs(args) {
  const options = {
    repository: process.env.GITHUB_REPOSITORY ?? "",
    treeSha: process.env.GITHUB_SHA ?? "",
    eventName: process.env.GITHUB_EVENT_NAME ?? "local",
    runId: process.env.GITHUB_RUN_ID ?? "",
    runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? 1),
    createdAt: new Date().toISOString(),
    coverage: [],
    ownedRoots: new Map(),
    vitest: [],
    previousObservationPath: null,
    shadowSelectionPath: null,
    cacheSamplesPath: null,
    timingSamplesPath: null,
    outputPath: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    index += 1;
    if (flag === "--repository") options.repository = value;
    else if (flag === "--tree-sha") options.treeSha = value;
    else if (flag === "--event") options.eventName = value;
    else if (flag === "--run-id") options.runId = value;
    else if (flag === "--run-attempt") options.runAttempt = Number(value);
    else if (flag === "--created-at") options.createdAt = value;
    else if (flag === "--coverage") options.coverage.push(parsePackagePath(value, flag));
    else if (flag === "--owned-root") addOwnedRoot(options.ownedRoots, value);
    else if (flag === "--vitest") options.vitest.push(parsePackagePath(value, flag));
    else if (flag === "--previous-observation") options.previousObservationPath = value;
    else if (flag === "--shadow-selection") options.shadowSelectionPath = value;
    else if (flag === "--cache-samples") options.cacheSamplesPath = value;
    else if (flag === "--timing-samples") options.timingSamplesPath = value;
    else if (flag === "--output") options.outputPath = value;
    else throw new Error(`unknown argument: ${flag}`);
  }
  return options;
}

function isOwnedSourceFile(name) {
  return /\.(?:ts|tsx)$/.test(name)
    && !/\.(?:test|spec)\.(?:ts|tsx)$/.test(name)
    && !/\.d\.ts$/.test(name);
}

export function discoverOwnedSourceFiles({
  repoRoot = process.cwd(),
  roots = [],
} = {}) {
  const files = [];
  const walk = (absolutePath) => {
    let entries;
    try {
      entries = readdirSync(absolutePath, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOTDIR") {
        if (isOwnedSourceFile(absolutePath)) {
          files.push(relative(repoRoot, absolutePath).replaceAll("\\", "/"));
        }
        return;
      }
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && [
        "__tests__",
        ".next",
        "coverage",
        "generated",
        "node_modules",
      ].includes(entry.name)) {
        continue;
      }
      const child = join(absolutePath, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (isOwnedSourceFile(entry.name)) {
        files.push(relative(repoRoot, child).replaceAll("\\", "/"));
      }
    }
  };
  for (const root of roots) walk(resolve(repoRoot, root));
  return [...new Set(files)].sort((left, right) => left.localeCompare(right));
}

function readJson(path, fallback) {
  if (!path) return fallback;
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

function ownedRootsFor(packageName, explicitRoots) {
  return explicitRoots.get(packageName) ?? DEFAULT_OWNED_ROOTS.get(packageName) ?? [];
}

export function collectObservation(options) {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const coverage = options.coverage.map(({ packageName, path }) => {
    const coverageSummary = readJson(path, {});
    return summarizeCoverage({
      packageName,
      repoRoot,
      ownedFiles: discoverOwnedSourceFiles({
        repoRoot,
        roots: ownedRootsFor(packageName, options.ownedRoots),
      }),
      coverageSummary,
    });
  });

  const testRuns = options.vitest.map(({ packageName, path }) => {
    const parsed = parseVitestJsonReport(readJson(path, {}), {
      packageName,
      repoRoot,
      runId: options.runId,
      treeSha: options.treeSha,
    });
    return {
      packageName,
      ...parsed,
      durationMs: parsed.files.reduce(
        (total, file) => total + Number(file.durationMs ?? 0),
        0,
      ),
      phase: `test:${packageName}`,
    };
  });

  const previous = readJson(options.previousObservationPath, {});
  const rawShadowSelection = readJson(options.shadowSelectionPath, null);
  const shadowSelection = rawShadowSelection
    ? calculateSelectionRecall(rawShadowSelection)
    : null;

  return buildCiObservation({
    repository: options.repository,
    treeSha: options.treeSha,
    eventName: options.eventName,
    runId: options.runId,
    runAttempt: options.runAttempt,
    createdAt: options.createdAt,
    coverage,
    testRuns,
    historicalTestObservations: previous.testHistory ?? [],
    cacheSamples: readJson(options.cacheSamplesPath, []),
    timingSamples: readJson(options.timingSamplesPath, []),
    shadowSelection,
  });
}

function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const observation = collectObservation({
    ...options,
    repoRoot: process.cwd(),
  });
  const serialized = `${JSON.stringify(observation, null, 2)}\n`;
  if (options.outputPath) {
    const outputPath = resolve(options.outputPath);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, serialized, "utf8");
    process.stdout.write(`[ci-observation] wrote ${options.outputPath}\n`);
  } else {
    process.stdout.write(serialized);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[ci-observation] ${error.message}\n`);
    process.exitCode = 1;
  }
}
