import { lazyFs, lazyFsPromises, lazyPath, getCwd } from "@/lib/shared/lazy-node";

export type SpecPlanKind = "spec" | "plan";

export type SpecPlanResult = {
  path: string;
  sourceRoot: string;
  kind: SpecPlanKind;
  title: string;
  date: string | null;
  snippet: string;
  referencedItemIds: string[];
  referencedEpicIds: string[];
};

/**
 * Whether this install actually carries a spec/plan corpus to search.
 *
 * BI-10C34BE1: the consumer image excludes `docs/superpowers/` on purpose
 * (`.dockerignore`), so on a runtime-host install the directories simply are
 * not there. The search returned `[]` for that state and `[]` for a genuine
 * no-match, which are opposite facts: one means "nothing matched the corpus",
 * the other means "no corpus was searched". An agent running the
 * verify-substrate-before-proposing-new check reads the second as the first and
 * concludes no prior design exists, which is how already-designed work gets
 * re-proposed. Absence of a corpus is never evidence of absence of a spec.
 */
export type SpecPlanCorpusStatus = {
  /** True only when every searched directory exists AND holds at least one markdown file. */
  available: boolean;
  /** Resolved repository root the directories were probed under. */
  root: string;
  /** Repo-relative directories this search covered. */
  searchedPaths: string[];
  /** Repo-relative directories that do not exist on this install. */
  missingPaths: string[];
  /** Total markdown files found across the searched directories. */
  fileCount: number;
  /** Human-readable statement of what was searched, and where specs live when they are not here. */
  reason: string;
};

export type SpecPlanSearchOutcome = {
  corpus: SpecPlanCorpusStatus;
  results: SpecPlanResult[];
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

const fsp = lazyFsPromises();
const fs = lazyFs();
const path = lazyPath();
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
  // turbopackIgnore: process.cwd() and these resolves are runtime filesystem
  // walks of the deployed install root; they must not be traced into the bundle.
  const cwd = getCwd();
  const cwdResolved = path.resolve(/*turbopackIgnore: true*/ cwd);
  const docsMarker = path.join(/*turbopackIgnore: true*/ cwdResolved, "docs", "superpowers");
  if (existsSyncCached(docsMarker)) return cwdResolved;

  // A canonical install keeps the bytes that are actually eligible for
  // self-upgrade under .upgrade-workspace. The host checkout beside it may be
  // stale, so it must not win merely because it also contains docs/.
  const configuredRoot = process.env.DPF_REPO_ROOT;
  if (configuredRoot) {
    const resolvedConfiguredRoot = path.resolve(/*turbopackIgnore: true*/ configuredRoot);
    const deployedRoot = path.join(
      /*turbopackIgnore: true*/ resolvedConfiguredRoot,
      ".upgrade-workspace",
    );
    if (existsSyncCached(path.join(/*turbopackIgnore: true*/ deployedRoot, "docs", "superpowers"))) {
      return deployedRoot;
    }
    if (existsSyncCached(path.join(/*turbopackIgnore: true*/ resolvedConfiguredRoot, "docs", "superpowers"))) {
      return resolvedConfiguredRoot;
    }
  }
  // apps/web/<...> dev scenarios — climb to repo root.
  const climbed = path.resolve(/*turbopackIgnore: true*/ cwdResolved, "..", "..");
  return climbed;
}

const existsCache = new Map<string, boolean>();
function existsSyncCached(p: string): boolean {
  if (existsCache.has(p)) return existsCache.get(p)!;
  try {
    fs.statSync(p);
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
  // CodeQL #107 (js/file-system-race): the previous form was
  //   stat = await fs.stat(filePath);
  //   ... (cache decision)
  //   body = await fs.readFile(filePath, "utf-8");
  // which has a TOCTOU window between the stat and the readFile —
  // a symlink swap or file replacement between the two ops could
  // produce a CacheEntry where mtimeMs and body come from different
  // files. The fix is to open() once and use the returned FileHandle
  // for both stat and read: stat-via-fd is atomic against on-disk
  // changes and readFile-via-fd reads the same inode.
  const { open } = fsp;
  let fh;
  try {
    fh = await open(filePath, "r");
  } catch {
    return null;
  }
  try {
    const stat = await fh.stat();
    const cached = cache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached;

    const body = await fh.readFile("utf-8");
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
  } catch {
    return null;
  } finally {
    await fh.close();
  }
}

/**
 * List markdown under a directory, reporting whether the directory exists at
 * all. The previous form collapsed ENOENT and "present but empty" into the same
 * `[]`, which is the collapse BI-10C34BE1 is about — the caller could not tell
 * a missing corpus from an empty one.
 */
async function listMarkdown(absDir: string): Promise<{ present: boolean; files: string[] }> {
  let entries: string[];
  try {
    entries = await fsp.readdir(absDir);
  } catch {
    return { present: false, files: [] };
  }
  return {
    present: true,
    files: entries.filter((f) => f.endsWith(".md")).map((f) => path.join(absDir, f)),
  };
}

const CORPUS_HOME =
  "Design specs and implementation plans live in the platform source repository under " +
  "docs/superpowers/specs and docs/superpowers/plans. Consumer and runtime-host images exclude " +
  "that tree on purpose, so an install can carry no corpus at all. Search a source checkout " +
  "directly, or point DPF_REPO_ROOT at one, before concluding no prior design exists.";

function describeCorpus(
  root: string,
  probed: Array<{ rel: string; present: boolean; fileCount: number }>,
): SpecPlanCorpusStatus {
  const searchedPaths = probed.map((d) => d.rel);
  const missingPaths = probed.filter((d) => !d.present).map((d) => d.rel);
  const fileCount = probed.reduce((n, d) => n + d.fileCount, 0);
  const available = missingPaths.length === 0 && fileCount > 0;
  const reason = available
    ? `Searched ${fileCount} markdown file(s) under ${searchedPaths.join(" and ")} in ${root}.`
    : missingPaths.length > 0
      ? `No spec/plan corpus on this install: ${missingPaths.join(" and ")} ` +
        `do(es) not exist under ${root}. ${CORPUS_HOME}`
      : `No spec/plan corpus on this install: ${searchedPaths.join(" and ")} exist under ${root} ` +
        `but contain no markdown files. ${CORPUS_HOME}`;
  return { available, root, searchedPaths, missingPaths, fileCount, reason };
}

export async function searchSpecsAndPlans(
  opts: SpecPlanSearchOptions,
): Promise<SpecPlanSearchOutcome> {
  const root = repoRoot();
  const matchesCap = Math.max(1, Math.min(opts.matches ?? DEFAULT_MATCHES, MAX_MATCHES));
  const queryLower = opts.query.toLowerCase();
  const itemNeedle = opts.itemId?.toLowerCase() ?? null;
  const epicNeedle = opts.epicId?.toLowerCase() ?? null;

  const dirs: Array<{ kind: SpecPlanKind; path: string }> = [];
  // turbopackIgnore: the `root` argument resolves to repoRoot() at runtime and
  // points at filesystem content that is intentionally not bundled. Without
  // these annotations Turbopack treats process.cwd() as unbounded and traces
  // the whole monorepo into every output asset that reaches this module.
  if (opts.kind == null || opts.kind === "spec") {
    dirs.push({ kind: "spec", path: path.join(/*turbopackIgnore: true*/ root, SPEC_DIR) });
  }
  if (opts.kind == null || opts.kind === "plan") {
    dirs.push({ kind: "plan", path: path.join(/*turbopackIgnore: true*/ root, PLAN_DIR) });
  }

  const results: SpecPlanResult[] = [];
  const probed: Array<{ rel: string; present: boolean; fileCount: number }> = [];
  for (const dir of dirs) {
    const listing = await listMarkdown(dir.path);
    probed.push({
      rel: dir.kind === "spec" ? SPEC_DIR : PLAN_DIR,
      present: listing.present,
      fileCount: listing.files.length,
    });
    for (const file of listing.files) {
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
        sourceRoot: root,
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

  // The corpus status rides with the results rather than beside them, so a
  // caller cannot read the array without the state that says whether an empty
  // array means anything (BI-10C34BE1).
  return { corpus: describeCorpus(root, probed), results: results.slice(0, matchesCap) };
}

// Reverse index: which IDs (BI-* and EP-*) are referenced anywhere under
// docs/superpowers/{specs,plans}? Used by get_next_recommended_work to flag
// items that already have a design or plan attached.
export async function buildSpecPlanReferenceIndex(): Promise<{
  specs: Set<string>;
  plans: Set<string>;
  corpus: SpecPlanCorpusStatus;
}> {
  const root = repoRoot();
  const specs = new Set<string>();
  const plans = new Set<string>();
  // turbopackIgnore: see note in searchSpecsAndPlans — these paths are runtime
  // filesystem reads of docs/, not bundled inputs.
  const specListing = await listMarkdown(path.join(/*turbopackIgnore: true*/ root, SPEC_DIR));
  for (const file of specListing.files) {
    const entry = await loadFile(file);
    if (!entry) continue;
    for (const id of entry.refs.items) specs.add(id);
    for (const id of entry.refs.epics) specs.add(id);
  }
  const planListing = await listMarkdown(path.join(/*turbopackIgnore: true*/ root, PLAN_DIR));
  for (const file of planListing.files) {
    const entry = await loadFile(file);
    if (!entry) continue;
    for (const id of entry.refs.items) plans.add(id);
    for (const id of entry.refs.epics) plans.add(id);
  }
  // An absent corpus makes every hasSpec/hasPlan derived from this index read
  // false. That is the same false negative as an empty search result, so the
  // index states its own coverage rather than letting callers assume it
  // (BI-10C34BE1).
  const corpus = describeCorpus(root, [
    { rel: SPEC_DIR, present: specListing.present, fileCount: specListing.files.length },
    { rel: PLAN_DIR, present: planListing.present, fileCount: planListing.files.length },
  ]);
  return { specs, plans, corpus };
}

/**
 * One sentence to append to any tool message whose answer was derived from the
 * spec/plan corpus, when that corpus is not there. Single-sourced so every
 * surface states the same caveat rather than each inventing its own wording.
 * Returns null when the corpus is present and the answer can be trusted.
 */
export function specPlanCorpusCaveat(corpus: SpecPlanCorpusStatus): string | null {
  if (corpus.available) return null;
  return (
    "Spec/plan coverage was NOT measured: " +
    `${corpus.reason} Treat every hasSpec/hasPlan below as unknown, not as false.`
  );
}

// Test seam — clears in-memory caches between scenarios.
export function _resetSpecPlanCachesForTests(): void {
  cache.clear();
  existsCache.clear();
}
