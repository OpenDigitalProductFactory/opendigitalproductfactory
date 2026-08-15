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
// Case-insensitive on the type token: a `Fix: …` subject is the same change as
// `fix: …`, and the type is lower-cased before lookup.
const CONVENTIONAL_RE = /^(?<type>[A-Za-z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:\s+(?<body>.+?)$/;
const TRAILING_PR_RE = /\s*\(#(\d+)\)\s*$/;

const KNOWN_TYPES: ReadonlySet<ConventionalType> = new Set<ConventionalType>([
  "feat", "fix", "perf", "refactor", "docs", "chore",
  "test", "build", "ci", "style", "revert",
]);

// Spelling variants DPF actually emits upstream (`doc(skill): …` appears 16
// times in the last 400 commits on main). Normalised to the canonical type so
// they never fall through to `unknown` and get filed as unparseable.
const TYPE_ALIASES: Readonly<Record<string, ConventionalType>> = {
  doc: "docs",
  feature: "feat",
  bugfix: "fix",
};

// Dependency bumps arrive as `build(deps)` / `build(deps-dev)` — the scope, not
// the type, is what separates "we upgraded React" from "we changed the build".
// Dependabot's group PRs use the same scope shape.
const DEPENDENCY_SCOPE_RE = /^deps(-dev)?$/;

/**
 * Map a Conventional type + breaking marker (+ scope, where the scope is what
 * distinguishes the bucket) to an operator-facing category.
 *
 * The `security` bucket is NOT derivable from the subject grammar alone — it
 * comes from PR labels / advisory references and is applied later by
 * `refineCategories` (./refine), after PR enrichment.
 */
export function categoryFor(
  type: ConventionalType,
  breaking: boolean,
  scope: string | null = null,
): ChangeCategory {
  if (breaking) return "breaking";
  const scopeText = (scope ?? "").trim().toLowerCase();
  switch (type) {
    case "feat": return "feature";
    case "fix": return "fix";
    case "perf": return "performance";
    case "docs": return "documentation";
    case "build":
      return DEPENDENCY_SCOPE_RE.test(scopeText) ? "dependency" : "maintenance";
    // refactor / chore / test / ci / style / revert are internal upkeep: real
    // work, but nothing an operator acts on. They stay visible (and can still
    // outrank on score when they touch a customized path) under one honest
    // label instead of sharing a bucket with docs and dependency bumps.
    case "refactor":
    case "chore":
    case "test":
    case "ci":
    case "style":
    case "revert":
      return "maintenance";
    // Unparseable subject — we genuinely do not know. Say so.
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

  const rawType = m.groups["type"]!.toLowerCase();
  const aliased = TYPE_ALIASES[rawType];
  const type: ConventionalType =
    aliased ??
    ((KNOWN_TYPES as ReadonlySet<string>).has(rawType)
      ? (rawType as ConventionalType)
      : "unknown");
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
    category: categoryFor(type, breaking, scope),
  };
}

/** Bulk parser convenience. */
export function parseCommits(raw: RawCommit[]): ParsedCommit[] {
  return raw.map(parseCommit);
}
