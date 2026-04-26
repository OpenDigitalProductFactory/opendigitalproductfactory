import { promises as fs } from "fs";
import path from "path";

export type SpecPlanKind = "spec" | "plan";

export type SpecPlanResult = {
  path: string;
  kind: SpecPlanKind;
  title: string;
  date: string | null;
  snippet: string;
  referencedItemIds: string[];
  referencedEpicIds: string[];
};

export type SpecPlanSearchOptions = {
  query: string;
  kind?: SpecPlanKind;
  matches?: number;
  itemId?: string;
  epicId?: string;
};

const DEFAULT_MATCHES = 10;
const MAX_MATCHES = 25;
const SNIPPET_RADIUS = 120;

const SPEC_DIR = path.posix.join("docs", "superpowers", "specs");
const PLAN_DIR = path.posix.join("docs", "superpowers", "plans");

const ID_REGEX = /\b(BI|EP)-[A-Z0-9-]+\b/g;
const FRONTMATTER_TITLE = /^title:\s*['"]?(.+?)['"]?\s*$/m;
const FIRST_H1 = /^#\s+(.+)$/m;
const FILENAME_DATE = /^(\d{4}-\d{2}-\d{2})/;

type CacheEntry = {
  mtimeMs: number;
  title: string;
  date: string | null;
  body: string;
  bodyLower: string;
  refs: { items: string[]; epics: string[] };
};

const cache = new Map<string, CacheEntry>();

function repoRoot(): string {
  const cwdResolved = path.resolve(process.cwd());
  const docsMarker = path.join(cwdResolved, "docs", "superpowers");
  if (existsSyncCached(docsMarker)) return cwdResolved;
  // apps/web/<...> dev scenarios — climb to repo root.
  const climbed = path.resolve(cwdResolved, "..", "..");
  return climbed;
}

const existsCache = new Map<string, boolean>();
function existsSyncCached(p: string): boolean {
  if (existsCache.has(p)) return existsCache.get(p)!;
  try {
    require("fs").statSync(p);
    existsCache.set(p, true);
    return true;
  } catch {
    existsCache.set(p, false);
    return false;
  }
}

function extractTitle(body: string, fallback: string): string {
  const fm = body.match(FRONTMATTER_TITLE);
  if (fm) return fm[1]!.trim();
  const h1 = body.match(FIRST_H1);
  if (h1) return h1[1]!.trim();
  return fallback;
}

function extractDate(filename: string): string | null {
  const m = filename.match(FILENAME_DATE);
  return m ? m[1]! : null;
}

function extractRefs(body: string): { items: string[]; epics: string[] } {
  const items = new Set<string>();
  const epics = new Set<string>();
  for (const match of body.matchAll(ID_REGEX)) {
    const id = match[0];
    if (id.startsWith("BI-")) items.add(id);
    else if (id.startsWith("EP-")) epics.add(id);
  }
  return { items: [...items].sort(), epics: [...epics].sort() };
}

function makeSnippet(body: string, matchIndex: number): string {
  if (matchIndex < 0) {
    return body.slice(0, SNIPPET_RADIUS * 2).replace(/\s+/g, " ").trim();
  }
  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(body.length, matchIndex + SNIPPET_RADIUS);
  let s = body.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) s = "..." + s;
  if (end < body.length) s = s + "...";
  return s;
}

async function loadFile(filePath: string): Promise<CacheEntry | null> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return null;
  }
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached;

  let body: string;
  try {
    body = await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
  const filename = path.basename(filePath);
  const entry: CacheEntry = {
    mtimeMs: stat.mtimeMs,
    title: extractTitle(body, filename.replace(/\.md$/, "")),
    date: extractDate(filename),
    body,
    bodyLower: body.toLowerCase(),
    refs: extractRefs(body),
  };
  cache.set(filePath, entry);
  return entry;
}

async function listMarkdown(absDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(absDir);
  } catch {
    return [];
  }
  return entries.filter((f) => f.endsWith(".md")).map((f) => path.join(absDir, f));
}

export async function searchSpecsAndPlans(
  opts: SpecPlanSearchOptions,
): Promise<SpecPlanResult[]> {
  const root = repoRoot();
  const matchesCap = Math.max(1, Math.min(opts.matches ?? DEFAULT_MATCHES, MAX_MATCHES));
  const queryLower = opts.query.toLowerCase();
  const itemNeedle = opts.itemId?.toLowerCase() ?? null;
  const epicNeedle = opts.epicId?.toLowerCase() ?? null;

  const dirs: Array<{ kind: SpecPlanKind; path: string }> = [];
  if (opts.kind == null || opts.kind === "spec") {
    dirs.push({ kind: "spec", path: path.join(root, SPEC_DIR) });
  }
  if (opts.kind == null || opts.kind === "plan") {
    dirs.push({ kind: "plan", path: path.join(root, PLAN_DIR) });
  }

  const results: SpecPlanResult[] = [];
  for (const dir of dirs) {
    const files = await listMarkdown(dir.path);
    for (const file of files) {
      const entry = await loadFile(file);
      if (!entry) continue;

      const titleLower = entry.title.toLowerCase();
      const queryHit =
        queryLower.length > 0 &&
        (titleLower.includes(queryLower) || entry.bodyLower.includes(queryLower));
      const itemHit = itemNeedle != null && entry.bodyLower.includes(itemNeedle);
      const epicHit = epicNeedle != null && entry.bodyLower.includes(epicNeedle);

      if (!queryHit && !itemHit && !epicHit) continue;

      const matchIndex = queryLower.length > 0 ? entry.bodyLower.indexOf(queryLower) : -1;
      const relPath = path
        .relative(root, file)
        .replace(/\\/g, "/");

      results.push({
        path: relPath,
        kind: dir.kind,
        title: entry.title,
        date: entry.date,
        snippet: makeSnippet(entry.body, matchIndex),
        referencedItemIds: entry.refs.items,
        referencedEpicIds: entry.refs.epics,
      });
    }
  }

  results.sort((a, b) => {
    const ad = a.date ?? "";
    const bd = b.date ?? "";
    if (ad !== bd) return bd.localeCompare(ad);
    return a.path.localeCompare(b.path);
  });

  return results.slice(0, matchesCap);
}

// Test seam — clears in-memory caches between scenarios.
export function _resetSpecPlanCachesForTests(): void {
  cache.clear();
  existsCache.clear();
}
