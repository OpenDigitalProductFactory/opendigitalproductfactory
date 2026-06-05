// apps/web/lib/self-upgrade/impact/conventional.ts
//
// Conventional Commits 1.0.0 subject parser, narrowed to the subset DPF
// actually emits. DPF squashes PRs with Conventional Commit subjects
// (`feat(scope): subject (#1234)`), so the SUBJECT is the load-bearing
// signal — body trailers are rarely populated on squashed merges.
//
// Pure function, no I/O. Tested directly.

import type { ChangeCategory, ConventionalType, ParsedCommit, RawCommit } from "./types";

// `type(scope)!: description (#1234)` — scope and `!` and `(#nn)` optional.
// We intentionally accept a permissive scope ([^)]+) so multi-word scopes
// like `(self-upgrade)` and `(web,infra)` both parse.
const CONVENTIONAL_RE = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:\s+(?<body>.+?)$/;
const TRAILING_PR_RE = /\s*\(#(\d+)\)\s*$/;

const KNOWN_TYPES: ReadonlySet<ConventionalType> = new Set<ConventionalType>([
  "feat", "fix", "perf", "refactor", "docs", "chore",
  "test", "build", "ci", "style", "revert",
]);

/** Map a Conventional type + breaking marker to an ImpactCategory bucket. */
export function categoryFor(type: ConventionalType, breaking: boolean): ChangeCategory {
  if (breaking) return "breaking";
  switch (type) {
    case "feat": return "feature";
    case "fix": return "fix";
    case "perf": return "performance";
    // refactor / docs / chore / test / build / ci / style / revert / unknown
    // all aggregate as "other" — the headline groups them together, but the
    // per-item scoring keeps refactors visible if they touch a customized path.
    default: return "other";
  }
}

/**
 * Parse one raw commit. Returns a ParsedCommit with `type: "unknown"` and the
 * full subject in `description` when the subject is not Conventional — those
 * still flow through scoring + phrasing as `other`, never dropped.
 */
export function parseCommit(raw: RawCommit): ParsedCommit {
  const subject = raw.subject.trim();

  // Extract trailing `(#1234)` first so it doesn't end up in the description.
  let withoutPr = subject;
  let prNumber: number | null = null;
  const prMatch = withoutPr.match(TRAILING_PR_RE);
  if (prMatch && prMatch[1]) {
    prNumber = Number.parseInt(prMatch[1], 10);
    withoutPr = withoutPr.replace(TRAILING_PR_RE, "").trim();
  }

  const m = withoutPr.match(CONVENTIONAL_RE);
  if (!m || !m.groups) {
    return {
      ...raw,
      type: "unknown",
      scope: null,
      breaking: false,
      description: subject, // fall back to original subject (incl. PR ref)
      prNumber,
      category: categoryFor("unknown", false),
    };
  }

  const rawType = m.groups["type"]!;
  const type: ConventionalType = (KNOWN_TYPES as ReadonlySet<string>).has(rawType)
    ? (rawType as ConventionalType)
    : "unknown";
  const scope = m.groups["scope"] ?? null;
  const breaking = m.groups["bang"] === "!";
  const description = m.groups["body"]!.trim();

  return {
    ...raw,
    type,
    scope,
    breaking,
    description,
    prNumber,
    category: categoryFor(type, breaking),
  };
}

/** Bulk parser convenience. */
export function parseCommits(raw: RawCommit[]): ParsedCommit[] {
  return raw.map(parseCommit);
}
