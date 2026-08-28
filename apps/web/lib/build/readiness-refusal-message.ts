// apps/web/lib/build/readiness-refusal-message.ts
//
// BI-C5D978E9 — what the owner is told when initiative readiness blocks a phase.
//
// The refusal used to be the raw enum list:
//
//   Cannot enter plan: RESEARCH_REQUIRED, CANONICAL_DESIGN_REQUIRED,
//   SPEC_APPROVAL_REQUIRED, REVIEW_REQUIRED, OBJECTIVE_BASELINE_REQUIRED,
//   ARTIFACT_AUTHOR_REQUIRED.
//
// Six codes, no roles, no verbs. A shelter director reads that and cannot tell
// whether they forgot something, whether the platform is broken, or what would
// make it go. Live repro FB-EB292B9F, whose design had PASSED review and sized
// `ok` — nothing was wrong with their request at all.
//
// Every requirement already carries the role accountable for it
// (`evaluate.ts` builds `{ code, state, accountableRole }`); `codes()` simply
// discarded it. This turns the same decision into a sentence that says what is
// missing, who records it, and — decisively — that it is not the owner's input
// that is outstanding.
//
// Pure module — no Prisma, no I/O.

/** What each requirement means, in the owner's language. */
const MEANING: Record<string, string> = {
  RESEARCH_REQUIRED: "the research behind this design has not been recorded",
  CANONICAL_DESIGN_REQUIRED: "no canonical design document is pinned for this work",
  SPEC_APPROVAL_REQUIRED: "the design has not been approved against that document",
  REVIEW_REQUIRED: "an independent review has not been recorded",
  OBJECTIVE_BASELINE_REQUIRED: "this work is not yet tied to a measurable objective",
  ARTIFACT_AUTHOR_REQUIRED: "the design document has no recorded author",
  CLASSIFICATION_REQUIRED: "this work has not been classified",
  AUTHORIZATION_DENIED: "authorization for this work was refused",
  REVIEW_FAILED: "a recorded review did not pass",
};

/** Roles rendered as something a person recognises. */
const ROLE_LABEL: Record<string, string> = {
  "design-author": "the design author",
  "design-checklist-reviewer": "a design reviewer",
  "architecture-reviewer": "an architecture reviewer",
  "artifact-resolver": "the artifact resolver",
  "data-reviewer": "a data reviewer",
  "ux-reviewer": "a UX reviewer",
  "security-reviewer": "a security reviewer",
  "compliance-reviewer": "a compliance reviewer",
  "domain-reviewer": "a domain reviewer",
  "product-owner": "the product owner",
  "platform-governance": "platform governance",
};

export type UnmetRequirement = { code: string; accountableRole?: string | null };

function describe(entry: UnmetRequirement): string {
  const meaning = MEANING[entry.code] ?? entry.code;
  const role = entry.accountableRole ? ROLE_LABEL[entry.accountableRole] ?? entry.accountableRole : null;
  return role ? `${meaning} (${role})` : meaning;
}

/**
 * The owner-facing refusal.
 *
 * Deliberately says these are recorded by reviewers. The single most useful
 * fact for the owner is that nothing is waiting on them — the previous message
 * left them hunting for an input they were never asked for.
 *
 * Falls back to the bare code list only when there is nothing to describe, so a
 * caller can always render something.
 */
export function describeReadinessRefusal(
  targetPhase: string,
  unmet: readonly UnmetRequirement[],
): string {
  if (unmet.length === 0) return `Cannot enter ${targetPhase}.`;
  const parts = unmet.map(describe);
  const list = parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join("; ")}; and ${parts[parts.length - 1]}`;
  return (
    `This cannot move into ${targetPhase} yet because ${list}. `
    + "These are recorded by reviewers, not by you — nothing here is waiting on your input."
  );
}
