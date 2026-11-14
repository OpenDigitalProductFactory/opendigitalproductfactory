// scripts/lib/staged-scope.mjs
//
// BI-66236024 — does this commit stage anything the Workroom never claimed?
//
// WHY. `claim_workroom_scope` persists the paths a Workroom claims for edit
// (Workroom.scopeClaims, entries shaped {kind, value, intent}). Nothing ever
// compared that claim against what a commit actually stages.
//
// Observed 2026-09-16: a session ran `git add -A` after a tooling run, then
// `git commit --amend` without reading the staged diff, and committed 30 lines
// of an unrelated file — red TDD tests belonging to other work — into an
// observability branch. Full CI caught it about two hours later, after the
// session had already called the branch clean on the strength of a SCOPED test
// run that never touched that file.
//
// That is the shape this codebase keeps producing: a step that did not happen,
// reported as though it had. A guard that answers "are these paths yours?"
// turns it from something an agent must remember into something a commit
// cannot satisfy.
//
// WHAT IT IS NOT. It is not a review. A claimed path can still receive a bad
// change; this only answers whether the path was claimed at all.

/** Paths any branch may stage regardless of claim — the commit ceremony itself. */
export const ALWAYS_ALLOWED = Object.freeze([
  // Derived artifacts the pre-commit hook regenerates and stages on your
  // behalf. Refusing these would refuse the hook's own work.
  "apps/web/lib/docs/doc-index.generated.json",
  "apps/web/lib/docs/doc-impact.generated.json",
  "docs/user-guide/assets/diagrams/",
  "scripts/capability-service-catalog.generated.json",
]);

/** Reduce a scopeClaims array to the edit-claimed path prefixes. */
export function editClaimedPaths(scopeClaims) {
  if (!Array.isArray(scopeClaims)) return [];
  return scopeClaims
    .filter((c) => c && typeof c === "object" && c.intent === "edit" && c.kind === "path")
    .map((c) => (typeof c.value === "string" ? c.value.trim() : ""))
    .filter(Boolean)
    .map((p) => p.replace(/^\.\//, "").replace(/\\/g, "/").replace(/\/+$/, ""));
}

function covers(claim, staged) {
  const c = claim.replace(/\/+$/, "");
  return staged === c || staged.startsWith(`${c}/`);
}

/**
 * Classify a staged set against a claim.
 *
 * `active` is false whenever there is nothing to enforce against — no marker,
 * or a marker carrying no edit-claimed paths. The caller MUST report that
 * rather than print nothing: a guard that is off and a guard that passed must
 * never look the same. That rule is why this whole area exists.
 *
 * @param {{ stagedPaths: string[], scopePaths?: string[]|null, alwaysAllowed?: readonly string[] }} input
 */
export function classifyStagedScope({ stagedPaths, scopePaths, alwaysAllowed = ALWAYS_ALLOWED }) {
  const staged = (stagedPaths ?? []).map((p) => String(p).replace(/\\/g, "/")).filter(Boolean);
  if (!Array.isArray(scopePaths) || scopePaths.length === 0) {
    return {
      active: false,
      reason: "no edit-claimed paths for this branch — nothing to enforce against",
      violations: [],
      checked: staged.length,
    };
  }
  const violations = staged.filter(
    (p) => !alwaysAllowed.some((a) => covers(a, p)) && !scopePaths.some((c) => covers(c, p)),
  );
  return { active: true, reason: null, violations, checked: staged.length };
}
