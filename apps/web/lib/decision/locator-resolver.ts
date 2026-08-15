// Repo-backed LocatorResolver for the trust-envelope external verifier
// (BI-8192557E; consumes lib/decision/evidence-reverifier.ts, BI-70FF9114).
//
// WHY THIS EXISTS: admissibility is not truth. `lib/deliberation/evidence.ts`
// already rejects citation theater — a citation must normalize to a
// StructuredLocator and pass `checkAdmissibility`. But a locator can be
// perfectly well-formed and still FABRICATED: a plausible filePath+line that
// never existed, or a real file that never contained the claimed excerpt. Until
// something re-resolves the locator against the live source, a confident
// fabrication is indistinguishable from grounded evidence — and multi-model
// deliberation makes that worse, because co-trained branches co-hallucinate and
// their agreement reads as corroboration.
//
// FAIL-CLOSED IS THE WHOLE CONTRACT. Every path that cannot positively read the
// cited artifact returns `resolved: false`, which `reverifyCitations` maps to
// `unresolved` → degrade. Out-of-reach is never treated as evidence of truth.
// That covers: missing files, unreadable files, path traversal, absolute paths,
// and source types a repo resolver simply cannot verify (db-query,
// runtime-state, tool-output, web, paper).
//
// Verifier identity is an audit field, never a gate input
// (governance-approves-evidence-not-provenance).

import { readFile } from "node:fs/promises";
import { isAbsolute, normalize, resolve as resolvePath, sep } from "node:path";

import type { StructuredLocator } from "@/lib/deliberation/evidence";
import type { LocatorResolution, LocatorResolver } from "@/lib/decision/evidence-reverifier";

/** Source types a repo-backed resolver can actually read. Everything else is out of reach. */
const REPO_READABLE = new Set(["code", "spec", "doc"]);

const UNRESOLVED: LocatorResolution = { resolved: false, liveExcerpt: null };

export type RepoLocatorResolverOptions = {
  /** Absolute path the resolver is confined to. Nothing outside is ever read. */
  repoRoot: string;
  /**
   * For a line-anchored `code` locator, how many lines either side of the cited
   * line to treat as the supporting window. A citation pointing at line N should
   * be supported by what is AT line N — not by a coincidental match 4,000 lines
   * away in the same file. Defaults to 40 (generous enough to survive ordinary
   * drift, tight enough that the anchor still means something).
   */
  lineWindow?: number;
};

/** The repo-relative path a locator points at, or null when the shape carries none. */
function pathOf(locator: StructuredLocator): string | null {
  if (locator.sourceType === "code") return locator.filePath ?? null;
  if (locator.sourceType === "spec" || locator.sourceType === "doc") return locator.path ?? null;
  return null;
}

/**
 * Confine a repo-relative path to the root. Returns null for absolute paths and
 * for anything that normalizes outside the root — those are never opened.
 */
function confine(repoRoot: string, relPath: string): string | null {
  if (!relPath || isAbsolute(relPath)) return null;
  const root = resolvePath(repoRoot);
  const target = resolvePath(root, normalize(relPath));
  // Suffix guard, not a bare startsWith: `/repo-evil` must not pass for `/repo`.
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

/** Narrow a file to the window around a cited line (1-indexed). */
function windowAround(content: string, line: number, lineWindow: number): string {
  const lines = content.split(/\r?\n/);
  if (line < 1 || line > lines.length) return "";
  const from = Math.max(0, line - 1 - lineWindow);
  const to = Math.min(lines.length, line + lineWindow);
  return lines.slice(from, to).join("\n");
}

/**
 * Build a resolver that re-reads cited artifacts from a repo checkout.
 *
 * The returned resolver never throws: `reverifyCitations` already treats a
 * throwing resolver as unresolved, but returning the fail-closed value directly
 * keeps the degrade reason readable in the report.
 */
export function createRepoLocatorResolver(options: RepoLocatorResolverOptions): LocatorResolver {
  const { repoRoot, lineWindow = 40 } = options;

  return async function resolveLocator(locator: StructuredLocator): Promise<LocatorResolution> {
    if (!REPO_READABLE.has(locator.sourceType)) return UNRESOLVED;

    const relPath = pathOf(locator);
    if (!relPath) return UNRESOLVED;

    const absolute = confine(repoRoot, relPath);
    if (!absolute) return UNRESOLVED;

    let content: string;
    try {
      content = await readFile(absolute, "utf8");
    } catch {
      // Missing, unreadable, or a directory — all fail-closed.
      return UNRESOLVED;
    }

    const line = locator.sourceType === "code" ? locator.line : undefined;
    const liveExcerpt =
      typeof line === "number" ? windowAround(content, line, lineWindow) : content;

    // A cited line outside the file yields an empty window: resolved, but it
    // supports nothing, so any recorded excerpt degrades.
    return { resolved: true, liveExcerpt };
  };
}
