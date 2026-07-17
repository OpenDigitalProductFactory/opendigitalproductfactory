import { readFileSync, readdirSync, statSync } from "node:fs";
import { readFile as nativeReadFile, readdir as nativeReaddir } from "node:fs/promises";
import { join, relative } from "node:path";

export const MODULE_SIZE_ROOTS = ["apps", "packages", "scripts"];
export const MODULE_SIZE_SOFT_CEILING = 800;
export const MODULE_SIZE_HARD_CAP = 1000;
export const MODULE_SIZE_READ_CONCURRENCY = 8;

const SKIP_DIRECTORIES = new Set([
  "node_modules", ".next", "dist", "build", ".turbo", "coverage", "__snapshots__",
]);
const EXCLUSIONS = [
  /\.d\.ts$/,
  /^packages\/db\/generated\//,
  /^packages\/db\/src\/seed.*\.ts$/,
  /^packages\/db\/src\/.*-corpus\.ts$/,
  /^packages\/db\/scripts\/seed-.*\.ts$/,
];

export function normalizeModulePath(path) {
  return path.replace(/\\/g, "/");
}

export function isModuleSizeSource(path) {
  return /\.tsx?$/.test(path) && !EXCLUSIONS.some((pattern) => pattern.test(path));
}

function traversalError(path, cause) {
  return new Error(`Unable to traverse module-size path ${path}`, { cause });
}

async function walkAsync({ repoRoot, directory, readdir }) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT" && MODULE_SIZE_ROOTS.some((root) => directory === join(repoRoot, root))) return [];
    throw traversalError(directory, error);
  }
  const files = [];
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkAsync({ repoRoot, directory: fullPath, readdir }));
    else if (entry.isFile()) {
      const path = normalizeModulePath(relative(repoRoot, fullPath));
      if (isModuleSizeSource(path)) files.push(path);
    }
  }
  return files;
}

export async function listModuleSourcePaths({ repoRoot, readdir = nativeReaddir }) {
  const groups = [];
  for (const root of MODULE_SIZE_ROOTS) {
    groups.push(...await walkAsync({ repoRoot, directory: join(repoRoot, root), readdir }));
  }
  return groups.sort();
}

export async function readModuleSources({
  repoRoot,
  paths,
  readFile = nativeReadFile,
  concurrency = MODULE_SIZE_READ_CONCURRENCY,
}) {
  const sources = new Map();
  let cursor = 0;
  async function worker() {
    while (cursor < paths.length) {
      const path = paths[cursor];
      cursor += 1;
      sources.set(path, await readFile(join(repoRoot, ...path.split("/")), "utf8"));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, () => worker()));
  return sources;
}

export function moduleSizesFromSources(sources) {
  return Object.fromEntries([...sources]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([path, content]) => [path, content.split(/\r?\n/).length]));
}

export async function scanModuleSizes(options) {
  const paths = await listModuleSourcePaths(options);
  const sources = await readModuleSources({ ...options, paths });
  return moduleSizesFromSources(sources);
}

function walkSync(repoRoot, directory, io) {
  let entries;
  try {
    entries = io.readdirSync(directory);
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries.sort()) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const fullPath = join(directory, entry);
    let stat;
    try {
      stat = io.statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) files.push(...walkSync(repoRoot, fullPath, io));
    else if (stat.isFile()) {
      const path = normalizeModulePath(relative(repoRoot, fullPath));
      if (isModuleSizeSource(path)) files.push(path);
    }
  }
  return files;
}

export function scanModuleSizesSync({
  repoRoot,
  readdirSync: injectedReaddirSync = readdirSync,
  statSync: injectedStatSync = statSync,
  readFileSync: injectedReadFileSync = readFileSync,
}) {
  const io = { readdirSync: injectedReaddirSync, statSync: injectedStatSync };
  const sizes = {};
  for (const root of MODULE_SIZE_ROOTS) {
    for (const path of walkSync(repoRoot, join(repoRoot, root), io)) {
      sizes[path] = injectedReadFileSync(join(repoRoot, ...path.split("/")), "utf8").split(/\r?\n/).length;
    }
  }
  return sizes;
}
